import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createWorldsteelBatchImportRunCommands } from "../../scripts/commands/worldsteel-batch-import-run.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const worldsteelDocsDir = path.join(repoRoot, "docs", "import-profiles", "worldsteel");

type WorldsteelProfileFile = {
  profiles: {
    worldsteel: {
      docs: string[];
      allow_account_local_support_and_elementary: {
        enabled: boolean;
        scope: string[];
        authorized_by: string;
        note: string;
      };
    };
  };
};

function activeWorldsteelDocs(): string[] {
  return fs
    .readdirSync(worldsteelDocsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.posix.join("docs/import-profiles/worldsteel", entry.name))
    .sort();
}

function documentedRuntimeValues(source: string): boolean[] {
  return [...source.matchAll(/mintUnmatchedFpUgSupport\s*(?:=|:)\s*`?(true|false)/gu)].map(
    (match) => match[1] === "true",
  );
}

test("Worldsteel runtime, profile authorization, and every active document expose one support-mint truth", () => {
  let runtimeConfig: Record<string, unknown> | undefined;
  const runner = () => undefined;
  createWorldsteelBatchImportRunCommands(
    {},
    {
      createBafuBatchImportRunCommands(_deps, config) {
        runtimeConfig = config;
        return { runDatasetBafuBatchImportRun: runner };
      },
    },
  );

  assert.ok(runtimeConfig, "Worldsteel factory must pass a profile config to the batch engine");
  const runtimeValue = runtimeConfig.mintUnmatchedFpUgSupport;
  assert.equal(runtimeValue, true, "retained PR #20 delivery evidence freezes the runtime on");

  const profile = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "specs", "import-profiles.json"), "utf8"),
  ) as WorldsteelProfileFile;
  const worldsteel = profile.profiles.worldsteel;
  assert.equal(worldsteel.allow_account_local_support_and_elementary.enabled, true);
  assert.deepEqual(
    new Set(worldsteel.allow_account_local_support_and_elementary.scope),
    new Set([
      "elementary_flow_write",
      "elementary_flow_create_new",
      "flowproperty_write",
      "unitgroup_write",
      "canonical_support_local_mint",
    ]),
  );
  assert.deepEqual(
    [
      ...new Set(
        documentedRuntimeValues(worldsteel.allow_account_local_support_and_elementary.note),
      ),
    ],
    [runtimeValue],
    "The structured profile authorization must document the frozen executable value",
  );
  assert.match(
    worldsteel.allow_account_local_support_and_elementary.note,
    /enabled=false only when both the R3 elementary residual and R5 FP\/UG support/iu,
  );

  const activeDocs = activeWorldsteelDocs();
  assert.deepEqual(
    [...worldsteel.docs].sort(),
    activeDocs,
    "The profile must navigate AI developers to every active Worldsteel document",
  );
  for (const relativePath of activeDocs) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.deepEqual(
      [...new Set(documentedRuntimeValues(source))],
      [runtimeValue],
      `${relativePath} must declare only the executable mintUnmatchedFpUgSupport value`,
    );
    assert.match(source, /canonical(?:-support)?[- ]cache/iu, relativePath);
    assert.match(source, /state_code=0/iu, relativePath);
    assert.match(source, /defer/iu, relativePath);
    assert.match(source, /independent ready scope/iu, relativePath);
    assert.match(
      source,
      /(?:not a runtime|no LANCA|neither)[^.\n]*(?:allow|white)list/iu,
      relativePath,
    );
    assert.match(
      source,
      /(?:Unit Groups? (?:are )?(?:ordered before|precede) Flow Propert|Unit Group before Flow Property)/iu,
      relativePath,
    );
    assert.match(source, /00\.00\.001/u, relativePath);
    for (const line of source.split("\n").filter((value) => value.includes("enabled=false"))) {
      assert.match(line, /both .*R3.*R5 .*FP\/UG/iu, relativePath);
    }
  }

  const retainedEvidence = fs.readFileSync(
    path.join(worldsteelDocsDir, "import-coverage.md"),
    "utf8",
  );
  assert.match(retainedEvidence, /10\+10 EF3\.1 LANCA/iu);
  assert.match(retainedEvidence, /Flow properties[^\n]*\|\s*11\s*\|/iu);
  assert.match(retainedEvidence, /Unit groups[^\n]*\|\s*11\s*\|/iu);
  assert.match(worldsteel.allow_account_local_support_and_elementary.authorized_by, /2026-07-01/u);
  assert.match(worldsteel.allow_account_local_support_and_elementary.note, /LANCA/u);
});
