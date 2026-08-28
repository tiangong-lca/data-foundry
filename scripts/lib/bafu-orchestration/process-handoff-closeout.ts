interface ProcessHandoffCloseoutAdapter {
  processExecutable: string;
  foundryEntryPath: string;
  repoRelative: (filePath: string | null | undefined) => string;
}

interface ProcessHandoffCloseoutInput {
  handoffPlanPath: string;
  commitReportPath: string;
  verifyReportPath: string;
  outDir: string;
  ledgerDir: string;
}

export function closeoutCommand(
  {
    handoffPlanPath,
    commitReportPath,
    verifyReportPath,
    outDir,
    ledgerDir,
  }: ProcessHandoffCloseoutInput,
  adapter: ProcessHandoffCloseoutAdapter,
): string[] {
  return [
    adapter.processExecutable,
    adapter.foundryEntryPath,
    "dataset-post-write-closeout",
    "--handoff-plan",
    adapter.repoRelative(handoffPlanPath),
    "--commit-report",
    adapter.repoRelative(commitReportPath),
    "--post-write-verify-report",
    adapter.repoRelative(verifyReportPath),
    "--out-dir",
    adapter.repoRelative(outDir),
    "--ledger-dir",
    adapter.repoRelative(ledgerDir),
  ];
}
