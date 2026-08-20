# USLCI Database Public — source package manifest

> Historical implementation evidence below may name the retired Python `tidas-tools` checkout and old CLI wrapper. It is retained to explain the received package and the 2026-06 observations, not as an executable command or current dependency. Active conversion/validation uses the Foundry adapter over Rust `tidas` 0.2.x.

- registry id: `uslci-source-package` (see `docs/file-location-registry.json`)
- package dir (untracked): `inputs/National_Renewable_Energy_Laboratory-USLCI_Database_Public/`
- format: openLCA JSON-LD directory export (LCA Commons collaboration server, repository `schemaVersion: 2`)
- publisher: National Renewable Energy Laboratory (NREL), Federal LCA Commons
- import profile: `uslci` (`specs/import-profiles.json`); entry runbook: `docs/uslci-import-runbook.md`

## Main package contents (as received)

| folder | files |
| --- | --- |
| processes | 1,341 (1,316 UNIT_PROCESS / 25 LCI_RESULT; 77,986 exchanges) |
| flows | 4,314 (2,682 elementary / 1,437 product / 195 waste) |
| actors / sources | 70 / 557 |
| flow_properties / unit_groups | 6 / 1 (niche only; all standard FPs/UGs live in the library below) |
| locations / currencies | 317 / 12 (currencies unused by any exchange) |
| bin | 9 files (8 source attachments PDF/JPG/PNG + 1 calculation-preferences.json) |
| categories.json | 277 type-prefixed category paths (directory listing only; per-entity `category` fields are authoritative) |

## Supplement: U.S. electricity baseline library (downloaded 2026-06-12)

The package's `openlca.json` declares one external library dependency. Without it,
1,239 flows, 17 defaultProvider processes, 15 standard flow properties, the standard
unit groups, the `US` location, the NREL actor, and both US EPA pedigree DQ systems
are dangling (80.4% of processes carry at least one dangling exchange flow or
defaultProvider reference). The library was downloaded and frozen in-package:

- `libraries/U.S._electricity_baseline_v1.2025-06.0.zip`
  - source URL: `https://www.lcacommons.gov/lca-collaboration/ws/public/libraries/U.S._electricity_baseline_v1.2025-06.0`
  - downloaded: 2026-06-12
  - size: 19,231,416 bytes
  - sha256: `367b7efefd6613f6b8c099c8511f2d66984432500d182dc85fb5770f6e20a494`
  - content: openLCA matrix library (A/B npz matrices, M.npy, library.json) + embedded `meta.zip`
- `libraries/U.S._electricity_baseline_v1.2025-06.0/` — extracted content of the
  embedded `meta.zip` only (the matrix artifacts are irrelevant to TIDAS import and
  stay inside the zip). This is itself a complete openLCA JSON-LD package
  (repository `schemaVersion: 5`): 8 actors, 2 dq_systems, 37 flow_properties,
  2,310 flows, 82 locations, 771 processes, 22 sources, 31 unit_groups.

## Verified closure facts (2026-06-12)

- UUID overlap between main package and extracted library: **0** across all entity folders.
- Merged union closes **all** dangling references: 0 missing flows, 0 missing
  defaultProviders, 0 missing flow properties, 0 missing unit groups.
- Transitive defaultProvider closure of the 1,341 USLCI processes pulls in exactly
  **17** library processes (no deeper cascade) → recommended import universe 1,358.
- The tidas-tools `openlca-jsonld` adapter walks the input directory with a
  recursive `rglob("*.json")` and classifies entities by `@type`
  (`tidas-tools/src/tidas_tools/import_lca/adapters/openlca_jsonld.py:81`), so
  **converting the package root now yields the closed, merged conversion** — the
  `libraries/` zip itself is not scanned (not `.json`). Smoke conversion of the
  merged root (tidas-tools 0.0.29 checkout, 2026-06-12; also verified end-to-end
  through the `@tiangong-lca/cli` 0.0.16 `dataset import-lca convert` wrapper):
  completed, 0 errors, contacts 78 / sources 580 / unitgroups 32 /
  flowproperties 43 / flows 6,624 / processes 2,112 / lifecyclemodels 1 /
  process_bundles 2,112, TIDAS validation 0 issues,
  bundle `unresolved_references` **0** (was 44,193 without the library).

## Reproduce the supplement

```bash
cd inputs/National_Renewable_Energy_Laboratory-USLCI_Database_Public
curl -sSL -o libraries/U.S._electricity_baseline_v1.2025-06.0.zip \
  "https://www.lcacommons.gov/lca-collaboration/ws/public/libraries/U.S._electricity_baseline_v1.2025-06.0"
shasum -a 256 libraries/U.S._electricity_baseline_v1.2025-06.0.zip   # expect 367b7efe…e20a494
unzip -o libraries/U.S._electricity_baseline_v1.2025-06.0.zip meta.zip -d /tmp/uslci-lib-stage
unzip -o /tmp/uslci-lib-stage/meta.zip -d libraries/U.S._electricity_baseline_v1.2025-06.0
rm -rf /tmp/uslci-lib-stage
```

Do not re-download or re-extract without updating this manifest (sha256 + date) in
the same change.
