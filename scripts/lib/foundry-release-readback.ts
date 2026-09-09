/** Only transport visibility failures may be retried; verification errors remain terminal. */
export class TransientFoundryReadbackError extends Error {}
export async function readBackWithBudget<T>(
  read: () => Promise<T>,
  options: {
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
    budgetMs?: number;
  } = {},
): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const budget = options.budgetMs ?? 240000;
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 240000)
    throw new Error("Invalid registry readback budget.");
  const deadline = now() + budget;
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof TransientFoundryReadbackError) || attempt >= 10) throw error;
      const delay = Math.min(5000 * 2 ** attempt, 60000);
      if (now() + delay >= deadline) throw error;
      await sleep(delay);
      if (now() >= deadline) throw error;
    }
  }
}
