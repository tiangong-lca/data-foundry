import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runSurfaceAudit } from "../../scripts/lib/surface-audit.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function scriptModules(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return scriptModules(entryPath);
    return entry.isFile() && /\.(?:mjs|mts|ts)$/u.test(entry.name) ? [entryPath] : [];
  });
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
