import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

type BudgetContract = {
  schema_version: 1;
  owner_target_lines: number;
  semantic_stage_target_lines: number;
  pure_rule_target_lines: number;
  owner_ceiling_lines: Record<string, number>;
  semantic_module_ceiling_lines: Record<string, number>;
  allowed_upward_imports: Record<string, string[]>;
  allowed_cycles: string[][];
};

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const contractPath = path.join(repoRoot, "specs", "orchestration-module-budgets.json");

function trackedTypeScriptFiles(): string[] {
  return execFileSync("git", ["ls-files", "scripts/**/*.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);
}

function sourceLineCount(relativePath: string): number {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}

function relativeImports(relativePath: string): string[] {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  return [...source.matchAll(/(?:from\s+|import\s*)["'](?<specifier>\.[^"']+)["']/gu)]
    .map((match) => match.groups?.specifier ?? "")
    .filter(Boolean);
}

function resolveImport(fromPath: string, specifier: string, tracked: Set<string>): string | null {
  const candidate = path
    .relative(repoRoot, path.resolve(repoRoot, path.dirname(fromPath), specifier))
    .split(path.sep)
    .join(path.posix.sep);
  for (const pathCandidate of [
    candidate,
    candidate.replace(/\.js$/u, ".ts"),
    candidate.endsWith(".ts") ? candidate : `${candidate}.ts`,
    `${candidate}/index.ts`,
  ]) {
    if (tracked.has(pathCandidate)) return pathCandidate;
  }
  return null;
}

function stronglyConnectedComponents(graph: Map<string, string[]>): string[][] {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(node: string): void {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const neighbor of graph.get(node) ?? []) {
      if (!indexes.has(neighbor)) {
        visit(neighbor);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(neighbor)!));
      } else if (onStack.has(neighbor)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indexes.get(neighbor)!));
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    components.push(component.sort());
  }

  for (const node of [...graph.keys()].sort()) {
    if (!indexes.has(node)) visit(node);
  }
  return components
    .filter((component) => component.length > 1)
    .sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

test("orchestration owners have an explicit shrink-only line budget", () => {
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8")) as BudgetContract;
  assert.equal(contract.schema_version, 1);
  assert.equal(contract.owner_target_lines, 500);
  assert.equal(contract.semantic_stage_target_lines, 800);
  assert.equal(contract.pure_rule_target_lines, 1200);
  assert.deepEqual(Object.keys(contract.owner_ceiling_lines), [
    "scripts/commands/library-scope-workflow.ts",
    "scripts/commands/bafu-leaf-classification-tasks.ts",
    "scripts/commands/bafu-auto-authoring.ts",
    "scripts/commands/bafu-process-scope-e2e.ts",
    "scripts/commands/bafu-batch-import-run.ts",
  ]);
  for (const [relativePath, ceiling] of Object.entries(contract.owner_ceiling_lines)) {
    assert.ok(fs.existsSync(path.join(repoRoot, relativePath)), relativePath);
    assert.ok(sourceLineCount(relativePath) <= ceiling, `${relativePath} exceeds ${ceiling} lines`);
    assert.ok(
      contract.owner_target_lines < ceiling,
      `${relativePath} ceiling must shrink to target`,
    );
  }
  assert.deepEqual(Object.keys(contract.semantic_module_ceiling_lines), [
    "scripts/lib/bafu-authoring/name-plan.ts",
    "scripts/lib/batch-orchestration/scope-selection.ts",
  ]);
  for (const [relativePath, ceiling] of Object.entries(contract.semantic_module_ceiling_lines)) {
    assert.ok(fs.existsSync(path.join(repoRoot, relativePath)), relativePath);
    assert.ok(sourceLineCount(relativePath) <= ceiling, `${relativePath} exceeds ${ceiling} lines`);
  }
});

test("scripts/lib remains below command owners and the existing authoring SCC is the only cycle", () => {
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8")) as BudgetContract;
  const trackedFiles = trackedTypeScriptFiles();
  const tracked = new Set(trackedFiles);
  const graph = new Map<string, string[]>();

  for (const relativePath of trackedFiles) {
    const resolved = relativeImports(relativePath)
      .map((specifier) => resolveImport(relativePath, specifier, tracked))
      .filter((value): value is string => Boolean(value));
    graph.set(relativePath, resolved);
    if (relativePath.startsWith("scripts/lib/")) {
      assert.deepEqual(
        resolved.filter((dependency) => dependency.startsWith("scripts/commands/")).sort(),
        [...(contract.allowed_upward_imports[relativePath] ?? [])].sort(),
        `${relativePath} changed its command-owner imports`,
      );
    }
  }

  const expectedCycles = contract.allowed_cycles
    .map((component) => [...component].sort())
    .sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
  assert.deepEqual(stronglyConnectedComponents(graph), expectedCycles);
});
