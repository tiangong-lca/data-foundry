/** Display text only; authoritative canonical descriptions retain their JSON value. */
export function referenceDescriptionText(
  reference: unknown,
  asText: (value: unknown) => string,
): string {
  const value = reference as Record<string, unknown> | null | undefined;
  const description = value?.["common:shortDescription"] ?? value?.shortDescription;
  if (typeof description === "string") return description.trim();
  if (description && typeof description === "object" && !Array.isArray(description)) {
    const item = description as Record<string, unknown>;
    return asText(item["#text"] ?? item.value);
  }
  return "";
}
