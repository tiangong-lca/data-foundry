export type ParsedScalar = boolean | number | string;

export type ParsedArgs = {
  _: string[];
  [key: string]: ParsedScalar | ParsedScalar[];
};

export function parseScalar(value: unknown): ParsedScalar {
  const text = String(value ?? "").trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/u.test(text)) return Number(text);
  return text.replace(/^["']|["']$/gu, "");
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: ParsedArgs = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined && value && !String(value).startsWith("--")) {
      index += 1;
    }
    const parsed =
      inlineValue !== undefined || (value && !String(value).startsWith("--"))
        ? parseScalar(value)
        : true;
    if (Object.hasOwn(options, key)) {
      options[key] = Array.isArray(options[key])
        ? [...options[key], parsed]
        : [options[key], parsed];
    } else {
      options[key] = parsed;
    }
  }
  return options;
}
