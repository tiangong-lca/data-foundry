import { createHash } from "node:crypto";

// #144 changes only the maintained skill owner. Bind the entire reviewed
// capability and derived route so unrelated gate/contract changes remain visible.
const capabilityHashes = new Set([
  "6ef94a922fc0921e7ddcfd7585a919946bdb85c4aea5289b9f4d5ab559e98547",
  "308d91565b39f88de73f117d02a58f6a0fb465d9081fc7189adb2e0110051701",
]);
const routeHashes = new Set([
  "dbd52f0603a97b696c285573112cbfc6dcd2fd515957c24449b5e15764090d4a",
  "578a31dd55214838f2d247abf6d9d95f32bff54a895e5a217d7e07d01eda2a94",
]);

export function normalizeGoldenSkillOwnership(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const ordered = Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
  const digest = createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
  if (capabilityHashes.has(digest)) return { ...value, owner_project: "<reviewed-skill-owner>" };
  if (routeHashes.has(digest))
    return { ...value, owner_projects: ["<reviewed-skill-route-owners>"] };
  return value;
}
