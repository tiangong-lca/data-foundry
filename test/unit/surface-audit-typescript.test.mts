import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runSurfaceAudit } from "../../scripts/lib/surface-audit.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

type AuditFinding = {
  code?: string;
  command?: string;
  message?: string;
  path?: string;
  script?: string;
};

type AuditCheck = {
  name?: string;
  ok: boolean;
  scanned?: number;
  errors: AuditFinding[];
  warnings: AuditFinding[];
};

type SurfaceReport = {
  schema_version: number;
  generated_at_utc: string;
  status: string;
  checks: AuditCheck[];
  counts: { checks: number; errors: number; warnings: number };
};

function scriptModules(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return scriptModules(entryPath);
    return entry.isFile() && /\.(?:mjs|mts|ts)$/u.test(entry.name) ? [entryPath] : [];
  });
}

function withRepositoryFixture<T>(
  files: Record<string, string>,
  callback: (fixtureRoot: string) => T,
): T {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-surface-audit-"));
  try {
    for (const [relativePath, contents] of Object.entries({
      "package.json": '{"scripts":{}}\n',
      ...files,
    })) {
      const absolutePath = path.join(fixtureRoot, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, contents);
    }
    return callback(fixtureRoot);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function auditFixture(files: Record<string, string>): SurfaceReport {
  return withRepositoryFixture(files, (fixtureRoot) =>
    runSurfaceAudit({
      repoRoot: fixtureRoot,
      nowIso: () => "2026-08-25T00:00:00.000Z",
    }),
  );
}

function reportCheck(report: SurfaceReport, name: string): AuditCheck {
  const check = report.checks.find((candidate) => candidate.name === name);
  assert.ok(check, `missing ${name} check`);
  return check;
}

test("surface audit includes TypeScript modules and explicit TypeScript imports", () => {
  const report = runSurfaceAudit({
    repoRoot,
    nowIso: () => "2026-08-25T00:00:00.000Z",
  });
  const inbound = report.checks.find(
    (check: { name?: string }) => check.name === "inbound_modules",
  ) as
    | {
        ok: boolean;
        scanned: number;
        errors: Array<{ path?: string }>;
      }
    | undefined;
  assert.ok(inbound);
  assert.equal(inbound.ok, true, JSON.stringify(inbound));
  assert.equal(inbound.scanned, scriptModules(path.join(repoRoot, "scripts")).length);
  assert.equal(
    inbound.errors.some((error) => error.path === "scripts/lib/production-case-policy.ts"),
    false,
  );
});

test("surface audit report preserves its exact top-level and check ordering contract", () => {
  const report = runSurfaceAudit({
    repoRoot,
    nowIso: () => "2026-08-25T00:00:00.000Z",
  });
  assert.deepEqual(Object.keys(report), [
    "schema_version",
    "generated_at_utc",
    "status",
    "checks",
    "counts",
  ]);
  assert.equal(report.schema_version, 1);
  assert.equal(report.generated_at_utc, "2026-08-25T00:00:00.000Z");
  assert.deepEqual(
    report.checks.map((check) => check.name),
    ["legacy_aliases", "metadata_categories", "orphan_docs", "inbound_modules"],
  );
  assert.deepEqual(report.counts, {
    checks: 4,
    errors: report.checks.flatMap((check) => check.errors).length,
    warnings: report.checks.flatMap((check) => check.warnings).length,
  });
});

test("deprecated package-script warnings use package-manager-neutral wording", () => {
  const report = auditFixture({
    "package.json": '{"scripts":{"legacy-task":"node task.mjs"}}\n',
  });
  assert.deepEqual(reportCheck(report, "legacy_aliases").warnings, [
    {
      code: "deprecated_npm_script_name",
      message: "Package script name looks like a legacy/deprecated compatibility alias.",
      script: "legacy-task",
    },
  ]);
});

test("surface audit resolves explicit TypeScript and dynamic imports", () => {
  const report = auditFixture({
    "scripts/foundry.mjs": [
      'import { explicit } from "./lib/explicit.ts";',
      'const dynamic = await import("./lib/dynamic.ts");',
      "void [explicit, dynamic];",
    ].join("\n"),
    "scripts/lib/explicit.ts": "export const explicit = true;\n",
    "scripts/lib/dynamic.ts": "export const dynamic = true;\n",
  });
  const inbound = reportCheck(report, "inbound_modules");
  assert.equal(inbound.scanned, 3);
  assert.deepEqual(inbound.errors, []);
});

test("surface audit emits portable POSIX paths and ignores test-only inbound imports", () => {
  const report = auditFixture({
    "scripts/foundry.mjs": 'import { run } from "./lib/foundry-cli.mjs";\nvoid run;\n',
    "scripts/lib/foundry-cli.mjs": "export const run = true;\n",
    "scripts/lib/only-from-test.ts": "export const testOnly = true;\n",
    "test/unit/consumer.test.mts":
      'import { testOnly } from "../../scripts/lib/only-from-test.ts";\nvoid testOnly;\n',
  });
  const inbound = reportCheck(report, "inbound_modules");
  assert.deepEqual(
    inbound.errors.map((error) => error.path),
    ["scripts/lib/only-from-test.ts"],
  );
  assert.ok(inbound.errors.every((error) => !error.path?.includes("\\")));
});

test("surface audit keeps registered and profile docs while reporting true orphan docs", () => {
  const report = auditFixture({
    ".docpact/config.yaml": "docs:\n  - docs/registered.md\n",
    "docs/registered.md": "# Registered\n",
    "docs/orphan.md": "# Orphan\n",
    "docs/import-profiles/sample/profile.md": "# Profile\n",
  });
  const orphanDocs = reportCheck(report, "orphan_docs");
  assert.deepEqual(
    orphanDocs.warnings.map((warning) => warning.path),
    ["docs/orphan.md"],
  );
});

test("surface audit exempts declared entrypoints but detects hidden handlers and random scripts", () => {
  const entrypointReport = auditFixture({
    "scripts/check-tidas-cutover.mjs": "export {};\n",
    "scripts/foundry.mjs": "export {};\n",
    "scripts/foundry-golden-diff.mjs": "export {};\n",
    "scripts/cases/production-contact-draft.ts": "export {};\n",
    "scripts/with-lca-account.ts": "export {};\n",
  });
  const entrypointInbound = reportCheck(entrypointReport, "inbound_modules");
  assert.equal(entrypointInbound.scanned, 5);
  assert.deepEqual(entrypointInbound.errors, []);

  const guardedReport = auditFixture({
    "scripts/foundry.mjs":
      'import { commandHandlers } from "./lib/foundry-cli.mjs";\nvoid commandHandlers;\n',
    "scripts/lib/foundry-cli.mjs": [
      "const commandHandlers = {",
      "    help: () => null,",
      '    "hidden-command": () => null,',
      "  };",
      "export { commandHandlers };",
    ].join("\n"),
    "scripts/random.ts": "export const random = true;\n",
  });
  assert.deepEqual(
    reportCheck(guardedReport, "legacy_aliases").errors.map((error) => ({
      code: error.code,
      command: error.command,
    })),
    [{ code: "hidden_command_handler", command: "hidden-command" }],
  );
  assert.deepEqual(
    reportCheck(guardedReport, "inbound_modules").errors.map((error) => error.path),
    ["scripts/random.ts"],
  );
});

test("metadata and surface audit leaves are native TypeScript with updated consumers", () => {
  for (const stem of ["foundry-command-metadata", "surface-audit"]) {
    assert.equal(fs.existsSync(path.join(repoRoot, `scripts/lib/${stem}.ts`)), true);
    assert.equal(fs.existsSync(path.join(repoRoot, `scripts/lib/${stem}.mjs`)), false);
  }
  const expectedImports = [
    ["scripts/commands/core.mjs", "../lib/surface-audit.ts"],
    ["scripts/lib/surface-audit.ts", "./foundry-command-metadata.ts"],
    [
      "test/unit/foundry-command-metadata.test.mts",
      "../../scripts/lib/foundry-command-metadata.ts",
    ],
    ["test/unit/surface-audit-typescript.test.mts", "../../scripts/lib/surface-audit.ts"],
  ] as const;
  for (const [consumer, specifier] of expectedImports) {
    assert.match(
      fs.readFileSync(path.join(repoRoot, consumer), "utf8"),
      new RegExp(`from ["']${specifier.replaceAll(".", "\\.")}["']`, "u"),
      `${consumer} must import ${specifier}`,
    );
  }
  assert.match(
    fs.readFileSync(path.join(repoRoot, "test/commands/account-context-wrapper.test.mts"), "utf8"),
    /["']surface-audit\.ts["']/u,
  );
});
