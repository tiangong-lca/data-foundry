#!/usr/bin/env node
import { Ajv2020 } from "ajv/dist/2020.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parsers } from "prettier/plugins/babel";

export const SCHEMA_ID = "tiangong.supabase-consumer-manifest.v3";
export const REPOSITORY = "tiangong-lca/data-foundry";
export const CANONICAL_ORIGIN = "git@github.com:tiangong-lca/data-foundry.git";
export const MANIFEST_PATH = "contracts/supabase-consumer-manifest.v3.json";
export const SCHEMA_PATH = "contracts/supabase-consumer-manifest.v3.schema.json";
export const AUDIT_TOOL_PATH = "scripts/audit-supabase-consumers.mjs";
export const SOURCE_PATTERNS = [
  ".agents/skills/**/*.md",
  ".env.example",
  "package.json",
  "scripts/**/*.mjs",
  "specs/**/*.json",
];

const PUBLIC_CORE = new Set([
  "contacts",
  "flowproperties",
  "flows",
  "ilcd",
  "lciamethods",
  "lifecyclemodels",
  "processes",
  "sources",
  "unitgroups",
]);
const FORBIDDEN_CLIENT_MODULES = new Set([
  "@supabase/supabase-js",
  "pg",
  "postgres",
  "postgres.js",
]);
const CHILD_PROCESS_CALLS = new Set(["exec", "execFile", "execFileSync", "spawn", "spawnSync"]);
const CLI_CALLS = new Set([
  "resolveTiangongLcaCliCommand",
  "runJsonCli",
  "runTiangongJsonStage",
  "tiangongLcaCliInvocation",
]);
const ROUTE_RE = /\/(?:auth|functions|rest|storage)\/v1(?:\b|\/)/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const COMMIT_RE = /^[0-9a-f]{40}$/u;

export class ManifestError extends Error {}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(stable(value))}\n`, "utf8");
}

function cleanGitEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
}

function git(root, ...args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: null,
      env: cleanGitEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new ManifestError(
      `git ${args.join(" ")} failed: ${error.stderr?.toString("utf8").trim() || error.message}`,
    );
  }
}

function gitText(root, ...args) {
  return git(root, ...args)
    .toString("utf8")
    .trim();
}

function resolveCommit(root, revision) {
  const commit = gitText(root, "rev-parse", "--verify", `${revision}^{commit}`);
  if (!COMMIT_RE.test(commit))
    throw new ManifestError(`revision is not an exact commit: ${revision}`);
  return commit;
}

export function canonicalGithubRepository(remote) {
  const exact = String(remote).trim();
  let slug = null;
  if (exact.startsWith("git@github.com:")) {
    slug = exact.slice("git@github.com:".length);
  } else if (exact.startsWith("ssh://git@github.com/")) {
    slug = exact.slice("ssh://git@github.com/".length);
  } else if (exact.startsWith("https://github.com/")) {
    slug = exact.slice("https://github.com/".length);
  }
  slug = slug?.replace(/\.git$/u, "") ?? null;
  if (slug !== REPOSITORY) {
    throw new ManifestError(`origin must be canonical github.com ${REPOSITORY}; got ${exact}`);
  }
  return slug;
}

function sourcePath(filePath) {
  if (filePath === AUDIT_TOOL_PATH) return true;
  return (
    filePath === ".env.example" ||
    filePath === "package.json" ||
    (filePath.startsWith("scripts/") && filePath.endsWith(".mjs")) ||
    (filePath.startsWith("specs/") && filePath.endsWith(".json")) ||
    (filePath.startsWith(".agents/skills/") && filePath.endsWith(".md"))
  );
}

export function readGitTree(root, commit) {
  const resolved = resolveCommit(root, commit);
  if (resolved !== commit)
    throw new ManifestError(`sourceTreeCommit must be a full exact SHA: ${commit}`);
  const entries = [];
  for (const record of git(root, "ls-tree", "-r", "-z", "--full-tree", commit)
    .toString("utf8")
    .split("\0")) {
    if (!record) continue;
    const match = /^(\d{6}) (\S+) ([0-9a-f]{40})\t(.+)$/u.exec(record);
    if (!match || !sourcePath(match[4])) continue;
    const [, mode, type, oid, filePath] = match;
    if (type !== "blob" || !["100644", "100755"].includes(mode)) {
      throw new ManifestError(`governed source is not a regular Git blob: ${filePath}`);
    }
    const bytes = git(root, "cat-file", "blob", oid);
    entries.push({ path: filePath, mode, type, oid, bytes, sha256: sha256(bytes) });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return entries;
}

export function filteredTreeDigest(entries) {
  const projection = entries
    .filter((entry) => entry.path !== AUDIT_TOOL_PATH)
    .map(({ path: filePath, mode, type, oid }) => ({ path: filePath, mode, type, blobOid: oid }));
  return sha256(canonicalBytes(projection));
}

export function assertDeliveryTreeEqual(sourceEntries, deliveryEntries) {
  const project = (entries) =>
    new Map(
      entries
        .filter((entry) => entry.path !== AUDIT_TOOL_PATH)
        .map((entry) => [entry.path, `${entry.mode}:${entry.type}:${entry.oid}`]),
    );
  const source = project(sourceEntries);
  const delivery = project(deliveryEntries);
  const paths = new Set([...source.keys(), ...delivery.keys()]);
  const changed = [...paths]
    .filter((filePath) => source.get(filePath) !== delivery.get(filePath))
    .sort();
  if (changed.length > 0) {
    throw new ManifestError(
      `governed source drifted outside the exact audit-tool exemption: ${changed.slice(0, 20).join(", ")}`,
    );
  }
}

export function readNoFollowRegular(filePath) {
  let descriptor;
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new ManifestError(`artifact is not a regular file: ${filePath}`);
    return readFileSync(descriptor);
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    throw new ManifestError(`cannot read no-follow regular file ${filePath}: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function walk(node, parent, visit) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (["comments", "errors", "loc", "tokens"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, node, visit));
    else if (value && typeof value === "object" && typeof value.type === "string")
      walk(value, node, visit);
  }
}

function calleeName(node) {
  const callee = node.callee;
  if (callee?.type === "Identifier") return callee.name;
  if (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.property?.type === "Identifier"
  )
    return callee.property.name;
  if (
    callee?.type === "MemberExpression" &&
    callee.computed &&
    callee.property?.type === "StringLiteral"
  )
    return callee.property.value;
  return null;
}

function literalValue(node) {
  if (node?.type === "StringLiteral") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value?.cooked ?? "";
  return null;
}

function sourceFragment(source, node) {
  return source.slice(node.start, node.end);
}

function lineFor(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function makeOccurrence({
  file,
  source,
  node,
  detector,
  capability,
  relationship,
  upstream,
  transport,
  credential,
  role,
  schema,
  object,
  signature,
  acl,
  semantics,
  sourceClass,
}) {
  const fragment = sourceFragment(source, node);
  const seed = `${file}\0${node.start}\0${node.end}\0${detector}\0${object}`;
  return {
    id: `occ-${sha256(seed).slice(0, 24)}`,
    file,
    line: lineFor(source, node.start),
    span: { startOffset: node.start, endOffset: node.end, sha256: sha256(fragment) },
    detector,
    capability,
    relationship,
    upstream,
    transport,
    credential,
    role,
    schema,
    object,
    signature: signature ?? fragment,
    acl,
    semantics,
    sourceClass,
  };
}

function dynamicSubprocess(file, source, node) {
  const name = calleeName(node);
  const command = node.arguments?.[0] ? sourceFragment(source, node.arguments[0]) : "<missing>";
  const cliBound = /(?:cli\.command|argv\[0\]|finalizeCommand\[0\])/u.test(command);
  return makeOccurrence({
    file,
    source,
    node,
    detector: "javascript-ast-child-process",
    capability: cliBound ? "tiangong-cli.dispatch" : "runtime.subprocess.dispatch",
    relationship: "indirect-upstream",
    upstream: cliBound ? "tiangong-lca/tiangong-cli" : "runtime-selected-command",
    transport: "subprocess",
    credential: "inherited-process-environment",
    role: "caller-runtime",
    schema: "indirect-control-plane",
    object: command,
    acl: "inherits the Foundry process environment; downstream owner remains authoritative",
    semantics: name,
    sourceClass: "runtime",
  });
}

function deriveJavascript(file, source) {
  let ast;
  try {
    ast = parsers.babel.parse(source, { filepath: file });
  } catch (error) {
    throw new ManifestError(`Babel AST parse failed for ${file}: ${error.message}`);
  }
  const occurrences = [];
  const forbidden = [];
  walk(ast, null, (node, parent) => {
    if (node.type === "ImportDeclaration" && FORBIDDEN_CLIENT_MODULES.has(node.source?.value)) {
      forbidden.push(`${file}:${lineFor(source, node.start)} imports ${node.source.value}`);
    }
    if (node.type === "TaggedTemplateExpression" && node.tag?.name === "sql") {
      forbidden.push(`${file}:${lineFor(source, node.start)} uses an unclassified sql template`);
    }
    if (
      node.type === "MemberExpression" &&
      /^(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY)$/u.test(
        node.property?.name ?? node.property?.value ?? "",
      )
    ) {
      forbidden.push(
        `${file}:${lineFor(source, node.start)} reads a forbidden privileged Supabase credential`,
      );
    }
    if (node.type === "CallExpression") {
      const name = calleeName(node);
      if (CHILD_PROCESS_CALLS.has(name)) occurrences.push(dynamicSubprocess(file, source, node));
      if (CLI_CALLS.has(name)) {
        const object = node.arguments?.[0] ? sourceFragment(source, node.arguments[0]) : name;
        occurrences.push(
          makeOccurrence({
            file,
            source,
            node,
            detector: "javascript-ast-cli-control",
            capability: `tiangong-cli.${name}`,
            relationship: "indirect-upstream",
            upstream: "tiangong-lca/tiangong-cli",
            transport: "subprocess",
            credential: "actor-session-api-key",
            role: "foundry-task-actor",
            schema: "indirect-cli-edge-database-contract",
            object,
            acl: "Foundry actor credentials; CLI/Edge/Database enforce capability authorization",
            semantics: name,
            sourceClass: "runtime",
          }),
        );
      }
      if (name === "fetch") {
        const target = node.arguments?.[0]
          ? sourceFragment(source, node.arguments[0])
          : "<missing>";
        const isAuth = target.includes("/auth/v1/");
        occurrences.push(
          makeOccurrence({
            file,
            source,
            node,
            detector: "javascript-ast-http",
            capability: isAuth ? "supabase.auth.http" : "supabase.dynamic-http-helper",
            relationship: "direct-supabase",
            upstream: "supabase-platform",
            transport: isAuth ? "auth-http" : "raw-http",
            credential: isAuth ? "publishable-key+user-session" : "call-site-defined",
            role: isAuth ? "authenticated" : "dynamic",
            schema: isAuth ? "auth" : "dynamic",
            object: target,
            acl: isAuth
              ? "publishable key plus password/session; no service-role"
              : "must be closed by typed call sites",
            semantics: isAuth
              ? target.includes("/user")
                ? "resolve-current-user"
                : "password-token"
              : "http-request-helper",
            sourceClass: "runtime",
          }),
        );
      }
      if (name === "supabaseJsonRequest") {
        const targetNode = node.arguments?.[0];
        const target = targetNode ? sourceFragment(source, targetNode) : "<missing>";
        const isAuth = target.includes("/auth/v1/");
        occurrences.push(
          makeOccurrence({
            file,
            source,
            node,
            detector: "javascript-ast-supabase-request",
            capability: isAuth
              ? "supabase.auth.password-token"
              : "supabase.postgrest.dynamic-relation",
            relationship: "direct-supabase",
            upstream: "supabase-platform",
            transport: isAuth ? "auth-http" : "postgrest-relation",
            credential: "publishable-key+authenticated-user-session",
            role: "authenticated",
            schema: isAuth ? "auth" : "public",
            object: target,
            acl: "authenticated actor under downstream RLS; no service-role",
            semantics: isAuth ? "password-token" : "paginated-read-only-select",
            sourceClass: "runtime",
          }),
        );
      }
      if (name === "fetchSupportCacheRows") {
        const argument = node.arguments?.[0];
        if (argument?.type !== "ObjectExpression")
          throw new ManifestError(
            `dynamic support-cache call is not structurally closed: ${file}:${lineFor(source, node.start)}`,
          );
        const property = argument.properties.find(
          (candidate) =>
            candidate.type === "ObjectProperty" &&
            ((candidate.key.type === "Identifier" && candidate.key.name === "table") ||
              candidate.key.value === "table"),
        );
        const table = literalValue(property?.value);
        if (!table)
          throw new ManifestError(
            `support-cache table is dynamic: ${file}:${lineFor(source, node.start)}`,
          );
        occurrences.push(
          makeOccurrence({
            file,
            source,
            node: property.value,
            detector: "javascript-ast-postgrest-target",
            capability: `support-cache.read-${table}`,
            relationship: "direct-database-consumer",
            upstream: "supabase-postgrest",
            transport: "postgrest-relation",
            credential: "publishable-key+authenticated-user-session",
            role: "authenticated",
            schema: "public",
            object: table,
            acl: "SELECT under authenticated RLS; anon/service-role not requested by Foundry",
            semantics:
              "select id,version,state_code,json; state_code filter; deterministic pagination/order",
            sourceClass: "runtime",
          }),
        );
      }
      const method = name;
      const receiver =
        node.callee?.type === "MemberExpression" ? sourceFragment(source, node.callee.object) : "";
      if (
        ["from", "rpc", "schema", "channel"].includes(method) &&
        /(?:supabase|postgrest|client)/iu.test(receiver)
      ) {
        forbidden.push(
          `${file}:${lineFor(source, node.start)} has unclassified Supabase method .${method}()`,
        );
      }
    }
    if (
      (node.type === "StringLiteral" || node.type === "TemplateElement") &&
      ROUTE_RE.test(node.value?.cooked ?? node.value ?? "")
    ) {
      const route = node.value?.cooked ?? node.value ?? "";
      const routeKind = route.match(/\/(auth|functions|rest|storage)\/v1/u)?.[1];
      occurrences.push(
        makeOccurrence({
          file,
          source,
          node,
          detector: "javascript-ast-route-literal",
          capability: `supabase.${routeKind}.route`,
          relationship: "direct-supabase",
          upstream: "supabase-platform",
          transport: `${routeKind}-http`,
          credential: routeKind === "auth" ? "publishable-key+user-session" : "call-site-defined",
          role: routeKind === "auth" ? "authenticated" : "dynamic",
          schema: routeKind,
          object: route,
          acl: "route literal requires a separately derived credential/call-site binding",
          semantics: "route-construction",
          sourceClass: "runtime",
        }),
      );
    }
  });
  if (forbidden.length > 0)
    throw new ManifestError(
      `dynamic/direct database bypass requires parser support:\n${forbidden.join("\n")}`,
    );
  return occurrences;
}

function deriveEnv(file, source) {
  const occurrences = [];
  let offset = 0;
  for (const raw of source.split(/(?<=\n)/u)) {
    const line = raw.replace(/\r?\n$/u, "");
    const match =
      /^(TIANGONG_LCA_API_BASE_URL|TIANGONG_LCA_API_KEY|TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY)=(.*)$/u.exec(
        line,
      );
    if (match) {
      const node = { start: offset, end: offset + line.length };
      const key = match[1];
      occurrences.push(
        makeOccurrence({
          file,
          source,
          node,
          detector: "structured-env-parser",
          capability: `foundry.env.${key.toLowerCase()}`,
          relationship: "configuration",
          upstream:
            key === "TIANGONG_LCA_API_KEY" ? "foundry-account-profile" : "supabase-platform",
          transport: key.includes("KEY") ? "credential-config" : "endpoint-config",
          credential:
            key === "TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY"
              ? "publishable-key"
              : key === "TIANGONG_LCA_API_KEY"
                ? "encoded-user-credentials"
                : "none",
          role: "foundry-task-actor",
          schema: "platform",
          object: key,
          signature: `${key}=<runtime-profile-value>`,
          acl: "example/public configuration only; secrets remain ignored runtime state",
          semantics: "runtime-profile-configuration",
          sourceClass: "versioned-config",
        }),
      );
    }
    offset += raw.length;
  }
  return occurrences;
}

function derivePackage(file, source) {
  const value = JSON.parse(source);
  const occurrences = [];
  let searchFrom = 0;
  for (const [name, command] of Object.entries(value.scripts ?? {})) {
    if (!/(?:@tiangong-lca\/cli|supabase|psql|\bpg\b)/iu.test(command)) continue;
    const needle = JSON.stringify(command);
    const start = source.indexOf(needle, searchFrom);
    if (start < 0) throw new ManifestError(`package script span not found: ${name}`);
    searchFrom = start + needle.length;
    occurrences.push(
      makeOccurrence({
        file,
        source,
        node: { start, end: start + needle.length },
        detector: "structured-package-json-parser",
        capability: `package-script.${name}`,
        relationship: "indirect-upstream",
        upstream: command.includes("@tiangong-lca/cli")
          ? "tiangong-lca/tiangong-cli"
          : "supabase-platform",
        transport: "subprocess",
        credential: "inherited-process-environment",
        role: "caller-runtime",
        schema: "indirect-control-plane",
        object: name,
        signature: command,
        acl: "inherits caller environment; downstream command enforces authorization",
        semantics: "npm-script",
        sourceClass: "versioned-config",
      }),
    );
  }
  return occurrences;
}

function deriveMarkdown(file, source) {
  const occurrences = [];
  let inFence = false;
  let offset = 0;
  for (const raw of source.split(/(?<=\n)/u)) {
    const line = raw.replace(/\r?\n$/u, "");
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      offset += raw.length;
      continue;
    }
    if (
      inFence &&
      /(?:@tiangong-lca\/cli|\bsupabase\b|\bpsql\b|\/rest\/v1|\/auth\/v1)/iu.test(line)
    ) {
      const direct = /(?:\bsupabase\b|\bpsql\b|\/rest\/v1|\/auth\/v1)/iu.test(line);
      occurrences.push(
        makeOccurrence({
          file,
          source,
          node: { start: offset, end: offset + line.length },
          detector: "structured-agent-command-parser",
          capability: direct ? "agent-command.supabase" : "agent-command.tiangong-cli",
          relationship: direct ? "direct-supabase" : "indirect-upstream",
          upstream: direct ? "supabase-platform" : "tiangong-lca/tiangong-cli",
          transport: "agent-tool-command",
          credential: "runtime-selected",
          role: "agent-task-actor",
          schema: "agent-control-plane",
          object: line.trim(),
          acl: "runtime agent command remains subject to repository and downstream authorization gates",
          semantics: "versioned-agent-instruction",
          sourceClass: "versioned-config",
        }),
      );
    }
    offset += raw.length;
  }
  if (inFence) throw new ManifestError(`unterminated Markdown code fence: ${file}`);
  return occurrences;
}

async function deriveOccurrences(entries) {
  const occurrences = [];
  for (const entry of entries) {
    if (entry.path === AUDIT_TOOL_PATH) continue;
    const source = entry.bytes.toString("utf8");
    if (entry.path.endsWith(".mjs")) occurrences.push(...deriveJavascript(entry.path, source));
    else if (entry.path === ".env.example") occurrences.push(...deriveEnv(entry.path, source));
    else if (entry.path === "package.json") occurrences.push(...derivePackage(entry.path, source));
    else if (entry.path.endsWith(".json")) JSON.parse(source);
    else if (entry.path.endsWith(".md")) occurrences.push(...deriveMarkdown(entry.path, source));
  }
  occurrences.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.span.startOffset - right.span.startOffset ||
      left.id.localeCompare(right.id),
  );
  const ids = new Set(occurrences.map((row) => row.id));
  if (ids.size !== occurrences.length)
    throw new ManifestError("derived occurrence IDs are not globally unique");
  return occurrences;
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) counts[row[field]] = (counts[row[field]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
}

function publicResidue(occurrences) {
  const relations = [
    ...new Set(
      occurrences
        .filter((row) => row.relationship === "direct-database-consumer" && row.schema === "public")
        .map((row) => row.object),
    ),
  ].sort();
  const nonCore = relations.filter((relation) => !PUBLIC_CORE.has(relation));
  if (nonCore.length > 0)
    throw new ManifestError(`non-core public relation residue: ${nonCore.join(", ")}`);
  return { relations, routines: [], dynamicSchemaSelectors: [] };
}

function buildUpstreams(occurrences) {
  const names = [...new Set(occurrences.map((row) => row.upstream))].sort();
  return names.map((name) => ({
    id: name,
    relationship:
      name === "supabase-postgrest" || name === "supabase-platform" ? "direct" : "indirect",
    contract:
      name === "tiangong-lca/tiangong-cli"
        ? "tiangong.supabase-consumer-manifest.v3 candidate + published CLI command contracts"
        : name === "supabase-postgrest"
          ? "public core relation REST contract"
          : "runtime/configuration control plane",
    lifecycle:
      name === "tiangong-lca/tiangong-cli"
        ? "requires exact CLI/Edge/Database/Worker/Release and hosted joint qualification"
        : "locally statically derived; hosted verification remains pending",
  }));
}

export function assertExactOccurrenceSet(declared, derived) {
  const canonical = (rows) => rows.map((row) => canonicalBytes(row).toString("utf8"));
  const left = canonical(declared);
  const right = canonical(derived);
  if (new Set(left).size !== left.length) throw new ManifestError("manifest repeats an occurrence");
  if (new Set(right).size !== right.length)
    throw new ManifestError("derivation repeats an occurrence");
  if (left.length !== right.length || left.some((row, index) => row !== right[index])) {
    throw new ManifestError(
      "manifest and independent AST/structured derivation are not bidirectionally exact and globally exactly-once",
    );
  }
}

function manifestFor(sourceCommit, entries, occurrences, schemaSha256) {
  const digest = filteredTreeDigest(entries);
  return {
    $schema: "./supabase-consumer-manifest.v3.schema.json",
    schema: SCHEMA_ID,
    version: 3,
    repository: { slug: REPOSITORY, canonicalOrigin: CANONICAL_ORIGIN },
    manifestSchema: { path: SCHEMA_PATH, sha256: schemaSha256 },
    sourceSnapshot: {
      derivation: "prettier-babel-ast+structured-json-env-v3",
      sourceTreeCommit: sourceCommit,
      filteredGitTreeSha256: digest,
      pathPatterns: SOURCE_PATTERNS,
      exactExemptions: [AUDIT_TOOL_PATH],
      governedFileCount: entries.filter((entry) => entry.path !== AUDIT_TOOL_PATH).length,
      symlinkPolicy: "reject",
      nonRegularFilePolicy: "reject",
      setEquality: "bidirectional-global-exactly-once",
    },
    delivery: {
      targetBranch: "main",
      deliveryCommit: null,
      deliveryCommitAuthority: "external-verifier-binds-actual-head",
      headResolution: "scan-actual-git-head",
      filteredGitTreeSha256: digest,
      governedSourcePolicy: "exact-tree-entries-equal-except-audit-tool",
    },
    authority: {
      status: "candidate",
      authorizesConsumerZero: false,
      authorizesDatabaseFreeze: false,
      authorizesDatabaseMigration: false,
      authorizesHostedMutation: false,
      authorizesProductionMutation: false,
    },
    occurrences,
    upstreams: buildUpstreams(occurrences),
    publicResidue: publicResidue(occurrences),
    pending: [
      {
        id: "database-engine-357-exact-verifier",
        blocker:
          "tiangong-lca/database-engine#357 must bind this exact schema, manifest bytes, source commit, delivery HEAD, occurrences, upstream contracts, and ACL/signature semantics.",
      },
      {
        id: "joint-runtime-lifecycle",
        blocker:
          "Worker, Release, CLI, Edge, Database, and hosted representative retry/duplicate/partial-failure/resume/rollback qualification remain external lifecycle evidence.",
      },
      {
        id: "workspace-484-merge-deploy",
        blocker:
          "tiangong-lca/workspace#484 exclusively owns merge/deploy sequencing; this candidate does not authorize either.",
      },
    ],
    absenceProofs: [
      {
        surface: "direct PostgreSQL/SQL/regclass",
        result: "absent",
        enforcement: "Babel AST forbidden import/tag detector",
      },
      {
        surface: "Supabase JS .from/.rpc/.schema",
        result: "absent",
        enforcement: "Babel AST call detector",
      },
      {
        surface: "Storage direct client",
        result: "absent",
        enforcement: "AST route/client detector; attachment storage is indirect through CLI",
      },
      {
        surface: "Realtime/PGMQ/Cron",
        result: "absent",
        enforcement: "AST import/call plus governed structured-source scan",
      },
      {
        surface: "service-role/secret key",
        result: "absent",
        enforcement: "credential occurrence derivation and env contract",
      },
    ],
    summary: {
      occurrences: occurrences.length,
      upstreams: buildUpstreams(occurrences).length,
      byRelationship: countBy(occurrences, "relationship"),
      byTransport: countBy(occurrences, "transport"),
      byCredential: countBy(occurrences, "credential"),
      bySchema: countBy(occurrences, "schema"),
    },
  };
}

export async function deriveManifest(root, sourceRevision, schemaBytes) {
  canonicalGithubRepository(gitText(root, "remote", "get-url", "origin"));
  const sourceCommit = resolveCommit(root, sourceRevision);
  const entries = readGitTree(root, sourceCommit);
  const occurrences = await deriveOccurrences(entries);
  return manifestFor(sourceCommit, entries, occurrences, sha256(schemaBytes));
}

export async function verifyManifest(root, manifest, schema, schemaBytes) {
  canonicalGithubRepository(gitText(root, "remote", "get-url", "origin"));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(manifest))
    throw new ManifestError(`schema validation failed: ${JSON.stringify(validate.errors)}`);
  if (manifest.manifestSchema.sha256 !== sha256(schemaBytes))
    throw new ManifestError("canonical schema SHA drift");
  const sourceCommit = resolveCommit(root, manifest.sourceSnapshot.sourceTreeCommit);
  const deliveryHead = resolveCommit(root, "HEAD");
  if (gitText(root, "merge-base", "--is-ancestor", sourceCommit, deliveryHead) !== "") {
    // `merge-base --is-ancestor` succeeds with empty stdout; failure is already converted by git().
  }
  const sourceEntries = readGitTree(root, sourceCommit);
  const deliveryEntries = readGitTree(root, deliveryHead);
  assertDeliveryTreeEqual(sourceEntries, deliveryEntries);
  const digest = filteredTreeDigest(sourceEntries);
  if (
    manifest.sourceSnapshot.filteredGitTreeSha256 !== digest ||
    manifest.delivery.filteredGitTreeSha256 !== digest ||
    filteredTreeDigest(deliveryEntries) !== digest
  ) {
    throw new ManifestError("sourceTreeCommit/delivery HEAD filtered Git digest drift");
  }
  const derived = await deriveOccurrences(sourceEntries);
  assertExactOccurrenceSet(manifest.occurrences, derived);
  const expected = manifestFor(sourceCommit, sourceEntries, derived, sha256(schemaBytes));
  if (canonicalBytes(manifest).compare(canonicalBytes(expected)) !== 0)
    throw new ManifestError(
      "manifest metadata/upstream/residue/absence/summary differs from independent derivation",
    );
  return {
    sourceCommit,
    deliveryHead,
    digest,
    occurrences: derived.length,
    summary: expected.summary,
  };
}

function parseArgs(argv) {
  const options = { mode: "verify", root: process.cwd(), sourceCommit: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--generate") options.mode = "generate";
    else if (value === "--verify") options.mode = "verify";
    else if (value === "--root") options.root = path.resolve(argv[++index]);
    else if (value === "--source-commit") options.sourceCommit = argv[++index];
    else throw new ManifestError(`unknown argument: ${value}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schemaFile = path.join(options.root, SCHEMA_PATH);
  const manifestFile = path.join(options.root, MANIFEST_PATH);
  const schemaBytes = readNoFollowRegular(schemaFile);
  const schema = JSON.parse(schemaBytes.toString("utf8"));
  if (options.mode === "generate") {
    if (!options.sourceCommit)
      throw new ManifestError("--generate requires --source-commit <exact revision>");
    const manifest = await deriveManifest(options.root, options.sourceCommit, schemaBytes);
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "w",
      mode: 0o644,
    });
    console.log(
      JSON.stringify({
        status: "generated",
        path: MANIFEST_PATH,
        sourceTreeCommit: manifest.sourceSnapshot.sourceTreeCommit,
        digest: manifest.sourceSnapshot.filteredGitTreeSha256,
        summary: manifest.summary,
      }),
    );
    return;
  }
  const manifestBytes = readNoFollowRegular(manifestFile);
  const result = await verifyManifest(
    options.root,
    JSON.parse(manifestBytes.toString("utf8")),
    schema,
    schemaBytes,
  );
  console.log(JSON.stringify({ status: "verified-candidate-non-authorizing", ...result }));
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[supabase-consumer-manifest] ${error.message}`);
    process.exit(1);
  });
}
