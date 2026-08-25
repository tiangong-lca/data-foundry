import assert from "node:assert/strict";
import test from "node:test";

import { bundleRowTypes } from "../../scripts/lib/bundle-row-types.ts";
import { asText, ensureArray } from "../../scripts/lib/import-curation/internal/runtime-io.ts";
import { createTidasRowUtils } from "../../scripts/lib/tidas-row-utils.ts";

type FlowPayloadFixture = {
  flowDataSet: {
    flowInformation: {
      dataSetInformation: {
        typeOfDataSet: string;
        classificationInformation: {
          "common:classification": {
            "common:class": Array<Record<string, string>>;
          };
        };
      };
    };
    modellingAndValidation?: {
      LCIMethod: { typeOfDataSet: string };
    };
  };
};

function createUtils(writes = new Map<string, string>()) {
  return createTidasRowUtils({
    asText,
    bundleRowTypes,
    cloneJson: <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
    ensureArray,
    writeText: (filePath: string, text: string) => writes.set(filePath, text),
  });
}

test("TIDAS row utility factory preserves its complete helper surface", () => {
  assert.deepEqual(Object.keys(createUtils()).sort(), [
    "bundleClassificationPath",
    "cleanEcoSpoldNameText",
    "contactGlobalReference",
    "datasetIdentity",
    "datasetRowsFileStem",
    "flowClassificationSchemaType",
    "flowTypeOfDataSet",
    "isConvertedDefaultClassification",
    "isObjectEmpty",
    "languageForText",
    "multiLang",
    "normalizeTidasLanguageCode",
    "pathExpression",
    "preferredSourceLanguageText",
    "printJson",
    "rewriteContactReferences",
    "sanitizePlaceholderText",
    "textValue",
    "writeJsonLines",
  ]);
});

test("row stems, multilingual helpers, language selection, and invalid tags remain stable", () => {
  const utils = createUtils();
  assert.equal(utils.datasetRowsFileStem("contact"), "contacts");
  assert.equal(utils.datasetRowsFileStem("FLOWPROPERTY"), "flowproperties");
  assert.equal(utils.datasetRowsFileStem("custom"), "customs");
  assert.equal(utils.datasetRowsFileStem(null), "nulls");
  assert.deepEqual(utils.multiLang(" text ", "DE"), {
    "@xml:lang": "de",
    "#text": "text",
  });
  assert.throws(() => utils.multiLang("text", "en-US"), /TIDAS Languages enumeration/u);
  assert.equal(utils.languageForText("中文", "de"), "zh");
  assert.equal(utils.languageForText("Latin", "DE"), "de");
  assert.equal(utils.languageForText("", "zh"), "zh");
  assert.equal(utils.preferredSourceLanguageText(["中文", " English ", "Deutsch"]), "English");
  assert.equal(utils.preferredSourceLanguageText(["中文", "汉字"]), "中文");
  assert.equal(utils.preferredSourceLanguageText(null), "");
});

test("contact references and dataset identities preserve exact roots, ids, versions, and invalids", () => {
  const utils = createUtils();
  assert.deepEqual(
    utils.contactGlobalReference({
      id: "contact-id",
      version: "01.00.000",
      shortDescription: " Owner ",
      language: "en",
    }),
    {
      "@type": "contact data set",
      "@refObjectId": "contact-id",
      "@version": "01.00.000",
      "@uri": "../contacts/contact-id.json",
      "common:shortDescription": { "@xml:lang": "en", "#text": "Owner" },
    },
  );
  for (const [type, config] of Object.entries(bundleRowTypes)) {
    const payload = {
      [config.rootKey]: {
        [config.informationKey]: {
          dataSetInformation: { "common:UUID": `${type}-id` },
        },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "02.03.004" },
        },
      },
    };
    assert.deepEqual(utils.datasetIdentity(payload, type), {
      id: `${type}-id`,
      version: "02.03.004",
    });
  }
  assert.deepEqual(utils.datasetIdentity({}, "flow"), { id: null, version: null });
  assert.deepEqual(utils.datasetIdentity(null, "flow"), { id: null, version: null });
  assert.deepEqual(utils.datasetIdentity([], "flow"), { id: null, version: null });
  assert.deepEqual(utils.datasetIdentity({}, "unknown"), { id: null, version: null });
});

test("contact rewrites recurse through arrays, preserve non-contacts, clone descriptions, and report stats", () => {
  const utils = createUtils();
  const contactRef = utils.contactGlobalReference({
    id: "new-contact",
    version: "02.00.000",
    shortDescription: "New owner",
  });
  const payload = {
    owner: {
      "@type": "contact data set",
      "@refObjectId": "old-contact",
      "@version": "01.00.000",
      "common:shortDescription": { "#text": "Old owner" },
    },
    nested: [
      {
        reviewer: {
          "@type": "CONTACT DATA SET",
          "@refObjectId": "reviewer",
          "common:shortDescription": "Reviewer text",
        },
      },
      { source: { "@type": "source data set", "@refObjectId": "source" } },
    ],
  };
  const stats = {
    rewritten: 0,
    previous_ids: new Set<string>(),
    previous_descriptions: new Set<string>(),
  };
  utils.rewriteContactReferences(payload, contactRef, stats);
  assert.equal(stats.rewritten, 2);
  assert.deepEqual([...stats.previous_ids], ["old-contact", "reviewer"]);
  assert.deepEqual([...stats.previous_descriptions], ["Old owner", "Reviewer text"]);
  assert.equal(payload.owner["@refObjectId"], "new-contact");
  const reviewer = payload.nested[0] as { reviewer: Record<string, unknown> };
  const source = payload.nested[1] as { source: Record<string, unknown> };
  assert.equal(reviewer.reviewer["@refObjectId"], "new-contact");
  assert.equal(source.source["@refObjectId"], "source");
  assert.notStrictEqual(
    payload.owner["common:shortDescription"],
    contactRef["common:shortDescription"],
  );
});

test("placeholder, path, object, and text helpers preserve exact coercion and counters", () => {
  const utils = createUtils();
  const stats = { placeholder_text_replacements: 0 };
  assert.equal(utils.pathExpression(["root", 2, "field"]), "root.2.field");
  assert.equal(utils.isObjectEmpty({}), true);
  assert.equal(utils.isObjectEmpty({ value: 1 }), false);
  assert.equal(utils.isObjectEmpty([]), false);
  assert.equal(utils.isObjectEmpty(null), null);
  assert.equal(utils.cleanEcoSpoldNameText(" x Product {CH}  name "), "Product name");
  assert.equal(
    utils.sanitizePlaceholderText("0 Not declared in source package", ["value"], stats),
    "Not specified",
  );
  assert.equal(utils.sanitizePlaceholderText(" x Product {CH}", ["baseName"], stats), "Product");
  assert.equal(utils.sanitizePlaceholderText("kept", ["value"], stats), "kept");
  assert.equal(stats.placeholder_text_replacements, 2);
  assert.equal(utils.textValue(" text "), "text");
  assert.equal(utils.textValue({ "#text": " nested " }), "nested");
  assert.equal(utils.textValue([null, { value: " fallback " }]), "fallback");
  assert.equal(utils.textValue(42), "");
});

test("classification and flow helpers preserve paths, defaults, and schema selection", () => {
  const utils = createUtils();
  const payload: FlowPayloadFixture = {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          typeOfDataSet: "Product flow",
          classificationInformation: {
            "common:classification": {
              "common:class": [
                { "@level": "0", "@classId": "1", "#text": "Root" },
                { "@level": "1", "@classId": "2", "#text": "Leaf" },
              ],
            },
          },
        },
      },
    },
  };
  assert.equal(utils.bundleClassificationPath(payload, "flow"), "Root > Leaf");
  assert.equal(utils.flowTypeOfDataSet(payload), "Product flow");
  assert.equal(utils.flowClassificationSchemaType(payload), "flow-product");
  payload.flowDataSet.modellingAndValidation = { LCIMethod: { typeOfDataSet: "Elementary flow" } };
  assert.equal(utils.flowTypeOfDataSet(payload), "Elementary flow");
  assert.equal(utils.flowClassificationSchemaType(payload), "flow-elementary");
  assert.equal(utils.bundleClassificationPath({}, "flow"), "");
  assert.equal(
    utils.isConvertedDefaultClassification(
      "Other service activities > Activities of membership organizations > Activities of other membership organizations > Activities of other membership organizations n.e.c.",
    ),
    true,
  );
  assert.equal(utils.isConvertedDefaultClassification("Custom"), false);
});

test("JSONL and print helpers preserve exact output bytes", () => {
  const writes = new Map<string, string>();
  const utils = createUtils(writes);
  utils.writeJsonLines("rows.jsonl", [{ id: 1 }, "two"]);
  utils.writeJsonLines("empty.jsonl", []);
  assert.equal(writes.get("rows.jsonl"), '{"id":1}\n"two"\n');
  assert.equal(writes.get("empty.jsonl"), "");

  const logs: string[] = [];
  const original = console.log;
  console.log = (value?: unknown) => logs.push(String(value));
  try {
    utils.printJson({ b: 2, a: 1 });
  } finally {
    console.log = original;
  }
  assert.deepEqual(logs, ['{\n  "b": 2,\n  "a": 1\n}']);
});
