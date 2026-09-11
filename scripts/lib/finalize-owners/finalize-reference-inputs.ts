import fs from "node:fs";

type Options = Record<string, unknown>;
function invalid(option: string, message: string): never {
  throw new Error(`${option}: ${message}`);
}
function selectedFile(
  value: unknown,
  option: string,
  resolve: (value: unknown) => string | null,
): string {
  if (typeof value !== "string" || !value.trim())
    invalid(option, "Select an explicit non-empty file path.");
  const file = resolve(value);
  try {
    if (!file || !fs.lstatSync(file).isFile()) invalid(option, "Select a readable regular file.");
    fs.accessSync(file, fs.constants.R_OK);
  } catch {
    invalid(option, "The explicitly selected file is missing or is not a readable regular file.");
  }
  return file;
}

/** Input selection only. The CLI owns dimensional QA and exact-reference eligibility. */
export function selectFinalizeReferenceInputs(input: {
  options: Options;
  datasetType: string;
  verifyRemote: boolean;
  resolveFile: (value: unknown) => string | null;
}): { qaFiles: string[]; intentFile: string | null } {
  if (
    Object.keys(input.options).some(
      (key) => key.startsWith("referenceIntent") && key !== "referenceIntentFile",
    )
  )
    invalid("--reference-intent-file", "Unsupported reference intent selection.");
  let qaFiles: string[] = [];
  if (Object.hasOwn(input.options, "qaReferenceRows")) {
    if (input.datasetType !== "process")
      invalid("--qa-reference-rows", "Explicit unit evidence belongs to Process QA.");
    const selected = Array.isArray(input.options.qaReferenceRows)
      ? input.options.qaReferenceRows
      : [input.options.qaReferenceRows];
    if (!selected.length) invalid("--qa-reference-rows", "Select at least one reference-row file.");
    qaFiles = [
      ...new Set(
        selected.map((file) => selectedFile(file, "--qa-reference-rows", input.resolveFile)),
      ),
    ];
  }
  let intentFile: string | null = null;
  if (Object.hasOwn(input.options, "referenceIntentFile")) {
    if (!input.verifyRemote)
      invalid("--reference-intent-file", "Explicit intent requires remote reference verification.");
    intentFile = selectedFile(
      input.options.referenceIntentFile,
      "--reference-intent-file",
      input.resolveFile,
    );
    try {
      const stat = fs.statSync(intentFile);
      if (stat.size > 8 * 1024 * 1024)
        invalid("--reference-intent-file", "Intent exceeds the 8 MiB selection limit.");
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(intentFile)),
      );
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (value as Options).schema_version !== "dataset-exact-reference-intent.v1"
      )
        invalid("--reference-intent-file", "Select the supported CLI intent JSON object.");
    } catch {
      invalid("--reference-intent-file", "Select a bounded valid CLI intent JSON object.");
    }
  }
  return { qaFiles, intentFile };
}
