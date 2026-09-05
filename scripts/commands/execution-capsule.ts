export {
  modelExecutionAttemptDisposition,
  type ExecutionAttemptState,
  type ExecutionAttemptDisposition,
} from "../lib/foundry-execution-attempt.ts";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

type RawHash = {
  algorithm?: string;
  sha256?: string;
  bytes?: number;
};

type SemanticHash = {
  algorithm?: string;
  domain?: string;
  canonicalizer_id?: string;
  sha256?: string;
};

type Freshness = {
  toolchain_fingerprint_sha256?: string;
  activation_epoch_id?: string;
  captured_at_utc?: string;
  source_fingerprint_sha256?: string;
  owner_session_fingerprint_sha256?: string;
  no_known_mutation_after_capture?: boolean;
};

type StageLeaf = JsonRecord & {
  leaf_id?: string;
  role?: string;
  path?: string;
  raw_hash?: RawHash;
  semantic_hash?: SemanticHash;
  scope_binding_sha256?: string;
  dependency_leaf_ids?: string[];
  freshness_class?: string;
  freshness?: Freshness;
  executable_input?: boolean;
};

type AttemptState = JsonRecord & {
  status?: string;
  attempt_count?: number;
  primary_attempt_count?: number;
  dispatch_state?: string;
  mutation_state?: string;
  readback_state?: string;
};

type StageManifest = JsonRecord & {
  schema_version?: string;
  stage_id?: string;
  producer_id?: string;
  revision?: number;
  predecessor_stage_manifest_sha256?: string | null;
  stage_root?: string;
  admission_mode?: string;
  production_authority?: boolean;
  scope_binding_sha256?: string;
  attempt_state?: AttemptState;
  findings?: { p0?: number; p1?: number };
  leaves?: StageLeaf[];
  boundary_contract_leaf_id?: string;
  reviewer_report_leaf_ids?: string[];
};

type BoundaryShape = JsonRecord & {
  cwd?: string;
  argv?: string[];
  program_path?: string;
  declared_fields?: string[];
  producer_outputs?: Record<string, string>;
  consumer_inputs?: Record<string, string>;
  network_mode?: string;
  network_dispatch_count?: number;
  database_dispatch_count?: number;
};

type BoundaryContract = JsonRecord & {
  schema_version?: string;
  required?: BoundaryShape;
  observed?: BoundaryShape;
};

type ReviewerReport = JsonRecord & {
  status?: string;
  reviewer_id?: string;
  scope_binding_sha256?: string;
  reviewed_leaf_ids?: string[];
  findings?: { p0?: number; p1?: number };
};

type LedgerRow = {
  schema_version: string;
  check_id: string;
  status: "PASS" | "FAIL";
  severity: "P0" | "P1" | null;
  detail: string;
  evidence: unknown;
};

type MaterializedLeaf = {
  leaf_id: string | null;
  path: string | null;
  role: string | null;
  executable_input: boolean;
  raw_sha256: string | null;
  semantic_sha256: string | null;
  freshness_class: string | null;
};

type ValidationResult = {
  rows: LedgerRow[];
  materializedLeaves: MaterializedLeaf[];
  stageRoot: string | null;
  manifestSha256: string;
};

type AddCheck = (checkId: string, passed: boolean, detail: string, evidence?: unknown) => boolean;

export type ExecutionCapsuleOptions = Record<string, unknown> & {
  help?: unknown;
  stageManifest?: unknown;
  manifest?: unknown;
  outDir?: unknown;
  predecessorStageManifest?: unknown;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const STAGE_SCHEMA = "foundry-execution-capsule-stage.v1";
const BOUNDARY_SCHEMA = "foundry-execution-capsule-boundary.v1";
const SEAL_SCHEMA = "foundry-execution-capsule-seal.v1";
const REPORT_SCHEMA = "foundry-execution-capsule-admission-report.v1";
const LEDGER_SCHEMA = "foundry-execution-capsule-admission-ledger-row.v1";

const FRESHNESS_CLASSES = new Set([
  "SEMANTIC_IMMUTABLE",
  "TOOLCHAIN_BOUND",
  "LIVE_RECONCILIATION",
  "OWNER_SESSION",
  "DERIVED_REPORT",
]);

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function isPlainObject(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function exactJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function pathIsInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function canonicalSemanticBytes(buffer: Buffer, canonicalizerId: string | undefined): Buffer {
  switch (canonicalizerId) {
    case "raw-bytes-v1":
      return buffer;
    case "utf8-lf-v1":
      return Buffer.from(buffer.toString("utf8").replace(/\r\n?/gu, "\n"), "utf8");
    case "canonical-json-v1":
      return Buffer.from(stableJson(JSON.parse(buffer.toString("utf8"))), "utf8");
    default:
      throw new Error(`Unsupported semantic canonicalizer: ${canonicalizerId || "<missing>"}`);
  }
}

function semanticSha256(domain: string, canonicalBytes: Buffer): string {
  return sha256(Buffer.concat([Buffer.from(`${domain}\0`, "utf8"), canonicalBytes]));
}

function dependencyIds(leaf: StageLeaf | undefined): string[] {
  return Array.isArray(leaf?.dependency_leaf_ids) ? leaf.dependency_leaf_ids : [];
}

function severityFor(code: string): "P0" | "P1" {
  if (
    code.startsWith("attempt_") ||
    code.startsWith("leaf_raw_") ||
    code.startsWith("leaf_semantic_") ||
    code.startsWith("leaf_path_") ||
    code.startsWith("leaf_file_") ||
    code.startsWith("dependency_") ||
    code.startsWith("scope_") ||
    code.startsWith("stage_")
  ) {
    return "P0";
  }
  return "P1";
}

function checkCollector() {
  const rows: LedgerRow[] = [];
  function add(checkId: string, passed: boolean, detail: string, evidence: unknown = null) {
    rows.push({
      schema_version: LEDGER_SCHEMA,
      check_id: checkId,
      status: passed ? "PASS" : "FAIL",
      severity: passed ? null : severityFor(checkId),
      detail,
      evidence,
    });
    return passed;
  }
  return { add, rows };
}

function dependencyCycle(leavesById: Map<string, StageLeaf>): string[] | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(leafId: string, trail: string[]): string[] | null {
    if (visiting.has(leafId)) return [...trail, leafId];
    if (visited.has(leafId)) return null;
    visiting.add(leafId);
    const leaf = leavesById.get(leafId);
    for (const dependencyId of dependencyIds(leaf)) {
      if (!leavesById.has(dependencyId)) continue;
      const cycle = visit(dependencyId, [...trail, leafId]);
      if (cycle) return cycle;
    }
    visiting.delete(leafId);
    visited.add(leafId);
    return null;
  }
  for (const leafId of leavesById.keys()) {
    const cycle = visit(leafId, []);
    if (cycle) return cycle;
  }
  return null;
}

function boundaryChecks(
  boundary: BoundaryContract,
  materializedLeafPaths: Set<string>,
  add: AddCheck,
): void {
  const schemaOk = boundary?.schema_version === BOUNDARY_SCHEMA;
  add(
    "boundary_schema",
    schemaOk,
    schemaOk ? "Boundary contract schema is supported." : `Expected ${BOUNDARY_SCHEMA}.`,
  );
  const required = boundary?.required;
  const observed = boundary?.observed;
  const shapesOk = isPlainObject(required) && isPlainObject(observed);
  add(
    "boundary_shapes",
    shapesOk,
    shapesOk ? "Required and observed boundary objects are present." : "Boundary objects missing.",
  );
  if (!shapesOk) return;

  const materializedShapeOk = Boolean(
    typeof required.cwd === "string" &&
    required.cwd.length > 0 &&
    Array.isArray(required.argv) &&
    required.argv.length > 0 &&
    required.argv.every((value) => typeof value === "string" && value.length > 0) &&
    typeof required.program_path === "string" &&
    required.program_path.length > 0 &&
    Array.isArray(required.declared_fields) &&
    required.declared_fields.length > 0 &&
    required.declared_fields.every((value) => typeof value === "string" && value.length > 0) &&
    new Set(required.declared_fields).size === required.declared_fields.length &&
    isPlainObject(required.producer_outputs) &&
    Object.keys(required.producer_outputs).length > 0 &&
    Object.values(required.producer_outputs).every(
      (value) => typeof value === "string" && value.length > 0,
    ) &&
    isPlainObject(required.consumer_inputs) &&
    Object.values(required.consumer_inputs).every(
      (value) => typeof value === "string" && value.length > 0,
    ),
  );
  add(
    "boundary_materialized_shape",
    materializedShapeOk,
    "The required boundary must fully type CWD, argv, program, declared fields, and materialized paths.",
  );

  for (const field of [
    "cwd",
    "argv",
    "program_path",
    "declared_fields",
    "producer_outputs",
    "consumer_inputs",
    "network_mode",
  ]) {
    const passed = exactJson(required[field], observed[field]);
    add(
      `boundary_exact_${field}`,
      passed,
      passed ? `${field} is exact.` : `${field} differs between required and observed boundary.`,
      passed ? null : { required: required[field] ?? null, observed: observed[field] ?? null },
    );
  }

  add(
    "boundary_network_disabled",
    required.network_mode === "disabled" && observed.network_mode === "disabled",
    "The capsule boundary must declare disabled network access.",
  );
  add(
    "boundary_zero_dispatch",
    observed.network_dispatch_count === 0 && observed.database_dispatch_count === 0,
    "Observed network and database dispatch counts must both be zero.",
    {
      network_dispatch_count: observed.network_dispatch_count ?? null,
      database_dispatch_count: observed.database_dispatch_count ?? null,
    },
  );
  add(
    "boundary_paths_materialized",
    isPlainObject(required.producer_outputs) &&
      Object.keys(required.producer_outputs).length > 0 &&
      exactJson(required.producer_outputs, required.consumer_inputs),
    "Producer outputs and consumer inputs must bind the same named materialized paths.",
  );
  const boundaryPaths = [
    required.program_path,
    ...Object.values(required.producer_outputs ?? {}),
    ...Object.values(required.consumer_inputs ?? {}),
  ];
  add(
    "boundary_paths_content_addressed",
    boundaryPaths.every((value) => materializedLeafPaths.has(value as string)),
    "The consumer program and every producer/consumer path must resolve to a content-addressed stage leaf.",
    { boundary_paths: boundaryPaths },
  );
  add(
    "boundary_argv_materialized",
    Array.isArray(required.argv) && required.argv.length > 0 && required.argv.every(Boolean),
    "The exact consumer argv must be a non-empty materialized array.",
  );
}

function freshnessChecks(leaf: StageLeaf, add: AddCheck): void {
  const freshnessClass = leaf?.freshness_class;
  const known = FRESHNESS_CLASSES.has(freshnessClass ?? "");
  add(
    `freshness_class:${leaf?.leaf_id ?? "unknown"}`,
    known,
    known ? `Freshness class ${freshnessClass} is supported.` : "Unknown freshness class.",
  );
  if (!known) return;
  const freshness = leaf?.freshness;
  if (freshnessClass === "TOOLCHAIN_BOUND") {
    add(
      `freshness_toolchain:${leaf.leaf_id}`,
      isSha256(freshness?.toolchain_fingerprint_sha256),
      "Toolchain-bound leaves require a SHA-256 toolchain fingerprint.",
    );
  }
  if (freshnessClass === "LIVE_RECONCILIATION") {
    add(
      `freshness_live:${leaf.leaf_id}`,
      Boolean(
        freshness?.activation_epoch_id &&
        isIsoTimestamp(freshness?.captured_at_utc) &&
        isSha256(freshness?.source_fingerprint_sha256) &&
        freshness?.no_known_mutation_after_capture === true,
      ),
      "Live reconciliation leaves require epoch, capture time, source fingerprint, and no-mutation attestation.",
    );
  }
  if (freshnessClass === "OWNER_SESSION") {
    add(
      `freshness_owner_session:${leaf.leaf_id}`,
      Boolean(
        freshness?.activation_epoch_id &&
        isIsoTimestamp(freshness?.captured_at_utc) &&
        isSha256(freshness?.owner_session_fingerprint_sha256) &&
        freshness?.no_known_mutation_after_capture === true,
      ),
      "Owner-session leaves require epoch, capture time, session fingerprint, and no-mutation attestation.",
    );
  }
  if (freshnessClass === "DERIVED_REPORT") {
    add(
      `freshness_derived_dependencies:${leaf.leaf_id}`,
      dependencyIds(leaf).length > 0,
      "Derived reports require at least one dependency leaf.",
    );
  }
}

function validateStage({
  manifest,
  manifestPath,
  manifestRaw,
  predecessorOption,
  repoRoot,
}: {
  manifest: StageManifest;
  manifestPath: string;
  manifestRaw: Buffer;
  predecessorOption: unknown;
  repoRoot: string;
}): ValidationResult {
  const { add, rows } = checkCollector();
  add(
    "stage_schema",
    manifest?.schema_version === STAGE_SCHEMA,
    manifest?.schema_version === STAGE_SCHEMA
      ? "Stage schema is supported."
      : `Expected ${STAGE_SCHEMA}.`,
  );
  add("stage_id", Boolean(manifest?.stage_id), "A non-empty stage_id is required.");
  add("stage_producer_id", Boolean(manifest?.producer_id), "A non-empty producer_id is required.");
  add(
    "stage_revision",
    Number.isInteger(manifest.revision) && Number(manifest.revision) >= 1,
    "Revision must be a positive integer.",
  );
  const predecessorHash = manifest?.predecessor_stage_manifest_sha256;
  if (manifest?.revision === 1) {
    add(
      "stage_predecessor_absent",
      predecessorHash === null && !predecessorOption,
      "Revision 1 has no predecessor manifest or predecessor CLI input.",
    );
  } else {
    add(
      "stage_predecessor_descriptor",
      isSha256(predecessorHash),
      "Later revisions require a predecessor SHA-256 descriptor.",
    );
    const predecessorPath = predecessorOption
      ? path.resolve(repoRoot, predecessorOption as string)
      : null;
    const repoReal = fs.realpathSync(repoRoot);
    let predecessorSafe = false;
    let predecessorRaw: Buffer | null = null;
    if (
      predecessorPath &&
      pathIsInside(repoRoot, predecessorPath) &&
      fs.existsSync(predecessorPath)
    ) {
      const predecessorStat = fs.lstatSync(predecessorPath);
      predecessorSafe = predecessorStat.isFile() && !predecessorStat.isSymbolicLink();
      if (predecessorSafe) {
        predecessorSafe = pathIsInside(repoReal, fs.realpathSync(predecessorPath));
      }
      if (predecessorSafe) predecessorRaw = fs.readFileSync(predecessorPath);
    }
    add(
      "stage_predecessor_file_safe",
      predecessorSafe,
      "Later revisions require a regular, non-symlink predecessor manifest inside the repository.",
      { path: predecessorOption ?? null },
    );
    add(
      "stage_predecessor_hash_exact",
      Boolean(predecessorRaw && sha256(predecessorRaw) === predecessorHash),
      "The predecessor manifest bytes must match the declared predecessor SHA-256.",
    );
    let predecessorManifest: StageManifest | null = null;
    if (predecessorRaw) {
      try {
        predecessorManifest = JSON.parse(predecessorRaw.toString("utf8")) as StageManifest;
      } catch {
        predecessorManifest = null;
      }
    }
    add(
      "stage_predecessor_lineage",
      Boolean(
        predecessorManifest?.schema_version === STAGE_SCHEMA &&
        predecessorManifest?.stage_id === manifest?.stage_id &&
        predecessorManifest?.producer_id === manifest?.producer_id &&
        predecessorManifest?.revision === Number(manifest.revision) - 1,
      ),
      "The predecessor must be the immediately prior revision for the same stage and producer.",
    );
  }
  add(
    "stage_offline_only",
    manifest?.admission_mode === "OFFLINE_ONLY" && manifest?.production_authority === false,
    "MVP admission accepts offline-only, non-production-authority stages.",
  );
  add(
    "stage_findings_zero",
    manifest?.findings?.p0 === 0 && manifest?.findings?.p1 === 0,
    "Stage-declared P0 and P1 findings must both be zero.",
  );
  add(
    "scope_binding_sha256",
    isSha256(manifest?.scope_binding_sha256),
    "Stage scope binding must be a SHA-256 value.",
  );

  const attempt = manifest?.attempt_state;
  add(
    "attempt_unconsumed",
    Boolean(
      attempt?.status === "UNATTEMPTED" &&
      attempt?.attempt_count === 0 &&
      attempt?.primary_attempt_count === 0,
    ),
    "Pre-seal admission requires an unattempted stage with zero attempt counts.",
  );
  add(
    "attempt_zero_dispatch",
    Boolean(
      attempt?.dispatch_state === "NOT_DISPATCHED" &&
      attempt?.mutation_state === "NONE" &&
      attempt?.readback_state === "NOT_STARTED",
    ),
    "Pre-seal admission requires zero dispatch, zero mutation, and no readback.",
  );

  const manifestDir = path.dirname(manifestPath);
  const stageRoot = path.resolve(manifestDir, manifest?.stage_root || ".");
  const rootExists = fs.existsSync(stageRoot) && fs.statSync(stageRoot).isDirectory();
  add("stage_root", rootExists, "Stage root must resolve to an existing directory.", {
    stage_root: stageRoot,
  });
  const rootReal = rootExists ? fs.realpathSync(stageRoot) : stageRoot;

  const leaves = Array.isArray(manifest.leaves) ? manifest.leaves : [];
  add("stage_leaves", leaves.length > 0, "At least one CAS leaf is required.", {
    leaf_count: leaves.length,
  });
  const leavesById = new Map<string, StageLeaf>();
  const leafBuffers = new Map<string, Buffer>();
  const leafPaths = new Set<string>();
  const materializedLeaves: MaterializedLeaf[] = [];
  for (const leaf of leaves) {
    const leafId = leaf?.leaf_id;
    const identityOk = Boolean(leafId) && !leavesById.has(leafId ?? "");
    add(
      `leaf_identity:${leafId ?? "missing"}`,
      identityOk,
      "Leaf IDs must be non-empty and unique.",
    );
    if (leafId && !leavesById.has(leafId)) leavesById.set(leafId, leaf);

    const relativePath = leaf?.path;
    add(`leaf_role:${leafId}`, Boolean(leaf?.role), "Every leaf requires a non-empty role.");
    add(
      `leaf_executable_flag:${leafId}`,
      typeof leaf?.executable_input === "boolean",
      "Every leaf requires an explicit executable_input boolean.",
    );
    const candidate =
      typeof relativePath === "string" ? path.resolve(stageRoot, relativePath) : null;
    const confined = Boolean(candidate && rootExists && pathIsInside(stageRoot, candidate));
    add(`leaf_path_confined:${leafId}`, confined, "Leaf path must stay inside the stage root.", {
      path: relativePath ?? null,
    });
    const pathUnique = Boolean(relativePath) && !leafPaths.has(relativePath ?? "");
    add(`leaf_path_unique:${leafId}`, pathUnique, "Leaf paths must be non-empty and unique.");
    if (relativePath) leafPaths.add(relativePath);

    let buffer: Buffer | null = null;
    let pathSafe = false;
    if (confined && candidate && fs.existsSync(candidate)) {
      const stat = fs.lstatSync(candidate);
      pathSafe = stat.isFile() && !stat.isSymbolicLink();
      if (pathSafe) {
        const real = fs.realpathSync(candidate);
        pathSafe = pathIsInside(rootReal, real);
      }
      if (pathSafe) buffer = fs.readFileSync(candidate);
    }
    add(
      `leaf_file_safe:${leafId}`,
      pathSafe,
      "Leaf must be a regular non-symlink file in stage root.",
    );
    if (leafId && buffer) leafBuffers.set(leafId, buffer);

    const rawDescriptorOk = Boolean(
      leaf?.raw_hash?.algorithm === "sha256" &&
      isSha256(leaf?.raw_hash?.sha256) &&
      Number.isInteger(leaf?.raw_hash?.bytes) &&
      Number(leaf.raw_hash?.bytes) >= 0,
    );
    add(
      `leaf_raw_descriptor:${leafId}`,
      rawDescriptorOk,
      "Raw hash descriptor is typed and complete.",
    );
    if (buffer) {
      add(
        `leaf_raw_hash:${leafId}`,
        sha256(buffer) === leaf?.raw_hash?.sha256,
        "Leaf raw SHA-256 must match exact file bytes.",
      );
      add(
        `leaf_raw_bytes:${leafId}`,
        buffer.byteLength === leaf?.raw_hash?.bytes,
        "Leaf byte count must match exact file bytes.",
      );
    }

    const semanticDescriptorOk = Boolean(
      leaf?.semantic_hash?.algorithm === "sha256" &&
      leaf?.semantic_hash?.domain &&
      leaf?.semantic_hash?.canonicalizer_id &&
      isSha256(leaf?.semantic_hash?.sha256),
    );
    add(
      `leaf_semantic_descriptor:${leafId}`,
      semanticDescriptorOk,
      "Semantic hash descriptor requires domain, canonicalizer, and SHA-256.",
    );
    const semanticHash = leaf.semantic_hash;
    if (buffer && semanticDescriptorOk && semanticHash?.canonicalizer_id && semanticHash.domain) {
      try {
        const canonical = canonicalSemanticBytes(buffer, semanticHash.canonicalizer_id);
        add(
          `leaf_semantic_hash:${leafId}`,
          semanticSha256(semanticHash.domain, canonical) === semanticHash.sha256,
          "Leaf semantic SHA-256 must match its declared canonicalizer.",
        );
      } catch (error) {
        add(
          `leaf_semantic_hash:${leafId}`,
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    add(
      `scope_leaf_binding:${leafId}`,
      isSha256(leaf?.scope_binding_sha256) &&
        leaf.scope_binding_sha256 === manifest?.scope_binding_sha256,
      "Every leaf must bind the exact stage scope SHA-256.",
    );
    add(
      `leaf_dependencies_shape:${leafId}`,
      Array.isArray(leaf?.dependency_leaf_ids),
      "Every leaf requires an explicit dependency_leaf_ids array.",
    );
    freshnessChecks(leaf, add);
    materializedLeaves.push({
      leaf_id: leafId ?? null,
      path: relativePath ?? null,
      role: leaf?.role ?? null,
      executable_input: leaf?.executable_input === true,
      raw_sha256: buffer ? sha256(buffer) : null,
      semantic_sha256: leaf?.semantic_hash?.sha256 ?? null,
      freshness_class: leaf?.freshness_class ?? null,
    });
  }

  for (const leaf of leaves) {
    add(
      `dependency_unique:${leaf?.leaf_id}`,
      new Set(dependencyIds(leaf)).size === dependencyIds(leaf).length,
      "Dependency leaf IDs must not repeat within a leaf.",
    );
    for (const dependencyId of dependencyIds(leaf)) {
      add(
        `dependency_exists:${leaf?.leaf_id}:${dependencyId}`,
        leavesById.has(dependencyId),
        "Every dependency must reference a leaf in the same stage.",
      );
    }
  }
  const cycle = dependencyCycle(leavesById);
  add("dependency_acyclic", !cycle, "Leaf dependency graph must be acyclic.", { cycle });
  const executableLeafIds = leaves
    .filter((leaf) => leaf?.executable_input === true)
    .map((leaf) => leaf.leaf_id);
  add(
    "executable_inputs_present",
    executableLeafIds.length > 0,
    "At least one leaf must be declared as an executable consumer input.",
  );

  const reviewerIds = Array.isArray(manifest?.reviewer_report_leaf_ids)
    ? manifest.reviewer_report_leaf_ids
    : [];
  add(
    "reviewer_reports_present",
    reviewerIds.length > 0,
    "At least one independent reviewer report leaf is required.",
  );
  add(
    "reviewer_reports_unique",
    new Set(reviewerIds).size === reviewerIds.length,
    "Reviewer report leaf IDs must be unique.",
  );
  for (const reviewerId of reviewerIds) {
    const reviewerLeaf = leavesById.get(reviewerId);
    add(
      `reviewer_report_role:${reviewerId}`,
      reviewerLeaf?.role === "reviewer_report",
      "Reviewer report references must resolve to reviewer_report leaves.",
    );
    try {
      const reviewerReport = JSON.parse(
        leafBuffers.get(reviewerId)?.toString("utf8") ?? "",
      ) as ReviewerReport;
      add(
        `reviewer_report_coverage_shape:${reviewerId}`,
        Array.isArray(reviewerReport?.reviewed_leaf_ids) &&
          new Set(reviewerReport.reviewed_leaf_ids).size ===
            reviewerReport.reviewed_leaf_ids.length,
        "Reviewer coverage must be an explicit array of unique leaf IDs.",
      );
      add(
        `reviewer_report_pass:${reviewerId}`,
        Boolean(
          reviewerReport?.status === "PASS" &&
          reviewerReport?.findings?.p0 === 0 &&
          reviewerReport?.findings?.p1 === 0,
        ),
        "Reviewer report must independently declare PASS with P0=0 and P1=0.",
      );
      add(
        `reviewer_report_identity:${reviewerId}`,
        Boolean(
          reviewerReport?.reviewer_id && reviewerReport.reviewer_id !== manifest?.producer_id,
        ),
        "Reviewer identity must be present and differ from the stage producer.",
      );
      add(
        `reviewer_report_scope:${reviewerId}`,
        reviewerReport?.scope_binding_sha256 === manifest?.scope_binding_sha256,
        "Reviewer report must bind the exact stage scope.",
      );
      add(
        `reviewer_report_coverage:${reviewerId}`,
        executableLeafIds.every((leafId) =>
          reviewerReport?.reviewed_leaf_ids?.includes(leafId as string),
        ),
        "Reviewer report must cover every executable input leaf.",
      );
    } catch (error) {
      add(
        `reviewer_report_parse:${reviewerId}`,
        false,
        `Reviewer report is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const boundaryLeaf = leavesById.get(manifest.boundary_contract_leaf_id ?? "");
  add(
    "boundary_leaf_role",
    boundaryLeaf?.role === "consumer_boundary_contract",
    "boundary_contract_leaf_id must resolve to a consumer_boundary_contract leaf.",
  );
  if (boundaryLeaf && rootExists) {
    try {
      boundaryChecks(
        JSON.parse(
          leafBuffers.get(boundaryLeaf.leaf_id ?? "")?.toString("utf8") ?? "",
        ) as BoundaryContract,
        leafPaths,
        add,
      );
    } catch (error) {
      add(
        "boundary_parse",
        false,
        `Boundary contract is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    rows,
    materializedLeaves,
    stageRoot,
    manifestSha256: sha256(manifestRaw),
  };
}

function writeExclusive(filePath: string, content: string | Buffer): void {
  fs.writeFileSync(filePath, content, { flag: "wx" });
}

function writeJsonExclusive(filePath: string, value: unknown): void {
  writeExclusive(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function relativeToRepo(repoRoot: string, filePath: string): string {
  const relative = path.relative(repoRoot, filePath).split(path.sep).join(path.posix.sep);
  return pathIsInside(repoRoot, filePath) ? relative : filePath;
}

export function createExecutionCapsuleCommands({ repoRoot }: { repoRoot: string }) {
  function runExecutionCapsuleAdmit(options: ExecutionCapsuleOptions): JsonRecord {
    if (options.help) {
      return {
        status: "help",
        command: "execution-capsule-admit",
        usage:
          "node scripts/foundry.ts execution-capsule-admit --stage-manifest <revision.json> [--predecessor-stage-manifest <previous-revision.json>] --out-dir <fresh-dir>",
        effects: "local evidence files only; zero network, database, CLI dispatch, and mutation",
      };
    }

    const manifestOption = options.stageManifest || options.manifest;
    const outDirOption = options.outDir;
    if (!manifestOption || !outDirOption) {
      throw new Error("--stage-manifest and --out-dir are required.");
    }
    const manifestPath = path.resolve(repoRoot, manifestOption as string);
    const outDir = path.resolve(repoRoot, outDirOption as string);
    if (!pathIsInside(repoRoot, outDir)) {
      throw new Error("--out-dir must stay inside the repository root.");
    }
    if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
      throw new Error(`Stage manifest is not a file: ${manifestOption}`);
    }
    if (fs.existsSync(outDir)) {
      throw new Error(
        `Admission output directory already exists and is immutable: ${outDirOption}`,
      );
    }
    const repoReal = fs.realpathSync(repoRoot);
    let existingParent = path.dirname(outDir);
    while (!fs.existsSync(existingParent)) {
      const next = path.dirname(existingParent);
      if (next === existingParent) break;
      existingParent = next;
    }
    if (
      !fs.existsSync(existingParent) ||
      !fs.statSync(existingParent).isDirectory() ||
      !pathIsInside(repoReal, fs.realpathSync(existingParent))
    ) {
      throw new Error("--out-dir resolves through a parent outside the repository root.");
    }
    fs.mkdirSync(outDir, { recursive: true });

    const manifestRaw = fs.readFileSync(manifestPath);
    const snapshotPath = path.join(outDir, "execution-capsule-stage-revision.json");
    writeExclusive(snapshotPath, manifestRaw);

    let manifest: StageManifest | undefined;
    let validation: ValidationResult | undefined;
    try {
      manifest = JSON.parse(manifestRaw.toString("utf8")) as StageManifest;
    } catch (error) {
      validation = {
        rows: [
          {
            schema_version: LEDGER_SCHEMA,
            check_id: "stage_parse",
            status: "FAIL",
            severity: "P0",
            detail: `Stage manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            evidence: null,
          },
        ],
        materializedLeaves: [],
        stageRoot: null,
        manifestSha256: sha256(manifestRaw),
      };
    }
    if (!validation) {
      try {
        validation = validateStage({
          manifest: manifest!,
          manifestPath,
          manifestRaw,
          predecessorOption: options.predecessorStageManifest,
          repoRoot,
        });
      } catch (error) {
        validation = {
          rows: [
            {
              schema_version: LEDGER_SCHEMA,
              check_id: "admission_validator_error",
              status: "FAIL",
              severity: "P0",
              detail: `Admission validator failed closed: ${error instanceof Error ? error.message : String(error)}`,
              evidence: null,
            },
          ],
          materializedLeaves: [],
          stageRoot: null,
          manifestSha256: sha256(manifestRaw),
        };
      }
    }

    const failed = validation.rows.filter((row) => row.status === "FAIL");
    const p0 = failed.filter((row) => row.severity === "P0").length;
    const p1 = failed.filter((row) => row.severity === "P1").length;
    const ledgerText = validation.rows.map((row) => stableJson(row)).join("\n") + "\n";
    const ledgerPath = path.join(outDir, "execution-capsule-admission-ledger.jsonl");
    writeExclusive(ledgerPath, ledgerText);

    const snapshotBytes = fs.readFileSync(snapshotPath);
    const report = {
      schema_version: REPORT_SCHEMA,
      status: failed.length === 0 ? "sealed" : "rejected",
      admission_mode: "OFFLINE_ONLY",
      production_authority: false,
      stage: {
        stage_id: manifest?.stage_id ?? null,
        revision: manifest?.revision ?? null,
        source_manifest: relativeToRepo(repoRoot, manifestPath),
        snapshot: relativeToRepo(repoRoot, snapshotPath),
        manifest_sha256: validation.manifestSha256,
        scope_binding_sha256: manifest?.scope_binding_sha256 ?? null,
      },
      counts: {
        checks: validation.rows.length,
        passed: validation.rows.length - failed.length,
        failed: failed.length,
        p0,
        p1,
        leaves: validation.materializedLeaves.length,
        primary_attempts: 0,
        network_dispatches: 0,
        database_dispatches: 0,
        mutations: 0,
      },
      artifacts: {
        stage_snapshot_sha256: sha256(snapshotBytes),
        ledger: relativeToRepo(repoRoot, ledgerPath),
        ledger_sha256: sha256(ledgerText),
      },
      leaves: validation.materializedLeaves,
      failed_checks: failed.map((row) => row.check_id),
    };
    const reportPath = path.join(outDir, "execution-capsule-admission-report.json");
    writeJsonExclusive(reportPath, report);

    let seal: JsonRecord | null = null;
    let sealPath: string | null = null;
    if (failed.length === 0) {
      const reportBytes = fs.readFileSync(reportPath);
      const sealPayload = {
        schema_version: SEAL_SCHEMA,
        stage_id: manifest!.stage_id,
        revision: manifest!.revision,
        predecessor_stage_manifest_sha256: manifest!.predecessor_stage_manifest_sha256,
        stage_manifest_sha256: validation.manifestSha256,
        scope_binding_sha256: manifest!.scope_binding_sha256,
        leaf_set_sha256: sha256(
          stableJson(
            validation.materializedLeaves
              .map((leaf) => ({
                leaf_id: leaf.leaf_id,
                raw_sha256: leaf.raw_sha256,
                semantic_sha256: leaf.semantic_sha256,
              }))
              .sort((left, right) => compareText(left.leaf_id ?? "", right.leaf_id ?? "")),
          ),
        ),
        evidence: {
          stage_snapshot_sha256: sha256(snapshotBytes),
          admission_ledger_sha256: sha256(ledgerText),
          admission_report_sha256: sha256(reportBytes),
        },
        attempt_state: {
          status: "UNATTEMPTED",
          attempt_count: 0,
          primary_attempt_count: 0,
          dispatch_state: "NOT_DISPATCHED",
          mutation_state: "NONE",
        },
        production_authority: false,
      };
      seal = {
        ...sealPayload,
        seal_payload_sha256: sha256(stableJson(sealPayload)),
      };
      sealPath = path.join(outDir, "execution-capsule-seal.json");
      writeJsonExclusive(sealPath, seal);
    }

    return {
      status: report.status,
      report: relativeToRepo(repoRoot, reportPath),
      ledger: relativeToRepo(repoRoot, ledgerPath),
      seal: sealPath ? relativeToRepo(repoRoot, sealPath) : null,
      seal_payload_sha256: seal?.seal_payload_sha256 ?? null,
      counts: report.counts,
    };
  }

  return { runExecutionCapsuleAdmit };
}
