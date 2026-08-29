import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CONTROL_ARTIFACT_SCHEMA = "tiangong-foundry.control-artifact.v1" as const;

export interface ControlArtifactFact {
  schema: typeof CONTROL_ARTIFACT_SCHEMA;
  artifact_id: string;
  bytes: number;
  sha256: string;
  store_path: string;
  storage_mode: "copied" | "hardlinked" | "reused";
}

export interface ControlArtifactVerification {
  status: "failed" | "passed";
  artifact_id: string;
  expected_bytes: number;
  observed_bytes: number | null;
  expected_sha256: string;
  observed_sha256: string | null;
}

export interface ControlArtifactStoreOptions {
  rootDir: string;
  linkFile?: (source: string, destination: string) => void;
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function regularFileBytes(filePath: string): Buffer {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Control artifact source must be a regular non-symlink file: ${filePath}`);
  }
  return fs.readFileSync(filePath);
}

function canCopyAfterLinkError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return ["EACCES", "EINVAL", "ENOTSUP", "EPERM", "EXDEV"].includes(String(code));
}

export function createControlArtifactStore({
  rootDir,
  linkFile = fs.linkSync,
}: ControlArtifactStoreOptions) {
  const absoluteRoot = path.resolve(rootDir);

  function targetPath(digest: string): string {
    return path.join(absoluteRoot, "sha256", digest.slice(0, 2), digest);
  }

  function verify(fact: ControlArtifactFact): ControlArtifactVerification {
    let observedBytes: number | null = null;
    let observedSha256: string | null = null;
    try {
      const bytes = regularFileBytes(fact.store_path);
      observedBytes = bytes.byteLength;
      observedSha256 = sha256(bytes);
    } catch {
      // The explicit null observation below is verification evidence.
    }
    return {
      status: observedBytes === fact.bytes && observedSha256 === fact.sha256 ? "passed" : "failed",
      artifact_id: fact.artifact_id,
      expected_bytes: fact.bytes,
      observed_bytes: observedBytes,
      expected_sha256: fact.sha256,
      observed_sha256: observedSha256,
    };
  }

  function existingFact(filePath: string, bytes: Buffer, digest: string): ControlArtifactFact {
    const fact: ControlArtifactFact = {
      schema: CONTROL_ARTIFACT_SCHEMA,
      artifact_id: `sha256:${digest}`,
      bytes: bytes.byteLength,
      sha256: digest,
      store_path: filePath,
      storage_mode: "reused",
    };
    if (verify(fact).status !== "passed") {
      throw new Error(`Existing control artifact blob failed exact verification: ${filePath}`);
    }
    return fact;
  }

  function putFile(sourcePath: string): ControlArtifactFact {
    const bytes = regularFileBytes(sourcePath);
    const digest = sha256(bytes);
    const destination = targetPath(digest);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    if (fs.existsSync(destination)) return existingFact(destination, bytes, digest);
    let storageMode: ControlArtifactFact["storage_mode"] = "hardlinked";
    try {
      linkFile(sourcePath, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === "EEXIST") {
        return existingFact(destination, bytes, digest);
      }
      if (!canCopyAfterLinkError(error)) throw error;
      storageMode = "copied";
      try {
        fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o400 });
      } catch (copyError) {
        if ((copyError as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw copyError;
        return existingFact(destination, bytes, digest);
      }
    }
    const fact: ControlArtifactFact = {
      schema: CONTROL_ARTIFACT_SCHEMA,
      artifact_id: `sha256:${digest}`,
      bytes: bytes.byteLength,
      sha256: digest,
      store_path: destination,
      storage_mode: storageMode,
    };
    if (verify(fact).status !== "passed") {
      throw new Error(`New control artifact blob failed exact verification: ${destination}`);
    }
    return fact;
  }

  return Object.freeze({ putFile, verify, rootDir: absoluteRoot });
}
