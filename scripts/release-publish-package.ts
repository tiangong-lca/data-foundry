import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadFoundryReleaseWorkflowContext } from "./lib/foundry-release-workflow.ts";
import { createGitHubFoundryTagStore } from "./lib/foundry-release-tag.ts";
import {
  readFoundryReleaseArtifact,
  verifyPreparedFoundryNpm,
} from "./lib/foundry-release-prepared.ts";
import { verifyPublicNpmRelease } from "./lib/foundry-release-provenance.ts";
import { resolvePackageManagerCommand } from "./lib/package-manager-command.ts";
import {
  exchangeFoundryNpmOidcToken,
  foundryNpmPublishEnvironment,
  inspectFoundryNpmAvailability,
  publishOnceAndReadBack,
} from "./lib/foundry-release-publish.ts";

async function main(args: readonly string[]): Promise<void> {
  if (args.length || process.env.GITHUB_JOB !== "npm-package")
    throw new Error(
      "Package publication requires the owning npm-package workflow job and accepts no arguments.",
    );
  const root = path.resolve(import.meta.dirname, "..");
  const { context, pr } = await loadFoundryReleaseWorkflowContext(root, process.env);
  if (!context.release || !pr)
    throw new Error("Package publication requires the exact merged release-only source.");
  const expected = { version: context.version, gitHead: context.head };
  const preparedRoot = path.join(root, "package-artifacts", "npm-release");
  const prepared = await verifyPreparedFoundryNpm(preparedRoot, expected);
  const evidenceRoot = path.join(root, "package-artifacts", "npm-publication");
  fs.mkdirSync(evidenceRoot, { mode: 0o700 });
  const record = (status: "published" | "needs-maintainer" | "failed", detail: unknown): void => {
    fs.writeFileSync(
      path.join(evidenceRoot, "publication.json"),
      `${JSON.stringify(
        {
          schema: "tiangong-foundry.npm-publication.v1",
          status,
          package: prepared.package,
          source: prepared.source,
          prepared_tarball: prepared.tarball,
          detail,
        },
        null,
        2,
      )}\n`,
      { flag: "wx", mode: 0o600 },
    );
    if (process.env.GITHUB_OUTPUT)
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `npm_published=${status === "published"}\n`);
    const summary = `Foundry npm publication: ${status}. Package ${prepared.package.name}@${context.version}; source ${context.head}.\n\n\`\`\`json\n${JSON.stringify(detail, null, 2)}\n\`\`\`\n`;
    fs.writeFileSync(path.join(evidenceRoot, "README.md"), summary, { flag: "wx", mode: 0o600 });
    if (process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    process.stdout.write(
      `${JSON.stringify({ status, package: prepared.package, source: context.head })}\n`,
    );
  };
  const revalidateSource = async (): Promise<void> => {
    const fresh = await loadFoundryReleaseWorkflowContext(root, process.env);
    const tag = await createGitHubFoundryTagStore(process.env.GITHUB_TOKEN ?? "").read(
      `refs/tags/${context.tag}`,
    );
    if (
      !fresh.context.release ||
      fresh.context.head !== context.head ||
      fresh.context.tree !== context.tree ||
      tag?.head !== context.head
    )
      throw new Error("Package publication source or immutable tag changed.");
  };
  const readback = async () => {
    const result = await verifyPublicNpmRelease({ ...expected, package: "foundry" });
    if (
      result.evidence.tarball.sha512 !== prepared.tarball.sha512 ||
      result.evidence.tarball.bytes !== prepared.tarball.bytes
    )
      throw new Error("Published package bytes differ from the qualified prepared artifact.");
    return result;
  };
  let recorded = false;
  try {
    await revalidateSource();
    const availability = await inspectFoundryNpmAvailability(context.version);
    if (availability === "first-package-identity") {
      record("needs-maintainer", {
        reason: availability,
        next: "Verify the prepared artifact, then perform the documented one-time account/2FA upload. Configure the exact npm Trusted Publisher and rerun this immutable release tag.",
      });
      recorded = true;
      throw new Error(
        "The first npm package identity requires the prepared maintainer handoff; no upload was attempted.",
      );
    }
    let outcome;
    if (availability === "version-exists") {
      outcome = { transport: "existing-version", evidence: await readback() };
    } else {
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-npm-publish-"));
      fs.chmodSync(temporary, 0o700);
      try {
        for (const [artifact, algorithm, limit] of [
          [prepared.tarball, "sha512", 64 * 1024 * 1024],
          [prepared.provenance, "sha256", 4 * 1024 * 1024],
        ] as const) {
          const bytes = readFoundryReleaseArtifact(path.join(preparedRoot, artifact.file), limit);
          const digest = createHash(algorithm).update(bytes).digest("hex");
          const wanted =
            algorithm === "sha512" ? prepared.tarball.sha512 : prepared.provenance.sha256;
          if (digest !== wanted)
            throw new Error("Prepared publication bytes changed after verification.");
          fs.writeFileSync(path.join(temporary, artifact.file), bytes, { flag: "wx", mode: 0o400 });
        }
        const userConfig = path.join(temporary, "user.npmrc"),
          globalConfig = path.join(temporary, "global.npmrc");
        fs.writeFileSync(
          userConfig,
          "registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\nignore-pnpmfile=true\nignore-scripts=true\nstrict-ssl=true\n",
          { flag: "wx", mode: 0o600 },
        );
        fs.writeFileSync(globalConfig, "", { flag: "wx", mode: 0o600 });
        const environment = foundryNpmPublishEnvironment(process.env, userConfig, globalConfig, "");
        const gitContext = spawnSync("git", ["rev-parse", "--show-toplevel"], {
          cwd: temporary,
          env: environment,
          shell: false,
          encoding: "utf8",
          timeout: 10_000,
          maxBuffer: 256 * 1024,
        });
        if (gitContext.error || gitContext.status !== 128 || gitContext.stdout.trim())
          throw new Error("Publication staging must be outside every Git checkout.");
        const versionCommand = resolvePackageManagerCommand("pnpm", ["--version"], { environment });
        const version = spawnSync(versionCommand.executable, versionCommand.argv, {
          cwd: temporary,
          env: environment,
          shell: false,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 256 * 1024,
        });
        if (version.error || version.status !== 0 || version.stdout.trim() !== "11.24.0")
          throw new Error("Publication requires the pinned pnpm 11.24.0 executable.");
        const credential = await exchangeFoundryNpmOidcToken(context, process.env);
        await revalidateSource();
        const refreshedAvailability = await inspectFoundryNpmAvailability(context.version);
        if (refreshedAvailability === "first-package-identity")
          throw new Error("The npm package identity disappeared before publication.");
        if (refreshedAvailability === "version-exists") {
          outcome = { transport: "existing-version", evidence: await readback() };
        } else {
          const invocation = resolvePackageManagerCommand(
            "pnpm",
            [
              "publish",
              path.join(temporary, prepared.tarball.file),
              "--access",
              "public",
              "--tag",
              "latest",
              "--no-git-checks",
              "--config.fetch-retries=0",
              "--config.provenance=false",
              `--config.provenance-file=${path.join(temporary, prepared.provenance.file)}`,
            ],
            { environment },
          );
          outcome = await publishOnceAndReadBack(
            async () => {
              if (Date.now() >= credential.expiresAt - 30_000)
                throw new Error("The short-lived publishing credential expired before dispatch.");
              const result = spawnSync(invocation.executable, invocation.argv, {
                cwd: temporary,
                env: foundryNpmPublishEnvironment(
                  process.env,
                  userConfig,
                  globalConfig,
                  credential.token,
                ),
                shell: false,
                encoding: "utf8",
                timeout: 180_000,
                killSignal: "SIGKILL",
                maxBuffer: 2 * 1024 * 1024,
                stdio: ["ignore", "pipe", "pipe"],
              });
              if (result.error || result.status !== 0)
                throw new Error("The pnpm publication response was unsuccessful or uncertain.");
            },
            async () => {
              for (let attempt = 0; ; attempt++) {
                try {
                  return await readback();
                } catch (error) {
                  if (attempt >= 2) throw error;
                  await new Promise<void>((resolve) => setTimeout(resolve, (attempt + 1) * 5000));
                }
              }
            },
          );
        }
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    }
    for (const [name, bytes] of Object.entries({
      "registry-metadata.json": outcome.evidence.metadataBytes,
      "registry-attestations.json": outcome.evidence.attestationBytes,
      "verification.json": Buffer.from(`${JSON.stringify(outcome.evidence.evidence, null, 2)}\n`),
    }))
      fs.writeFileSync(path.join(evidenceRoot, name), bytes, { flag: "wx", mode: 0o600 });
    record("published", { transport: outcome.transport, verification: outcome.evidence.evidence });
    recorded = true;
  } catch (error) {
    if (!recorded)
      record("failed", {
        error: error instanceof Error ? error.message : "Package publication failed.",
        next: "Inspect this exact public version and fix the reported source, publisher or readback condition before an explicit rerun. No publish retry was performed.",
      });
    throw error;
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Package publication failed."}\n`,
    );
    process.exitCode = 1;
  });
