import fs from "node:fs";
import {
  FOUNDRY_PUBLISH_WORKFLOW,
  FOUNDRY_RELEASE_REPOSITORY,
  inspectFoundryRelease,
  readFoundryReleaseGit as git,
  type FoundryReleaseChange,
} from "./foundry-release-contract.ts";

export interface FoundryReleaseWorkflowEvent {
  readonly mode: "main-push" | "tag-recovery";
  readonly ref: string;
  readonly base: string | null;
  readonly head: string;
}

export type FoundryReleaseWorkflowContext = FoundryReleaseChange & {
  readonly schema: "tiangong-foundry.release-workflow-context.v1";
  readonly mode: FoundryReleaseWorkflowEvent["mode"];
  readonly ref: string;
  readonly base: string;
  readonly head: string;
  readonly tree: string;
};

export interface FoundryReleasePr {
  readonly number: number;
  readonly url: string;
  readonly head: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Foundry release ${label} must be an object.`);
  return value as Record<string, unknown>;
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value) && value !== "0".repeat(40);
}

export function parseFoundryReleaseWorkflowEvent(
  environment: Readonly<NodeJS.ProcessEnv>,
  payload: unknown,
): FoundryReleaseWorkflowEvent {
  const event = record(payload, "event");
  const head = environment.GITHUB_SHA,
    ref = environment.GITHUB_REF;
  if (
    environment.GITHUB_ACTIONS !== "true" ||
    environment.GITHUB_REPOSITORY !== FOUNDRY_RELEASE_REPOSITORY ||
    record(event.repository, "event repository").full_name !== FOUNDRY_RELEASE_REPOSITORY ||
    !sha(head) ||
    typeof ref !== "string" ||
    environment.GITHUB_WORKFLOW_SHA !== head ||
    environment.GITHUB_WORKFLOW_REF !==
      `${FOUNDRY_RELEASE_REPOSITORY}/${FOUNDRY_PUBLISH_WORKFLOW}@${ref}`
  )
    throw new Error(
      "Foundry release requires the canonical workflow definition at its exact event commit.",
    );
  if (environment.GITHUB_EVENT_NAME === "push") {
    if (
      ref !== "refs/heads/main" ||
      event.ref !== ref ||
      !sha(event.before) ||
      event.before === head ||
      event.after !== head ||
      event.created !== false ||
      event.deleted !== false ||
      event.forced !== false ||
      record(event.head_commit, "push head commit").id !== head
    )
      throw new Error("Foundry release requires an ordinary exact main push.");
    return Object.freeze({ mode: "main-push", ref, base: event.before, head });
  }
  if (
    environment.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    !/^refs\/tags\/foundry-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(ref) ||
    ref.length > 90
  )
    throw new Error(
      "Foundry release recovery must dispatch the exact existing stable version tag.",
    );
  if (event.ref !== undefined && event.ref !== ref && event.ref !== ref.slice("refs/tags/".length))
    throw new Error("Foundry release recovery event ref does not match its workflow ref.");
  if (
    event.inputs !== undefined &&
    event.inputs !== null &&
    Object.keys(record(event.inputs, "recovery inputs")).length
  )
    throw new Error("Foundry release recovery accepts no alternate source or tag input.");
  return Object.freeze({ mode: "tag-recovery", ref, base: null, head });
}

export function inspectFoundryReleaseWorkflow(
  root: string,
  event: FoundryReleaseWorkflowEvent,
): FoundryReleaseWorkflowContext {
  const actualRoot = fs.realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim());
  if (
    actualRoot !== fs.realpathSync(root) ||
    git(root, ["rev-parse", "HEAD"]).trim() !== event.head
  )
    throw new Error(
      "Foundry release checkout must match the exact workflow source root and commit.",
    );
  if (git(root, ["status", "--porcelain", "--untracked-files=all"]).trim())
    throw new Error("Foundry release source checkout must be clean.");
  git(root, ["merge-base", "--is-ancestor", event.head, "refs/remotes/origin/main"]);
  const base = event.base ?? git(root, ["rev-parse", `${event.head}^1`]).trim();
  const inspection = inspectFoundryRelease(root, base, event.head);
  if (event.mode === "tag-recovery") {
    if (
      !inspection.release ||
      event.ref !== `refs/tags/${inspection.tag}` ||
      git(root, ["rev-parse", `${event.ref}^{commit}`]).trim() !== event.head
    )
      throw new Error(
        "Foundry release recovery tag must bind the exact main release-only version commit.",
      );
  }
  return Object.freeze({
    ...inspection,
    schema: "tiangong-foundry.release-workflow-context.v1",
    mode: event.mode,
    ref: event.ref,
  });
}

export function validateMergedFoundryReleasePr(pulls: unknown, head: string): FoundryReleasePr {
  if (!sha(head) || !Array.isArray(pulls) || pulls.length > 100)
    throw new Error("Foundry release requires bounded merged PR evidence for the exact commit.");
  const matches = pulls
    .map((value: unknown) => record(value, "PR evidence"))
    .filter((pull) => {
      const base = record(pull.base, "PR base"),
        source = record(pull.head, "PR head");
      return (
        pull.state === "closed" &&
        typeof pull.merged_at === "string" &&
        Number.isFinite(Date.parse(pull.merged_at)) &&
        pull.merge_commit_sha === head &&
        base.ref === "main" &&
        record(base.repo, "PR base repository").full_name === FOUNDRY_RELEASE_REPOSITORY &&
        record(source.repo, "PR head repository").full_name === FOUNDRY_RELEASE_REPOSITORY
      );
    });
  if (matches.length !== 1)
    throw new Error("Foundry release requires one merged canonical main PR for the exact commit.");
  const pull = matches[0],
    source = record(pull.head, "PR source");
  if (
    typeof pull.number !== "number" ||
    !Number.isSafeInteger(pull.number) ||
    pull.number < 1 ||
    !sha(source.sha) ||
    pull.html_url !== `https://github.com/${FOUNDRY_RELEASE_REPOSITORY}/pull/${pull.number}`
  )
    throw new Error("Foundry release merged PR identity is invalid.");
  return Object.freeze({ number: pull.number, url: pull.html_url, head: source.sha });
}

export async function fetchMergedFoundryReleasePr(
  head: string,
  token: string,
): Promise<FoundryReleasePr> {
  if (!sha(head) || !token || /\s/u.test(token))
    throw new Error("Foundry release GitHub lookup requires an exact commit and workflow token.");
  const response = await fetch(
    `https://api.github.com/repos/${FOUNDRY_RELEASE_REPOSITORY}/commits/${head}/pulls?per_page=100`,
    {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}` },
    },
  );
  const limit = 4 * 1024 * 1024;
  if (
    !response.ok ||
    !response.body ||
    response.headers.get("link")?.includes('rel="next"') ||
    Number(response.headers.get("content-length") ?? 0) > limit
  ) {
    await response.body?.cancel();
    throw new Error(
      `Foundry release GitHub lookup is unavailable or incomplete (HTTP ${response.status}).`,
    );
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > limit) throw new Error("Foundry release GitHub lookup exceeded its byte bound.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, total),
    text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes))
    throw new Error("Foundry release PR evidence must be valid UTF-8.");
  const result: unknown = JSON.parse(text);
  return validateMergedFoundryReleasePr(result, head);
}
