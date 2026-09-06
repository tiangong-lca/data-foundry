#!/usr/bin/env node
import { runFoundryPublicCommand } from "./runtime-entry.ts";
import { receiveFoundryManagedHost } from "./lib/foundry-managed-host.ts";

void runFoundryPublicCommand(process.argv, {}, receiveFoundryManagedHost);
