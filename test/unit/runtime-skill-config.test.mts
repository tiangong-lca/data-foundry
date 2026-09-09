import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

interface SkillEntry {
  name: string;
  source: string;
  source_type: string;
  install_command: string;
  use_command: string;
}

interface SharedSkillsConfig {
  local_project_skills: SkillEntry[];
  shared_runtime_skills: SkillEntry[];
}

interface PackageConfig {
  scripts: Record<string, string>;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8")) as T;
}

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("migrated Foundry entry and authoring packages resolve to Skills without tracked local copies", () => {
  const config = readJson<SharedSkillsConfig>(".agents/shared-skills.json");
  const pkg = readJson<PackageConfig>("package.json");
  const registry = readJson<{ capabilities: Array<{ id: string; owner_project: string }> }>(
    "specs/automated-lca-capability-registry.json",
  );
  assert.equal(
    registry.capabilities.find((capability) => capability.id === "foundry.skill.tidas-import")
      ?.owner_project,
    "tiangong-lca-skills",
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  for (const name of ["foundry-tidas-import", "foundry-tidas-authoring"]) {
    assert.equal(
      config.local_project_skills.some((entry) => entry.name === name),
      false,
    );
    const shared = config.shared_runtime_skills.find((entry) => entry.name === name);
    assert.ok(shared);
    assert.equal(shared.source, "https://github.com/tiangong-lca/skills");
    assert.equal(shared.source_type, "github");
    assert.ok(shared.install_command.includes(`--skill ${name}`));
    assert.ok(pkg.scripts["skills:install:shared"].includes(name));
    const relative = `.agents/skills/${name}/`;
    assert.equal(
      execFileSync("git", ["-C", repoRoot, "ls-files", "--", relative], { env, encoding: "utf8" }),
      "",
    );
    assert.ok(readText(".gitignore").split("\n").includes(relative));
  }
});

test("document-granular-decompose is a runtime Tiangong AI skill, not a tracked Foundry skill", () => {
  const sharedSkills = readJson<SharedSkillsConfig>(".agents/shared-skills.json");
  const packageJson = readJson<PackageConfig>("package.json");
  const gitignore = readText(".gitignore");

  const localNames = new Set(sharedSkills.local_project_skills.map((skill) => skill.name));
  assert.equal(localNames.has("document-granular-decompose"), false);

  const runtimeSkill = sharedSkills.shared_runtime_skills.find(
    (skill) => skill.name === "document-granular-decompose",
  );
  assert.ok(runtimeSkill, "document-granular-decompose should be configured as a runtime skill");
  assert.equal(runtimeSkill.source, "https://github.com/tiangong-ai/skills");
  assert.equal(runtimeSkill.source_type, "github");
  assert.match(
    runtimeSkill.install_command,
    /skills@latest add https:\/\/github\.com\/tiangong-ai\/skills/,
  );
  assert.match(
    runtimeSkill.use_command,
    /skills@latest use https:\/\/github\.com\/tiangong-ai\/skills/,
  );

  assert.match(packageJson.scripts["skills:install:shared"], /document-granular-decompose/);
  assert.match(
    packageJson.scripts["skills:source-evidence:use:document"],
    /document-granular-decompose/,
  );
  assert.match(gitignore, /\.agents\/skills\/document-granular-decompose\//);
});
