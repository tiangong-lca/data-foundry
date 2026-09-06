import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { list } from "tar";
import { unzipSync } from "fflate";

const maximumArchive = 256 * 1024 * 1024;
const maximumSelected = 512 * 1024 * 1024;
const hosts = new Set([
  "nodejs.org",
  "github.com",
  "raw.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);

function checksum(bytes: Buffer, expected: string): void {
  if (
    !/^[0-9a-f]{64}$/u.test(expected) ||
    createHash("sha256").update(bytes).digest("hex") !== expected
  )
    throw new Error("Native input checksum differs from its reviewed release source.");
}

function checkedUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !hosts.has(url.hostname)
  )
    throw new Error("Native input requires an allowed uncredentialed HTTPS artifact host.");
  return url;
}

export async function fetchFoundryNativeBytes(
  source: string,
  sha256: string,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<Buffer> {
  if (!/^[0-9a-f]{64}$/u.test(sha256)) throw new Error("Native input checksum is invalid.");
  let url = checkedUrl(source);
  const signal = AbortSignal.timeout(300000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetchImpl(url.href, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: { accept: "application/octet-stream" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirects === 5)
        throw new Error("Native input redirect chain is invalid or too long.");
      url = checkedUrl(new URL(location, url).href);
      continue;
    }
    const declared = response.headers.get("content-length");
    if (
      !response.ok ||
      !response.body ||
      (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumArchive))
    ) {
      await response.body?.cancel();
      throw new Error(
        `Native input download failed or exceeds its bound (HTTP ${response.status}).`,
      );
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        length += item.value.length;
        if (length > maximumArchive)
          throw new Error("Native input exceeds its download byte bound.");
        chunks.push(item.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks, length);
    checksum(bytes, sha256);
    return bytes;
  }
  throw new Error("Native input redirect chain did not resolve.");
}

export function selectFoundryNativeFiles(
  input: Buffer,
  expectation: {
    readonly format: "tar-gzip" | "zip" | "file";
    readonly sha256: string;
    readonly files: readonly string[];
  },
): ReadonlyMap<string, Buffer> {
  const bytes = Buffer.from(input),
    requested = [...expectation.files];
  if (!bytes.length || bytes.length > maximumArchive)
    throw new Error("Native input archive size is invalid.");
  checksum(bytes, expectation.sha256);
  if (
    !requested.length ||
    requested.length > 32 ||
    new Set(requested.map((name) => name.toLowerCase())).size !== requested.length ||
    requested.some(
      (name) =>
        name.length > 1024 ||
        name.startsWith("/") ||
        /[\\\p{Cc}]/u.test(name) ||
        name
          .split("/")
          .some(
            (part) => !part || [".", "..", "__proto__", "constructor", "prototype"].includes(part),
          ),
    )
  )
    throw new Error("Native input selected paths are invalid or duplicated.");
  if (expectation.format === "file") {
    if (requested.length !== 1) throw new Error("Raw native input requires one selected file.");
    return new Map([[requested[0], bytes]]);
  }
  const wanted = new Set(requested),
    seen = new Set<string>(),
    selected = new Map<string, Buffer>();
  let count = 0,
    total = 0,
    selectedBytes = 0;
  const admit = (name: string, size: number): boolean => {
    count++;
    total += size;
    if (count > 50000 || !Number.isSafeInteger(size) || size < 0 || total > 2 * 1024 * 1024 * 1024)
      throw new Error("Native archive exceeds its entry or unpacked byte bound.");
    if (!wanted.has(name)) return false;
    if (seen.has(name)) throw new Error("Native archive contains a duplicate selected file.");
    seen.add(name);
    selectedBytes += size;
    if (size > maximumArchive || selectedBytes > maximumSelected)
      throw new Error("Native archive selected files exceed their byte bound.");
    return true;
  };
  if (expectation.format === "zip") {
    const unpacked = unzipSync(bytes, {
      filter(file) {
        return admit(file.name, file.originalSize);
      },
    });
    for (const name of requested)
      if (Object.hasOwn(unpacked, name)) selected.set(name, Buffer.from(unpacked[name]));
  } else if (expectation.format === "tar-gzip") {
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
      throw new Error("Native tar input must be gzip encoded.");
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-native-select-"));
    fs.chmodSync(temporary, 0o700);
    try {
      const archive = path.join(temporary, "native.tgz");
      fs.writeFileSync(archive, bytes, { flag: "wx", mode: 0o400 });
      list({
        file: archive,
        sync: true,
        strict: true,
        maxMetaEntrySize: 1024 * 1024,
        onReadEntry(entry) {
          if (!admit(entry.path, entry.size)) return;
          if (entry.type !== "File" && entry.type !== "OldFile")
            throw new Error("Selected native input must be a regular file.");
          const chunks: Buffer[] = [];
          let length = 0;
          entry.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > entry.size) throw new Error("Native file body exceeds its header.");
            chunks.push(chunk);
          });
          entry.on("end", () => {
            if (length !== entry.size) throw new Error("Native file body is incomplete.");
            selected.set(entry.path, Buffer.concat(chunks, length));
          });
        },
      });
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  } else throw new Error("Native input archive format is unsupported.");
  if (selected.size !== requested.length)
    throw new Error("Native archive is missing a complete selected file.");
  return selected;
}
