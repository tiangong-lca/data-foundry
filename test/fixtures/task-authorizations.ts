import fs from "node:fs";
import path from "node:path";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import {
  type TaskAuthorizationAction,
  type TaskAuthorizationBinding,
  taskAuthorizationActions,
  validateTaskAuthorization,
} from "../../scripts/lib/task-authorization.ts";

export function taskAuthorizationFixture(profileId = "bafu", profile: unknown = {}) {
  const binding: TaskAuthorizationBinding = {
    workspace_id: "fixture-workspace",
    task_id: "fixture-task",
    actor_id: "fixture-agent",
    project_ref: "aaaaaaaaaaaaaaaaaaaa",
    user_id: "11111111-1111-4111-8111-111111111111",
    profile_id: profileId,
    profile_sha256: sha256Json(profile),
    input_scope_sha256: sha256Json({ fixture: "exact-input-scope" }),
  };
  const issued = Date.now();
  const authorization = {
    schema: "tiangong-foundry.task-authorization.v1",
    binding: { ...binding },
    issued_at_utc: new Date(issued).toISOString(),
    expires_at_utc: new Date(issued + 3_600_000).toISOString(),
    remote_state_code: 0,
    allowed_actions: [...taskAuthorizationActions] as TaskAuthorizationAction[],
    qa_waivers: [] as { dataset_type: string; code: string; evidence_ids: string[] }[],
    evidence: [
      {
        id: "approval",
        kind: "user-decision",
        reference: "fixture/approval.md",
        sha256: sha256Json("fixture approval"),
      },
    ],
  };
  return { binding, authorization, nowMs: issued };
}

/** Explicit positive fixtures opt in per test; no automatic legacy profile approval. */
export function authorizedProfileOptions(
  repoRoot: string,
  profileId: string,
  actions: TaskAuthorizationAction[] = [...taskAuthorizationActions],
  inputScopeSha256?: string,
) {
  const config = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "specs/import-profiles.json"), "utf8"),
  ) as { profiles: Record<string, unknown> };
  const fixture = taskAuthorizationFixture(profileId, config.profiles[profileId]);
  fixture.authorization.allowed_actions = actions;
  if (inputScopeSha256) {
    fixture.binding.input_scope_sha256 = inputScopeSha256;
    fixture.authorization.binding.input_scope_sha256 = inputScopeSha256;
  }
  const result = validateTaskAuthorization(fixture.authorization, fixture.binding, fixture.nowMs);
  if (result.status !== "authorized") throw new Error("Invalid task authorization test fixture.");
  return { taskAuthorization: result.authorization, taskAuthorizationBinding: fixture.binding };
}
