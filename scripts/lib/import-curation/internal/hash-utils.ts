import crypto from "node:crypto";

export function sha256Text(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
}

export function sha256Json(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
