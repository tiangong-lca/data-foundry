import type { BafuNamePlan } from "./name-plan-contract.ts";

export interface JsonRecord {
  [key: string]: unknown;
}

export interface MarketMixPart {
  base_name: string;
  mix_location: string;
}

export function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

export function textFromMultilang(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = jsonRecord(value);
    return String(record["#text"] ?? record.text ?? "");
  }
  return "";
}

export function englishText(text: unknown): JsonRecord {
  return { "@xml:lang": "en", "#text": text };
}

export function normalizeLocationTokenCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function trailingLocationToken(value: unknown): { code: string; cleaned: string } | null {
  const text = String(value ?? "").trim();
  const match =
    /\s*\{(?<code>[A-Z0-9][A-Z0-9+&-]{1,30})\}\s*(?:[A-Z]\s*)?(?:-\s*(?<suffix>[A-Z0-9][A-Z0-9+&-]{1,30}))?\s*$/u.exec(
      text,
    );
  if (!match?.groups?.code) return null;
  const code = normalizeLocationTokenCode(match.groups.code);
  const suffix = normalizeLocationTokenCode(match.groups.suffix);
  if (suffix && suffix !== code) return null;
  return {
    code,
    cleaned: text.slice(0, match.index).trim(),
  };
}

export function stripTrailingLocationTokenText(
  value: unknown,
  expectedLocationCode: unknown = null,
): string {
  const text = String(value ?? "").trim();
  const token = trailingLocationToken(text);
  if (!token) return text;
  const expected = normalizeLocationTokenCode(expectedLocationCode);
  if (expected && token.code !== expected) return text;
  return token.cleaned;
}

export function stripGeneratedPrefixText(value: unknown): string {
  return String(value ?? "")
    .replace(/^\s*x{2,}\s+/iu, "")
    .trim();
}

export function removeTrailingLocationToken(
  value: unknown,
  expectedLocationCode: unknown = null,
): JsonRecord | null {
  const text = textFromMultilang(value).trim();
  const cleaned = stripTrailingLocationTokenText(text, expectedLocationCode);
  return cleaned && cleaned !== text ? englishText(cleaned) : null;
}

export function cleanProcessFunctionalUnitText(
  value: unknown,
  expectedLocationCode: unknown = null,
): JsonRecord | null {
  const text = textFromMultilang(value).trim();
  const expected = normalizeLocationTokenCode(expectedLocationCode);
  let cleaned = stripTrailingLocationTokenText(text, expectedLocationCode);
  if (expected) cleaned = cleaned.split(`{${expected}}`).join(" ");
  cleaned = cleaned
    .replace(/(^|\s)xx\s+/iu, "$1")
    .replace(/\s+/gu, " ")
    .replace(/\s+\|/gu, " |")
    .trim();
  return cleaned && cleaned !== text ? englishText(cleaned) : null;
}

export function cleanNamePlanPart(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+,/gu, ",")
    .replace(/,\s*/gu, ", ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function splitCommaDelimitedMarketMixPart(value: unknown): MarketMixPart | null {
  const parts = String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const marketMixIndex = parts.findIndex((part) => normalizeIdentityText(part) === "market mix");
  if (marketMixIndex < 0) return null;
  const remainingParts = parts.filter((_, index) => index !== marketMixIndex);
  if (remainingParts.length === 0) return null;
  return {
    base_name: cleanNamePlanPart(remainingParts.join(", ")),
    mix_location: "market mix",
  };
}

export function sourceLocatorMarkerInText(value: unknown): boolean {
  const text = String(value ?? "");
  return [
    /\b(?!(?:summer|winter|spring|autumn|fall)\s)[A-Z][A-Za-z]+(?:\s+et\s+al\.)?\s+(?:19|20)\d{2}\b/iu,
    /[\p{Script=Han}·]{2,12}\s*(?:19|20)\d{2}/u,
    /\b(?:Table|Tbl\.)\s*\d+[A-Za-z]?\b/iu,
    /表\s*\d+/u,
    /\b(?:Figure|Fig\.)\s*\d+[A-Za-z]?\b/iu,
    /图\s*\d+/u,
  ].some((regex) => regex.test(text));
}

export function stripSourceLocatorSuffix(value: unknown): string {
  return String(value ?? "")
    .replace(
      /\s*,?\s*(?:according to|as per|based on)\s+[A-Z][A-Za-z.'-]+(?:\s+et\s+al\.?)?\s+(?:19|20)\d{2}\b/giu,
      "",
    )
    .replace(/\s*,(?:\s*,)+/gu, ",")
    .replace(/^\s*,\s*/u, "")
    .replace(/\s*,\s*$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function recyclingShareDescriptor(value: unknown): string | null {
  const text = String(value ?? "");
  const percentMatch =
    /\brecycling\s+share\s+(?:(?:19|20)\d{2}\s*)?\(?\s*(?<percent>\d+(?:\.\d+)?)\s*%\s*(?:Rec\.)?\s*\)?/iu.exec(
      text,
    );
  return percentMatch?.groups?.percent ? `recycling share ${percentMatch.groups.percent}%` : null;
}

export function normalizeIdentityText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\\+/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function mergeExistingTreatmentRoute(
  nameSplit: BafuNamePlan | null,
  name: JsonRecord,
): BafuNamePlan | null {
  if (!nameSplit) return null;
  const existing = textFromMultilang(name.treatmentStandardsRoutes).trim();
  if (!existing || normalizeIdentityText(existing) === "source described route") return nameSplit;
  const currentTreatment = String(nameSplit.treatment ?? "").trim();
  if (nameSplit.clean_existing_treatment) {
    const parts = [...existing.split(","), ...currentTreatment.split(",")]
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => {
        const normalized = normalizeIdentityText(part);
        return (
          !["disposal route", "market"].includes(normalized) &&
          !sourceLocatorMarkerInText(part) &&
          !/\brecycling\s+share\b/iu.test(part) &&
          !/^(?:at|to)\s+(?:plant|user|grid|market|consumer|sawmill|warehouse|regional storage)$/iu.test(
            part,
          )
        );
      });
    const uniqueParts = [];
    const seen = new Set();
    for (const part of parts) {
      const key = normalizeIdentityText(part);
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueParts.push(part);
    }
    return { ...nameSplit, treatment: uniqueParts.join(", ") };
  }
  if (!currentTreatment) return { ...nameSplit, treatment: existing };
  if (normalizeIdentityText(currentTreatment).includes(normalizeIdentityText(existing))) {
    return nameSplit;
  }
  return { ...nameSplit, treatment: `${currentTreatment}, ${existing}` };
}
