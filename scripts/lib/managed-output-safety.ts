import { realpathSync } from "node:fs";
import path from "node:path";

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

    const targetRealPath = realpathSync(targetPath);
    const relative = path.relative(managedWorkspaceRealPath, targetRealPath);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  } catch {
    return false;
  }
}
