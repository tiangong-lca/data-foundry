import assert from "node:assert/strict";
import test from "node:test";
import { createBundleSampleUtils } from "../../scripts/lib/bundle-sample-utils.ts";

// Minimal stubs for the eight dependencies buildLibraryContactPayload touches.
function utils() {
  const dependencies = {
    asText: (value: unknown) =>
      typeof value === "string" ? value.trim() : value == null ? "" : String(value),
    deterministicUuid: () => "deterministic-minted-id",
    multiLang: (text: string, lang: string | undefined) => ({
      "@xml:lang": lang,
      "#text": text,
    }),
    canonicalSourceReferenceForRelation: () => null,
    cloneJson: <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
    sourceReferenceSnapshot: (reference: unknown) => {
      const record = reference as Record<string, unknown> | null;
      return {
        ref_object_id: record?.["@refObjectId"] ?? null,
        version: record?.["@version"] ?? null,
        short_description: "",
      };
    },
    contactGlobalReference: ({ id, version }: { id: string; version: string }) => ({
      "@refObjectId": id,
      "@version": version,
    }),
    nowIso: () => "2026-06-29T00:00:00.000Z",
  } as unknown as Parameters<typeof createBundleSampleUtils>[0];
  return createBundleSampleUtils(dependencies);
}

// Requirement 1 (2026-06-29): the worldsteel runner reuses the packaged worldsteel
// contact (d5710976) as the shared library contact instead of minting a synthetic
// foundry contact. The library-prefixed contact id/version must win.
test("buildLibraryContactPayload reuses an explicit library contact id/version", () => {
  const payload = utils().buildLibraryContactPayload({
    profile: "worldsteel",
    libraryContactId: "d5710976-d600-11da-a94d-0800200c9a66",
    libraryContactVersion: "20.20.002",
    libraryName: "World Steel Association",
    libraryShortName: "worldsteel",
    libraryWebsite: "https://www.worldsteel.org",
  });
  const di = payload.contactDataSet.contactInformation.dataSetInformation;
  assert.equal(di["common:UUID"], "d5710976-d600-11da-a94d-0800200c9a66");
  assert.equal(di["common:name"]["#text"], "World Steel Association");
  assert.equal(
    payload.contactDataSet.administrativeInformation.publicationAndOwnership[
      "common:dataSetVersion"
    ],
    "20.20.002",
  );
  // self-reference (ownership) must also carry the reused identity
  assert.equal(
    payload.contactDataSet.administrativeInformation.publicationAndOwnership[
      "common:referenceToOwnershipOfDataSet"
    ]["@refObjectId"],
    "d5710976-d600-11da-a94d-0800200c9a66",
  );
});

test("buildLibraryContactPayload mints a deterministic id when none is supplied", () => {
  const payload = utils().buildLibraryContactPayload({
    profile: "worldsteel",
    libraryName: "X",
    libraryWebsite: "https://x",
  });
  assert.equal(
    payload.contactDataSet.contactInformation.dataSetInformation["common:UUID"],
    "deterministic-minted-id",
  );
});

// A non-BAFU profile must NEVER inherit BAFU/FOEN contact details (email or the
// "Governmental organisations" category) — those are filled from the importing
// organisation's own metadata/research, not copied from BAFU.
test("buildLibraryContactPayload does not leak BAFU email/category for non-bafu profiles", () => {
  const di = utils().buildLibraryContactPayload({
    profile: "worldsteel",
    libraryName: "World Steel Association",
    libraryShortName: "worldsteel",
    libraryWebsite: "https://www.worldsteel.org",
    email: "steel@worldsteel.org",
    contactClassification: [
      { "@level": "0", "@classId": "2", "#text": "Organisations" },
      { "@level": "1", "@classId": "2.4", "#text": "Other organisations" },
    ],
    contactAddress: "worldsteel, Avenue de Tervueren 270, 1150 Brussels, Belgium",
  }).contactDataSet.contactInformation.dataSetInformation;
  assert.equal(di.email, "steel@worldsteel.org");
  assert.notEqual(di.email, "info@bafu.admin.ch");
  const classes = di.classificationInformation["common:classification"]["common:class"];
  assert.equal(classes[1]["#text"], "Other organisations");
  assert.equal(classes[1]["@classId"], "2.4");
  assert.ok(!JSON.stringify(di).includes("Governmental organisations"));
  assert.ok(!JSON.stringify(di).includes("bafu.admin.ch"));
  assert.ok(!JSON.stringify(di).includes("Bern"));
});

// A non-bafu profile that supplies no email/classification must fall back to neutral,
// non-BAFU values (empty email, generic "Other organisations"), never FOEN strings.
test("buildLibraryContactPayload non-bafu fallback is neutral, not BAFU", () => {
  const di = utils().buildLibraryContactPayload({
    profile: "worldsteel",
    libraryName: "X",
    libraryWebsite: "https://x",
  }).contactDataSet.contactInformation.dataSetInformation;
  assert.equal(di.email, "");
  const classes = di.classificationInformation["common:classification"]["common:class"];
  assert.equal(classes[1]["#text"], "Other organisations");
  assert.ok(!JSON.stringify(di).includes("bafu.admin.ch"));
});

// The BAFU profile keeps its FOEN defaults (unchanged behavior).
test("buildLibraryContactPayload keeps FOEN defaults for the bafu profile", () => {
  const di = utils().buildLibraryContactPayload({ profile: "bafu" }).contactDataSet
    .contactInformation.dataSetInformation;
  assert.equal(di.email, "info@bafu.admin.ch");
  const classes = di.classificationInformation["common:classification"]["common:class"];
  assert.equal(classes[1]["#text"], "Governmental organisations");
});
