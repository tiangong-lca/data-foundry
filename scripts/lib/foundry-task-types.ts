import type { FoundryInputFact } from "./foundry-runtime-context.ts";

export type JsonRecord = Record<string, unknown>;
export type Lane = "external-dataset-curated-import" | "source-evidence-dataset-development";
export interface FileReference {
  path: string;
  sha256: string;
}
export interface TaskRuntimeIdentity {
  package_name: string;
  package_version: string;
  manifest_sha256: string;
  entry_sha256: string;
}
export interface FoundryTaskJob {
  schema: "tiangong-foundry.job.v2";
  workspace_id: string;
  task_id: string;
  actor_id: string;
  request_id: string;
  lane: Lane;
  target_profile: string;
  target_entities: string[];
  source_manifest: FileReference;
  profile_lock: FileReference;
  seed_manifest: FileReference | null;
  runtime_identity: TaskRuntimeIdentity;
  write_policy: { mode: "dry-run"; remote_state_code: 0 };
  created_at_utc: string;
}
export interface SourceManifest {
  schema: "tiangong-foundry.source-manifest.v2";
  workspace_id: string;
  task_id: string;
  source_kind: "selected-local-files";
  source_paths: FoundryInputFact[];
}
export interface FoundryTaskOptions {
  profileId?: string;
  lane?: Lane;
  requestId?: string;
  targetEntities?: string[];
  seed?: JsonRecord;
}
export interface ArtifactFact extends FoundryInputFact {
  path: string;
}
export interface ArtifactEntry extends ArtifactFact {
  schema: "tiangong-foundry.artifact-index.v2";
  sequence: number;
  previous_sha256: string | null;
  operation_id: string;
  command: string;
  input_scope_sha256: string;
  receipt: FileReference;
  record_sha256: string;
}
export interface OperationPlan {
  schema: "tiangong-foundry.operation-plan.v1";
  operation_id: string;
  job_sha256: string;
  command: string;
  options_sha256: string;
  input_scope_sha256: string;
  inputs: FoundryInputFact[];
  created_at_utc: string;
}
export interface OperationReceipt {
  schema: "tiangong-foundry.operation-receipt.v1";
  mode: "deterministic-local";
  status: "completed";
  plan: FileReference;
  job_sha256: string;
  outputs: ArtifactFact[];
  result: FileReference;
}
export interface LoadedTask {
  job: FoundryTaskJob;
  jobSha256: string;
  sources: FoundryInputFact[];
}
export interface TaskRegistration {
  schema: "tiangong-foundry.task-registration.v1";
  job: FoundryTaskJob;
  source_manifest: SourceManifest;
  profile_lock: JsonRecord;
  seed_manifest: JsonRecord | null;
  registration_sha256: string;
}
export interface FoundryTaskOperation {
  readonly job: FoundryTaskJob;
  readonly operationId: string;
  readonly inputScopeSha256: string;
  readonly nowIso: () => string;
  writeText(filePath: string, bytes: string | NodeJS.ArrayBufferView): void;
  writeJson(filePath: string, value: unknown): void;
}
