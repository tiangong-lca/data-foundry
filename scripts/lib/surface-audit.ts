import fs from "node:fs";
import path from "node:path";
import { commandCategories, commandMetadata } from "./foundry-command-metadata.ts";
import { knownCommands } from "./foundry-command-registry.ts";

export type SurfaceAuditFinding = {
  code: string;
  message?: string;
  command?: string;
  script?: string;
  category?: string;
  path?: string;
};

export type SurfaceAuditCheck = {
  name: string;
  ok: boolean;
  errors: SurfaceAuditFinding[];
  warnings: SurfaceAuditFinding[];
  scanned?: number;
  category_counts?: Record<string, number>;
};

export type SurfaceAuditReport = {
  schema_version: number;
  generated_at_utc: string;
  status: "passed" | "failed";
  checks: SurfaceAuditCheck[];
  counts: {
    checks: number;
    errors: number;
    warnings: number;
  };
};

type SurfaceAuditOptions = {
  repoRoot: string;
  nowIso: () => string;
};

type FileLocationRegistry = {
  policy_doc?: string;
  entries?: Array<{
    current_path?: string;
    referenced_by?: string[];
  }>;
};

type PackageJson = {
  scripts?: Record<string, unknown>;
};

const commandHandlerHelpKeys = new Set(["help", "--help", "-h"]);
const deprecatedNamePattern = /\b(?:legacy|deprecated|compat|compatibility|alias|old)\b/iu;
const scriptEntrypoints = new Set([
  "scripts/check-tidas-cutover.ts",
  "scripts/foundry.ts",
  "scripts/foundry-golden-diff.ts",
  "scripts/cases/production-contact-draft.ts",
  "scripts/with-lca-account.ts",
]);

function portablePath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function walkFiles(
  root: string,
  relativeDir: string,
  predicate: (relativePath: string) => boolean,
  files: string[] = [],
): string[] {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return files;
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = portablePath(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) {
      walkFiles(root, relativePath, predicate, files);
    } else if (entry.isFile() && predicate(relativePath)) {
      files.push(relativePath);
    }
  }
  return files;
}

function readTextIfExists(root: string, relativePath: string): string {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
}

function commandHandlerKeys(repoRoot: string): string[] {
  const source = readTextIfExists(repoRoot, "scripts/lib/foundry-cli.ts");
  const match = source.match(/const commandHandlers = \{([\s\S]*?)\n  \};/u);
  if (!match) return [];
  return [...match[1].matchAll(/^\s*(?:"([^"]+)"|([A-Za-z_$][\w$-]*))\s*:/gmu)]
    .map((item) => item[1] ?? item[2])
    .filter((value): value is string => Boolean(value));
}

function auditLegacyAliases(repoRoot: string): SurfaceAuditCheck {
  const errors: SurfaceAuditFinding[] = [];
  const warnings: SurfaceAuditFinding[] = [];
  const known = new Set<string>(knownCommands);
  const hiddenHandlers = commandHandlerKeys(repoRoot).filter(
    (command) => !known.has(command) && !commandHandlerHelpKeys.has(command),
  );
  for (const command of hiddenHandlers) {
    errors.push({
      code: "hidden_command_handler",
      message:
        "Foundry command handlers must be declared in the public command registry; hidden aliases become unmaintained surfaces.",
      command,
    });
  }
  for (const command of knownCommands) {
    if (deprecatedNamePattern.test(command)) {
      warnings.push({
        code: "deprecated_command_name",
        message: "Command name looks like a legacy/deprecated compatibility surface.",
        command,
      });
    }
  }
  const packageJson = JSON.parse(readTextIfExists(repoRoot, "package.json")) as PackageJson;
  for (const scriptName of Object.keys(packageJson.scripts ?? {})) {
    if (deprecatedNamePattern.test(scriptName)) {
      warnings.push({
        code: "deprecated_npm_script_name",
        message: "Package script name looks like a legacy/deprecated compatibility alias.",
        script: scriptName,
      });
    }
  }
  return {
    name: "legacy_aliases",
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function auditMetadataCategories(): SurfaceAuditCheck {
  const errors: SurfaceAuditFinding[] = [];
  const warnings: SurfaceAuditFinding[] = [];
  const entries = Object.entries(commandMetadata);
  const categoryCounts = Object.fromEntries(
    commandCategories.map((category) => [category, 0]),
  ) as Record<string, number>;
  for (const [command, metadata] of entries) {
    if (!metadata?.category) {
      errors.push({
        code: "command_metadata_category_missing",
        command,
      });
      continue;
    }
    if (!commandCategories.includes(metadata.category)) {
      errors.push({
        code: "command_metadata_category_unknown",
        command,
        category: metadata.category,
      });
      continue;
    }
    categoryCounts[metadata.category] += 1;
  }
  for (const [category, count] of Object.entries(categoryCounts)) {
    if (count === 0) {
      errors.push({
        code: "empty_command_metadata_category",
        category,
      });
    }
  }
  return {
    name: "metadata_categories",
    ok: errors.length === 0,
    category_counts: categoryCounts,
    errors,
    warnings,
  };
}

function registeredDocPaths(repoRoot: string): Set<string> {
  const registered = new Set<string>();
  const docpactText = readTextIfExists(repoRoot, ".docpact/config.yaml");
  for (const match of docpactText.matchAll(/docs\/[A-Za-z0-9._/-]+\.md/gu)) {
    registered.add(match[0]);
  }
  const registry = JSON.parse(
    readTextIfExists(repoRoot, "docs/file-location-registry.json") || '{"entries":[]}',
  ) as FileLocationRegistry;
  if (registry.policy_doc) registered.add(registry.policy_doc);
  for (const entry of registry.entries ?? []) {
    if (entry.current_path?.endsWith(".md")) registered.add(entry.current_path);
    for (const ref of entry.referenced_by ?? []) {
      if (String(ref).endsWith(".md")) registered.add(ref);
    }
  }
  return registered;
}

function auditOrphanDocs(repoRoot: string): SurfaceAuditCheck {
  const errors: SurfaceAuditFinding[] = [];
  const warnings: SurfaceAuditFinding[] = [];
  const docs = walkFiles(repoRoot, "docs", (file) => file.endsWith(".md")).sort();
  const registered = registeredDocPaths(repoRoot);
  const searchFiles = [
    "AGENTS.md",
    "README.md",
    "WORKFLOW.md",
    ".docpact/config.yaml",
    "docs/file-location-registry.json",
    ...walkFiles(repoRoot, "docs", (file) => /\.(?:md|json|ya?ml)$/u.test(file)),
    ...walkFiles(repoRoot, "specs", (file) => /\.(?:md|json|ya?ml)$/u.test(file)),
  ];
  for (const doc of docs) {
    const hasInboundReference = searchFiles.some((file) => {
      if (file === doc) return false;
      return readTextIfExists(repoRoot, file).includes(doc);
    });
    const profileDoc = doc.startsWith("docs/import-profiles/");
    if (!hasInboundReference && !registered.has(doc) && !profileDoc) {
      warnings.push({
        code: "unregistered_orphan_doc",
        message:
          "Markdown doc has no inbound reference and is not registered in docpact/file-location registry.",
        path: doc,
      });
    }
  }
  return {
    name: "orphan_docs",
    ok: errors.length === 0,
    scanned: docs.length,
    errors,
    warnings,
  };
}

function importedModulePaths(repoRoot: string): Set<string> {
  const imported = new Set<string>();
  const sourceFiles = [
    ...walkFiles(repoRoot, "scripts", (file) => /\.(?:cts|mts|ts)$/u.test(file)),
  ];
  for (const file of sourceFiles) {
    const text = readTextIfExists(repoRoot, file);
    for (const match of text.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/gu)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const base = portablePath(path.normalize(path.join(path.dirname(file), specifier)));
      const candidates = /\.(?:cts|mts|ts)$/u.test(base)
        ? [base]
        : [base, ...[".ts", ".mts", ".cts"].map((suffix) => `${base}${suffix}`)];
      const resolved = candidates.find((candidate) =>
        fs.existsSync(path.join(repoRoot, candidate)),
      );
      if (resolved) imported.add(resolved);
    }
  }
  return imported;
}

function auditInboundModules(repoRoot: string): SurfaceAuditCheck {
  const errors: SurfaceAuditFinding[] = [];
  const warnings: SurfaceAuditFinding[] = [];
  const modules = walkFiles(repoRoot, "scripts", (file) => /\.(?:cts|mts|ts)$/u.test(file)).sort();
  const imported = importedModulePaths(repoRoot);
  const metadataOwnerModules = new Set(
    Object.values(commandMetadata).map((entry) => entry.ownerModule),
  );
  for (const modulePath of modules) {
    if (scriptEntrypoints.has(modulePath)) continue;
    if (metadataOwnerModules.has(modulePath)) continue;
    if (!imported.has(modulePath)) {
      errors.push({
        code: "module_without_inbound_import",
        message:
          "Script module has no static inbound import and is not a registered command owner.",
        path: modulePath,
      });
    }
  }
  return {
    name: "inbound_modules",
    ok: errors.length === 0,
    scanned: modules.length,
    errors,
    warnings,
  };
}

export function runSurfaceAudit({ repoRoot, nowIso }: SurfaceAuditOptions): SurfaceAuditReport {
  const checks = [
    auditLegacyAliases(repoRoot),
    auditMetadataCategories(),
    auditOrphanDocs(repoRoot),
    auditInboundModules(repoRoot),
  ];
  const errors = checks.flatMap((check) => check.errors);
  const warnings = checks.flatMap((check) => check.warnings);
  return {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: errors.length === 0 ? "passed" : "failed",
    checks,
    counts: {
      checks: checks.length,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}
