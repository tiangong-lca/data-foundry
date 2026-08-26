export interface JsonRecord {
  [key: string]: unknown;
}

export interface SchemaPaths extends JsonRecord {
  processCategory: string;
  flowProductCategory: string;
  flowElementaryCategory: string;
  location: string;
  allClassification: string[];
}

export interface ClassificationRepairResult extends JsonRecord {
  repairs: JsonRecord[];
  unresolved: JsonRecord[];
  repairPath: string;
  unresolvedPath: string;
}

export interface ClassificationSchemaRepairAdapter {
  readonly fileExists: (filePath: string) => boolean;
  readonly readJson: (filePath: string) => unknown;
  readonly readJsonLines: (filePath: string) => unknown[];
  readonly writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
  readonly repoRelative: (filePath: string) => string;
  readonly normalizeSearchText: (value: unknown) => string;
  readonly pathJoin: (...parts: string[]) => string;
}

export interface ClassificationSchemaRepairService {
  readonly repair: (input: {
    decisionsFile: string;
    schemas: SchemaPaths;
    outDir: string;
  }) => ClassificationRepairResult;
}

interface SchemaClass {
  classId: string;
  level: string;
  text: string;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function assertAdapter(
  adapter: ClassificationSchemaRepairAdapter,
): ClassificationSchemaRepairAdapter {
  const functionKeys = [
    "fileExists",
    "readJson",
    "readJsonLines",
    "writeJsonLines",
    "repoRelative",
    "normalizeSearchText",
    "pathJoin",
  ] as const satisfies readonly (keyof ClassificationSchemaRepairAdapter)[];
  const missing = functionKeys.filter((key) => typeof adapter?.[key] !== "function");
  if (missing.length > 0) {
    throw new Error(
      `createClassificationSchemaRepairService missing dependencies: ${missing.join(", ")}`,
    );
  }
  return Object.freeze({ ...adapter });
}

export function createClassificationSchemaRepairService(
  runtimeAdapter: ClassificationSchemaRepairAdapter,
): ClassificationSchemaRepairService {
  const runtime = assertAdapter(runtimeAdapter);

  function schemaClasses(schemaFile: string): Map<string, SchemaClass> {
    const classes = new Map<string, SchemaClass>();
    const visit = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const record = jsonRecord(value);
      const properties = jsonRecord(record.properties);
      const classId = jsonRecord(properties["@classId"]).const;
      if (classId != null) {
        classes.set(String(classId), {
          classId: String(classId),
          level: String(jsonRecord(properties["@level"]).const ?? ""),
          text: String(jsonRecord(properties["#text"]).const ?? ""),
        });
      }
      for (const child of Object.values(value)) visit(child);
    };
    visit(runtime.readJson(schemaFile));
    return classes;
  }

  function categorySchemaForDecision(decision: JsonRecord, schemas: SchemaPaths): string | null {
    const type = String(decision.category_type || decision.schema_type || "").toLowerCase();
    if (type === "process") return schemas.processCategory;
    if (type === "flow-elementary") return schemas.flowElementaryCategory;
    if (type === "flow-product" || type === "flow" || type === "product") {
      return schemas.flowProductCategory;
    }
    return null;
  }

  function childClassesFor(classes: Map<string, SchemaClass>, parentCode: string): SchemaClass[] {
    const parent = classes.get(parentCode);
    const parentLevel = Number(parent?.level);
    if (!Number.isFinite(parentLevel)) return [];
    return [...classes.values()]
      .filter((entry) => {
        const level = Number(entry.level);
        return (
          Number.isFinite(level) &&
          level === parentLevel + 1 &&
          entry.classId.startsWith(parentCode) &&
          entry.classId !== parentCode
        );
      })
      .sort((left, right) => left.classId.localeCompare(right.classId));
  }

  function decisionEvidenceText(row: JsonRecord): string {
    const evidence = jsonRecord(row.evidence);
    const queue = jsonRecord(evidence.queue);
    const authoringContext = jsonRecord(queue.authoring_context);
    const libraryDecision = jsonRecord(evidence.library_decision);
    const sourceClassification = jsonRecord(queue.source_classification);
    return runtime.normalizeSearchText(
      [
        row.basis,
        row.code,
        row.selected_code,
        libraryDecision.basis,
        libraryDecision.source_name,
        sourceClassification.category,
        sourceClassification.localCategory,
        authoringContext.source_name,
        authoringContext.source_local_name,
        authoringContext.technology,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  function bestChildRepairCode(
    row: JsonRecord,
    parentCode: string,
    children: SchemaClass[],
  ): string | null {
    if (children.length === 0) return null;
    const text = decisionEvidenceText(row);
    if (parentCode === "351") {
      const mentionsDistribution = /\b(?:distribution|transmission)\b/u.test(text);
      const negatesDistribution =
        /\b(?:not|nor|without)\s+(?:include\s+)?(?:transport\s+)?(?:nor\s+)?distribution\b/u.test(
          text,
        );
      if (
        mentionsDistribution &&
        !negatesDistribution &&
        !/\b(?:production|generation)\b/u.test(text)
      ) {
        return children.find((child) => child.classId === "3513")?.classId ?? null;
      }
      const renewableOnly =
        /\b(?:renewable|wind|hydro|hydropower|photovoltaic|solar|biogas|wood)\b/u.test(text) &&
        !/\b(?:coal|diesel|gas|industrial gas|natural gas|nuclear|oil|non renewable|nonrenewable)\b/u.test(
          text,
        );
      if (renewableOnly) return children.find((child) => child.classId === "3512")?.classId ?? null;
      if (/\b(?:electricity|power|production|generation|plant|cogen|cogeneration)\b/u.test(text)) {
        return children.find((child) => child.classId === "3511")?.classId ?? null;
      }
    }

    let best: SchemaClass | null = null;
    let bestScore = -1;
    const tokens = new Set(text.split(" ").filter((token) => token.length > 2));
    for (const child of children) {
      const childTokens = runtime
        .normalizeSearchText(child.text)
        .split(" ")
        .filter((token) => token.length > 2);
      const score = childTokens.reduce((sum, token) => sum + (tokens.has(token) ? 1 : 0), 0);
      if (score > bestScore) {
        best = child;
        bestScore = score;
      }
    }
    return best?.classId ?? null;
  }

  function repair(input: {
    decisionsFile: string;
    schemas: SchemaPaths;
    outDir: string;
  }): ClassificationRepairResult {
    const rows = runtime.readJsonLines(input.decisionsFile).map(jsonRecord);
    const cache = new Map<string, Map<string, SchemaClass>>();
    const repairs: JsonRecord[] = [];
    const unresolved: JsonRecord[] = [];
    const repaired = rows.map((row) => {
      const schemaFile = categorySchemaForDecision(row, input.schemas);
      if (!schemaFile || !runtime.fileExists(schemaFile)) return row;
      if (!cache.has(schemaFile)) cache.set(schemaFile, schemaClasses(schemaFile));
      const classes = cache.get(schemaFile)!;
      const code = String(row.code ?? row.selected_code ?? "").trim();
      if (!code || classes.has(code)) return row;
      const stripped = code.replace(/0+$/u, "");
      if (stripped && stripped !== code && classes.has(stripped)) {
        const children = childClassesFor(classes, stripped);
        const repairedCode = bestChildRepairCode(row, stripped, children) ?? stripped;
        const repairKind =
          repairedCode === stripped
            ? "strip_invalid_trailing_zero_to_valid_parent_class"
            : "replace_invalid_trailing_zero_code_with_schema_valid_child_class";
        repairs.push({
          schema_version: 1,
          dataset_id: row.dataset_id,
          dataset_version: row.dataset_version,
          category_type: row.category_type ?? row.schema_type,
          original_code: code,
          repaired_code: repairedCode,
          basis:
            repairedCode === stripped
              ? "Projected category code was not valid in the bundled TIDAS schema; removing trailing zeroes selected the valid parent class without changing the semantic branch."
              : "Projected category code was not valid in the bundled TIDAS schema; the valid parent branch required one more schema level, so the closest source-backed child class was selected.",
        });
        return {
          ...row,
          code: repairedCode,
          basis:
            repairedCode === stripped
              ? `${row.basis || "Classification decision projected from library-level semantic decision."} Schema repair: ${code} -> ${stripped} because ${code} is not a valid bundled TIDAS classId and ${stripped} is the valid parent class.`
              : `${row.basis || "Classification decision projected from library-level semantic decision."} Schema repair: ${code} -> ${repairedCode} because ${code} is not a valid bundled TIDAS classId and ${repairedCode} is the closest valid child class under parent ${stripped}.`,
          evidence: {
            ...jsonRecord(row.evidence),
            schema_repair: {
              source: "dataset-bafu-batch-import-run",
              original_code: code,
              repaired_code: repairedCode,
              parent_code: stripped,
              schema_file: runtime.repoRelative(schemaFile),
              repair_kind: repairKind,
              child_candidates: children.map((child) => ({
                code: child.classId,
                label: child.text,
              })),
            },
          },
        };
      }
      unresolved.push({
        schema_version: 1,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        category_type: row.category_type ?? row.schema_type,
        code,
        schema_file: runtime.repoRelative(schemaFile),
        reason: "classification_code_not_in_bundled_tidas_schema",
      });
      return row;
    });
    runtime.writeJsonLines(input.decisionsFile, repaired);
    const repairPath = runtime.pathJoin(
      input.outDir,
      "classification-decisions.schema-repairs.jsonl",
    );
    const unresolvedPath = runtime.pathJoin(
      input.outDir,
      "classification-decisions.schema-invalid.manual-review.jsonl",
    );
    runtime.writeJsonLines(repairPath, repairs);
    runtime.writeJsonLines(unresolvedPath, unresolved);
    return { repairs, unresolved, repairPath, unresolvedPath };
  }

  return Object.freeze({ repair });
}
