const ownerId = "44444444-4444-4444-8444-444444444444";
const formatId = "33333333-3333-4333-8333-333333333333";
const complianceId = "22222222-2222-4222-8222-222222222222";
export const supportFixtureReferences = [
  { table: "contacts", id: ownerId, version: "00.00.001" },
  { table: "sources", id: formatId, version: "00.00.001" },
  { table: "sources", id: complianceId, version: "00.00.001" },
];
const text = (value: string) => ({ "@xml:lang": "en", "#text": value });
const reference = (type: string, id: string, name: string) => ({
  "@type": `${type} data set`,
  "@refObjectId": id,
  "@version": "00.00.001",
  "@uri": `https://example.invalid/${type}/${id}`,
  "common:shortDescription": text(name),
});
function root(type: "UnitGroup" | "FlowProperty") {
  return {
    "@xmlns": `http://lca.jrc.it/ILCD/${type}`,
    "@xmlns:common": "http://lca.jrc.it/ILCD/Common",
    "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "@version": "1.1",
    "@xsi:schemaLocation": `http://lca.jrc.it/ILCD/${type} ../../schemas/ILCD_${type}DataSet.xsd`,
    modellingAndValidation: {
      complianceDeclarations: {
        compliance: {
          "common:referenceToComplianceSystem": reference(
            "source",
            complianceId,
            "Fixture compliance system",
          ),
          "common:approvalOfOverallCompliance": "Not defined",
        },
      },
    },
    administrativeInformation: {
      dataEntryBy: {
        "common:timeStamp": "2026-09-01T00:00:00.000Z",
        "common:referenceToDataSetFormat": reference("source", formatId, "Fixture data format"),
      },
      publicationAndOwnership: {
        "common:dataSetVersion": "00.00.001",
        "common:referenceToOwnershipOfDataSet": reference(
          "contact",
          ownerId,
          "Fixture dataset owner",
        ),
      },
    },
  };
}
const information = (id: string, name: string, classification: string) => ({
  "common:UUID": id,
  "common:name": text(name),
  classificationInformation: {
    "common:classification": {
      "common:class": { "@level": "0", "@classId": "4", "#text": classification },
    },
  },
});

export function supportUnitGroupRow(id: string) {
  return {
    unitGroupDataSet: {
      ...root("UnitGroup"),
      unitGroupInformation: {
        dataSetInformation: information(id, "Units of fixture pulses", "Other unit groups"),
        quantitativeReference: { referenceToReferenceUnit: "0" },
      },
      units: { unit: [{ "@dataSetInternalID": "0", name: "fixture-pulse", meanValue: "1" }] },
    },
  };
}
export function supportFlowPropertyRow(id: string, unitGroupId: string) {
  return {
    flowPropertyDataSet: {
      ...root("FlowProperty"),
      flowPropertiesInformation: {
        dataSetInformation: information(id, "Fixture pulse count", "Other flow properties"),
        quantitativeReference: {
          referenceToReferenceUnitGroup: reference(
            "unit group",
            unitGroupId,
            "Units of fixture pulses",
          ),
        },
      },
    },
  };
}
