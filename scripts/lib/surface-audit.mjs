import fs from "node:fs";
import path from "node:path";
import { commandCategories, commandMetadata } from "./foundry-command-metadata.mjs";
import { knownCommands } from "./foundry-command-registry.mjs";

const commandHandlerHelpKeys = new Set(["help", "--help", "-h"]);
const deprecatedNamePattern = /\b(?:legacy|deprecated|compat|compatibility|alias|old)\b/iu;
const scriptEntrypoints = new Set([
  "scripts/foundry.mjs",
  "scripts/foundry-golden-diff.mjs",
  "scripts/with-lca-account.mjs",
]);

function portablePath(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

function walkFiles(root, relativeDir, predicate, files = []) {
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

function readTextIfExists(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
}

function commandHandlerKeys(repoRoot) {
  const source = readTextIfExists(repoRoot, "scripts/lib/foundry-cli.mjs");
  const match = source.match(/const commandHandlers = \{([\s\S]*?)\n  \};/u);
  if (!match) return [];
  return [...match[1].matchAll(/^\s*(?:"([^"]+)"|([A-Za-z_$][\w$-]*))\s*:/gmu)]
    .map((item) => item[1] ?? item[2])
    .filter(Boolean);
}

function auditLegacyAliases(repoRoot) {
  const errors = [];
  const warnings = [];
  const known = new Set(knownCommands);
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
  const packageJson = JSON.parse(readTextIfExists(repoRoot, "package.json"));
  for (const scriptName of Object.keys(packageJson.scripts ?? {})) {
    if (deprecatedNamePattern.test(scriptName)) {
      warnings.push({
        code: "deprecated_npm_script_name",
        message: "NPM script name looks like a legacy/deprecated compatibility alias.",
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

function auditMetadataCategories() {
  const errors = [];
  const warnings = [];
  const entries = Object.entries(commandMetadata);
  const categoryCounts = Object.fromEntries(commandCategories.map((category) => [category, 0]));
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

function registeredDocPaths(repoRoot) {
  const registered = new Set();
  const docpactText = readTextIfExists(repoRoot, ".docpact/config.yaml");
  for (const match of docpactText.matchAll(/docs\/[A-Za-z0-9._/-]+\.md/gu)) {
    registered.add(match[0]);
  }
  const registry = JSON.parse(
    readTextIfExists(repoRoot, "docs/file-location-registry.json") || '{"entries":[]}',
  );
  if (registry.policy_doc) registered.add(registry.policy_doc);
  for (const entry of registry.entries ?? []) {
    if (entry.current_path?.endsWith(".md")) registered.add(entry.current_path);
    for (const ref of entry.referenced_by ?? []) {
      if (String(ref).endsWith(".md")) registered.add(ref);
    }
  }
  return registered;
}

function auditOrphanDocs(repoRoot) {
  const errors = [];
  const warnings = [];
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

function importedModulePaths(repoRoot) {
  const imported = new Set();
  const jsFiles = [
    ...walkFiles(repoRoot, "scripts", (file) => file.endsWith(".mjs")),
    ...walkFiles(repoRoot, "test", (file) => file.endsWith(".mjs")),
  ];
  for (const file of jsFiles) {
    const text = readTextIfExists(repoRoot, file);
    for (const match of text.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/gu)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const resolved = portablePath(
        path.normalize(
          path.join(
            path.dirname(file),
            specifier.endsWith(".mjs") ? specifier : `${specifier}.mjs`,
          ),
        ),
      );
      imported.add(resolved);
    }
  }
  return imported;
}

function auditInboundModules(repoRoot) {
  const errors = [];
  const warnings = [];
  const modules = walkFiles(repoRoot, "scripts", (file) => file.endsWith(".mjs")).sort();
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

export function runSurfaceAudit({ repoRoot, nowIso }) {
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
