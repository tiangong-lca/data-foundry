import fs from "node:fs";
import { FoundryContextError } from "./foundry-runtime-error.ts";

export function migrationCredentialPath(relative: string): boolean {
  const parts = relative.split(/[\\/]/u);
  return parts.some((part, index) => {
    if (
      part === "task-accounts" &&
      parts[index - 1] === "state" &&
      index === parts.length - 2 &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.json$/u.test(parts[index + 1])
    )
      return false;
    return (
      /^\.env(?:\.|$)|(?:^|[-_.])(?:sessions?|tokens?|cookies?|credentials?|secrets?|passwords?|passwd|accounts?|private-key)(?:[-_.]|$)/iu.test(
        part,
      ) && !/^account-intent\.json$/u.test(part)
    );
  });
}

export function assertNotFoundrySessionFile(file: string, reference?: string): void {
  if (
    reference &&
    fs.existsSync(reference) &&
    fs.existsSync(file) &&
    fs.realpathSync(reference) === fs.realpathSync(file)
  )
    throw new FoundryContextError(
      "credential_input_forbidden",
      "CLI-owned session storage cannot be opened as workspace or migration evidence.",
    );
}
