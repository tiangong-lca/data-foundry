import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createSupportCacheCommands } from "../../scripts/commands/support-cache.ts";

type JsonObject = Record<string, unknown>;

interface SupportReport extends JsonObject {
  status: string;
  counts: Record<string, number>;
  mapped_units?: string[];
  blocked_units?: string[];
  blockers?: JsonObject[];
  files: Record<string, string>;
}

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const fixedNow = "2026-08-25T12:00:00.000Z";

function asText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function withTempRoot(name: string, run: (root: string) => void | Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `foundry-${name}-`));
  return Promise.resolve(run(root)).finally(() =>
    fs.rmSync(root, { recursive: true, force: true }),
  );
}

function resolveFrom(root: string, value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(root, text);
}

function relativeTo(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function supportText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(supportText).find(Boolean) ?? "";
  if (typeof value === "object" && value !== null) {
    const record = value as JsonObject;
    return supportText(record["#text"] ?? record.en ?? record["@name"]);
  }
  return "";
}

function supportHarness(root: string) {
  const resolveRepoPath = (value: unknown) => resolveFrom(root, value);
  return createSupportCacheCommands({
    asText,
    ensureArray,
    fileExists(filePath: string | null) {
      return Boolean(filePath && fs.existsSync(filePath));
    },
    nowIso: () => fixedNow,
    readJson(filePath: string) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    },
    repoRelativePath(filePath: string) {
      return relativeTo(root, filePath);
    },
    resolveRepoPath,
    supportText,
    writeJson,
  });
}

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("support refresh preserves auth/read request order, row order, summaries, and exact cache bytes", async () => {
  await withTempRoot("support-refresh", async (root) => {
    const cachePath = path.join(root, "cache.json");
    const existingMappings = [
      {
        canonical_flow_property_id: "fp-1",
        source_units: ["kg"],
        reason: "mass",
      },
    ];
    writeJson(cachePath, { flow_property_mappings: existingMappings });
    const credentials = Buffer.from(
      JSON.stringify({ email: "fixture@example.test", password: "fixture-password" }),
    ).toString("base64");
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/auth/v1/token")) {
        return new Response(
          JSON.stringify({ access_token: "fixture-token", user: { id: "u-1" } }),
          {
            status: 200,
            statusText: "OK",
          },
        );
      }
      if (url.includes("/rest/v1/flowproperties")) {
        return new Response(
          JSON.stringify([
            {
              id: "fp-b",
              version: "03.00.003",
              state_code: 100,
              json: {
                flowPropertyDataSet: {
                  flowPropertiesInformation: {
                    dataSetInformation: { "common:name": { "#text": "Property B" } },
                    quantitativeReference: {
                      referenceToReferenceUnitGroup: {
                        "@refObjectId": "ug-b",
                        "@version": "03.00.003",
                        "common:shortDescription": { "#text": "Unit B" },
                      },
                    },
                  },
                },
              },
            },
            {
              id: "fp-a",
              version: "03.00.003",
              state_code: 100,
              json: {
                flowPropertyDataSet: {
                  flowPropertiesInformation: {
                    dataSetInformation: { "common:shortName": "Property A" },
                  },
                },
              },
            },
          ]),
          { status: 200, statusText: "OK" },
        );
      }
      if (url.includes("/rest/v1/unitgroups")) {
        return new Response(
          JSON.stringify([
            {
              id: "ug-b",
              version: "03.00.003",
              state_code: 100,
              json: {
                unitGroupDataSet: {
                  unitGroupInformation: {
                    dataSetInformation: { "common:name": "Units B" },
                    quantitativeReference: { referenceToReferenceUnit: "0" },
                  },
                  units: {
                    unit: [
                      { "@dataSetInternalID": "0", name: "kg", meanValue: "1" },
                      { "@dataSetInternalID": "1", name: "g", meanValue: "0.001" },
                    ],
                  },
                },
              },
            },
          ]),
          { status: 200, statusText: "OK" },
        );
      }
      throw new Error(`unexpected fixture request ${url}`);
    };

    try {
      const commands = supportHarness(root);
      const report = (await withEnv(
        {
          TIANGONG_LCA_API_BASE_URL: "https://fixture.supabase.co/functions/v1/",
          TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
          TIANGONG_LCA_API_KEY: credentials,
        },
        () => commands.runDatasetSupportCacheRefresh({ out: "cache.json", stateCode: 100 }),
      )) as SupportReport;
      assert.equal(report.status, "completed");
      assert.deepEqual(report.counts, {
        flow_properties: 2,
        unit_groups: 1,
        flow_property_mappings: 1,
      });
      assert.deepEqual(
        calls.map((call) => new URL(call.url).pathname),
        ["/auth/v1/token", "/rest/v1/flowproperties", "/rest/v1/unitgroups"],
      );
      assert.equal(calls[0].init?.method, "POST");
      assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
        email: "fixture@example.test",
        password: "fixture-password",
      });
      for (const call of calls.slice(1)) {
        const url = new URL(call.url);
        assert.equal(url.searchParams.get("select"), "id,version,state_code,json");
        assert.equal(url.searchParams.get("state_code"), "eq.100");
        assert.equal(url.searchParams.get("order"), "id.asc,version.asc");
        assert.equal(url.searchParams.get("limit"), "1000");
        assert.equal(url.searchParams.get("offset"), "0");
        assert.equal(
          ((call.init?.headers ?? {}) as Record<string, string>).authorization,
          "Bearer fixture-token",
        );
      }

      const cache = JSON.parse(fs.readFileSync(cachePath, "utf8")) as JsonObject;
      assert.deepEqual(
        (cache.flow_properties as JsonObject[]).map((row) => row.id),
        ["fp-b", "fp-a"],
      );
      assert.deepEqual((cache.flow_properties as JsonObject[])[0].reference_unit_group, {
        id: "ug-b",
        version: "03.00.003",
        short_description: "Unit B",
      });
      assert.deepEqual((cache.unit_groups as JsonObject[])[0].units, [
        { internal_id: "0", name: "kg", mean_value: "1" },
        { internal_id: "1", name: "g", mean_value: "0.001" },
      ]);
      assert.deepEqual(cache.flow_property_mappings, existingMappings);
      assert.equal(cache.generated_at_utc, fixedNow);
      assert.equal(fs.readFileSync(cachePath, "utf8"), `${JSON.stringify(cache, null, 2)}\n`);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test("canonical support autofill preserves row order, unit normalization, blockers, and report bytes", async () => {
  await withTempRoot("support-autofill", (root) => {
    writeJsonLines(path.join(root, "template.jsonl"), [
      {
        support_type: "flowproperty",
        source_support_id: "source-volume",
        source_name: "Amount in m3 / year",
      },
      {
        support_type: "unitgroup",
        source_support_id: "source-mass-unit",
        source_name: "Units of kg",
        source_units: [{ name: "kg" }],
      },
      {
        support_type: "flowproperty",
        source_support_id: "source-unknown",
        source_name: "Amount in mystery",
      },
    ]);
    writeJson(path.join(root, "cache.json"), {
      flow_properties: [
        {
          id: "fp-volume",
          version: "03.00.003",
          short_description: "Volume-time property",
          reference_unit_group: { id: "ug-volume", version: "03.00.003" },
        },
        {
          id: "fp-mass",
          version: "03.00.003",
          short_description: "Mass property",
          reference_unit_group: { id: "ug-mass", version: "03.00.003" },
        },
      ],
      unit_groups: [
        { id: "ug-volume", version: "03.00.003", short_description: "Volume-time units" },
        { id: "ug-mass", version: "03.00.003", short_description: "Mass units" },
      ],
      flow_property_mappings: [
        { canonical_flow_property_id: "fp-volume", source_units: ["m3y"], reason: "volume time" },
        { canonical_flow_property_id: "fp-mass", source_units: ["kg"], reason: "mass" },
      ],
    });
    const commands = supportHarness(root);
    const report = commands.runDatasetCanonicalSupportMappingsAutofill({
      template: "template.jsonl",
      canonicalSupportCache: "cache.json",
      outDir: "out",
    }) as SupportReport;

    assert.equal(report.status, "completed_with_manual_blocks");
    assert.deepEqual(report.counts, { template_rows: 3, mapped_rows: 2, blocked_rows: 1 });
    assert.deepEqual(report.mapped_units, ["kg", "m3y"]);
    assert.deepEqual(report.blocked_units, ["mystery"]);
    const mappingsText = fs.readFileSync(
      path.join(root, "out/canonical-support-mappings.jsonl"),
      "utf8",
    );
    const mappings = mappingsText
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      mappings.map((row) => [row.source_support_id, row.canonical_support_id, row.source_unit]),
      [
        ["source-volume", "fp-volume", "m3y"],
        ["source-mass-unit", "ug-mass", "kg"],
      ],
    );
    assert.equal(mappingsText, mappings.map((row) => JSON.stringify(row)).join("\n") + "\n");
    const blockedText = fs.readFileSync(
      path.join(root, "out/canonical-support-blocked.manual-review.jsonl"),
      "utf8",
    );
    assert.deepEqual(JSON.parse(blockedText), {
      support_type: "flowproperty",
      source_support_id: "source-unknown",
      source_name: "Amount in mystery",
      decision: "block_unresolved",
      blocked_reason: "unit_physical_dimension_not_proven",
      candidate_units: ["mystery"],
    });
    assert.equal(
      fs.readFileSync(path.join(root, "out/canonical-support-mappings-report.json"), "utf8"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  });
});

test("support cache factory preserves native JSON/credential errors before writes", async () => {
  await withTempRoot("support-errors", async (root) => {
    const commands = supportHarness(root);
    writeText(path.join(root, "malformed.jsonl"), "{ malformed\n");
    writeJson(path.join(root, "cache.json"), {});
    assert.throws(
      () =>
        commands.runDatasetCanonicalSupportMappingsAutofill({
          template: "malformed.jsonl",
          canonicalSupportCache: "cache.json",
          outDir: "out",
        }),
      SyntaxError,
    );
    await assert.rejects(
      withEnv(
        {
          TIANGONG_LCA_API_BASE_URL: "https://fixture.supabase.co/functions/v1",
          TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: "fixture",
          TIANGONG_LCA_API_KEY: "not-base64-json",
        },
        () => commands.runDatasetSupportCacheRefresh({ out: "never.json" }),
      ),
      /Invalid TIANGONG_LCA_API_KEY user credentials/u,
    );
    assert.equal(fs.existsSync(path.join(root, "never.json")), false);
  });
});

test("support cache factory exists only as zero-escape native TypeScript", () => {
  const typedPath = path.join(repoRoot, "scripts/commands/support-cache.ts");
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
});

test("support cache consumers target the typed command factory", () => {
  for (const consumer of [
    "scripts/foundry.mjs",
    "scripts/lib/foundry-command-metadata.ts",
    "test/unit/support-cache-command-factory.test.mts",
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, consumer), "utf8");
    assert.match(source, /(?:commands\/|scripts\/commands\/)support-cache\.ts/u);
    assert.doesNotMatch(source, /(?:commands\/|scripts\/commands\/)support-cache\.mjs/u);
  }
});
