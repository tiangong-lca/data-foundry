export type ImportLedgerCommandFactoryDependencies<TRunner> = {
  runDatasetImportLedgerReport: TRunner;
};

export type ImportLedgerCommands<TRunner> = {
  runDatasetImportLedgerReport: TRunner;
};

export function createImportLedgerCommands<TRunner>({
  runDatasetImportLedgerReport,
}: ImportLedgerCommandFactoryDependencies<TRunner>): ImportLedgerCommands<TRunner> {
  return {
    runDatasetImportLedgerReport,
  };
}
