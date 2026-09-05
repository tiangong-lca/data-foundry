import fs from "node:fs";
import path from "node:path";

interface PackageManagerHost {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  isFile?: (candidate: string) => boolean;
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Repository tooling only. Windows command shims are never executable targets. */
export function resolvePackageManagerCommand(
  manager: "npm" | "pnpm",
  argv: readonly string[],
  host: PackageManagerHost = {},
): { executable: string; argv: string[] } {
  if ((host.platform ?? process.platform) !== "win32")
    return { executable: manager, argv: [...argv] };
  const environment = host.environment ?? process.env;
  const file = host.isFile ?? isFile;
  const directories = (environment.PATH ?? environment.Path ?? "")
    .split(path.win32.delimiter)
    .filter((directory) => path.win32.isAbsolute(directory));
  if (manager === "pnpm") {
    const home = environment.PNPM_HOME;
    const candidates = [
      ...(home && path.win32.isAbsolute(home) ? [path.win32.join(home, "pnpm.exe")] : []),
      ...directories.map((directory) => path.win32.join(directory, "pnpm.exe")),
    ];
    const executable = candidates.find(file);
    if (!executable) throw new Error("Cannot resolve the pnpm native executable on Windows");
    return { executable, argv: [...argv] };
  }
  const installation = directories
    .map((directory) => ({
      command: path.win32.join(directory, "npm.cmd"),
      node: path.win32.join(directory, "node.exe"),
      script: path.win32.join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
    }))
    .find((candidate) => [candidate.command, candidate.node, candidate.script].every(file));
  if (!installation) throw new Error("Cannot resolve a complete npm installation on Windows");
  return { executable: installation.node, argv: [installation.script, ...argv] };
}
