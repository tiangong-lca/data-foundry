export function processRowWithDeferredTrace(processId: string) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          "common:other": {
            "tiangongfoundry:unresolvedTrace": [
              {
                status: "unresolved_deferred",
                action_item_code: "source_system_boilerplate",
                blocked_path: "processDataSet.processInformation.dataSetInformation.generalComment",
                reason:
                  "The source package did not provide a safe source-language value for this optional descriptive field.",
                evidence: {
                  source: "ai-authoring-package",
                  quote_or_trace:
                    "source_row.processDataSet.processInformation.dataSetInformation.generalComment absent",
                },
                next_action:
                  "Review the original source package if a richer user-facing description is later required.",
              },
            ],
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

export function processRowWithDefaultClassification(processId: string) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Heat, from natural gas",
            },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                {
                  "@level": "0",
                  "@classId": "T",
                  "#text": "Other service activities",
                },
                {
                  "@level": "1",
                  "@classId": "94",
                  "#text": "Activities of membership organizations",
                },
                {
                  "@level": "2",
                  "@classId": "949",
                  "#text": "Activities of other membership organizations",
                },
                {
                  "@level": "3",
                  "@classId": "9499",
                  "#text": "Activities of other membership organizations n.e.c.",
                },
              ],
            },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

export function flowRowWithClassification({
  flowId,
  typeOfDataSet,
  classification,
}: {
  flowId: string;
  typeOfDataSet: string;
  classification: unknown;
}) {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Natural gas",
            },
            treatmentStandardsRoutes: {
              "@xml:lang": "en",
              "#text": "Not specified",
            },
            mixAndLocationTypes: {
              "@xml:lang": "en",
              "#text": "Not specified",
            },
          },
          classificationInformation: classification,
        },
      },
      modellingAndValidation: {
        LCIMethod: {
          typeOfDataSet,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

export function processRowWithInvalidLocation(processId: string) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Heat, from natural gas",
            },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                {
                  "@level": "0",
                  "@classId": "D",
                  "#text": "Electricity, gas, steam and air conditioning supply",
                },
              ],
            },
          },
        },
        geography: {
          locationOfOperationSupplyOrProduction: {
            "@location": "Invalid region",
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

export function processRowWithInvalidAnnualSupply(processId: string) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Heat, from natural gas",
            },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                {
                  "@level": "0",
                  "@classId": "D",
                  "#text": "Electricity, gas, steam and air conditioning supply",
                },
              ],
            },
          },
        },
      },
      modellingAndValidation: {
        dataSourcesTreatmentAndRepresentativeness: {
          dataCutOffAndCompletenessPrinciples: {
            "@xml:lang": "en",
            "#text": "Not specified",
          },
          referenceToDataSource: {
            "@refObjectId": "11111111-2222-4333-8444-555555555555",
            "@type": "source data set",
          },
          annualSupplyOrProductionVolume: {
            "@xml:lang": "en",
            "#text": "Not specified",
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

export function processRowWithFlowRef(processId: string, flowId: string) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Heat production",
            },
          },
        },
      },
      exchanges: {
        exchange: [
          {
            exchangeDirection: "Input",
            referenceToFlowDataSet: {
              "@refObjectId": flowId,
              "@version": "00.00.001",
            },
          },
        ],
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

export function processRowWithOnlyOutputExchange(processId: string) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Recovered solvent production",
            },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                { "@level": "0", "@classId": "C", "#text": "Manufacturing" },
                {
                  "@level": "1",
                  "@classId": "10",
                  "#text": "Manufacture of food products",
                },
                {
                  "@level": "2",
                  "@classId": "108",
                  "#text": "Manufacture of prepared animal feeds",
                },
                {
                  "@level": "3",
                  "@classId": "1080",
                  "#text": "Manufacture of prepared animal feeds",
                },
              ],
            },
          },
        },
      },
      exchanges: {
        exchange: [
          {
            exchangeDirection: "Output",
            meanAmount: 1,
            resultingAmount: 1,
          },
        ],
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

export function flowRow(flowId: string) {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Natural gas",
            },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

export function sourceRow(sourceId: string) {
  return {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": sourceId,
          "common:shortName": {
            "@xml:lang": "en",
            "#text": "Fixture report",
          },
        },
        sourceCitation: "Fixture report, 2026",
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}
