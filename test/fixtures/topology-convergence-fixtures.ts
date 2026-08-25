import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { admissionRequestBinding } from "../../scripts/commands/topology-convergence.ts";
import { repoRoot, testTmpRoot, writeJson, writeJsonLines } from "./foundry-core.ts";

const version = "00.00.001";
const evidence = "e".repeat(64);

type JsonRecord = Record<string, unknown>;

interface LanguageNode {
  "@xml:lang": string;
  "#text": string;
}

interface FlowPayload extends JsonRecord {
  flowDataSet: {
    flowInformation: {
      dataSetInformation: {
        "common:UUID": string;
        name: { baseName: LanguageNode };
        classificationInformation: JsonRecord;
      };
      flowProperties: JsonRecord;
    };
    administrativeInformation: JsonRecord;
  };
}

interface FixtureExchange extends JsonRecord {
  "@dataSetInternalID": string;
  referenceToFlowDataSet: JsonRecord;
  exchangeDirection: string;
  meanAmount: string;
  resultingAmount: string;
  generalComment: LanguageNode;
  "common:other"?: unknown;
}

interface ProcessPayload extends JsonRecord {
  processDataSet: {
    processInformation: {
      dataSetInformation: {
        "common:UUID": string;
        name: { baseName: LanguageNode };
        "common:synonyms"?: LanguageNode;
      };
    };
    exchanges: { exchange: FixtureExchange[] };
    administrativeInformation: JsonRecord;
  };
}

interface SnapshotRow extends JsonRecord {
  table: string;
  id: string;
  version: string;
  user_id: string | null;
  state_code: number;
  json_ordered: unknown;
  payload_sha256: string;
}

interface ArtifactRef extends JsonRecord {
  path: string;
  sha256: string;
  bytes: number;
  rows: number;
}

interface MappingRow extends JsonRecord {
  old_flow_id: string;
  new_flow_id: string;
  mapping_kind: string;
  evidence_sha256: string;
}

interface TopologyFixtureState {
  root: string;
  flowPayloads: Map<string, FlowPayload>;
  candidateProcessPayloads: Map<string, ProcessPayload>;
  currentProcessA: ProcessPayload;
  germanRows: JsonRecord[];
  ownerFlowRows: SnapshotRow[];
  publicFlowRows: SnapshotRow[];
  foreignFlowRows: SnapshotRow[];
  ownerProcessRows: SnapshotRow[];
  classificationRows: JsonRecord[];
  mappingRows: MappingRow[];
  protectedRows: JsonRecord[];
  requestMutator?: (request: unknown, admission: unknown) => void;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const topologyIds = {
  flows: [
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000002",
    "10000000-0000-4000-8000-000000000003",
    "10000000-0000-4000-8000-000000000004",
  ],
  oldFlows: [
    "11000000-0000-4000-8000-000000000001",
    "11000000-0000-4000-8000-000000000002",
    "11000000-0000-4000-8000-000000000003",
    "11000000-0000-4000-8000-000000000004",
    "11000000-0000-4000-8000-000000000005",
  ],
  processes: [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
    "20000000-0000-4000-8000-000000000003",
  ],
  source: "30000000-0000-4000-8000-000000000001",
  flowproperty: "40000000-0000-4000-8000-000000000001",
  owner: "00000000-0000-4000-8000-000000000001",
} as const;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function fixtureSha(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function fileSha(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function artifactRef(filePath: string, rows: number): ArtifactRef {
  return {
    path: path.relative(repoRoot, filePath),
    sha256: fileSha(filePath),
    bytes: fs.statSync(filePath).size,
    rows,
  };
}

function classification(code: string): JsonRecord {
  return {
    "common:classification": {
      "common:class": [
        { "@level": "0", "@classId": code.slice(0, 1), "#text": "Root" },
        { "@level": "4", "@classId": code, "#text": `Leaf ${code}` },
      ],
    },
  };
}

function flowPayload(id: string, code: string): FlowPayload {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: { baseName: { "@xml:lang": "en", "#text": `Flow ${id.slice(-1)}` } },
          classificationInformation: classification(code),
        },
        flowProperties: {
          flowProperty: [
            {
              referenceToFlowPropertyDataSet: {
                "@refObjectId": topologyIds.flowproperty,
                "@version": version,
              },
            },
          ],
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": version },
      },
    },
  };
}

function sourceTrace(number: string | number): JsonRecord {
  return {
    "common:other": {
      "tidasimport:sourceTrace": {
        payload: {
          sourceTrace: {
            exchange: { attributes: [{ name: "number", value: String(number) }] },
          },
        },
      },
    },
  };
}

function flowReference(id: string, text: string, chinese: string | null = null): JsonRecord {
  const descriptions = [{ "@xml:lang": "en", "#text": text }];
  if (chinese) descriptions.push({ "@xml:lang": "zh", "#text": chinese });
  return {
    "@refObjectId": id,
    "@version": version,
    "common:shortDescription": descriptions.length === 1 ? descriptions[0] : descriptions,
  };
}

function exchange({
  number,
  flow,
  amount = "1",
  direction = "Input",
  chinese = null,
}: {
  number: string | number;
  flow: string;
  amount?: string;
  direction?: string;
  chinese?: string | null;
}): FixtureExchange {
  return {
    "@dataSetInternalID": String(number),
    referenceToFlowDataSet: flowReference(flow, `Flow ${flow.slice(-1)}`, chinese),
    exchangeDirection: direction,
    meanAmount: amount,
    resultingAmount: amount,
    generalComment: { "@xml:lang": "en", "#text": `Exchange ${number}` },
    ...sourceTrace(number),
  };
}

function processPayload(
  id: string,
  exchanges: FixtureExchange[],
  { name = "Candidate name", german = null }: { name?: string; german?: LanguageNode | null } = {},
): ProcessPayload {
  const dataSetInformation: ProcessPayload["processDataSet"]["processInformation"]["dataSetInformation"] =
    {
      "common:UUID": id,
      name: { baseName: { "@xml:lang": "en", "#text": name } },
    };
  if (german) dataSetInformation["common:synonyms"] = german;
  return {
    processDataSet: {
      processInformation: { dataSetInformation },
      exchanges: { exchange: exchanges },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": version },
      },
    },
  };
}

function snapshotRow(
  table: string,
  id: string,
  payload: unknown,
  { user = topologyIds.owner, state = 0 }: { user?: string | null; state?: number } = {},
): SnapshotRow {
  return {
    table,
    id,
    version,
    user_id: user,
    state_code: state,
    json_ordered: payload,
    payload_sha256: fixtureSha(payload),
  };
}

function candidateIndexRow(filePath: string, table: string, id: string): JsonRecord {
  return {
    schema_version: "foundry-topology-candidate-index-row.v1",
    entity: { table, id, version },
    path: path.relative(repoRoot, filePath),
    sha256: fileSha(filePath),
    bytes: fs.statSync(filePath).size,
  };
}

export function createTopologyConvergenceFixture(
  name: string,
  mutate: (state: TopologyFixtureState) => void = () => {},
) {
  const root = testTmpRoot(`topology-${name}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const candidateDir = path.join(root, "candidate");
  fs.mkdirSync(candidateDir, { recursive: true });
  const [flowA, flowB, flowC, flowD] = topologyIds.flows;
  const [oldA, oldB, oldC, oldD, oldE] = topologyIds.oldFlows;
  const [processA, processB, processC] = topologyIds.processes;
  const germanA = { "@xml:lang": "de", "#text": "Deutscher Name A" };
  const germanC = { "@xml:lang": "de", "#text": "Deutscher Name C" };

  const flowPayloads = new Map<string, FlowPayload>([
    [flowA, flowPayload(flowA, "12345")],
    [flowB, flowPayload(flowB, "21691")],
    [flowC, flowPayload(flowC, "12345")],
    [flowD, flowPayload(flowD, "12345")],
  ]);
  const candidateProcessPayloads = new Map<string, ProcessPayload>([
    [
      processA,
      processPayload(processA, [
        exchange({ number: 1, flow: flowA }),
        exchange({ number: 2, flow: flowB, amount: "2" }),
        exchange({ number: 3, flow: flowC, direction: "Output" }),
        exchange({ number: 5, flow: flowD }),
      ]),
    ],
    [processB, processPayload(processB, [exchange({ number: 6, flow: flowA })])],
    [
      processC,
      processPayload(processC, [exchange({ number: 7, flow: flowD })], {
        name: "Exact process",
        german: germanC,
      }),
    ],
  ]);
  const currentProcessA = processPayload(
    processA,
    [
      exchange({ number: 1, flow: oldA }),
      exchange({ number: 2, flow: oldB, amount: "1", chinese: "中文流" }),
      exchange({ number: 3, flow: oldD, direction: "Input" }),
      exchange({ number: 4, flow: oldE }),
    ],
    { name: "Owner-authored name", german: germanA },
  );
  for (const currentExchange of currentProcessA.processDataSet.exchanges.exchange) {
    delete currentExchange["common:other"];
    currentExchange.generalComment = {
      "@xml:lang": "en",
      "#text": `Source EcoSpold1 exchange number: ${currentExchange["@dataSetInternalID"]}. Preserved production trace.`,
    };
  }

  const mappingTuples: Array<[string, string, string]> = [
    [oldA, flowA, "1:1"],
    [oldB, flowB, "many-to-one"],
    [oldC, flowB, "many-to-one"],
    [oldD, flowC, "one-to-many"],
    [oldD, flowD, "one-to-many"],
  ];
  const state: TopologyFixtureState = {
    root,
    flowPayloads,
    candidateProcessPayloads,
    currentProcessA,
    germanRows: [
      {
        entity: { table: "processes", id: processA, version },
        desired_value: germanA,
        desired_value_sha256: fixtureSha(germanA),
        evidence_sha256: evidence,
      },
      {
        entity: { table: "processes", id: processC, version },
        desired_value: germanC,
        desired_value_sha256: fixtureSha(germanC),
        evidence_sha256: evidence,
      },
    ],
    ownerFlowRows: [
      ...[oldA, oldB, oldC, oldD, oldE].map((id) =>
        snapshotRow("flows", id, flowPayload(id, "12345")),
      ),
      snapshotRow("flows", flowC, flowPayloads.get(flowC)),
    ],
    publicFlowRows: [
      snapshotRow("flows", flowD, flowPayloads.get(flowD), { user: null, state: 100 }),
    ],
    foreignFlowRows: [],
    ownerProcessRows: [
      snapshotRow("processes", processA, currentProcessA),
      snapshotRow("processes", processC, candidateProcessPayloads.get(processC)),
    ],
    classificationRows: [...flowPayloads.entries()].map(([id, payload]) => ({
      schema_version: "foundry-topology-flow-classification.v1",
      entity: { table: "flows", id, version },
      classification:
        payload.flowDataSet.flowInformation.dataSetInformation.classificationInformation,
      selected_code: id === flowB ? "21691" : "12345",
      source_kind: id === flowB ? "explicit_conflict_override" : "audited_projection",
      evidence_sha256: evidence,
    })),
    mappingRows: mappingTuples.map(([old_flow_id, new_flow_id, mapping_kind]) => ({
      old_flow_id,
      new_flow_id,
      mapping_kind,
      evidence_sha256: evidence,
    })),
    protectedRows: [
      {
        entity: { table: "sources", id: topologyIds.source, version },
        before_sha256: "a".repeat(64),
        reason: "FRENCH_VALUE_PRESERVE_NO_WRITE",
        evidence_sha256: evidence,
      },
    ],
  };
  mutate(state);

  const flowIndex = [];
  for (const [id, payload] of state.flowPayloads) {
    const filePath = path.join(candidateDir, `flow-${id}.json`);
    writeJson(filePath, payload);
    flowIndex.push(candidateIndexRow(filePath, "flows", id));
  }
  const processIndex = [];
  for (const [id, payload] of state.candidateProcessPayloads) {
    const filePath = path.join(candidateDir, `process-${id}.json`);
    writeJson(filePath, payload);
    processIndex.push(candidateIndexRow(filePath, "processes", id));
  }
  const files = {
    candidateFlows: path.join(root, "candidate-flows.jsonl"),
    candidateProcesses: path.join(root, "candidate-processes.jsonl"),
    ownerFlows: path.join(root, "owner-flows.jsonl"),
    publicFlows: path.join(root, "public-flows.jsonl"),
    foreignFlows: path.join(root, "foreign-flows.jsonl"),
    ownerProcesses: path.join(root, "owner-processes.jsonl"),
    mappings: path.join(root, "flow-mappings.jsonl"),
    classifications: path.join(root, "target-classifications.jsonl"),
    german: path.join(root, "german-synonyms.jsonl"),
    protected: path.join(root, "protected-no-write.jsonl"),
    candidatePackage: path.join(root, "candidate-package.zip"),
    admission: path.join(root, "admission.json"),
    request: path.join(root, "request.json"),
  };
  writeJsonLines(files.candidateFlows, flowIndex);
  writeJsonLines(files.candidateProcesses, processIndex);
  writeJsonLines(files.ownerFlows, state.ownerFlowRows);
  writeJsonLines(files.publicFlows, state.publicFlowRows);
  writeJsonLines(files.foreignFlows, state.foreignFlowRows);
  writeJsonLines(files.ownerProcesses, state.ownerProcessRows);
  writeJsonLines(files.mappings, state.mappingRows);
  writeJsonLines(files.classifications, state.classificationRows);
  writeJsonLines(files.german, state.germanRows);
  writeJsonLines(files.protected, state.protectedRows);
  fs.writeFileSync(files.candidatePackage, "fixture candidate package\n");

  const refs: Record<string, ArtifactRef> = {
    candidate_flows: artifactRef(files.candidateFlows, flowIndex.length),
    candidate_processes: artifactRef(files.candidateProcesses, processIndex.length),
    owner_flows: artifactRef(files.ownerFlows, state.ownerFlowRows.length),
    public_flows: artifactRef(files.publicFlows, state.publicFlowRows.length),
    foreign_flows: artifactRef(files.foreignFlows, state.foreignFlowRows.length),
    owner_processes: artifactRef(files.ownerProcesses, state.ownerProcessRows.length),
    flow_mappings: artifactRef(files.mappings, state.mappingRows.length),
    target_classifications: artifactRef(files.classifications, state.classificationRows.length),
    german_synonyms: artifactRef(files.german, state.germanRows.length),
    protected_no_write: artifactRef(files.protected, state.protectedRows.length),
  };
  const scope = {
    email: "owner@example.com",
    user_id: topologyIds.owner,
    project_ref: "fixture-project",
    state_code: 0,
    visibility: "owner_draft",
  };
  const cliFingerprint = {
    version: "0.0.33",
    git_head: "b".repeat(40),
    integrity: "sha512-fixture",
  };
  const candidatePackage = {
    path: path.relative(repoRoot, files.candidatePackage),
    sha256: fileSha(files.candidatePackage),
    bytes: fs.statSync(files.candidatePackage).size,
  };
  const request = {
    schema_version: "foundry-topology-convergence-request.v1",
    campaign_id: `fixture-${name}`,
    production_authority: false,
    candidate_package: candidatePackage,
    scope,
    input_artifacts: refs,
    canonical_support: {
      flowproperties: [`${topologyIds.flowproperty}@${version}`],
      unitgroups: [],
    },
    classification_policy: { conflict_flow_id: flowB, selected_code: "21691" },
    expected: {
      candidate_flows: 4,
      processes: 3,
      exchanges: 6,
      flow_reference_changes: 3,
      exchange_add: 1,
      exchange_delete: 1,
      direction_changes: 1,
      amount_changes: 1,
      german_synonyms: 2,
      chinese_descriptions: 1,
      protected_no_write: 1,
      process_update: 1,
      process_insert: 1,
      process_no_write: 1,
      obsolete_flow_delete_ceiling: 5,
    },
    cli_fingerprint: cliFingerprint,
  };
  const admission = {
    schema_version: "foundry-topology-fresh-admission-receipt.v1",
    captured_at_utc: "2026-07-24T00:00:00Z",
    select_only: true,
    fresh_owner_session: true,
    scope,
    candidate_package_sha256: candidatePackage.sha256,
    request_binding_sha256: admissionRequestBinding(
      request as unknown as Parameters<typeof admissionRequestBinding>[0],
    ),
    input_artifact_sha256: Object.fromEntries(
      Object.entries(refs).map(([key, ref]) => [key, ref.sha256]),
    ),
    cli_fingerprint: cliFingerprint,
    fingerprints: { deployment: "d".repeat(64), rpc: "e".repeat(64), query: "f".repeat(64) },
    guards: { queue: 0, fence: 0, residue: 0, p0: 0, p1: 0 },
  };
  state.requestMutator?.(request, admission);
  admission.request_binding_sha256 = admissionRequestBinding(
    request as unknown as Parameters<typeof admissionRequestBinding>[0],
  );
  writeJson(files.admission, admission);
  refs.admission_receipt = artifactRef(files.admission, 1);
  writeJson(files.request, request);
  return {
    ...state,
    ...files,
    requestPath: files.request,
    requestValue: request,
    outDir: path.join(root, "out"),
  };
}
