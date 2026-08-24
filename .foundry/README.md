# Foundry Runtime Directory

This directory is the local runtime root for the Data Foundry service.

Tracked files here document the runtime contract. Runtime state, logs, and per-task workspaces are local-only and ignored by git:

- `.foundry/logs/`
- `.foundry/workspaces/`
- `.foundry/state/`

Run `pnpm init:runtime` after cloning to create those ignored directories.
