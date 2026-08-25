import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

test("import-ledger contains no explicit any escape hatch", () => {
  const source = fs.readFileSync(path.join(repoRoot, "scripts", "lib", "import-ledger.ts"), "utf8");
  assert.doesNotMatch(source, /\bany\b/u);
});

test("import-ledger publishes a strict compile-time dependency, report, row, and result contract", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "import-ledger-types-"));
  try {
    const sourceModule = path.join(repoRoot, "scripts", "lib", "import-ledger.ts");
    let moduleSpecifier = path.relative(tempRoot, sourceModule).replaceAll("\\", "/");
    if (!moduleSpecifier.startsWith(".")) moduleSpecifier = `./${moduleSpecifier}`;
    const template = fs.readFileSync(
      path.join(repoRoot, "test", "type-fixtures", "import-ledger-contract.mts.txt"),
      "utf8",
    );
    const fixturePath = path.join(tempRoot, "import-ledger-contract.mts");
    fs.writeFileSync(fixturePath, template.replaceAll("__IMPORT_LEDGER_MODULE__", moduleSpecifier));

    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "tsc",
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2024",
        "--lib",
        "ES2024",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--verbatimModuleSyntax",
        "--allowImportingTsExtensions",
        "--types",
        "node",
        fixturePath,
      ],
      { cwd: repoRoot, encoding: "utf8", env: process.env },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
