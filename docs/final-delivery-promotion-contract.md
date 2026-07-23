---
title: Final Delivery Promotion Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when promoting a completed local delivery package into immutable reviewer-facing evidence
  - when defining exact row, algebra, workbook, redaction, and independent-review gates
whenToUpdate:
  - when the final-delivery manifest, promotion ledger, report, or detached seal contract changes
checkPaths:
  - docs/final-delivery-promotion-contract.md
  - specs/schemas/final-delivery-manifest.schema.json
  - scripts/commands/final-delivery-promotion.mjs
  - test/commands/final-delivery-promotion.test.mjs
lastReviewedAt: 2026-07-23
lastReviewedCommit: 849d6ac14d357bd445a9fa75a9c18dc16a2a411a
---

# Final Delivery Promotion Contract

`final-delivery-promote` is a Foundry-owned, workflow-internal offline gate. It validates one completed local delivery package and writes immutable promotion evidence. It does not create or alter the delivery artifacts, access a network or database, dispatch another CLI, perform a mutation, or grant production authority.

## Fast path

Prepare a `foundry-final-delivery-manifest.v1` file and run:

```bash
node scripts/foundry.mjs final-delivery-promote \
  --manifest .foundry/workspaces/<task-id>/final-delivery/final-delivery-manifest.json \
  --out-dir .foundry/workspaces/<task-id>/final-delivery-promotion/revision-0001
```

Both paths must remain inside the repository. The manifest and every declared artifact must be regular, non-symlink files. The output directory must not already exist. A correction uses a fresh output directory; prior snapshots, ledgers, reports, and seals are never overwritten.

The manifest schema is `specs/schemas/final-delivery-manifest.schema.json`. The command validates the same safety-critical constraints at runtime and fails closed when the manifest or an artifact cannot be parsed.

## Promotion requirements

One promotion pass checks all of these:

- offline-only mode, `production_authority=false`, and declared `P0=0` / `P1=0`;
- unique, confined artifact identities and paths with exact SHA-256, byte count, schema, and row count;
- JSON object, JSON object-with-rows, JSON array, JSONL, CSV, XLSX, and explicit no-row artifact contracts;
- declarative numeric algebra over literal values, artifact row counts, JSON pointers, and sums;
- exact XLSX sheet names and order, required headers, required control cells, and aggregate data-row counts;
- bounded ZIP/XLSX parsing that rejects encryption, unsafe paths, duplicate entries, unsupported compression, and decompression limits;
- complete redaction coverage of every textual/workbook artifact for credentials, user-specific absolute paths, and manifest-declared forbidden literals;
- content-bound independent reviewer reports whose reviewer differs from the producer, reports `PASS` with zero P0/P1 findings, and covers every required artifact ID.

The package is promoted only when every ledger row passes. Any validation failure produces a rejected report and no seal.

## Outputs and authority boundary

Every parseable invocation writes into the fresh output directory:

- `final-delivery-manifest-snapshot.json` — exact input manifest bytes;
- `final-delivery-promotion-ledger.jsonl` — machine-readable PASS/FAIL rows;
- `final-delivery-promotion-report.json` — reader-facing summary, artifact census, findings, and zero-dispatch counters.

A fully passing invocation also writes `final-delivery-promotion-seal.json`. The detached seal binds the source manifest SHA-256, sorted artifact set, manifest snapshot, ledger, report, zero findings, and zero effects.

The seal is delivery-promotion evidence only. `production_authority` is always `false`. Publication, deployment, owner-session creation, remote write/readback, and database semantics remain owned by their existing CLI, release, and database surfaces.

## Package independence

The command contains no account, project, dataset, campaign, workbook filename, sheet name, or expected denominator. All delivery-specific expectations are declared in the content-addressed manifest. A producer may therefore apply the same gate to any final-delivery package that satisfies the schema without changing Foundry code.
