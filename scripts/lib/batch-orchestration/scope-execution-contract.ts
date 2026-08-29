import type { SchemaPaths } from "../bafu-classification/schema-repair.ts";
import type {
  BatchFinalizeArgsInput,
  BatchFinalizeContextPaths,
  BatchFinalizeStageResult,
  RunFinalizeStageInput,
} from "../bafu-orchestration/batch-finalize-stage.ts";
import type {
  BatchScopeMaterializedRows,
  BatchScopePreparationInput,
  BatchScopePreparationResult,
} from "./scope-preparation.ts";
import type { ScopeResumeContract } from "./scope-resume-contract.ts";
import type { VerifiedFlowWriteInput } from "./verified-flow-write.ts";

export type BatchScopeJsonRecord = Record<string, unknown>;

export interface BatchScopeExecutionPaths {
  [key: string]: unknown;
  runDir: string;
  outDir: string;
  scopeFile: string;
  processBundlesDir: string;
  libraryClassificationDecisions: string | null;
  scopeCheckpoints: string;
  okFlows: string;
  okProcesses: string;
  okScopes: string;
  blockedHumanReview: string;
  blockedHumanReviewActive: string;
  blockedHumanReviewResolved: string;
  blocked_human_review: string;
  blocked_reference_closure: string;
  blocked_remote_write: string;
  blockedOther: string;
  failedRetry: string;
  supportIdentityCache: string;
  preflightPlan: string;
  bafuFamilySignatures: string;
  resumeInvalidated: string;
  attemptEvents: string;
  attemptState: string;
  ambiguousNoReplay: string;
  resumeContractsByScopeKey: Map<string, ScopeResumeContract>;
  resolutionRewritesByProcess: Map<string, BatchScopeJsonRecord[]>;
  applyResolutionRewritesMode: boolean;
}
export interface RunBatchScopeInput {
  scope: BatchScopeJsonRecord;
  familySignature: unknown;
  options: BatchScopeJsonRecord;
  paths: BatchScopeExecutionPaths;
  schemas: SchemaPaths;
  verifiedScopes: Set<string>;
  verifiedFlows: Set<string>;
  verifiedFlowRowsByKey: Map<string, BatchScopeJsonRecord>;
  blockedScopes: Set<string>;
  workerIndex?: number;
}
interface DatasetIdentity {
  id: string | null;
  version: string;
}
export interface BatchScopeActionInput {
  stage: string;
  blocker: BatchScopeJsonRecord;
  report: string | null;
}
interface FlowVerificationPlan {
  pendingRows: BatchScopeJsonRecord[];
  verifiedRows: BatchScopeJsonRecord[];
  pendingIdentities: BatchScopeJsonRecord[];
  verifiedIdentities: BatchScopeJsonRecord[];
}
interface CarriedForwardFlowRows {
  count: number;
  rows: BatchScopeJsonRecord[];
  ledger: string;
}
interface IdentityPatchCompleted extends BatchScopeJsonRecord {
  status: "completed";
  rowsFile: string;
  identityApplyReport: string | null;
  patchCollectReport: string | null;
  patchApplyReport: string | null;
}
interface IdentityPatchBlocked extends BatchScopeJsonRecord {
  status: "blocked";
  blocker: BatchScopeJsonRecord;
  report?: string | null;
}
type IdentityPatchResult = IdentityPatchCompleted | IdentityPatchBlocked;
interface HandoffResult extends BatchScopeJsonRecord {
  status: string;
  blockers: BatchScopeJsonRecord[];
  stages: BatchScopeJsonRecord[];
  closeoutReportPath?: string | null;
}
interface DatasetCommitCompleted extends BatchScopeJsonRecord {
  status: "completed";
  report: string;
  finalizeReport: BatchScopeJsonRecord;
  handoff: HandoffResult;
}
interface DatasetCommitBlocked extends BatchScopeJsonRecord {
  status: "failed" | "blocked";
  blocker: BatchScopeJsonRecord;
  report: string;
}
type DatasetCommitResult = DatasetCommitCompleted | DatasetCommitBlocked;

export interface BatchScopeExecutionIoAdapter {
  processExecPath: string;
  foundryEntryPath: string;
  rerunCommandName: string;
  joinPath: (...parts: string[]) => string;
  ensureDirectory: (directory: string) => void;
  nowIso: () => string;
  asText: (value: unknown) => string;
  integerOption: (value: unknown, fallback?: number | null) => number | null;
  booleanOption: (value: unknown) => boolean;
  repoRelative: (filePath: string | null | undefined) => string;
  resolveRepoPath: (value: unknown) => string | null;
  fileExists: (filePath: string | null | undefined) => boolean;
  readJsonLines: (filePath: string | null | undefined) => BatchScopeJsonRecord[];
  readRows: (filePath: string | null | undefined) => BatchScopeJsonRecord[];
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
  appendJsonLine: (filePath: string, row: unknown) => void;
}

export interface BatchScopeExecutionOperationAdapter {
  prepareScope: (input: BatchScopePreparationInput) => Promise<BatchScopePreparationResult>;
  requestedProcessIdValues: (options: BatchScopeJsonRecord) => string[];
  familyPlanFields: (signature: unknown) => BatchScopeJsonRecord;
  compactFamilySignature: (
    signature: unknown,
    repoRelative: (filePath: string | null | undefined) => string,
  ) => unknown;
  commandString: (argv: string[]) => string;
  blockRow: (input: {
    scope: BatchScopeJsonRecord;
    stage: string;
    blocker: BatchScopeJsonRecord;
    report: string | null;
    rerunCommand: string;
  }) => BatchScopeJsonRecord;
  categoryForBlocker: (code: unknown) => string;
  retryableStageFailure: (input: BatchScopeActionInput) => BatchScopeJsonRecord | null;
  firstBlocker: (
    report: BatchScopeJsonRecord | null,
    fallbackCode: string,
    fallbackMessage: string,
  ) => BatchScopeJsonRecord;
  datasetIdentity: (row: BatchScopeJsonRecord, type: string) => DatasetIdentity;
  datasetIdentityKey: (identity: DatasetIdentity) => string | null;
  flowRowsPendingVerification: (
    rows: BatchScopeJsonRecord[],
    verified: Set<string>,
    verifiedRowsByKey: ReadonlyMap<string, BatchScopeJsonRecord>,
  ) => FlowVerificationPlan;
  recordVerifiedFlowRows: (input: VerifiedFlowWriteInput) => void;
  writeScopeCarriedForwardVerifiedFlowRows: (input: {
    ledgerDir: string;
    processId: string;
    verifiedIdentities: BatchScopeJsonRecord[];
    verifiedFlowRowsByKey: Map<string, BatchScopeJsonRecord>;
  }) => CarriedForwardFlowRows;
  existingIdentityApplyReportsWithReferenceRewrites: (scopeDir: string, label: string) => string[];
  uniqueExistingPaths: (paths: unknown[]) => string[];
  buildFinalizeArgs: (input: BatchFinalizeArgsInput) => string[];
  runFinalizeStage: (input: RunFinalizeStageInput) => Promise<BatchFinalizeStageResult>;
  defaultContext: (runDir: string, type: string) => BatchFinalizeContextPaths;
  commitFlowSupportInline: () => boolean;
  maybeCommitSupportThenRerunFinalize: (input: {
    type: string;
    finalizeReport: BatchScopeJsonRecord;
    finalizeReportPath: string;
    finalizeArgs: string[];
    ledgerDir: string;
    scopeDir: string;
    logDir: string;
    stages: BatchScopeJsonRecord[];
    supportIdentityCacheFile: string;
  }) => Promise<BatchScopeJsonRecord>;
  runIdentityAndPatch: (input: {
    type: string;
    inputRowsFile: string;
    preFinalizeReport: BatchScopeJsonRecord;
    scopeDir: string;
    runDir: string;
    logDir: string;
    stages: BatchScopeJsonRecord[];
    resolutionRewriteRows?: BatchScopeJsonRecord[];
    applyResolutionRewritesMode?: boolean;
  }) => Promise<IdentityPatchResult>;
  preFinalizeRecoveryBlocker: (input: {
    type: string;
    finalizeReport: BatchScopeJsonRecord;
    recovery: BatchScopeJsonRecord | null;
  }) => BatchScopeJsonRecord | null;
  finalizeAndCommitDataset: (input: {
    type: string;
    rowsFile: string;
    scopeDir: string;
    runDir: string;
    materialized: BatchScopeMaterializedRows;
    classificationApplyReport: string | null;
    locationApplyReport: string | null;
    identityApplyReports: string[];
    patchCollectReport: string | null;
    patchApplyReport: string | null;
    targetUserId: string;
    stateCode: number;
    logDir: string;
    ledgerDir: string;
    stages: BatchScopeJsonRecord[];
    supportIdentityCacheFile: string;
  }) => Promise<DatasetCommitResult>;
  okDatasetRow: (input: {
    type: string;
    id: string | null;
    version: string;
    processId: string;
    report: string;
    files: BatchScopeJsonRecord;
  }) => BatchScopeJsonRecord;
  executeHandoff: (input: {
    handoffPlanPath: string;
    ledgerDir: string;
    outDir: string;
    logDir: string;
    label: string;
  }) => Promise<HandoffResult>;
  trimVerifiedScopeScratch: (
    scopeDir: string,
    options: BatchScopeJsonRecord,
    runDir: string,
  ) => void;
}
export interface BatchScopeExecutionAdapter {
  io: BatchScopeExecutionIoAdapter;
  operations: BatchScopeExecutionOperationAdapter;
}
export interface BatchScopeExecutionService {
  runOneScope: (input: RunBatchScopeInput) => Promise<BatchScopeJsonRecord>;
}
