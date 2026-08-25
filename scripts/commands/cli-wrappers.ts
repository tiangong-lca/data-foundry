import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

type JsonRecord = Record<string, unknown>;

type CliResolution = {
  command: string;
  args: string[];
  display: string;
  package: JsonRecord | null;
};

type JsonCliResult = {
  cliBin: string;
  cli: CliResolution;
  spawnArgs: string[];
  exitCode: number;
  report: JsonRecord;
  stderr: string;
};

export type CliWrapperOptions = Record<string, unknown> & {
  help?: unknown;
  processes?: unknown;
  processesFile?: unknown;
  processRows?: unknown;
  outDir?: unknown;
  flows?: unknown;
  flowsFile?: unknown;
  flowRows?: unknown;
  support?: unknown;
  supportFile?: unknown;
  supportRows?: unknown;
  externalFlowRef?: unknown;
  externalFlowRefs?: unknown;
  excludeProcessId?: unknown;
  excludeProcessIds?: unknown;
  processLimit?: unknown;
  input?: unknown;
  rowsFile?: unknown;
  rows?: unknown;
  patch?: unknown;
  patchFile?: unknown;
  patches?: unknown;
  suggestions?: unknown;
  out?: unknown;
  outFile?: unknown;
  authoringPackageDir?: unknown;
  authoringPackagesDir?: unknown;
  requireAuthoringPackage?: unknown;
  requireActionItemClosure?: unknown;
};

export type CliWrapperFactoryDependencies = {
  appendOption: (args: string[], option: string, value: unknown) => unknown;
  appendRepeatedOptions: (args: string[], option: string, value: unknown) => unknown;
  repoRoot: string;
  resolveTiangongLcaCliCommand?: () => CliResolution;
  resolveTiangongLcaCliBin: () => string;
};

export function createCliWrapperCommands({
  appendOption,
  appendRepeatedOptions,
  repoRoot,
  resolveTiangongLcaCliCommand,
  resolveTiangongLcaCliBin,
}: CliWrapperFactoryDependencies) {
  function runJsonCli(cliArgs: string[], errorMessage: string): JsonCliResult {
    const cli = resolveTiangongLcaCliCommand
      ? resolveTiangongLcaCliCommand()
      : {
          command: resolveTiangongLcaCliBin(),
          args: [],
          display: resolveTiangongLcaCliBin(),
          package: null,
        };
    const spawnArgs = [...cli.args, ...cliArgs];
    const result = spawnSync(cli.command, spawnArgs, {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      // Mega-scope stages emit large JSON payloads on stdout; the 1MB spawnSync
      // default overflows with ENOBUFS. Cap below V8's max string length.
      maxBuffer: 512 * 1024 * 1024,
    });
    const exitCode = typeof result.status === "number" ? result.status : 1;
    if (result.error) {
      throw result.error;
    }
    let report: JsonRecord;
    try {
      report = JSON.parse(result.stdout || "{}") as JsonRecord;
    } catch {
      throw new Error(
        [
          errorMessage,
          result.stdout ? `stdout:\n${result.stdout}` : "",
          result.stderr ? `stderr:\n${result.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    return {
      cliBin: cli.display,
      cli,
      spawnArgs,
      exitCode,
      report,
      stderr: result.stderr || "",
    };
  }

  function runDatasetCurationQueueBuild(options: CliWrapperOptions): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-curation-queue-build",
        wraps: "tiangong-lca dataset curation-queue build",
        usage: [
          "tiangong-lca dataset curation-queue build --processes <processes.jsonl> --out-dir <queue-dir>",
          "node scripts/foundry.mjs dataset-curation-queue-build --processes ./rows/processes.jsonl --flows ./rows/flows.jsonl --support ./rows/sources.jsonl --out-dir ./curation-queue",
        ],
        foundry_wrapper: {
          exit_code: 0,
          owner: "tiangong-lca-cli",
        },
      };
    }
    const processes = options.processes || options.processesFile || options.processRows;
    const outDir = options.outDir || ".foundry/workspaces/dataset-curation-queue";
    const cliArgs = ["dataset", "curation-queue", "build", "--json"];
    appendOption(cliArgs, "--processes", processes);
    appendOption(cliArgs, "--flows", options.flows || options.flowsFile || options.flowRows);
    appendRepeatedOptions(
      cliArgs,
      "--support",
      options.support || options.supportFile || options.supportRows,
    );
    appendRepeatedOptions(
      cliArgs,
      "--external-flow-ref",
      options.externalFlowRef || options.externalFlowRefs,
    );
    appendRepeatedOptions(
      cliArgs,
      "--exclude-process-id",
      options.excludeProcessId || options.excludeProcessIds,
    );
    appendOption(cliArgs, "--process-limit", options.processLimit);
    appendOption(cliArgs, "--out-dir", outDir);

    const { cliBin, cli, spawnArgs, exitCode, report, stderr } = runJsonCli(
      cliArgs,
      "tiangong-lca dataset curation-queue build did not emit JSON.",
    );
    return {
      ...report,
      foundry_wrapper: {
        command: cliBin,
        executable: cli.command,
        args: spawnArgs,
        cli_args: cliArgs,
        cli_package: cli.package,
        exit_code: exitCode,
        stderr,
        owner: "tiangong-lca-cli",
      },
    };
  }

  function runDatasetPatchApply(options: CliWrapperOptions): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-patch-apply",
        wraps: "tiangong-lca dataset patch apply",
        usage: [
          "node scripts/foundry.mjs dataset-patch-apply --input <rows.jsonl> --patch <ai-patches.json> --out <patched.jsonl> --out-dir <apply-dir>",
          "node scripts/foundry.mjs dataset-patch-apply --input ./rows/processes.jsonl --patch ./curation/patches.json --out ./rows/processes.patched.jsonl --out-dir ./patch-apply --authoring-package-dir ./curation-gate/ai-authoring-packages --require-action-item-closure",
        ],
        foundry_wrapper: {
          exit_code: 0,
          owner: "tiangong-lca-cli",
          stage: "post_ai_authoring_deterministic_apply",
        },
      };
    }

    const input = options.input || options.rowsFile || options.rows;
    const patch = options.patch || options.patchFile || options.patches || options.suggestions;
    const outDir = (options.outDir || ".foundry/workspaces/dataset-patch-apply") as string;
    const out = options.out || options.outFile || path.join(outDir, "patched-rows.jsonl");
    const cliArgs = ["dataset", "patch", "apply", "--json"];
    appendOption(cliArgs, "--input", input);
    appendOption(cliArgs, "--patch", patch);
    appendOption(cliArgs, "--out", out);
    appendOption(cliArgs, "--out-dir", outDir);
    appendOption(
      cliArgs,
      "--authoring-package-dir",
      options.authoringPackageDir || options.authoringPackagesDir,
    );
    if (options.requireAuthoringPackage === true || options.requireAuthoringPackage === "true") {
      cliArgs.push("--require-authoring-package");
    }
    if (options.requireActionItemClosure === true || options.requireActionItemClosure === "true") {
      cliArgs.push("--require-action-item-closure");
    }

    const { cliBin, cli, spawnArgs, exitCode, report, stderr } = runJsonCli(
      cliArgs,
      "tiangong-lca dataset patch apply did not emit JSON.",
    );
    return {
      ...report,
      foundry_wrapper: {
        command: cliBin,
        executable: cli.command,
        args: spawnArgs,
        cli_args: cliArgs,
        cli_package: cli.package,
        exit_code: exitCode,
        stderr,
        owner: "tiangong-lca-cli",
        stage: "post_ai_authoring_deterministic_apply",
        remote_write_mode: "read-only",
      },
    };
  }

  return {
    runDatasetCurationQueueBuild,
    runDatasetPatchApply,
  };
}
