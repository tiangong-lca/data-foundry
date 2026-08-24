import Ajv2020 from "ajv/dist/2020.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readOnlyStageContract } from "../lib/stage-contract.ts";

const REQUEST_SCHEMA = "foundry-topology-convergence-request.v1";
const CANDIDATE_ROW_SCHEMA = "foundry-topology-candidate-index-row.v1";
const EVENT_SCHEMA = "foundry-topology-conversion-event.v1";
const REPORT_SCHEMA = "foundry-topology-convergence-report.v1";
const MANIFEST_SCHEMA = "foundry-topology-convergence-manifest.v1";
const ADMISSION_SCHEMA = "foundry-topology-fresh-admission-receipt.v1";
const SAVE_DRAFT_CONTRACT_SCHEMA = "dataset-save-draft-execution-contract.v1";
const ABSENCE_DOMAIN = "foundry-topology-absence.v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableValue(value) {
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

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256Json(value) {
  return sha256Bytes(stableJson(value));
}

function clone(value) {
  return structuredClone(value);
}

function asToken(value) {
  return typeof value === "string" ? value.trim() : "";
}

function entityKey(entity) {
  return `${entity.table}/${entity.id}@${entity.version}`;
}

function artifactFacts(filePath, rows, schemaVersion) {
  const fd = fs.openSync(filePath, "r");
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  try {
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      bytes += read;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return {
    path: path.basename(filePath),
    schema_version: schemaVersion,
    rows,
    bytes,
    sha256: hash.digest("hex"),
  };
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveInside(repoRoot, value, label, mustExist = true) {
  const token = asToken(value);
  if (!token) throw new Error(`${label} is required.`);
  const resolved = path.resolve(repoRoot, token);
  if (!pathInside(repoRoot, resolved)) throw new Error(`${label} must be inside the repository.`);
  if (!mustExist) {
    const parent = fs.realpathSync(path.dirname(resolved));
    const realRoot = fs.realpathSync(repoRoot);
    if (!pathInside(realRoot, parent)) throw new Error(`${label} parent escapes the repository.`);
    return path.join(parent, path.basename(resolved));
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${label} file not found.`);
  }
  const realRoot = fs.realpathSync(repoRoot);
  const realPath = fs.realpathSync(resolved);
  if (!pathInside(realRoot, realPath) || !fs.statSync(realPath).isFile()) {
    throw new Error(`${label} must resolve to a regular file inside the repository.`);
  }
  return realPath;
}

function resolveFreshOutput(repoRoot, value) {
  const outDir = resolveInside(repoRoot, value, "--out-dir", false);
  if (fs.existsSync(outDir)) throw new Error("--out-dir must not already exist.");
  return outDir;
}

function* rawJsonLines(filePath) {
  const fd = fs.openSync(filePath, "r");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  let carry = Buffer.alloc(0);
  let carryOffset = 0;
  let fileOffset = 0;
  let line = 0;
  try {
    for (;;) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, fileOffset);
      if (!read) break;
      const incoming = Buffer.from(chunk.subarray(0, read));
      const combined = carry.length ? Buffer.concat([carry, incoming]) : incoming;
      const combinedOffset = carry.length ? carryOffset : fileOffset;
      let start = 0;
      for (let index = 0; index < combined.length; index += 1) {
        if (combined[index] !== 0x0a) continue;
        let end = index;
        if (end > start && combined[end - 1] === 0x0d) end -= 1;
        const raw = combined.subarray(start, end);
        if (raw.toString("utf8").trim()) {
          line += 1;
          yield { line, offset: combinedOffset + start, length: end - start, raw };
        }
        start = index + 1;
      }
      carry = Buffer.from(combined.subarray(start));
      carryOffset = combinedOffset + start;
      fileOffset += read;
    }
    if (carry.toString("utf8").trim()) {
      line += 1;
      yield { line, offset: carryOffset, length: carry.length, raw: carry };
    }
  } finally {
    fs.closeSync(fd);
  }
}

function* jsonLines(filePath) {
  for (const line of rawJsonLines(filePath)) {
    let value;
    try {
      value = JSON.parse(line.raw.toString("utf8"));
    } catch (error) {
      throw new Error(
        `${path.basename(filePath)} line ${line.line} is invalid JSON: ${error.message}`,
      );
    }
    yield { ...line, value, raw_sha256: sha256Bytes(line.raw) };
  }
}

class JsonlWriter {
  constructor(filePath) {
    this.filePath = filePath;
    this.fd = fs.openSync(filePath, "wx", 0o600);
    this.rows = 0;
    this.closed = false;
  }

  write(value) {
    if (this.closed) throw new Error(`Writer already closed: ${this.filePath}`);
    fs.writeSync(this.fd, `${stableJson(value)}\n`, null, "utf8");
    this.rows += 1;
    return this.rows;
  }

  close() {
    if (!this.closed) {
      fs.fsyncSync(this.fd);
      fs.closeSync(this.fd);
      this.closed = true;
    }
  }

  facts(schemaVersion) {
    this.close();
    return artifactFacts(this.filePath, this.rows, schemaVersion);
  }
}

class ConversionEventWriter extends JsonlWriter {
  constructor(filePath) {
    super(filePath);
    this.previous = null;
  }

  event(value) {
    const event = {
      schema_version: EVENT_SCHEMA,
      sequence: this.rows + 1,
      ...value,
      previous_event_sha256: this.previous,
    };
    event.event_sha256 = sha256Json(event);
    this.previous = event.event_sha256;
    this.write(event);
    return event;
  }
}

function writeJson(filePath, value) {
  const fd = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function createSchemaRuntime(repoRoot) {
  const schema = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "specs", "schemas", "topology-convergence.schema.json")),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true, formats: { email: true } });
  ajv.addSchema(schema);
  return {
    request: ajv.compile({ $ref: `${schema.$id}#/$defs/request` }),
    admissionReceipt: ajv.compile({ $ref: `${schema.$id}#/$defs/admissionReceipt` }),
    candidateIndexRow: ajv.compile({ $ref: `${schema.$id}#/$defs/candidateIndexRow` }),
    classificationRow: ajv.compile({ $ref: `${schema.$id}#/$defs/classificationRow` }),
  };
}

function assertSchema(validate, value, label) {
  if (validate(value)) return;
  const details = (validate.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`)
    .join("; ");
  throw new Error(`${label} schema mismatch: ${details}`);
}

function verifyArtifactRef(repoRoot, ref, label, singleDocument = false) {
  const filePath = resolveInside(repoRoot, ref?.path, `${label}.path`);
  const facts = artifactFacts(filePath, ref.rows, null);
  if (facts.sha256 !== ref.sha256 || facts.bytes !== ref.bytes) {
    throw new Error(`${label} SHA-256 or byte binding mismatch.`);
  }
  let rows = singleDocument ? 1 : 0;
  if (!singleDocument) {
    for (const ignored of rawJsonLines(filePath)) {
      void ignored;
      rows += 1;
    }
  }
  if (rows !== ref.rows) throw new Error(`${label} row-count binding mismatch.`);
  return { filePath, facts: { ...ref, path: ref.path } };
}

function readCandidateIndex(repoRoot, verified, table, validate) {
  const rows = [];
  const seen = new Set();
  for (const { value, line } of jsonLines(verified.filePath)) {
    assertSchema(validate, value, `${table} candidate index line ${line}`);
    if (value.entity.table !== table)
      throw new Error(`${table} candidate line ${line} table mismatch.`);
    const key = entityKey(value.entity);
    if (seen.has(key)) throw new Error(`Duplicate candidate identity: ${key}`);
    seen.add(key);
    rows.push({ ...value, filePath: resolveInside(repoRoot, value.path, `${key}.path`) });
  }
  rows.sort((left, right) => compareText(entityKey(left.entity), entityKey(right.entity)));
  return rows;
}

function loadCandidate(row) {
  const bytes = fs.readFileSync(row.filePath);
  if (bytes.length !== row.bytes || sha256Bytes(bytes) !== row.sha256) {
    throw new Error(`Candidate payload binding mismatch: ${entityKey(row.entity)}`);
  }
  const payload = JSON.parse(bytes.toString("utf8"));
  return payload;
}

function normalizeSnapshotRow(row, expectedTable, line) {
  const entity = row.entity ?? { table: row.table, id: row.id, version: row.version };
  const payload = row.payload ?? row.json_ordered;
  if (
    entity?.table !== expectedTable ||
    !asToken(entity.id) ||
    !asToken(entity.version) ||
    !payload ||
    typeof payload !== "object"
  ) {
    throw new Error(`${expectedTable} snapshot line ${line} is malformed.`);
  }
  const payloadSha256 = row.payload_sha256 ?? sha256Json(payload);
  if (payloadSha256 !== sha256Json(payload)) {
    throw new Error(`${expectedTable} snapshot line ${line} payload hash mismatch.`);
  }
  assertPayloadIdentity(payload, entity);
  return {
    entity,
    payload,
    payload_sha256: payloadSha256,
    user_id: row.user_id ?? row.owner?.user_id ?? null,
    state_code: row.state_code ?? row.owner?.state_code ?? null,
  };
}

function buildSnapshotIndex(verified, table, visibility, request) {
  const byKey = new Map();
  const entries = [];
  for (const { value, line, offset, length } of jsonLines(verified.filePath)) {
    const normalized = normalizeSnapshotRow(value, table, line);
    if (visibility === "owner") {
      if (
        normalized.user_id !== request.scope.user_id ||
        normalized.state_code !== request.scope.state_code
      ) {
        throw new Error(`${table} owner snapshot line ${line} is outside owner/state scope.`);
      }
    } else if (visibility === "public" && normalized.state_code !== 100) {
      throw new Error(`${table} public snapshot line ${line} is not state_code=100.`);
    } else if (
      visibility === "foreign" &&
      (normalized.user_id === request.scope.user_id || normalized.state_code !== 0)
    ) {
      throw new Error(`${table} foreign snapshot line ${line} is not foreign owner-draft.`);
    }
    const entry = {
      ...normalized,
      payload: undefined,
      offset,
      length,
      line,
      visibility,
    };
    const key = entityKey(normalized.entity);
    const same = byKey.get(key) ?? [];
    same.push(entry);
    byKey.set(key, same);
    entries.push(entry);
  }
  return { filePath: verified.filePath, fd: fs.openSync(verified.filePath, "r"), byKey, entries };
}

function loadSnapshotPayload(index, entry) {
  const buffer = Buffer.allocUnsafe(entry.length);
  fs.readSync(index.fd, buffer, 0, entry.length, entry.offset);
  const row = JSON.parse(buffer.toString("utf8"));
  return row.payload ?? row.json_ordered;
}

function closeSnapshotIndex(index) {
  if (index?.fd != null) fs.closeSync(index.fd);
}

function extractIdentity(payload, table) {
  const root = table === "flows" ? payload?.flowDataSet : payload?.processDataSet;
  const information = table === "flows" ? root?.flowInformation : root?.processInformation;
  return {
    table,
    id: asToken(information?.dataSetInformation?.["common:UUID"]),
    version: asToken(
      root?.administrativeInformation?.publicationAndOwnership?.["common:dataSetVersion"],
    ),
  };
}

function assertPayloadIdentity(payload, entity) {
  const actual = extractIdentity(payload, entity.table);
  if (entityKey(actual) !== entityKey(entity)) {
    throw new Error(`Payload identity mismatch for ${entityKey(entity)}.`);
  }
}

function flowClassification(payload) {
  return payload?.flowDataSet?.flowInformation?.dataSetInformation?.classificationInformation;
}

function setFlowClassification(payload, classification) {
  payload.flowDataSet.flowInformation.dataSetInformation.classificationInformation =
    clone(classification);
}

function leafClassificationCode(classification) {
  const classes = classification?.["common:classification"]?.["common:class"];
  const array = Array.isArray(classes) ? classes : classes ? [classes] : [];
  return asToken(array.at(-1)?.["@classId"]);
}

function referenceIdentity(reference) {
  return `${asToken(reference?.["@refObjectId"])}@${asToken(reference?.["@version"])}`;
}

function collectSupportReferences(
  value,
  result = { flowproperties: new Set(), unitgroups: new Set() },
) {
  if (Array.isArray(value)) {
    for (const child of value) collectSupportReferences(child, result);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "referenceToFlowPropertyDataSet")
        result.flowproperties.add(referenceIdentity(child));
      if (/referenceTo(?:Reference)?UnitGroup/u.test(key))
        result.unitgroups.add(referenceIdentity(child));
      collectSupportReferences(child, result);
    }
  }
  return result;
}

function candidateExchanges(payload) {
  const value = payload?.processDataSet?.exchanges?.exchange;
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textFragments(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) {
    for (const child of value) textFragments(child, output);
  } else if (value && typeof value === "object") {
    if (typeof value["#text"] === "string") output.push(value["#text"]);
    else for (const child of Object.values(value)) textFragments(child, output);
  }
  return output;
}

function sourceExchangeNumber(exchange, processId, exchangeIndex) {
  const attributes =
    exchange?.["common:other"]?.["tidasimport:sourceTrace"]?.payload?.sourceTrace?.exchange
      ?.attributes;
  const array = Array.isArray(attributes) ? attributes : attributes ? [attributes] : [];
  const traceNumbers = [
    ...new Set(
      array
        .filter((attribute) => attribute?.name === "number")
        .map((attribute) => asToken(attribute?.value))
        .filter(Boolean),
    ),
  ];
  const commentNumbers = [
    ...new Set(
      textFragments(exchange?.generalComment).flatMap((fragment) =>
        [...fragment.matchAll(/Source EcoSpold1 exchange number:\s*([0-9]+)(?:\.|\b)/giu)].map(
          (match) => match[1],
        ),
      ),
    ),
  ];
  if (traceNumbers.length > 1 || commentNumbers.length > 1) {
    throw new Error(
      `Process ${processId} exchange ${exchangeIndex + 1} has ambiguous source numbers.`,
    );
  }
  const traceNumber = traceNumbers[0] ?? "";
  const commentNumber = commentNumbers[0] ?? "";
  if (traceNumber && commentNumber && traceNumber !== commentNumber) {
    throw new Error(
      `Process ${processId} exchange ${exchangeIndex + 1} sourceTrace/generalComment number mismatch.`,
    );
  }
  return traceNumber || commentNumber;
}

export function occurrenceKeyedExchanges(exchanges, processId) {
  const occurrences = new Map();
  const ordered = [];
  for (let index = 0; index < exchanges.length; index += 1) {
    const exchange = exchanges[index];
    const number = sourceExchangeNumber(exchange, processId, index);
    if (!number)
      throw new Error(`Process ${processId} exchange ${index + 1} has no source number.`);
    const occurrence = (occurrences.get(number) ?? 0) + 1;
    occurrences.set(number, occurrence);
    const token = `${number}\u0000${occurrence}`;
    ordered.push({ token, number, occurrence, index, exchange });
  }
  return ordered;
}

function languageValues(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function upsertLanguage(value, language, replacement) {
  const kept = languageValues(value).filter((entry) => entry?.["@xml:lang"] !== language);
  const output = [...kept, clone(replacement)];
  return output.length === 1 ? output[0] : output;
}

function chineseDescriptions(exchange) {
  return languageValues(exchange?.referenceToFlowDataSet?.["common:shortDescription"]).filter(
    (entry) => entry?.["@xml:lang"] === "zh",
  );
}

function overlayChineseDescription(candidateReference, currentExchange) {
  const output = clone(candidateReference);
  const chinese = chineseDescriptions(currentExchange);
  if (chinese.length > 1)
    throw new Error("An exchange contains duplicate zh shortDescription nodes.");
  if (chinese.length === 1) {
    output["common:shortDescription"] = upsertLanguage(
      output["common:shortDescription"],
      "zh",
      chinese[0],
    );
  }
  return { reference: output, chinese };
}

function canonicalDecimal(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const token = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u.exec(token);
  if (!match) return null;
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;
  const digits = `${match[2]}${match[3] ?? ""}`;
  const point = match[2].length + exponent;
  const expanded =
    point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length
        ? `${digits}${"0".repeat(point - digits.length)}`
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [wholeRaw, fractionRaw = ""] = expanded.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/u, "") || "0";
  const fraction = fractionRaw.replace(/0+$/u, "");
  const magnitude = fraction ? `${whole}.${fraction}` : whole;
  return magnitude === "0" ? "0" : `${match[1] === "-" ? "-" : ""}${magnitude}`;
}

function decimalEqual(left, right) {
  const normalized = [canonicalDecimal(left), canonicalDecimal(right)];
  return normalized[0] != null && normalized[0] === normalized[1];
}

function exchangeFlowIdentity(exchange) {
  return referenceIdentity(exchange?.referenceToFlowDataSet);
}

function hashOrNull(value) {
  return value == null ? null : sha256Json(value);
}

function loadClassifications(verified, validate) {
  const result = new Map();
  for (const { value, line } of jsonLines(verified.filePath)) {
    assertSchema(validate, value, `target classification line ${line}`);
    if (value.entity.table !== "flows")
      throw new Error(`Classification line ${line} is not a flow.`);
    const key = entityKey(value.entity);
    if (result.has(key)) throw new Error(`Duplicate target classification: ${key}`);
    result.set(key, value);
  }
  return result;
}

function loadGermanSynonyms(verified) {
  const result = new Map();
  for (const { value, line } of jsonLines(verified.filePath)) {
    const processId = asToken(value.process_id ?? value.entity?.id);
    const desired = value.value ?? value.desired_value;
    const evidence = asToken(value.evidence_sha256 ?? value.language_event_sha256);
    if (!processId || !desired || desired["@xml:lang"] !== "de" || !evidence) {
      throw new Error(`German synonym line ${line} is malformed.`);
    }
    const desiredSha = value.value_sha256 ?? value.desired_value_sha256 ?? sha256Json(desired);
    if (desiredSha !== sha256Json(desired))
      throw new Error(`German synonym line ${line} hash drift.`);
    if (result.has(processId)) throw new Error(`Duplicate German synonym process: ${processId}`);
    result.set(processId, { value: desired, evidence_sha256: evidence });
  }
  return result;
}

function loadMappings(verified) {
  const rows = [];
  const byPair = new Map();
  for (const { value, line } of jsonLines(verified.filePath)) {
    const oldId = asToken(value.old_flow_id ?? value.old_flow_uuid);
    const newId = asToken(value.new_flow_id ?? value.new_flow_uuid);
    const mappingKind = asToken(value.mapping_kind ?? value.relation);
    const evidence = asToken(value.evidence_sha256);
    if (!newId || !mappingKind || !evidence)
      throw new Error(`Flow mapping line ${line} is malformed.`);
    const row = {
      old_flow_id: oldId || null,
      new_flow_id: newId,
      mapping_kind: mappingKind,
      evidence_sha256: evidence,
    };
    rows.push(row);
    if (oldId) {
      const pair = `${oldId}\u0000${newId}`;
      if (byPair.has(pair)) throw new Error(`Duplicate flow mapping pair at line ${line}.`);
      byPair.set(pair, row);
    }
  }
  return { rows, byPair };
}

export function admissionRequestBinding(request) {
  const { admission_receipt: ignored, ...inputArtifacts } = request.input_artifacts ?? {};
  void ignored;
  return sha256Json({
    schema_version: "foundry-topology-admission-request-binding.v1",
    campaign_id: request.campaign_id,
    production_authority: request.production_authority,
    candidate_package: request.candidate_package,
    scope: request.scope,
    input_artifacts: inputArtifacts,
    canonical_support: request.canonical_support,
    classification_policy: request.classification_policy,
    expected: request.expected,
    cli_fingerprint: request.cli_fingerprint,
  });
}

function validateAdmission(receipt, request, refs) {
  if (receipt?.schema_version !== ADMISSION_SCHEMA || receipt?.select_only !== true) {
    throw new Error("Admission receipt is not a fresh SELECT-only receipt.");
  }
  if (receipt.fresh_owner_session !== true || receipt.captured_at_utc == null) {
    throw new Error("Admission receipt does not bind a fresh owner session.");
  }
  if (stableJson(receipt.scope) !== stableJson(request.scope)) {
    throw new Error("Admission receipt scope does not match the request.");
  }
  if (receipt.candidate_package_sha256 !== request.candidate_package.sha256) {
    throw new Error("Admission receipt candidate package binding mismatch.");
  }
  if (receipt.request_binding_sha256 !== admissionRequestBinding(request)) {
    throw new Error("Admission receipt request binding mismatch.");
  }
  for (const [name, ref] of Object.entries(request.input_artifacts)) {
    if (name === "admission_receipt") continue;
    if (receipt.input_artifact_sha256?.[name] !== ref.sha256) {
      throw new Error(`Admission receipt does not bind ${name}.`);
    }
  }
  if (stableJson(receipt.cli_fingerprint) !== stableJson(request.cli_fingerprint)) {
    throw new Error("Admission receipt CLI fingerprint mismatch.");
  }
  for (const name of ["deployment", "rpc", "query"]) {
    if (!/^[a-f0-9]{64}$/u.test(receipt.fingerprints?.[name] ?? "")) {
      throw new Error(`Admission receipt ${name} fingerprint is missing.`);
    }
  }
  for (const name of ["queue", "fence", "residue", "p0", "p1"]) {
    if (receipt.guards?.[name] !== 0)
      throw new Error(`Admission receipt guard ${name} is not zero.`);
  }
  void refs;
}

function executionContract(request, suffix, actions) {
  return {
    schema_version: SAVE_DRAFT_CONTRACT_SCHEMA,
    execution_id: `${request.campaign_id}-${suffix}`,
    project_ref: request.scope.project_ref,
    target_mode: "owner_draft",
    owner: {
      user_id: request.scope.user_id,
      email: request.scope.email.toLowerCase(),
      state_code: 0,
    },
    actions,
  };
}

function actionId(entity, desiredSha) {
  return `${entity.table}/${entity.id}@${entity.version}#topology@${desiredSha}`;
}

function conversionActionId(entity, kind, key, desiredSha) {
  const exchange = key ? `#${key.number}:${key.occurrence}` : "";
  return `${entity.table}/${entity.id}@${entity.version}${exchange}#${kind}@${desiredSha ?? "absent"}`;
}

function addProcessLanguage(payload, german) {
  if (!german) return;
  const information = payload.processDataSet.processInformation.dataSetInformation;
  information["common:synonyms"] = upsertLanguage(
    information["common:synonyms"],
    "de",
    german.value,
  );
}

function makePaths(outDir) {
  return Object.fromEntries(
    Object.entries({
      request: "topology-request.snapshot.json",
      events: "topology-conversion-events.jsonl",
      flowCreate: "flow-create-input.jsonl",
      flowNoWrite: "flow-no-write.jsonl",
      processInput: "process-save-draft-input.jsonl",
      processNoWrite: "process-no-write.jsonl",
      deleteCandidates: "flow-delete-candidates.jsonl",
      protectedNoWrite: "protected-no-write.jsonl",
      holds: "topology-holds.jsonl",
      ambiguity: "topology-ambiguity-recovery-registry.jsonl",
      dependencies: "topology-dependency-closure.json",
      flowContract: "flow-create-execution-contract.json",
      processContract: "process-execution-contract.json",
      auditInput: "topology-independent-audit-input.json",
      audit: "topology-independent-audit.json",
      report: "topology-report.json",
      manifest: "topology-manifest.json",
    }).map(([key, file]) => [key, path.join(outDir, file)]),
  );
}

function auditEventChain(filePath) {
  let previous = null;
  let rows = 0;
  for (const { value, line } of jsonLines(filePath)) {
    const recorded = value.event_sha256;
    const body = { ...value };
    delete body.event_sha256;
    if (body.previous_event_sha256 !== previous || sha256Json(body) !== recorded) {
      throw new Error(`Conversion event chain mismatch at line ${line}.`);
    }
    for (const field of [
      "action_id",
      "entity",
      "exchange_key",
      "mapping_kind",
      "reason",
      "before_sha",
      "desired_sha",
    ]) {
      if (!Object.hasOwn(value, field))
        throw new Error(`Conversion event line ${line} lacks ${field}.`);
    }
    previous = recorded;
    rows += 1;
  }
  return { rows, terminal_event_sha256: previous };
}

function independentAudit(artifacts, eventPath, algebra, p0, p1) {
  for (const artifact of artifacts) {
    const actual = artifactFacts(
      path.join(path.dirname(eventPath), artifact.path),
      artifact.rows,
      artifact.schema_version,
    );
    if (actual.bytes !== artifact.bytes || actual.sha256 !== artifact.sha256) {
      throw new Error(`Independent audit artifact drift: ${artifact.path}`);
    }
  }
  const chain = auditEventChain(eventPath);
  return {
    schema_version: "foundry-topology-independent-audit.v1",
    status: algebra.passed && p0 === 0 && p1 === 0 ? "PASS" : "FAIL",
    artifact_count: artifacts.length,
    conversion_event_chain: chain,
    algebra,
    remote_write_mode: "read-only",
    dispatch_counts: { network: 0, database: 0, cli: 0, dml: 0 },
  };
}

function commandHelp() {
  return {
    status: "help",
    command: "dataset-topology-convergence-compose",
    usage:
      "node scripts/foundry.mjs dataset-topology-convergence-compose --request <request.json> --out-dir <fresh-directory>",
    production_authority: false,
    ...readOnlyStageContract([
      {
        stage: "bind-inputs",
        phase: "prepare",
        purpose:
          "Verify the candidate, fresh owner census, classifications, languages, and CLI fingerprint.",
        inputs: ["SHA-bound request", "fresh SELECT-only admission receipt"],
        outputs: ["verified input bindings"],
        blockers: ["scope drift", "hash drift", "nonzero admission guard"],
      },
      {
        stage: "compose-topology",
        phase: "rewrite_cleanup",
        purpose:
          "Build F/P/D candidates with occurrence-aware exchanges and approved language preservation.",
        inputs: ["candidate topology", "owner rows", "audited classifications"],
        outputs: ["flow creates", "process saves", "zero-inbound delete candidates"],
        blockers: ["foreign target", "content conflict", "unresolved classification"],
      },
      {
        stage: "audit-algebra",
        phase: "gate_validate",
        purpose:
          "Check exact topology algebra, event chain, owner isolation, and support references.",
        inputs: ["composed artifacts", "expected counts"],
        outputs: ["independent audit"],
        blockers: ["count mismatch", "chain mismatch", "out-of-closure reference"],
      },
      {
        stage: "seal-package",
        phase: "report",
        purpose: "Write immutable content-addressed handoff artifacts without dispatching DML.",
        inputs: ["audited topology package"],
        outputs: ["report", "manifest", "separate F/P contracts"],
        blockers: ["P0/P1 finding"],
      },
    ]),
  };
}

export function createTopologyConvergenceCommands({ repoRoot }) {
  async function runDatasetTopologyConvergenceCompose(options = {}) {
    if (options.help) return commandHelp();
    const runtime = createSchemaRuntime(repoRoot);
    const requestPath = resolveInside(repoRoot, options.request, "--request");
    const outDir = resolveFreshOutput(repoRoot, options.outDir);
    const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    assertSchema(runtime.request, request, "topology convergence request");
    const candidatePackagePath = resolveInside(
      repoRoot,
      request.candidate_package.path,
      "candidate_package.path",
    );
    const candidatePackageFacts = artifactFacts(candidatePackagePath, 1, "candidate-package");
    if (
      candidatePackageFacts.sha256 !== request.candidate_package.sha256 ||
      candidatePackageFacts.bytes !== request.candidate_package.bytes
    ) {
      throw new Error("Candidate package SHA-256 or byte binding mismatch.");
    }

    const refs = Object.fromEntries(
      Object.entries(request.input_artifacts).map(([name, ref]) => [
        name,
        verifyArtifactRef(repoRoot, ref, name, name === "admission_receipt"),
      ]),
    );
    const receipt = JSON.parse(fs.readFileSync(refs.admission_receipt.filePath, "utf8"));
    assertSchema(runtime.admissionReceipt, receipt, "fresh admission receipt");
    validateAdmission(receipt, request, refs);

    const candidateFlows = readCandidateIndex(
      repoRoot,
      refs.candidate_flows,
      "flows",
      runtime.candidateIndexRow,
    );
    const candidateProcesses = readCandidateIndex(
      repoRoot,
      refs.candidate_processes,
      "processes",
      runtime.candidateIndexRow,
    );
    const classifications = loadClassifications(
      refs.target_classifications,
      runtime.classificationRow,
    );
    const german = loadGermanSynonyms(refs.german_synonyms);
    const mappings = loadMappings(refs.flow_mappings);
    const ownerFlows = buildSnapshotIndex(refs.owner_flows, "flows", "owner", request);
    const publicFlows = buildSnapshotIndex(refs.public_flows, "flows", "public", request);
    const foreignFlows = buildSnapshotIndex(refs.foreign_flows, "flows", "foreign", request);
    const ownerProcesses = buildSnapshotIndex(refs.owner_processes, "processes", "owner", request);

    fs.mkdirSync(outDir, { recursive: false, mode: 0o700 });
    fs.chmodSync(outDir, 0o700);
    const paths = makePaths(outDir);
    writeJson(paths.request, request);
    const writers = {
      events: new ConversionEventWriter(paths.events),
      flowCreate: new JsonlWriter(paths.flowCreate),
      flowNoWrite: new JsonlWriter(paths.flowNoWrite),
      processInput: new JsonlWriter(paths.processInput),
      processNoWrite: new JsonlWriter(paths.processNoWrite),
      deleteCandidates: new JsonlWriter(paths.deleteCandidates),
      protectedNoWrite: new JsonlWriter(paths.protectedNoWrite),
      holds: new JsonlWriter(paths.holds),
      ambiguity: new JsonlWriter(paths.ambiguity),
    };
    const flowActions = [];
    const processActions = [];
    const targetFlowKeys = new Set(candidateFlows.map((row) => entityKey(row.entity)));
    const targetFlowIds = new Set(candidateFlows.map((row) => row.entity.id));
    const findings = [];
    const counts = {
      candidate_flows: candidateFlows.length,
      flow_create: 0,
      flow_owner_no_write: 0,
      flow_public_reuse: 0,
      flow_hold: 0,
      obsolete_flow_delete_candidates: 0,
      processes: candidateProcesses.length,
      exchanges: 0,
      flow_reference_changes: 0,
      exchange_add: 0,
      exchange_delete: 0,
      direction_changes: 0,
      amount_changes: 0,
      german_synonyms: german.size,
      chinese_descriptions: 0,
      process_update: 0,
      process_insert: 0,
      process_no_write: 0,
      process_hold: 0,
      protected_no_write: 0,
      conversion_events: 0,
      machine_translation: 0,
      public_foreign_mutations: 0,
    };
    const supportSeen = { flowproperties: new Set(), unitgroups: new Set() };

    try {
      if (classifications.size !== candidateFlows.length) {
        findings.push({ severity: "P0", code: "TARGET_CLASSIFICATION_CLOSURE_MISMATCH" });
      }
      if (
        candidateFlows.filter(
          (row) => row.entity.id === request.classification_policy.conflict_flow_id,
        ).length !== 1
      ) {
        findings.push({ severity: "P0", code: "CLASSIFICATION_CONFLICT_TARGET_MISMATCH" });
      }
      for (const row of candidateFlows) {
        const payload = loadCandidate(row);
        assertPayloadIdentity(payload, row.entity);
        const key = entityKey(row.entity);
        const classification = classifications.get(key);
        if (!classification) {
          counts.flow_hold += 1;
          writers.holds.write({
            schema_version: "foundry-topology-hold.v1",
            entity: row.entity,
            reason: "MISSING_AUDITED_CLASSIFICATION",
          });
          continue;
        }
        const selectedLeaf = leafClassificationCode(classification.classification);
        if (classification.selected_code != null && classification.selected_code !== selectedLeaf) {
          findings.push({
            severity: "P0",
            code: "CLASSIFICATION_SELECTED_CODE_MISMATCH",
            entity: row.entity,
          });
        }
        if (
          row.entity.id === request.classification_policy.conflict_flow_id &&
          (classification.selected_code !== request.classification_policy.selected_code ||
            selectedLeaf !== request.classification_policy.selected_code)
        ) {
          findings.push({
            severity: "P0",
            code: "CLASSIFICATION_CONFLICT_OVERRIDE_MISMATCH",
            entity: row.entity,
          });
        }
        const desired = clone(payload);
        setFlowClassification(desired, classification.classification);
        const refsSeen = collectSupportReferences(desired);
        for (const identity of refsSeen.flowproperties) supportSeen.flowproperties.add(identity);
        for (const identity of refsSeen.unitgroups) supportSeen.unitgroups.add(identity);
        const desiredSha = sha256Json(desired);
        const action = actionId(row.entity, desiredSha);
        const ownerRows = ownerFlows.byKey.get(key) ?? [];
        const publicRows = publicFlows.byKey.get(key) ?? [];
        const foreignRows = foreignFlows?.byKey.get(key) ?? [];
        let mappingKind;
        let reason;
        let beforeSha = null;
        if (ownerRows.length > 1 || publicRows.length > 1) {
          mappingKind = "HOLD";
          reason = "NON_UNIQUE_VISIBLE_TARGET";
        } else if (ownerRows.length === 1) {
          beforeSha = ownerRows[0].payload_sha256;
          mappingKind = beforeSha === desiredSha ? "OWNER_DESIRED_EXACT_NO_WRITE" : "HOLD";
          reason =
            beforeSha === desiredSha
              ? "OWNER_TARGET_ALREADY_EXACT"
              : "OWNER_TARGET_CONTENT_CONFLICT";
        } else if (publicRows.length === 1) {
          beforeSha = publicRows[0].payload_sha256;
          mappingKind = beforeSha === desiredSha ? "PUBLIC_EXACT_REUSE" : "HOLD";
          reason =
            beforeSha === desiredSha
              ? "PUBLIC_TARGET_ALREADY_EXACT"
              : "PUBLIC_TARGET_CONTENT_CONFLICT";
        } else if (foreignRows.length) {
          mappingKind = "HOLD";
          reason = "FOREIGN_ONLY_TARGET";
        } else {
          mappingKind = "CREATE";
          reason = "TARGET_GLOBALLY_ABSENT";
        }
        if (mappingKind === "CREATE") {
          writers.flowCreate.write(desired);
          const metadata = {
            action_id: action,
            desired_sha256: desiredSha,
            expected_operation: "insert",
            table: "flows",
            id: row.entity.id,
            version: row.entity.version,
            before_sha256: null,
            dependency_action_ids: [],
          };
          flowActions.push(metadata);
          counts.flow_create += 1;
        } else if (
          mappingKind === "OWNER_DESIRED_EXACT_NO_WRITE" ||
          mappingKind === "PUBLIC_EXACT_REUSE"
        ) {
          writers.flowNoWrite.write({
            schema_version: "foundry-topology-flow-no-write.v1",
            action_id: action,
            entity: row.entity,
            disposition: mappingKind,
            before_sha256: beforeSha,
            desired_sha256: desiredSha,
          });
          counts[
            mappingKind === "PUBLIC_EXACT_REUSE" ? "flow_public_reuse" : "flow_owner_no_write"
          ] += 1;
        } else {
          writers.holds.write({
            schema_version: "foundry-topology-hold.v1",
            entity: row.entity,
            reason,
            before_sha256: beforeSha,
            desired_sha256: desiredSha,
          });
          findings.push({ severity: "P0", code: reason, entity: row.entity });
          counts.flow_hold += 1;
        }
        writers.events.event({
          action_id: action,
          entity: row.entity,
          exchange_key: null,
          mapping_kind: mappingKind,
          reason,
          before_sha: beforeSha,
          desired_sha: desiredSha,
          evidence_sha256: classification.evidence_sha256,
        });
      }

      const allowedSupport = {
        flowproperties: new Set(request.canonical_support.flowproperties),
        unitgroups: new Set(request.canonical_support.unitgroups),
      };
      for (const type of ["flowproperties", "unitgroups"]) {
        for (const identity of supportSeen[type]) {
          if (!allowedSupport[type].has(identity)) {
            findings.push({
              severity: "P0",
              code: "NON_CANONICAL_SUPPORT_REFERENCE",
              type,
              identity,
            });
          }
        }
      }

      for (const entry of ownerFlows.entries.sort((left, right) =>
        compareText(entityKey(left.entity), entityKey(right.entity)),
      )) {
        if (targetFlowKeys.has(entityKey(entry.entity))) continue;
        const desiredSha = sha256Json({
          schema_version: ABSENCE_DOMAIN,
          entity: entry.entity,
          absent: true,
        });
        const action = conversionActionId(entry.entity, "delete", null, desiredSha);
        writers.deleteCandidates.write({
          schema_version: "foundry-topology-flow-delete-candidate.v1",
          action_id: action,
          entity: entry.entity,
          before_sha256: entry.payload_sha256,
          desired_sha256: desiredSha,
          required_inbound_ref_count: 0,
          authorized_visibility: "owner_draft",
          authorized_state_code: 0,
        });
        writers.events.event({
          action_id: action,
          entity: entry.entity,
          exchange_key: null,
          mapping_kind: "DELETE_CANDIDATE",
          reason: "OWNER_FLOW_OUTSIDE_CANDIDATE_CLOSURE_PENDING_ZERO_INBOUND",
          before_sha: entry.payload_sha256,
          desired_sha: desiredSha,
        });
        counts.obsolete_flow_delete_candidates += 1;
      }

      const processFlowEdges = [];
      const candidateProcessIds = new Set(candidateProcesses.map((row) => row.entity.id));
      for (const processRow of candidateProcesses) {
        const candidate = loadCandidate(processRow);
        assertPayloadIdentity(candidate, processRow.entity);
        const processKey = entityKey(processRow.entity);
        const currentRows = ownerProcesses.byKey.get(processKey) ?? [];
        if (currentRows.length > 1) {
          writers.holds.write({
            schema_version: "foundry-topology-hold.v1",
            entity: processRow.entity,
            reason: "NON_UNIQUE_OWNER_PROCESS_TARGET",
          });
          findings.push({
            severity: "P0",
            code: "NON_UNIQUE_OWNER_PROCESS_TARGET",
            entity: processRow.entity,
          });
          counts.process_hold += 1;
          continue;
        }
        const current = currentRows.length
          ? loadSnapshotPayload(ownerProcesses, currentRows[0])
          : null;
        const candidateOrdered = occurrenceKeyedExchanges(
          candidateExchanges(candidate),
          processRow.entity.id,
        );
        const currentOrdered = current
          ? occurrenceKeyedExchanges(candidateExchanges(current), processRow.entity.id)
          : [];
        const currentByKey = new Map(currentOrdered.map((entry) => [entry.token, entry]));
        const candidateByKey = new Map(candidateOrdered.map((entry) => [entry.token, entry]));
        const desired = current ? clone(current) : clone(candidate);
        const desiredExchanges = [];
        const entity = processRow.entity;
        const parentBeforeSha = currentRows[0]?.payload_sha256 ?? null;

        for (const candidateEntry of candidateOrdered) {
          const beforeEntry = currentByKey.get(candidateEntry.token);
          let next;
          if (!beforeEntry) {
            next = clone(candidateEntry.exchange);
            if (current) {
              counts.exchange_add += 1;
              const desiredSha = sha256Json(next);
              writers.events.event({
                action_id: conversionActionId(entity, "exchange-add", candidateEntry, desiredSha),
                entity,
                exchange_key: {
                  number: candidateEntry.number,
                  occurrence: candidateEntry.occurrence,
                },
                mapping_kind: "EXCHANGE_ADD",
                reason: "CANDIDATE_OCCURRENCE_ADDED",
                before_sha: null,
                desired_sha: desiredSha,
              });
            }
          } else {
            const before = beforeEntry.exchange;
            next = clone(before);
            next["@dataSetInternalID"] = candidateEntry.exchange["@dataSetInternalID"];
            const beforeRef = before.referenceToFlowDataSet;
            const candidateRef = candidateEntry.exchange.referenceToFlowDataSet;
            const overlaid = overlayChineseDescription(candidateRef, before);
            next.referenceToFlowDataSet = overlaid.reference;
            for (const chinese of overlaid.chinese) {
              counts.chinese_descriptions += 1;
              writers.events.event({
                action_id: conversionActionId(
                  entity,
                  "zh-preserve",
                  candidateEntry,
                  sha256Json(chinese),
                ),
                entity,
                exchange_key: {
                  number: candidateEntry.number,
                  occurrence: candidateEntry.occurrence,
                },
                mapping_kind: "CHINESE_DESCRIPTION_PRESERVE",
                reason: "OWNER_AUTHORED_ZH_OVERLAY_BY_OCCURRENCE",
                before_sha: sha256Json(chinese),
                desired_sha: sha256Json(chinese),
              });
            }
            if (referenceIdentity(beforeRef) !== referenceIdentity(candidateRef)) {
              const oldFlowId = asToken(beforeRef?.["@refObjectId"]);
              const newFlowId = asToken(candidateRef?.["@refObjectId"]);
              const mapping = mappings.byPair.get(`${oldFlowId}\u0000${newFlowId}`);
              if (!mapping) {
                findings.push({
                  severity: "P0",
                  code: "MISSING_OCCURRENCE_FLOW_MAPPING",
                  entity,
                  exchange_key: candidateEntry.token,
                  old_flow_id: oldFlowId,
                  new_flow_id: newFlowId,
                });
              }
              counts.flow_reference_changes += 1;
              writers.events.event({
                action_id: conversionActionId(
                  entity,
                  "flow-ref",
                  candidateEntry,
                  sha256Json(candidateRef),
                ),
                entity,
                exchange_key: {
                  number: candidateEntry.number,
                  occurrence: candidateEntry.occurrence,
                },
                mapping_kind: "FLOW_REFERENCE_CHANGE",
                reason: mapping
                  ? `CANDIDATE_OCCURRENCE_TARGET_IDENTITY:${mapping.mapping_kind}`
                  : "CANDIDATE_OCCURRENCE_TARGET_IDENTITY:MAPPING_MISSING",
                before_sha: sha256Json(beforeRef),
                desired_sha: sha256Json(candidateRef),
                flow_mapping_kind: mapping?.mapping_kind ?? null,
                evidence_sha256: mapping?.evidence_sha256 ?? null,
              });
            }
            if (before.exchangeDirection !== candidateEntry.exchange.exchangeDirection) {
              next.exchangeDirection = candidateEntry.exchange.exchangeDirection;
              counts.direction_changes += 1;
              writers.events.event({
                action_id: conversionActionId(
                  entity,
                  "direction",
                  candidateEntry,
                  sha256Json(candidateEntry.exchange.exchangeDirection),
                ),
                entity,
                exchange_key: {
                  number: candidateEntry.number,
                  occurrence: candidateEntry.occurrence,
                },
                mapping_kind: "DIRECTION_CHANGE",
                reason: "AUTHORIZED_CANDIDATE_DIRECTION",
                before_sha: sha256Json(before.exchangeDirection),
                desired_sha: sha256Json(candidateEntry.exchange.exchangeDirection),
              });
            }
            const amountChanged =
              !decimalEqual(before.meanAmount, candidateEntry.exchange.meanAmount) ||
              !decimalEqual(before.resultingAmount, candidateEntry.exchange.resultingAmount);
            if (amountChanged) {
              next.meanAmount = candidateEntry.exchange.meanAmount;
              next.resultingAmount = candidateEntry.exchange.resultingAmount;
              counts.amount_changes += 1;
              const beforeAmount = {
                meanAmount: before.meanAmount,
                resultingAmount: before.resultingAmount,
              };
              const desiredAmount = {
                meanAmount: candidateEntry.exchange.meanAmount,
                resultingAmount: candidateEntry.exchange.resultingAmount,
              };
              writers.events.event({
                action_id: conversionActionId(
                  entity,
                  "amount",
                  candidateEntry,
                  sha256Json(desiredAmount),
                ),
                entity,
                exchange_key: {
                  number: candidateEntry.number,
                  occurrence: candidateEntry.occurrence,
                },
                mapping_kind: "AMOUNT_CHANGE",
                reason: "AUTHORIZED_CANDIDATE_AMOUNT",
                before_sha: sha256Json(beforeAmount),
                desired_sha: sha256Json(desiredAmount),
              });
            }
          }
          const flowIdentity = exchangeFlowIdentity(next);
          if (!targetFlowKeys.has(`flows/${flowIdentity}`)) {
            findings.push({
              severity: "P0",
              code: "PROCESS_REFERENCE_OUTSIDE_CANDIDATE_CLOSURE",
              entity,
              exchange_key: candidateEntry.token,
              flow_identity: flowIdentity,
            });
          }
          processFlowEdges.push({ process: processKey, flow: `flows/${flowIdentity}` });
          desiredExchanges.push(next);
        }
        if (current) {
          for (const currentEntry of currentOrdered) {
            if (candidateByKey.has(currentEntry.token)) continue;
            counts.exchange_delete += 1;
            writers.events.event({
              action_id: conversionActionId(entity, "exchange-delete", currentEntry, null),
              entity,
              exchange_key: { number: currentEntry.number, occurrence: currentEntry.occurrence },
              mapping_kind: "EXCHANGE_DELETE",
              reason: "CURRENT_OCCURRENCE_ABSENT_FROM_CANDIDATE",
              before_sha: sha256Json(currentEntry.exchange),
              desired_sha: null,
            });
          }
        }
        desired.processDataSet.exchanges = {
          ...desired.processDataSet.exchanges,
          exchange: desiredExchanges,
        };
        const germanRow = german.get(processRow.entity.id);
        addProcessLanguage(desired, germanRow);
        counts.exchanges += desiredExchanges.length;
        const desiredSha = sha256Json(desired);
        const processActionId = actionId(entity, desiredSha);
        const disposition = current
          ? parentBeforeSha === desiredSha
            ? "NO_WRITE"
            : "UPDATE"
          : "INSERT";
        if (disposition === "NO_WRITE") {
          counts.process_no_write += 1;
          writers.processNoWrite.write({
            schema_version: "foundry-topology-process-no-write.v1",
            action_id: processActionId,
            entity,
            before_sha256: parentBeforeSha,
            desired_sha256: desiredSha,
          });
        } else {
          counts[disposition === "INSERT" ? "process_insert" : "process_update"] += 1;
          writers.processInput.write(desired);
          processActions.push({
            action_id: processActionId,
            desired_sha256: desiredSha,
            expected_operation: disposition === "INSERT" ? "insert" : "save_draft",
            table: "processes",
            id: entity.id,
            version: entity.version,
            before_sha256: parentBeforeSha,
            dependency_action_ids: [],
          });
        }
        writers.events.event({
          action_id: processActionId,
          entity,
          exchange_key: null,
          mapping_kind: disposition,
          reason: current
            ? "CANDIDATE_ORDERED_TOPOLOGY_RECONCILIATION"
            : "MISSING_CANDIDATE_PROCESS_INSERT",
          before_sha: parentBeforeSha,
          desired_sha: desiredSha,
          german_evidence_sha256: germanRow?.evidence_sha256 ?? null,
        });
      }

      for (const processId of german.keys()) {
        if (!candidateProcessIds.has(processId)) {
          findings.push({
            severity: "P0",
            code: "GERMAN_OVERLAY_OUTSIDE_PROCESS_SCOPE",
            process_id: processId,
          });
        }
      }

      for (const { value, line } of jsonLines(refs.protected_no_write.filePath)) {
        const entity = value.entity;
        const beforeSha = asToken(value.before_sha256 ?? value.before_sha);
        const reason = asToken(value.reason);
        const evidenceSha = asToken(value.evidence_sha256);
        if (
          entity?.table !== "sources" ||
          !asToken(entity.id) ||
          !asToken(entity.version) ||
          !SHA256_PATTERN.test(beforeSha) ||
          !reason ||
          !SHA256_PATTERN.test(evidenceSha)
        )
          throw new Error(`Protected no-write line ${line} is malformed.`);
        const action = conversionActionId(entity, "protected-no-write", null, beforeSha);
        const output = {
          schema_version: "foundry-topology-protected-no-write.v1",
          action_id: action,
          entity,
          before_sha256: beforeSha,
          desired_sha256: beforeSha,
          reason,
          evidence_sha256: evidenceSha,
        };
        writers.protectedNoWrite.write(output);
        writers.events.event({
          action_id: action,
          entity,
          exchange_key: null,
          mapping_kind: "PROTECTED_NO_WRITE",
          reason,
          before_sha: beforeSha,
          desired_sha: beforeSha,
        });
        counts.protected_no_write += 1;
      }

      const mappingTargetIds = new Set(mappings.rows.map((row) => row.new_flow_id));
      for (const id of mappingTargetIds) {
        if (!targetFlowIds.has(id)) {
          findings.push({
            severity: "P0",
            code: "FLOW_MAPPING_OUTSIDE_CANDIDATE_SCOPE",
            flow_id: id,
          });
        }
      }

      counts.conversion_events = writers.events.rows;
      const expected = request.expected;
      const exactChecks = {
        candidate_flows: counts.candidate_flows === expected.candidate_flows,
        processes: counts.processes === expected.processes,
        exchanges: counts.exchanges === expected.exchanges,
        flow_reference_changes: counts.flow_reference_changes === expected.flow_reference_changes,
        exchange_add: counts.exchange_add === expected.exchange_add,
        exchange_delete: counts.exchange_delete === expected.exchange_delete,
        direction_changes: counts.direction_changes === expected.direction_changes,
        amount_changes: counts.amount_changes === expected.amount_changes,
        german_synonyms: counts.german_synonyms === expected.german_synonyms,
        chinese_descriptions: counts.chinese_descriptions === expected.chinese_descriptions,
        protected_no_write: counts.protected_no_write === expected.protected_no_write,
        process_update: counts.process_update === expected.process_update,
        process_insert: counts.process_insert === expected.process_insert,
        process_no_write: counts.process_no_write === expected.process_no_write,
        process_partition:
          counts.process_update +
            counts.process_insert +
            counts.process_no_write +
            counts.process_hold ===
          counts.processes,
        flow_partition:
          counts.flow_create +
            counts.flow_owner_no_write +
            counts.flow_public_reuse +
            counts.flow_hold ===
          counts.candidate_flows,
        delete_ceiling:
          counts.obsolete_flow_delete_candidates <= expected.obsolete_flow_delete_ceiling,
        target_reference_closure:
          new Set(processFlowEdges.map((edge) => edge.flow)).size === expected.candidate_flows,
        machine_translation_zero: counts.machine_translation === 0,
        public_foreign_mutations_zero: counts.public_foreign_mutations === 0,
      };
      for (const [name, passed] of Object.entries(exactChecks)) {
        if (!passed)
          findings.push({ severity: "P1", code: `ALGEBRA_${name.toUpperCase()}_FAILED` });
      }
      const algebra = { ...exactChecks, passed: Object.values(exactChecks).every(Boolean) };
      const p0 = findings.filter((finding) => finding.severity === "P0").length;
      const p1 = findings.filter((finding) => finding.severity === "P1").length;
      const status = p0 === 0 && p1 === 0 ? "ready_for_admission" : "rejected";

      for (const writer of Object.values(writers)) writer.close();
      writeJson(paths.dependencies, {
        schema_version: "foundry-topology-dependency-closure.v1",
        phase_order: ["F", "P", "D"],
        candidate_flow_identities: [...targetFlowKeys].sort(compareText),
        flow_create_action_ids: flowActions.map((action) => action.action_id),
        process_reference_edges: processFlowEdges,
        delete_barrier: "all-visible-process inbound_ref_count must equal zero after P",
      });
      if (status === "ready_for_admission" && flowActions.length) {
        writeJson(paths.flowContract, executionContract(request, "F", flowActions));
      }
      if (status === "ready_for_admission" && processActions.length) {
        writeJson(paths.processContract, executionContract(request, "P", processActions));
      }

      const report = {
        schema_version: REPORT_SCHEMA,
        status,
        production_authority: false,
        campaign_id: request.campaign_id,
        counts,
        findings,
        algebra,
        execution_order: ["F", "P", "D"],
        delete_gate: "Fresh all-visible-process zero-inbound proof is required after P.",
        next_gate:
          "Independent review and execution-capsule admission of this exact package are required before the separately authorized fixed CLI may dispatch owner-session DML.",
        remote_write_mode: "read-only",
        dispatch_counts: { network: 0, database: 0, cli: 0, dml: 0 },
      };
      writeJson(paths.report, report);

      const artifacts = [
        artifactFacts(paths.request, 1, REQUEST_SCHEMA),
        writers.events.facts(EVENT_SCHEMA),
        writers.flowCreate.facts("tidas-flow-payload-jsonl.v1"),
        writers.flowNoWrite.facts("foundry-topology-flow-no-write.v1"),
        writers.processInput.facts("tidas-process-payload-jsonl.v1"),
        writers.processNoWrite.facts("foundry-topology-process-no-write.v1"),
        writers.deleteCandidates.facts("foundry-topology-flow-delete-candidate.v1"),
        writers.protectedNoWrite.facts("foundry-topology-protected-no-write.v1"),
        writers.holds.facts("foundry-topology-hold.v1"),
        writers.ambiguity.facts("foundry-topology-ambiguity-recovery.v1"),
        artifactFacts(
          paths.dependencies,
          processFlowEdges.length,
          "foundry-topology-dependency-closure.v1",
        ),
        ...(fs.existsSync(paths.flowContract)
          ? [artifactFacts(paths.flowContract, flowActions.length, SAVE_DRAFT_CONTRACT_SCHEMA)]
          : []),
        ...(fs.existsSync(paths.processContract)
          ? [
              artifactFacts(
                paths.processContract,
                processActions.length,
                SAVE_DRAFT_CONTRACT_SCHEMA,
              ),
            ]
          : []),
        artifactFacts(paths.report, 1, REPORT_SCHEMA),
      ];
      writeJson(paths.auditInput, {
        schema_version: "foundry-topology-independent-audit-input.v1",
        campaign_id: request.campaign_id,
        expected: request.expected,
        counts,
        p0,
        p1,
        findings,
        algebra,
        artifact_facts: artifacts,
        event_terminal_sha256: writers.events.previous,
      });
      artifacts.push(
        artifactFacts(paths.auditInput, 1, "foundry-topology-independent-audit-input.v1"),
      );
      const audit = independentAudit(artifacts, paths.events, algebra, p0, p1);
      writeJson(paths.audit, audit);
      artifacts.push(artifactFacts(paths.audit, 1, "foundry-topology-independent-audit.v1"));
      const manifest = {
        schema_version: MANIFEST_SCHEMA,
        status,
        production_authority: false,
        campaign_id: request.campaign_id,
        candidate_package: request.candidate_package,
        cli_fingerprint: request.cli_fingerprint,
        input_artifacts: Object.fromEntries(
          Object.entries(request.input_artifacts).map(([name, ref]) => [name, ref]),
        ),
        output_artifacts: artifacts,
        output_binding_sha256: sha256Json(artifacts),
        counts,
        p0,
        p1,
        independent_audit: audit.status,
      };
      writeJson(paths.manifest, manifest);
      const manifestFacts = artifactFacts(paths.manifest, 1, MANIFEST_SCHEMA);
      return {
        status,
        production_authority: false,
        out_dir: path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep),
        counts,
        p0,
        p1,
        independent_audit: audit.status,
        manifest: manifestFacts,
        remote_write_mode: "read-only",
        dispatch_counts: { network: 0, database: 0, cli: 0, dml: 0 },
      };
    } finally {
      for (const writer of Object.values(writers)) writer.close();
      closeSnapshotIndex(ownerFlows);
      closeSnapshotIndex(publicFlows);
      closeSnapshotIndex(foreignFlows);
      closeSnapshotIndex(ownerProcesses);
    }
  }

  return { runDatasetTopologyConvergenceCompose };
}
