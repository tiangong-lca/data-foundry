# USLCI import — trace & progress report

Generator for the consolidated USLCI (NREL openLCA JSON-LD) import trace + progress workbook.

- **`build-uslci-trace-xlsx.py`** — the generator (tracked in git).
- **`USLCI-导入trace与进展.xlsx`** — the generated report (git-ignored; regenerate from the script).

## What the workbook contains

| Sheet | Rows | Content |
|---|---|---|
| 说明 Read me | — | Overview + per-sheet guide |
| 导入进展 Summary | — | Coverage (verified / pending) + flow/support/conversion totals + conversion-type distribution |
| 关键决策 Key Decisions | 7 | The engineering decisions that closed the import (unit normalization, land-use elementary promotion, canonical-source-by-UUID fix, physical-equivalence reuse, 142 net-new mints, 11 mega-scopes, ST_200 version bump) |
| Process Trace | 1,358 | Every in-universe process: id / version / name / status / verified timestamp |
| Flow Trace | ~1,936 | Every verified flow row: id / version / owning process / status / timestamp |
| 转换映射 Conversion | ~3,995 | Effective per-source-flow resolution (reuse → canonical: same-UUID version bump, or cross-UUID physical-equivalence) with canonical id/name/version |
| Support Identities | ~1,205 | Support datasets created/verified (contact / source / flow property / unit group) |

Final state: **universe 1,358 / verified 1,358 (100%, 0 residual)**, account `5c784552-09a5-43dc-b704-b96ed3239ecd` (linanenv), `state_code=0`.

## How to regenerate

```bash
# default run dir: .foundry/workspaces/uslci-full-import-20260612T093202Z
uv run --with openpyxl python3 reports/uslci-import/build-uslci-trace-xlsx.py

# or point at a different import workspace:
USLCI_RUN_DIR=.foundry/workspaces/<other-run> \
  uv run --with openpyxl python3 reports/uslci-import/build-uslci-trace-xlsx.py
```

Paths resolve relative to the script (repo root is two directories up), and the run
directory can be overridden with the `USLCI_RUN_DIR` environment variable.

## Sources

Reads from the import run directory: `universe-v1/universe-process-ids.txt` (the 1,358
in-universe process set), `batch-import-full-v2/import-ledger/{ok.processes,ok.flows,
verified-support-identities}.verified.jsonl` (verified ledgers), `library-resolution-v20/
exchange-reference-rewrites.jsonl` (the effective source-flow → canonical reuse decisions,
de-duplicated per source flow), `library-resolution-v13/ready-scopes.jsonl` (process
versions), and `conversion-v9/tidas/{processes,flows}` for names.
