export type TidasWorkflowOptions = Record<string, unknown> & {
  help?: unknown;
  rowsFile?: unknown;
};

type TidasWorkflowAdapterInput = {
  repoRoot: string;
  options: TidasWorkflowOptions;
};

export type TidasHandshakeAdapterResult = Record<string, unknown> & {
  binary_version: unknown;
  report: unknown;
  validation_describe: unknown;
  validation_describe_report: unknown;
};

export type TidasOperationAdapterResult = Record<string, unknown> & {
  report: Record<string, unknown>;
};

export type TidasWorkflowFactoryDependencies = {
  repoRoot: string;
  runTidasHandshake: (input: TidasWorkflowAdapterInput) => TidasHandshakeAdapterResult;
  runTidasImport: (input: TidasWorkflowAdapterInput) => TidasOperationAdapterResult;
  runTidasPackageValidation: (input: TidasWorkflowAdapterInput) => TidasOperationAdapterResult;
  runTidasRowsValidation: (input: TidasWorkflowAdapterInput) => TidasOperationAdapterResult;
};

type TidasHelpReport = {
  schema_version: 1;
  status: "help";
  command: string;
  usage: string[];
  owner: "tidas";
  remote_write_mode: "read-only";
};

export type TidasWorkflowReport = Record<string, unknown>;

function help(command: string, usage: string[]): TidasHelpReport {
  return {
    schema_version: 1,
    status: "help",
    command,
    usage,
    owner: "tidas",
    remote_write_mode: "read-only",
  };
}

export function createTidasWorkflowCommands({
  repoRoot,
  runTidasHandshake,
  runTidasImport,
  runTidasPackageValidation,
  runTidasRowsValidation,
}: TidasWorkflowFactoryDependencies) {
  return {
    runTidasHandshake(options: TidasWorkflowOptions = {}): TidasWorkflowReport {
      if (options.help) {
        return help("tidas-handshake", [
          "node scripts/foundry.ts tidas-handshake [--tidas-bin /path/to/tidas] [--tidas-config /path/to/config]",
        ]);
      }
      const result = runTidasHandshake({ repoRoot, options });
      return {
        schema_version: 1,
        status: "passed",
        command: "tidas-handshake",
        binary_version: result.binary_version,
        operation_report: result.report,
        validation_describe: result.validation_describe,
        validation_describe_report: result.validation_describe_report,
        foundry_adapter: result,
      };
    },
    runTidasImport(options: TidasWorkflowOptions = {}): TidasWorkflowReport {
      if (options.help) {
        return help("dataset-tidas-import", [
          "node scripts/foundry.ts dataset-tidas-import --input <source> --output <dir> [--from-format <format>] [--target tidas|ilcd|both] [--write-mapping]",
        ]);
      }
      const result = runTidasImport({ repoRoot, options });
      return {
        ...result.report,
        foundry_adapter: result,
      };
    },
    runTidasPackageValidation(options: TidasWorkflowOptions = {}): TidasWorkflowReport {
      if (options.help) {
        return help("dataset-tidas-validate", [
          "node scripts/foundry.ts dataset-tidas-validate --input <package-dir> [--input-format tidas-json|ilcd-xml]",
          "node scripts/foundry.ts dataset-tidas-validate --rows-file <rows.jsonl> --type <type> --out-dir <dir>",
        ]);
      }
      const result = options.rowsFile
        ? runTidasRowsValidation({ repoRoot, options })
        : runTidasPackageValidation({ repoRoot, options });
      return {
        ...result.report,
        foundry_adapter: result,
      };
    },
  };
}
