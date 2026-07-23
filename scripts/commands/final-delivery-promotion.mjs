import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { readOnlyStageContract } from "../lib/stage-contract.mjs";

const MANIFEST_SCHEMA = "foundry-final-delivery-manifest.v1";
const REPORT_SCHEMA = "foundry-final-delivery-promotion-report.v1";
const LEDGER_SCHEMA = "foundry-final-delivery-promotion-ledger-row.v1";
const SEAL_SCHEMA = "foundry-final-delivery-promotion-seal.v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 64 * 1024 * 1024;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

const stagePipeline = readOnlyStageContract([
  {
    stage: "prepare",
    purpose: "Snapshot one immutable final-delivery manifest into a fresh promotion directory.",
    inputs: ["foundry-final-delivery-manifest.v1"],
    outputs: ["final-delivery-manifest-snapshot.json"],
    blockers: ["unsafe path", "existing output directory", "unparseable manifest"],
    side_effects: ["local immutable evidence files only"],
  },
  {
    stage: "gate_validate",
    purpose:
      "Validate content bindings, row counts, algebra, workbook contract, redaction, and independent review.",
    inputs: ["manifest-bound local artifacts"],
    outputs: ["final-delivery-promotion-ledger.jsonl"],
    blockers: ["any P0 or P1 finding"],
    side_effects: ["none outside the fresh output directory"],
  },
  {
    stage: "report",
    purpose:
      "Write the reader-facing report and emit a detached seal only after every check passes.",
    inputs: ["snapshot", "ledger"],
    outputs: ["final-delivery-promotion-report.json", "final-delivery-promotion-seal.json"],
    blockers: ["rejected validation"],
    side_effects: ["local immutable evidence files only"],
  },
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableValue(value) {
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

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeRelativePath(value) {
  return Boolean(
    typeof value === "string" &&
    value.length > 0 &&
    !path.posix.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.split("/").includes("..") &&
    path.posix.normalize(value) === value,
  );
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeExclusive(filePath, content) {
  fs.writeFileSync(filePath, content, { flag: "wx" });
}

function writeJsonExclusive(filePath, value) {
  writeExclusive(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function relativeToRepo(repoRoot, filePath) {
  return pathIsInside(repoRoot, filePath) ? path.relative(repoRoot, filePath) : filePath;
}

function checkCollector() {
  const rows = [];
  function add(checkId, passed, severity, detail, evidence = null) {
    rows.push({
      schema_version: LEDGER_SCHEMA,
      check_id: checkId,
      status: passed ? "PASS" : "FAIL",
      severity: passed ? null : severity,
      detail,
      evidence,
    });
    return passed;
  }
  return { add, rows };
}

function parseCsv(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === ",") {
      record.push(field);
      field = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      continue;
    }
    field += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

function normalizedJsonPointerToken(token) {
  return token.replace(/~1/gu, "/").replace(/~0/gu, "~");
}

function jsonPointer(value, pointer) {
  if (pointer === "") return value;
  if (typeof pointer !== "string" || !pointer.startsWith("/")) {
    throw new Error("JSON pointer must be empty or start with '/'.");
  }
  return pointer
    .slice(1)
    .split("/")
    .map(normalizedJsonPointerToken)
    .reduce((current, token) => {
      if (current === null || current === undefined || !Object.hasOwn(Object(current), token)) {
        throw new Error(`JSON pointer segment is missing: ${token}`);
      }
      return current[token];
    }, value);
}

function zipEntries(buffer) {
  const minimumEocd = 22;
  if (buffer.byteLength < minimumEocd) throw new Error("XLSX is shorter than a ZIP EOCD.");
  let eocdOffset = -1;
  const lowerBound = Math.max(0, buffer.byteLength - 65_557);
  for (let offset = buffer.byteLength - minimumEocd; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("XLSX ZIP EOCD was not found.");
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error("XLSX ZIP has too many entries.");
  if (centralOffset + centralSize > buffer.byteLength) {
    throw new Error("XLSX ZIP central directory exceeds the file boundary.");
  }

  const entries = new Map();
  let cursor = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.byteLength || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("XLSX ZIP central directory entry is invalid.");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedBytes = buffer.readUInt32LE(cursor + 20);
    const uncompressedBytes = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.byteLength) throw new Error("XLSX ZIP entry name exceeds the file.");
    const name = buffer.subarray(nameStart, nameEnd).toString("utf8");
    if (!safeRelativePath(name) || name.endsWith("/") || entries.has(name)) {
      throw new Error(`XLSX ZIP entry path is unsafe or duplicated: ${name}`);
    }
    if ((flags & 0x1) !== 0) throw new Error(`Encrypted XLSX entry is not supported: ${name}`);
    if (![0, 8].includes(method)) throw new Error(`Unsupported XLSX compression method: ${method}`);
    if (uncompressedBytes > MAX_ZIP_ENTRY_BYTES) {
      throw new Error(`XLSX entry exceeds the decompression limit: ${name}`);
    }
    totalBytes += uncompressedBytes;
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) throw new Error("XLSX exceeds the total size limit.");
    if (localOffset + 30 > buffer.byteLength || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`XLSX local header is invalid: ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    if (
      localNameEnd > buffer.byteLength ||
      buffer.subarray(localNameStart, localNameEnd).toString("utf8") !== name ||
      localFlags !== flags ||
      localMethod !== method
    ) {
      throw new Error(`XLSX local header differs from the central directory: ${name}`);
    }
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedBytes;
    if (dataEnd > buffer.byteLength) throw new Error(`XLSX entry data exceeds the file: ${name}`);
    const compressed = buffer.subarray(dataStart, dataEnd);
    const content =
      method === 0
        ? Buffer.from(compressed)
        : zlib.inflateRawSync(compressed, {
            maxOutputLength: Math.min(MAX_ZIP_ENTRY_BYTES, uncompressedBytes + 1),
          });
    if (content.byteLength !== uncompressedBytes) {
      throw new Error(`XLSX entry byte count differs from the central directory: ${name}`);
    }
    if (crc32(content) !== checksum) throw new Error(`XLSX entry CRC-32 is invalid: ${name}`);
    entries.set(name, content);
    cursor = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&");
}

function xmlAttribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = attributes.match(new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`, "u"));
  return match ? decodeXml(match[1]) : null;
}

function relationshipTarget(basePath, target) {
  const cleaned = String(target).replace(/^\/+/, "");
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(basePath), cleaned));
  if (!safeRelativePath(resolved) || !resolved.startsWith("xl/")) {
    throw new Error(`Workbook relationship escapes the xl package root: ${target}`);
  }
  return resolved;
}

function cellParts(reference) {
  const match = String(reference).match(/^([A-Z]+)([1-9]\d*)$/u);
  return match ? { column: match[1], row: Number(match[2]) } : null;
}

function columnNumber(column) {
  let value = 0;
  for (const character of column) value = value * 26 + character.charCodeAt(0) - 64;
  return value;
}

function parseSharedStrings(entries) {
  const entry = entries.get("xl/sharedStrings.xml");
  if (!entry) return [];
  const xml = entry.toString("utf8");
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gu)].map((match) =>
    [...match[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gu)]
      .map((textMatch) => decodeXml(textMatch[1]))
      .join(""),
  );
}

function parseWorksheet(buffer, sharedStrings) {
  const xml = buffer.toString("utf8");
  const cells = new Map();
  const populatedRows = new Set();
  for (const match of xml.matchAll(/<(?:\w+:)?c\b([^>]*?)>([\s\S]*?)<\/(?:\w+:)?c>/gu)) {
    const reference = xmlAttribute(match[1], "r");
    const parts = cellParts(reference);
    if (!parts) continue;
    const type = xmlAttribute(match[1], "t");
    let raw = "";
    if (type === "inlineStr") {
      raw = [...match[2].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gu)]
        .map((textMatch) => decodeXml(textMatch[1]))
        .join("");
    } else {
      const valueMatch = match[2].match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/u);
      raw = valueMatch ? decodeXml(valueMatch[1]) : "";
      if (type === "s" && /^\d+$/u.test(raw)) raw = sharedStrings[Number(raw)] ?? "";
    }
    cells.set(reference, raw);
    if (raw !== "") populatedRows.add(parts.row);
  }
  return { cells, populatedRows, xml };
}

function parseWorkbook(buffer) {
  const entries = zipEntries(buffer);
  const contentTypesEntry = entries.get("[Content_Types].xml");
  const rootRelationsEntry = entries.get("_rels/.rels");
  const workbookEntry = entries.get("xl/workbook.xml");
  const relationsEntry = entries.get("xl/_rels/workbook.xml.rels");
  if (!contentTypesEntry || !rootRelationsEntry || !workbookEntry || !relationsEntry) {
    throw new Error("XLSX is missing a required OOXML package, workbook, or relationship part.");
  }
  const contentTypesXml = contentTypesEntry.toString("utf8");
  const rootRelationsXml = rootRelationsEntry.toString("utf8");
  const workbookXml = workbookEntry.toString("utf8");
  const relationXml = relationsEntry.toString("utf8");
  const contentTypes = new Map();
  for (const match of contentTypesXml.matchAll(/<(?:\w+:)?Override\b([^>]*?)\/?\s*>/gu)) {
    const partName = xmlAttribute(match[1], "PartName")?.replace(/^\/+/, "");
    const contentType = xmlAttribute(match[1], "ContentType");
    if (!partName || !contentType || contentTypes.has(partName)) {
      throw new Error("XLSX content type overrides contain an invalid or duplicate part.");
    }
    contentTypes.set(partName, contentType);
  }
  if (
    !contentTypes
      .get("xl/workbook.xml")
      ?.endsWith("openxmlformats-officedocument.spreadsheetml.sheet.main+xml")
  ) {
    throw new Error("XLSX workbook content type is missing or is not a standard non-macro sheet.");
  }
  const rootWorkbookRelationships = [
    ...rootRelationsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?\s*>/gu),
  ].filter((match) => {
    const type = xmlAttribute(match[1], "Type");
    const target = xmlAttribute(match[1], "Target")?.replace(/^\/+/, "");
    return Boolean(
      type?.endsWith("/officeDocument") &&
      target &&
      path.posix.normalize(target) === "xl/workbook.xml",
    );
  });
  if (rootWorkbookRelationships.length !== 1) {
    throw new Error("XLSX root relationships must bind exactly one office document workbook.");
  }
  const targets = new Map();
  for (const match of relationXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?\s*>/gu)) {
    const id = xmlAttribute(match[1], "Id");
    const target = xmlAttribute(match[1], "Target");
    if (id && target) {
      if (targets.has(id)) throw new Error(`XLSX workbook relationship ID is duplicated: ${id}`);
      targets.set(id, relationshipTarget("xl/workbook.xml", target));
    }
  }
  const sharedStrings = parseSharedStrings(entries);
  const names = [];
  const sheets = new Map();
  for (const match of workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?\s*>/gu)) {
    const name = xmlAttribute(match[1], "name");
    const relationId = xmlAttribute(match[1], "r:id");
    const target = targets.get(relationId);
    if (
      !name ||
      !target ||
      !entries.has(target) ||
      !contentTypes
        .get(target)
        ?.endsWith("openxmlformats-officedocument.spreadsheetml.worksheet+xml") ||
      sheets.has(name)
    ) {
      throw new Error("XLSX workbook contains an invalid or duplicate sheet relationship.");
    }
    names.push(name);
    sheets.set(name, parseWorksheet(entries.get(target), sharedStrings));
  }
  if (names.length === 0) throw new Error("XLSX workbook contains no worksheets.");
  const scanText = [...entries.entries()]
    .filter(([name]) => name.endsWith(".xml") || name.endsWith(".rels"))
    .map(([, content]) => content.toString("utf8"))
    .concat(
      [...sheets.values()].flatMap((sheet) =>
        [...sheet.cells.values()].map((value) => String(value)),
      ),
    )
    .join("\n");
  return { entries, names, scanText, sheets };
}

function parseArtifactRows(artifact, buffer) {
  const kind = artifact?.row_count?.kind;
  switch (kind) {
    case "json-object": {
      const value = JSON.parse(buffer.toString("utf8"));
      if (!isPlainObject(value)) throw new Error("Expected one JSON object.");
      if (value.schema_version !== artifact.schema)
        throw new Error("JSON schema_version mismatch.");
      return { json: value, rows: 1, scanText: buffer.toString("utf8") };
    }
    case "json-object-rows": {
      const value = JSON.parse(buffer.toString("utf8"));
      if (!isPlainObject(value) || !Array.isArray(value.rows)) {
        throw new Error("Expected a JSON object with a rows array.");
      }
      if (value.schema_version !== artifact.schema)
        throw new Error("JSON schema_version mismatch.");
      return { json: value, rows: value.rows.length, scanText: buffer.toString("utf8") };
    }
    case "json-array": {
      const value = JSON.parse(buffer.toString("utf8"));
      if (!Array.isArray(value)) throw new Error("Expected a JSON array.");
      return { json: value, rows: value.length, scanText: buffer.toString("utf8") };
    }
    case "jsonl": {
      const values = buffer
        .toString("utf8")
        .split(/\r?\n/gu)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
      if (values.some((value) => value?.schema_version !== artifact.schema)) {
        throw new Error("A JSONL row has a mismatched schema_version.");
      }
      return { json: values, rows: values.length, scanText: buffer.toString("utf8") };
    }
    case "csv": {
      const records = parseCsv(buffer.toString("utf8"));
      if (records.length === 0) throw new Error("CSV contains no header row.");
      const headers = records[0];
      const required = artifact.row_count.required_columns ?? [];
      if (!Array.isArray(required) || required.some((column) => !headers.includes(column))) {
        throw new Error("CSV required columns are missing.");
      }
      return {
        csv: records,
        rows: Math.max(0, records.length - 1),
        scanText: buffer.toString("utf8"),
      };
    }
    case "xlsx": {
      const workbook = parseWorkbook(buffer);
      return { workbook, rows: null, scanText: workbook.scanText };
    }
    case "none":
      return { rows: 0, scanText: null };
    default:
      throw new Error(`Unsupported row_count.kind: ${kind ?? "<missing>"}`);
  }
}

function secretFindingCodes(text, forbiddenLiterals) {
  const findings = [];
  const patterns = [
    ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
    ["DATABASE_URL", /\bpostgres(?:ql)?:\/\/[^\s"']+/iu],
    ["BEARER_TOKEN", /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/u],
    ["JWT", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u],
    ["AWS_ACCESS_KEY", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
    [
      "SECRET_ASSIGNMENT",
      /\b(?:api[_-]?key|access[_-]?token|password|secret)\b\s*[:=]\s*["'][^"'\s]{8,}["']/iu,
    ],
    ["USER_ABSOLUTE_PATH", /(?:\/Users\/[^/\s]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\)/u],
  ];
  for (const [code, expression] of patterns) if (expression.test(text)) findings.push(code);
  for (let index = 0; index < forbiddenLiterals.length; index += 1) {
    if (text.includes(forbiddenLiterals[index])) findings.push(`FORBIDDEN_LITERAL_${index + 1}`);
  }
  return findings;
}

function evaluateOperand(operand, artifactsById) {
  if (!isPlainObject(operand)) throw new Error("Algebra operand must be an object.");
  if (Object.hasOwn(operand, "literal")) {
    if (!Number.isFinite(operand.literal)) throw new Error("Algebra literal must be finite.");
    return operand.literal;
  }
  if (typeof operand.artifact_rows === "string") {
    const artifact = artifactsById.get(operand.artifact_rows);
    if (!artifact || !Number.isFinite(artifact.actualRows)) {
      throw new Error(`Artifact rows are unavailable: ${operand.artifact_rows}`);
    }
    return artifact.actualRows;
  }
  if (isPlainObject(operand.artifact_json)) {
    const artifact = artifactsById.get(operand.artifact_json.artifact_id);
    if (!artifact || artifact.parsed?.json === undefined) {
      throw new Error(`Artifact JSON is unavailable: ${operand.artifact_json.artifact_id}`);
    }
    const value = jsonPointer(artifact.parsed.json, operand.artifact_json.pointer ?? "");
    if (!Number.isFinite(Number(value))) throw new Error("Artifact JSON pointer is not numeric.");
    return Number(value);
  }
  if (Array.isArray(operand.sum) && operand.sum.length > 0) {
    return operand.sum.reduce((total, child) => total + evaluateOperand(child, artifactsById), 0);
  }
  throw new Error("Unsupported algebra operand.");
}

function validateManifest({ manifest, manifestPath, manifestRaw, repoRoot }) {
  const { add, rows } = checkCollector();
  add(
    "manifest_schema",
    manifest?.schema_version === MANIFEST_SCHEMA,
    "P1",
    `Manifest schema must be ${MANIFEST_SCHEMA}.`,
  );
  add(
    "delivery_id",
    typeof manifest?.delivery_id === "string" && manifest.delivery_id.length > 0,
    "P1",
    "delivery_id is required.",
  );
  add(
    "producer_id",
    typeof manifest?.producer_id === "string" && manifest.producer_id.length > 0,
    "P1",
    "producer_id is required.",
  );
  add(
    "offline_only",
    manifest?.promotion_mode === "OFFLINE_ONLY" && manifest?.production_authority === false,
    "P0",
    "Promotion must be offline-only and must not grant production authority.",
  );
  add(
    "declared_findings_zero",
    manifest?.findings?.p0 === 0 && manifest?.findings?.p1 === 0,
    "P1",
    "Manifest-declared P0 and P1 findings must both be zero.",
  );

  const manifestDir = path.dirname(manifestPath);
  const deliveryRoot = path.resolve(manifestDir, manifest?.delivery_root || ".");
  const rootExists = fs.existsSync(deliveryRoot) && fs.statSync(deliveryRoot).isDirectory();
  const rootReal = rootExists ? fs.realpathSync(deliveryRoot) : deliveryRoot;
  const rootSafe = Boolean(
    safeRelativePath(manifest?.delivery_root) &&
    rootExists &&
    !fs.lstatSync(deliveryRoot).isSymbolicLink() &&
    pathIsInside(fs.realpathSync(repoRoot), rootReal),
  );
  add(
    "delivery_root",
    rootSafe,
    "P0",
    "delivery_root must be a safe, existing, non-symlink directory inside the repository.",
  );

  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  add("artifacts_present", artifacts.length > 0, "P1", "At least one artifact is required.");
  const artifactsById = new Map();
  const paths = new Set();
  for (const descriptor of artifacts) {
    const artifactId = descriptor?.artifact_id;
    const identityOk = Boolean(artifactId) && !artifactsById.has(artifactId);
    add(
      `artifact_identity:${artifactId ?? "missing"}`,
      identityOk,
      "P1",
      "Artifact IDs must be unique.",
    );
    const pathOk = safeRelativePath(descriptor?.path) && !paths.has(descriptor.path);
    add(`artifact_path:${artifactId}`, pathOk, "P0", "Artifact paths must be safe and unique.");
    if (descriptor?.path) paths.add(descriptor.path);
    const descriptorOk = Boolean(
      isSha256(descriptor?.sha256) &&
      Number.isInteger(descriptor?.bytes) &&
      descriptor.bytes >= 0 &&
      Number.isInteger(descriptor?.rows) &&
      descriptor.rows >= 0 &&
      typeof descriptor?.schema === "string" &&
      descriptor.schema.length > 0 &&
      isPlainObject(descriptor?.row_count),
    );
    add(
      `artifact_descriptor:${artifactId}`,
      descriptorOk,
      "P1",
      "Artifact descriptor requires SHA-256, bytes, rows, schema, and row_count.",
    );

    const candidate = pathOk ? path.resolve(deliveryRoot, descriptor.path) : null;
    let buffer = null;
    let fileSafe = false;
    if (
      candidate &&
      rootSafe &&
      pathIsInside(deliveryRoot, candidate) &&
      fs.existsSync(candidate)
    ) {
      const stat = fs.lstatSync(candidate);
      fileSafe = stat.isFile() && !stat.isSymbolicLink();
      if (fileSafe) fileSafe = pathIsInside(rootReal, fs.realpathSync(candidate));
      if (fileSafe) buffer = fs.readFileSync(candidate);
    }
    add(
      `artifact_file_safe:${artifactId}`,
      fileSafe,
      "P0",
      "Artifact must be a regular non-symlink file under delivery_root.",
    );
    if (buffer) {
      add(
        `artifact_hash:${artifactId}`,
        sha256(buffer) === descriptor.sha256,
        "P0",
        "Artifact SHA-256 must match exact bytes.",
      );
      add(
        `artifact_bytes:${artifactId}`,
        buffer.byteLength === descriptor.bytes,
        "P0",
        "Artifact byte count must match exact bytes.",
      );
    }
    let parsed = null;
    if (buffer) {
      try {
        parsed = parseArtifactRows(descriptor, buffer);
        add(`artifact_parse:${artifactId}`, true, "P1", "Artifact parsed using its row contract.");
      } catch (error) {
        add(`artifact_parse:${artifactId}`, false, "P1", error.message);
      }
    }
    const runtime = {
      descriptor,
      buffer,
      parsed,
      actualRows: parsed?.rows ?? null,
      path: candidate,
    };
    if (artifactId && !artifactsById.has(artifactId)) artifactsById.set(artifactId, runtime);
    if (parsed && descriptor?.row_count?.kind !== "xlsx") {
      add(
        `artifact_rows:${artifactId}`,
        parsed.rows === descriptor.rows,
        "P1",
        "Artifact row count must match the manifest.",
        { declared: descriptor.rows, actual: parsed.rows },
      );
    }
  }

  const workbookPolicies = Array.isArray(manifest?.workbooks) ? manifest.workbooks : [];
  const xlsxArtifacts = artifacts.filter((artifact) => artifact?.row_count?.kind === "xlsx");
  add(
    "workbook_policy_coverage",
    workbookPolicies.length === xlsxArtifacts.length && workbookPolicies.length > 0,
    "P1",
    "Every XLSX artifact requires exactly one workbook policy.",
  );
  const workbookArtifactIds = new Set();
  for (const policy of workbookPolicies) {
    const artifactId = policy?.artifact_id;
    const runtime = artifactsById.get(artifactId);
    const unique = Boolean(artifactId) && !workbookArtifactIds.has(artifactId);
    if (artifactId) workbookArtifactIds.add(artifactId);
    add(`workbook_identity:${artifactId}`, unique, "P1", "Workbook policy IDs must be unique.");
    const workbook = runtime?.parsed?.workbook;
    add(
      `workbook_artifact_kind:${artifactId}`,
      runtime?.descriptor?.row_count?.kind === "xlsx",
      "P1",
      "Workbook policy must reference an XLSX artifact.",
    );
    const expectedNames = Array.isArray(policy?.exact_sheet_names) ? policy.exact_sheet_names : [];
    add(
      `workbook_sheet_names:${artifactId}`,
      Boolean(workbook && stableJson(workbook.names) === stableJson(expectedNames)),
      "P1",
      "Workbook sheet names and order must match exactly.",
      { expected: expectedNames, actual: workbook?.names ?? null },
    );
    const sheetPolicies = Array.isArray(policy?.sheets) ? policy.sheets : [];
    add(
      `workbook_sheet_policy_coverage:${artifactId}`,
      expectedNames.length > 0 &&
        sheetPolicies.length === expectedNames.length &&
        stableJson(sheetPolicies.map((sheet) => sheet.name)) === stableJson(expectedNames),
      "P1",
      "Every exact workbook sheet requires one ordered policy.",
    );
    let workbookRows = 0;
    for (const sheetPolicy of sheetPolicies) {
      const sheet = workbook?.sheets.get(sheetPolicy.name);
      const headerRow = sheetPolicy?.header_row;
      const headers = sheet
        ? [...sheet.cells.entries()]
            .map(([reference, value]) => ({ ...cellParts(reference), value }))
            .filter((cell) => cell.row === headerRow)
            .sort((left, right) => columnNumber(left.column) - columnNumber(right.column))
            .map((cell) => cell.value)
        : [];
      const requiredColumns = Array.isArray(sheetPolicy?.required_columns)
        ? sheetPolicy.required_columns
        : [];
      add(
        `workbook_required_columns:${artifactId}:${sheetPolicy.name}`,
        Boolean(
          sheet &&
          Number.isInteger(headerRow) &&
          headerRow >= 1 &&
          requiredColumns.length > 0 &&
          requiredColumns.every((column) => headers.includes(column)),
        ),
        "P1",
        "Workbook sheet must contain every required column on the declared header row.",
        { required: requiredColumns, actual: headers },
      );
      const requiredCells = Array.isArray(sheetPolicy?.required_cells)
        ? sheetPolicy.required_cells
        : [];
      for (const cell of requiredCells) {
        const actual = sheet?.cells.get(cell.cell);
        add(
          `workbook_required_cell:${artifactId}:${sheetPolicy.name}:${cell.cell}`,
          actual !== undefined && String(actual) === String(cell.equals),
          "P1",
          "Workbook control cell must match its exact declared value.",
          { cell: cell.cell, expected: String(cell.equals), actual: actual ?? null },
        );
      }
      if (sheet && Number.isInteger(headerRow)) {
        workbookRows += [...sheet.populatedRows].filter((row) => row > headerRow).length;
      }
    }
    if (runtime) runtime.actualRows = workbookRows;
    add(
      `artifact_rows:${artifactId}`,
      Boolean(runtime && workbook && workbookRows === runtime.descriptor.rows),
      "P1",
      "Workbook data-row count must match the manifest.",
      { declared: runtime?.descriptor?.rows ?? null, actual: workbook ? workbookRows : null },
    );
  }

  const algebra = Array.isArray(manifest?.algebra) ? manifest.algebra : [];
  add("algebra_present", algebra.length > 0, "P1", "At least one algebra assertion is required.");
  const algebraIds = new Set();
  for (const assertion of algebra) {
    const checkId = assertion?.check_id;
    const unique = Boolean(checkId) && !algebraIds.has(checkId);
    if (checkId) algebraIds.add(checkId);
    add(`algebra_identity:${checkId}`, unique, "P1", "Algebra check IDs must be unique.");
    try {
      const left = evaluateOperand(assertion.left, artifactsById);
      const right = evaluateOperand(assertion.right, artifactsById);
      const operator = assertion.operator;
      const passed =
        (operator === "eq" && left === right) ||
        (operator === "lte" && left <= right) ||
        (operator === "gte" && left >= right);
      add(`algebra:${checkId}`, passed, "P1", "Algebra assertion must evaluate true.", {
        operator,
        left,
        right,
      });
    } catch (error) {
      add(`algebra:${checkId}`, false, "P1", error.message);
    }
  }

  const redaction = manifest?.redaction;
  const scanIds = Array.isArray(redaction?.artifact_ids) ? redaction.artifact_ids : [];
  const forbiddenLiterals = Array.isArray(redaction?.forbidden_literals)
    ? redaction.forbidden_literals
    : [];
  add(
    "redaction_contract",
    scanIds.length > 0 &&
      new Set(scanIds).size === scanIds.length &&
      forbiddenLiterals.length <= 50 &&
      forbiddenLiterals.every((value) => typeof value === "string" && value.length > 0),
    "P1",
    "Redaction contract requires unique artifact IDs and bounded non-empty forbidden literals.",
  );
  const redactableArtifactIds = artifacts
    .filter((artifact) => artifact?.row_count?.kind !== "none")
    .map((artifact) => artifact?.artifact_id)
    .filter(Boolean)
    .sort(compareText);
  add(
    "redaction_coverage",
    stableJson([...scanIds].sort(compareText)) === stableJson(redactableArtifactIds),
    "P1",
    "Redaction scanning must cover every textual or workbook artifact exactly once.",
    { required: redactableArtifactIds, actual: [...scanIds].sort(compareText) },
  );
  const manifestSecretCodes = secretFindingCodes(manifestRaw.toString("utf8"), []);
  add(
    "redaction:manifest",
    manifestSecretCodes.length === 0,
    "P0",
    "Manifest must not contain credential-shaped or user-absolute-path content.",
    { finding_codes: manifestSecretCodes },
  );
  for (const artifactId of scanIds) {
    const runtime = artifactsById.get(artifactId);
    const scanText = runtime?.parsed?.scanText;
    const codes =
      typeof scanText === "string" ? secretFindingCodes(scanText, forbiddenLiterals) : [];
    add(
      `redaction:${artifactId}`,
      Boolean(runtime && typeof scanText === "string" && codes.length === 0),
      "P0",
      "Scanned artifact must be textual and free of secret-like, forbidden, or user-absolute-path content.",
      { finding_codes: codes },
    );
  }

  const reviewers = Array.isArray(manifest?.reviewers) ? manifest.reviewers : [];
  add("reviewers_present", reviewers.length > 0, "P1", "At least one reviewer is required.");
  const reviewerIds = new Set();
  const reviewerArtifacts = new Set();
  for (const reviewer of reviewers) {
    const reviewerId = reviewer?.reviewer_id;
    const artifactId = reviewer?.artifact_id;
    const identityOk = Boolean(
      reviewerId &&
      reviewerId !== manifest?.producer_id &&
      !reviewerIds.has(reviewerId) &&
      artifactId &&
      !reviewerArtifacts.has(artifactId),
    );
    if (reviewerId) reviewerIds.add(reviewerId);
    if (artifactId) reviewerArtifacts.add(artifactId);
    add(
      `reviewer_identity:${reviewerId}`,
      identityOk,
      "P1",
      "Reviewer identities must be independent and unique.",
    );
    const report = artifactsById.get(artifactId)?.parsed?.json;
    const required = Array.isArray(reviewer?.required_artifact_ids)
      ? reviewer.required_artifact_ids
      : [];
    add(
      `reviewer_pass:${reviewerId}`,
      Boolean(
        isPlainObject(report) &&
        report.reviewer_id === reviewerId &&
        report.status === "PASS" &&
        report.findings?.p0 === 0 &&
        report.findings?.p1 === 0,
      ),
      "P1",
      "Reviewer report must be content-bound PASS with P0=0 and P1=0.",
    );
    add(
      `reviewer_coverage:${reviewerId}`,
      Boolean(
        required.length > 0 &&
        new Set(required).size === required.length &&
        required.every((id) => artifactsById.has(id)) &&
        Array.isArray(report?.reviewed_artifact_ids) &&
        required.every((id) => report.reviewed_artifact_ids.includes(id)),
      ),
      "P1",
      "Reviewer report must cover every manifest-required artifact ID.",
    );
  }

  return {
    rows,
    manifestSha256: sha256(manifestRaw),
    deliveryRoot,
    artifacts: [...artifactsById.entries()].map(([artifactId, runtime]) => ({
      artifact_id: artifactId,
      path: runtime.descriptor.path,
      sha256: runtime.buffer ? sha256(runtime.buffer) : null,
      bytes: runtime.buffer?.byteLength ?? null,
      rows: runtime.actualRows,
      schema: runtime.descriptor.schema,
    })),
  };
}

export function createFinalDeliveryPromotionCommands({ repoRoot }) {
  function runFinalDeliveryPromote(options) {
    if (options.help) {
      return {
        status: "help",
        command: "final-delivery-promote",
        usage:
          "node scripts/foundry.mjs final-delivery-promote --manifest <final-delivery-manifest.json> --out-dir <fresh-dir>",
        effects:
          "local immutable evidence files only; zero network, database, CLI dispatch, and mutation",
        ...stagePipeline,
      };
    }

    if (!options.manifest || !options.outDir) {
      throw new Error("--manifest and --out-dir are required.");
    }
    const manifestPath = path.resolve(repoRoot, options.manifest);
    const outDir = path.resolve(repoRoot, options.outDir);
    if (!pathIsInside(repoRoot, manifestPath) || !pathIsInside(repoRoot, outDir)) {
      throw new Error("--manifest and --out-dir must stay inside the repository root.");
    }
    if (!fs.existsSync(manifestPath))
      throw new Error(`Manifest does not exist: ${options.manifest}`);
    const manifestStat = fs.lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      throw new Error("--manifest must be a regular non-symlink file.");
    }
    const repoReal = fs.realpathSync(repoRoot);
    if (!pathIsInside(repoReal, fs.realpathSync(manifestPath))) {
      throw new Error("--manifest resolves outside the repository root.");
    }
    if (fs.existsSync(outDir)) {
      throw new Error(
        `Promotion output directory already exists and is immutable: ${options.outDir}`,
      );
    }
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
    const snapshotPath = path.join(outDir, "final-delivery-manifest-snapshot.json");
    writeExclusive(snapshotPath, manifestRaw);

    let manifest = null;
    let validation;
    try {
      manifest = JSON.parse(manifestRaw.toString("utf8"));
      validation = validateManifest({ manifest, manifestPath, manifestRaw, repoRoot });
    } catch (error) {
      validation = {
        rows: [
          {
            schema_version: LEDGER_SCHEMA,
            check_id: "promotion_validator_error",
            status: "FAIL",
            severity: "P0",
            detail: `Promotion validator failed closed: ${error.message}`,
            evidence: null,
          },
        ],
        manifestSha256: sha256(manifestRaw),
        deliveryRoot: null,
        artifacts: [],
      };
    }

    const failed = validation.rows.filter((row) => row.status === "FAIL");
    const p0 = failed.filter((row) => row.severity === "P0").length;
    const p1 = failed.filter((row) => row.severity === "P1").length;
    const ledgerText = `${validation.rows.map((row) => stableJson(row)).join("\n")}\n`;
    const ledgerPath = path.join(outDir, "final-delivery-promotion-ledger.jsonl");
    writeExclusive(ledgerPath, ledgerText);

    const report = {
      schema_version: REPORT_SCHEMA,
      status: failed.length === 0 ? "promoted" : "rejected",
      promotion_mode: "OFFLINE_ONLY",
      production_authority: false,
      delivery: {
        delivery_id: manifest?.delivery_id ?? null,
        producer_id: manifest?.producer_id ?? null,
        source_manifest: relativeToRepo(repoRoot, manifestPath),
        manifest_snapshot: relativeToRepo(repoRoot, snapshotPath),
        manifest_sha256: validation.manifestSha256,
        delivery_root: validation.deliveryRoot
          ? relativeToRepo(repoRoot, validation.deliveryRoot)
          : null,
      },
      counts: {
        checks: validation.rows.length,
        passed: validation.rows.length - failed.length,
        failed: failed.length,
        p0,
        p1,
        artifacts: validation.artifacts.length,
        network_dispatches: 0,
        database_dispatches: 0,
        cli_write_dispatches: 0,
        mutations: 0,
      },
      artifacts: validation.artifacts,
      evidence: {
        manifest_snapshot_sha256: sha256(fs.readFileSync(snapshotPath)),
        ledger: relativeToRepo(repoRoot, ledgerPath),
        ledger_sha256: sha256(ledgerText),
      },
      failed_checks: failed.map((row) => row.check_id),
      ...stagePipeline,
    };
    const reportPath = path.join(outDir, "final-delivery-promotion-report.json");
    writeJsonExclusive(reportPath, report);

    let seal = null;
    let sealPath = null;
    if (failed.length === 0) {
      const artifactSet = validation.artifacts
        .map((artifact) => ({
          artifact_id: artifact.artifact_id,
          sha256: artifact.sha256,
          bytes: artifact.bytes,
          rows: artifact.rows,
          schema: artifact.schema,
        }))
        .sort((left, right) => compareText(left.artifact_id, right.artifact_id));
      const sealPayload = {
        schema_version: SEAL_SCHEMA,
        delivery_id: manifest.delivery_id,
        producer_id: manifest.producer_id,
        final_delivery_manifest_sha256: validation.manifestSha256,
        artifact_set_sha256: sha256(stableJson(artifactSet)),
        evidence: {
          manifest_snapshot_sha256: report.evidence.manifest_snapshot_sha256,
          promotion_ledger_sha256: report.evidence.ledger_sha256,
          promotion_report_sha256: sha256(fs.readFileSync(reportPath)),
        },
        findings: { p0: 0, p1: 0 },
        effects: {
          network_dispatches: 0,
          database_dispatches: 0,
          cli_write_dispatches: 0,
          mutations: 0,
        },
        production_authority: false,
      };
      seal = { ...sealPayload, seal_payload_sha256: sha256(stableJson(sealPayload)) };
      sealPath = path.join(outDir, "final-delivery-promotion-seal.json");
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

  return { runFinalDeliveryPromote };
}
