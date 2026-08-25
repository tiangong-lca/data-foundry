import test from "node:test";
import { createSourceSemanticUtils } from "../../scripts/lib/source-semantics.ts";
import { assert } from "../fixtures/foundry-core.mjs";

function utils() {
  const asText = (value) => {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("; ");
    if (typeof value === "object") return asText(value["#text"] ?? value.value ?? value.id);
    return "";
  };
  return createSourceSemanticUtils({
    asText,
    bundleClassificationPath: () => null,
    cloneJson: (value) => JSON.parse(JSON.stringify(value)),
    datasetIdentity: () => null,
    deterministicUuid: (seed) => `uuid:${seed}`,
    languageForText: () => "en",
    multiLang: (text, lang = "en") => ({ "@xml:lang": lang, "#text": text }),
    pathExpression: (parts) => parts.join("."),
    repoRelativeMaybe: (value) => value,
    textValue: asText,
  });
}

test("BAFU fallback source payload nests the format reference inside dataEntryBy", () => {
  const payload = utils().buildBafuFallbackSourcePayload({
    contactReference: { "@refObjectId": "contact-1" },
    timestamp: "2025-01-01T00:00:00.000Z",
  });
  const admin = payload.sourceDataSet.administrativeInformation;
  assert.ok(
    admin.dataEntryBy["common:referenceToDataSetFormat"],
    "dataEntryBy must carry common:referenceToDataSetFormat",
  );
  assert.equal(admin.dataEntryBy["common:timeStamp"], "2025-01-01T00:00:00.000Z");
  assert.equal(
    admin["common:referenceToDataSetFormat"],
    undefined,
    "format reference must not sit at the administrativeInformation root",
  );
  assert.equal(admin.publicationAndOwnership["common:dataSetVersion"], "00.00.001");
});

test("BAFU fallback source payload keeps the format reference without a timestamp", () => {
  const payload = utils().buildBafuFallbackSourcePayload({});
  const dataEntryBy = payload.sourceDataSet.administrativeInformation.dataEntryBy;
  assert.ok(dataEntryBy["common:referenceToDataSetFormat"]);
  assert.equal(dataEntryBy["common:timeStamp"], undefined);
});

test("buildBafuFallbackSourcePayload equals the profile-aware builder with profile=bafu", () => {
  const u = utils();
  const viaAlias = u.buildBafuFallbackSourcePayload({ timestamp: "2025-01-01T00:00:00.000Z" });
  const viaBuilder = u.buildDatabaseFallbackSourcePayload({
    profile: "bafu",
    timestamp: "2025-01-01T00:00:00.000Z",
  });
  assert.deepEqual(viaBuilder, viaAlias, "bafu profile must be byte-identical to the legacy alias");
});

test("USLCI database fallback source cites the USLCI database, never BAFU", () => {
  const payload = utils().buildDatabaseFallbackSourcePayload({ profile: "uslci" });
  const di = payload.sourceDataSet.sourceInformation.dataSetInformation;
  assert.equal(di["common:shortName"]["#text"], "U.S. Life Cycle Inventory Database (USLCI)");
  assert.ok(/USLCI/.test(di.sourceCitation), "citation must name USLCI");
  assert.ok(!/BAFU/.test(JSON.stringify(payload)), "USLCI fallback must contain no BAFU text");
  assert.equal(
    di.classificationInformation["common:classification"]["common:class"]["#text"],
    "Databases",
  );
  // USLCI id must differ from the BAFU fallback id (no collision with BAFU's source).
  const bafuId = utils().buildDatabaseFallbackSourcePayload({ profile: "bafu" }).sourceDataSet
    .sourceInformation.dataSetInformation["common:UUID"];
  assert.notEqual(di["common:UUID"], bafuId, "USLCI fallback id must not equal BAFU's");
});

test("worldsteel database fallback source cites worldsteel, never BAFU", () => {
  const payload = utils().buildDatabaseFallbackSourcePayload({ profile: "worldsteel" });
  const di = payload.sourceDataSet.sourceInformation.dataSetInformation;
  assert.equal(di["common:shortName"]["#text"], "worldsteel LCI database");
  assert.ok(/worldsteel/i.test(di.sourceCitation), "citation must name worldsteel");
  assert.ok(!/BAFU/.test(JSON.stringify(payload)), "worldsteel fallback must contain no BAFU text");
  assert.equal(
    di.classificationInformation["common:classification"]["common:class"]["#text"],
    "Databases",
  );
  // worldsteel id must differ from both the BAFU and USLCI fallback ids.
  const bafuId = utils().buildDatabaseFallbackSourcePayload({ profile: "bafu" }).sourceDataSet
    .sourceInformation.dataSetInformation["common:UUID"];
  const uslciId = utils().buildDatabaseFallbackSourcePayload({ profile: "uslci" }).sourceDataSet
    .sourceInformation.dataSetInformation["common:UUID"];
  assert.notEqual(di["common:UUID"], bafuId, "worldsteel fallback id must not equal BAFU's");
  assert.notEqual(di["common:UUID"], uslciId, "worldsteel fallback id must not equal USLCI's");
});
