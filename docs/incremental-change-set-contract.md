---
title: Incremental Change-Set Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when importing a new release over an existing owner-draft dataset without a full rewrite
  - when reviewing three-way merge, per-conversion logging, or CLI handoff artifacts
whenToUpdate:
  - when the incremental request, merge, log, dependency, or output contract changes
checkPaths:
  - docs/incremental-change-set-contract.md
  - specs/schemas/incremental-change-set.schema.json
  - scripts/commands/incremental-change-set.mjs
  - test/unit/incremental-change-set.test.mjs
  - test/commands/incremental-change-set.test.mts
  - test/scenarios/incremental-change-set-handoff.test.mjs
  - docs/execution-capsule-contract.md
lastReviewedAt: 2026-08-25
lastReviewedCommit: 898eb5cc5b348095e3ac096804e5271d2203479c
lastReviewedNote: "Reviewed for Issue #67 Wave 27 command tests: the command contract moves to strict TS7 without changing three-way merge, terminal disposition, dependency, event-chain, artifact algebra, activation, or zero-dispatch semantics."
---

# Incremental Change-Set Contract

`dataset-incremental-change-set-compose` is an offline Foundry planner for importing a newer package release over an existing owner-draft baseline. It minimizes writes by comparing three states for every declared entity:

- old: the previously imported source release;
- candidate: the newly projected source release;
- current: a fresh owner-session, SELECT-only snapshot.

The command produces a candidate change set and audit evidence. It never connects to a network or database, invokes the CLI, performs DML, or grants production authority.

## Invocation

```bash
node scripts/foundry.mjs dataset-incremental-change-set-compose \
  --request .foundry/workspaces/<task-id>/incremental/request.json \
  --out-dir .foundry/workspaces/<task-id>/incremental/composition-0001
```

Only `--request`, `--out-dir`, and `--help` are supported. The output directory must be inside the repository and must not exist. The command creates it with mode `0700` and artifacts with mode `0600`; it never overwrites an earlier composition.

Those numeric mode bits are enforced and tested on POSIX filesystems. Windows retains the same fresh-path, exclusive-create, immutable-output, hash, and manifest guarantees even though it does not expose POSIX permission bits through `stat.mode`.

## SHA-Bound Request

The request uses `foundry-incremental-change-set-request.v1` and binds:

- project, exact owner, `target_mode=owner_draft`, and `state_code=0`;
- the allowed CLI v1 tables, exact `table/id@version` target set, per-table non-root update-pointer allowlist, and explicit account-local support permission; an empty pointer list explicitly grants that table zero update authority while still allowing separately authorized inserts;
- comparison JSONL, owner snapshot JSONL, owner-snapshot receipt, and preservation policy by path, bytes, SHA-256, and row count where applicable;
- the snapshot receipt's exact project/owner/state, snapshot facts, capture time, SELECT-query fingerprint, deployment fingerprint, canonical scope SHA, and canonical allowed-target-set SHA;
- a complete, sorted receipt ledger with exactly one `present` plus raw snapshot-row SHA or `absent` entry for every allowed target; the ledger and snapshot must agree, so an omitted row cannot silently become an insert;
- optional terminal action exclusions whose success receipts remain readable and exactly SHA-bound;
- the intended CLI version, execution-contract schema, and toolchain fingerprint;
- `production_authority=false`.

The machine-readable shapes are in `specs/schemas/incremental-change-set.schema.json`. The command compiles and enforces its strict Draft 2020-12 definitions with Ajv before classification and again before materialization. The projector that creates comparison rows owns source alias/crosswalk decisions. The composer recomputes payload identity and canonical JSON hashes and never guesses UUID equivalence or a missing payload version.

## Four Terminal Dispositions

Each schema-valid comparison row receives exactly one terminal disposition:

| Disposition | Condition | CLI operation |
| --- | --- | --- |
| `INSERT` | old absent, candidate present, current absent, insert allowed | `insert`, `before_sha256=null` |
| `UPDATE` | current exists, merge is conflict-free, desired differs, changed pointers are allowed | `save_draft`, exact current `before_sha256` |
| `NOOP` | current already equals desired, an exact evidence-bound noise rule preserves equivalent bytes, entity is already absent, or a verified terminal-success receipt consumes the conversion | none |
| `HOLD` | delete signal, historical owner gap, identity collision, conflict, scope/owner/state failure, or dependency blocker | none |

No disposition can produce a delete. An old entity that is missing from current is a historical gap, not an inferred insert. A candidate missing while current exists is a forbidden-delete hold.

## Three-Way Merge

Merge decisions are made per JSON Pointer:

- current equals old and candidate changed: take candidate;
- current equals candidate: keep current bytes;
- candidate equals old and current changed: preserve current only through an exact `preserve_owner` rule bound to entity, pointer, old/candidate/current value hashes, and evidence hash; otherwise hold as unattributed drift;
- current and candidate both changed differently: use an equally bound `preserve_owner` or `take_candidate` rule, otherwise hold as a three-way conflict.

Semantic noise is not an open pointer prefix. A rule is bound to one entity, one exact pointer, all three value hashes, an evidence hash, and the enumerated `decimal_lexical_equivalence_v1` transform. It preserves current bytes only when old, candidate, and current normalize to the same exact decimal. Semantic SHA-256 is calculated from a projection that replaces only those exact-bound, actually matching decimal values with a canonical decimal marker; raw payload SHA-256 is never changed. Consequently numeric `1`, string `1.0`, and string `1` may share a semantic hash only under that exact rule. `1.01`, unrelated Unicode (including canonically similar spellings), regex stripping, UUID collapsing, and source-payload rewriting remain material and retain distinct semantic hashes.

Arrays are atomic unless an exact evidence-bound `stable_identity_by_index_v1` rule names an element identity pointer and proves equal length, unique identities, and unchanged identity at every index across old/candidate/current. Only then may the merge recurse to element pointers. Reorder, duplicate identity, length drift, or missing identity becomes a hold. After merging, the complete desired payload identity is checked again. Update output is permitted only when every material changed pointer matches the request's explicit non-root allowlist.

## Dependency Isolation and Ordering

Dependencies come from the SHA-bound comparison ledger and must be unique non-empty strings; malformed entries fail schema validation rather than disappearing during normalization. Missing, absent, held, or cyclic required dependencies hold only their dependent closure. A `NOOP_ALREADY_ABSENT` row cannot satisfy a dependency; only a present current row that is exact desired or a conversion consumed by a verified terminal-success receipt can. Independent ready actions continue. Candidate actions use stable topological order with the policy table rank and `table/id@version` as tie-breakers. Every CLI `dependency_action_id` points to a unique earlier action.

An optional terminal exclusion strictly binds schema, `action_id`, separate `desired_sha256`, and a readable success receipt by repository-relative path, receipt schema, `status=success`, bytes, and SHA-256. The receipt itself must bind that exact action and desired digest. Every exclusion must consume exactly one actual candidate action or one exact-current recovery `NOOP`; unmatched, random, duplicate, contradictory, unreadable, or drifted evidence rejects composition before output. A consumed conversion becomes an explicit terminal-success `NOOP`, can satisfy dependants, and is never emitted as an action. `terminal_replay_zero` is derived from complete one-to-one consumption plus the absence of every excluded pair from emitted actions; it is not a constant assertion.

## Per-Conversion Log

`incremental-change-set-conversion-events.jsonl` contains exactly one terminal event per comparison row. Each event records:

- input sequence, source line/raw hash, entity identity, and old/candidate/current payload and semantic hashes;
- owner-snapshot receipt hash, explicit noise/preserved/applied/conflict pointers, and one common decision/event evidence object;
- the policy SHA and exact evidence SHA arrays actually used for decimal noise, `take_candidate`, `preserve_owner`, and stable-array recursion; unused rules never appear;
- disposition, reason, expected operation, before/desired hash, action id, and any fully bound terminal-success receipt;
- dependency dispositions and earlier action ids;
- duration, output artifact/line/row hash, deterministic decision binding, and event hash-chain links.

Timestamps and durations are observational. `decision_binding_sha256` excludes them so the same semantic decision remains comparable. The event hash binds the complete recorded event, and `previous_event_sha256` makes missing or reordered log rows detectable.

## Outputs and Algebra

The command writes:

```text
incremental-change-set-request.snapshot.json
incremental-change-set-conversion-events.jsonl
incremental-change-set-delta.jsonl
incremental-change-set-no-write.jsonl
incremental-change-set-holds.jsonl
incremental-change-set-dependency-closure.json
incremental-change-set-report.json
incremental-change-set-manifest.json
```

When at least one action exists, the command additionally writes `dataset-save-draft-input.jsonl` and a non-empty `dataset-save-draft-execution-contract.json`. It never emits an empty contract that the CLI cannot consume. A UnitGroup or FlowProperty action is admitted only when the request explicitly allows account-local support; the report then requires the later CLI invocation to pass `--allow-account-local-support`.

The report and tests enforce:

```text
INSERT + UPDATE + NOOP + HOLD = universe
actions = delta rows = INSERT + UPDATE
no-write rows = NOOP
hold rows = HOLD
terminal conversion events = universe, with valid decision/output/event hashes and chain
DELETE = 0
terminal replay = 0
network = database = CLI = DML dispatch = 0
```

The manifest records schema, rows, bytes, and SHA-256 for every preceding output artifact. The CLI input rows are exact desired TIDAS payloads in contract action order, using the same recursively key-sorted canonical JSON SHA-256 as the CLI.

## Activation Boundary

Composer output is only a syntactically consumable candidate and remains `production_authority=false`. Before execution, a separate fresh stage must prove:

1. insert targets are still absent and update targets still match exact `before_sha256`;
2. NOOP/protected rows remain exact and owner/project/state scope is unchanged;
3. the intended published CLI and deployment fingerprints are exact;
4. a fresh owner session and independent review pass;
5. the existing `execution-capsule-admit` contract seals the materialized rows, contract, reviewer evidence, and exact consumer boundary.

Only a separately authorized CLI invocation may then perform owner-session transactions and exact readback. Foundry never performs that mutation itself.
