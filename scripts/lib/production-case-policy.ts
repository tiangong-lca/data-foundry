export type AuthoritativeCommand = {
  executable: string;
  argv: string[];
  display?: string;
};

export type FoundryAccountMode = "ordinary" | "production-test";

const PRODUCTION_TEST_IDENTITIES = new Set([
  "qgzvkongdjqiiamzbbts:c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
]);

export function accountModeForVerifiedIdentity(input: {
  projectRef: string;
  userId: string;
}): FoundryAccountMode {
  return PRODUCTION_TEST_IDENTITIES.has(`${input.projectRef}:${input.userId}`)
    ? "production-test"
    : "ordinary";
}

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
