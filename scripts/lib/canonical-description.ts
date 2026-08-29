export type CanonicalDescriptionJsonValue =
  | string
  | number
  | boolean
  | null
  | CanonicalDescriptionJsonValue[]
  | { [key: string]: CanonicalDescriptionJsonValue };

export type CanonicalDescription =
  string | CanonicalDescriptionJsonValue[] | { [key: string]: CanonicalDescriptionJsonValue };

export interface CanonicalDescriptionPair {
  reference: CanonicalDescription | null;
  ledger: CanonicalDescription | null;
}

function invalidDescription(path: string): never {
  throw new TypeError(`Canonical short description contains a non-JSON value at ${path}.`);
}

function cloneJsonValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): CanonicalDescriptionJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) return invalidDescription(path);
    return value;
  }
  if (typeof value !== "object") return invalidDescription(path);
  if (ancestors.has(value)) return invalidDescription(path);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.some(
          (key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key)),
        )
      ) {
        return invalidDescription(path);
      }
      const output: CanonicalDescriptionJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          return invalidDescription(`${path}[${index}]`);
        }
        output.push(cloneJsonValue(descriptor.value, `${path}[${index}]`, ancestors));
      }
      return output;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalidDescription(path);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output: { [key: string]: CanonicalDescriptionJsonValue } = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") return invalidDescription(path);
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        return invalidDescription(`${path}.${key}`);
      }
      Object.defineProperty(output, key, {
        value: cloneJsonValue(descriptor.value, `${path}.${key}`, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

export function cloneCanonicalDescription(value: unknown): CanonicalDescription | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && (typeof value !== "object" || value === null)) {
    return invalidDescription("$");
  }
  return cloneJsonValue(value, "$", new WeakSet()) as CanonicalDescription;
}

export function canonicalDescriptionPair(
  value: unknown,
  normalizeText: (text: string) => string,
): CanonicalDescriptionPair {
  const reference = value ? cloneCanonicalDescription(value) : null;
  return {
    reference,
    ledger: typeof reference === "string" ? normalizeText(reference) || null : reference,
  };
}
