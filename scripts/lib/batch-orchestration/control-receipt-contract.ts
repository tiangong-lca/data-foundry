export type ControlReceiptJsonRecord = Record<string, unknown>;

export const SCOPE_CONTROL_RECEIPT_SCHEMA = "tiangong-foundry.scope-control-receipt.v1" as const;

export interface ScopeControlArtifactEntry extends ControlReceiptJsonRecord {
  role: string;
  roles: string[];
  artifact_id: string | null;
  bytes: number | null;
  sha256: string | null;
  original_locator: string;
  store_locator: string | null;
  storage_mode: string | null;
  retention:
    "external_unmanaged" | "missing_before_retention" | "pruned_payload" | "retained_control";
  required_for_control: boolean;
}

export interface ScopeControlReceiptAuthority extends ControlReceiptJsonRecord {
  schema: typeof SCOPE_CONTROL_RECEIPT_SCHEMA;
  generated_at_utc: string;
  status: "completed";
  scope_id: string;
  store_root: string;
  artifacts: ScopeControlArtifactEntry[];
  counts: ControlReceiptJsonRecord;
}

export interface ScopeControlReceipt extends ScopeControlReceiptAuthority {
  receipt_sha256: string;
}
