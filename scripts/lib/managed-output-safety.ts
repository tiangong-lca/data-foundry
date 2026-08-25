import { realpathSync } from "node:fs";
import path from "node:path";

function isStrictRelativePath(relativePath: string): boolean {
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

/**
 * Returns true only when targetPath exists as a strict realpath descendant of
 * the repository's physical .foundry/workspaces directory. Symlinking either
 * managed-root component somewhere else therefore cannot expand deletion
 * authority, and the shared workspace container itself is never a task root.
 */
export function isTrustedManagedWorkspaceDescendant(repoRoot: string, targetPath: string): boolean {
  try {
    const repositoryRealPath = realpathSync(repoRoot);
    const managedWorkspacePath = path.resolve(repoRoot, ".foundry", "workspaces");
    const managedWorkspaceRealPath = realpathSync(managedWorkspacePath);
    const expectedManagedWorkspaceRealPath = path.join(
      repositoryRealPath,
      ".foundry",
      "workspaces",
    );
    if (path.relative(expectedManagedWorkspaceRealPath, managedWorkspaceRealPath) !== "") {
      return false;
    }

    const targetAbsolutePath = path.resolve(targetPath);
    const lexicalRelative = path.relative(managedWorkspacePath, targetAbsolutePath);
    if (!isStrictRelativePath(lexicalRelative)) return false;

    const targetRealPath = realpathSync(targetPath);
    const expectedTargetRealPath = path.resolve(managedWorkspaceRealPath, lexicalRelative);
    if (path.relative(expectedTargetRealPath, targetRealPath) !== "") return false;

    return isStrictRelativePath(path.relative(managedWorkspaceRealPath, targetRealPath));
  } catch {
    return false;
  }
}
