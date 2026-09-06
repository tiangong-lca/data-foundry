import fs from "node:fs";

/** Bind the physical directory; Git and Node can preserve different path casing. */
export function sameFoundryReleaseDirectory(expected: string, observed: string): boolean {
  const left = fs.statSync(fs.realpathSync.native(expected), { bigint: true });
  const right = fs.statSync(fs.realpathSync.native(observed), { bigint: true });
  return (
    left.isDirectory() &&
    right.isDirectory() &&
    left.ino !== 0n &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}
