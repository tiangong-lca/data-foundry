export type AuthoritativeCommand = {
  executable: string;
  argv: string[];
  display?: string;
};

export function acceptedRemoteDifferencePolicy(input: { accountMode: string }): {
  traceHashOnly: boolean;
  foreignStateZeroReference: boolean;
} {
  const productionTest = input.accountMode === "production-test";
  return {
    traceHashOnly: !productionTest,
    foreignStateZeroReference: false,
  };
}

export function assertAuthoritativeCommand(value: AuthoritativeCommand): {
  executable: string;
  argv: string[];
} {
  const executable = String(value?.executable ?? "").trim();
  const argv = Array.isArray(value?.argv) ? value.argv.map((item) => String(item)) : [];
  if (!executable || argv.length === 0 || argv.some((item) => !item)) {
    throw new Error("Executable command requires a non-empty executable and argv array.");
  }
  return { executable, argv };
}
