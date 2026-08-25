import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

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
