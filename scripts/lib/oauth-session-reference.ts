import fs from "node:fs";
import path from "node:path";

// Foundry validates a reference; only the CLI reads and rotates session contents.
export function requirePrivateOAuthSessionFile(value: string): string {
  let stat: fs.Stats;
  try {
    if (!path.isAbsolute(value)) throw new Error();
    stat = fs.lstatSync(value);
  } catch {
    throw new Error("OAuth session reference must identify an existing absolute private file.");
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
  ) {
    throw new Error(
      "OAuth session reference must identify a regular private file without symlinks.",
    );
  }
  return value;
}
