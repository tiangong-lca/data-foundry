import assert from "node:assert/strict";
import test from "node:test";

import { readyScopeFileValue } from "../../scripts/lib/library-orchestration/command-runtime.ts";

test("library command runtime preserves explicit scope-file precedence and safe resolution fallback", () => {
  assert.equal(
    readyScopeFileValue(
      { scopeFile: "explicit/scopes.jsonl" },
      { files: { ready_scopes: "resolution/ready-scopes.jsonl" } },
    ),
    "explicit/scopes.jsonl",
  );
  assert.equal(
    readyScopeFileValue(
      { scopeFile: "" },
      { files: { ready_scopes: "resolution/ready-scopes.jsonl" } },
    ),
    "resolution/ready-scopes.jsonl",
  );
  assert.equal(readyScopeFileValue({}, { files: [] }), undefined);
  assert.equal(readyScopeFileValue({}, { files: null }), undefined);
});
