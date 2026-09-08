import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import { createFoundryFacade } from "../../scripts/foundry-facade.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
} from "../../scripts/lib/foundry-runtime-context.ts";

test("registered production verification intent cannot be downgraded or replaced by ambient mode", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-account-mode-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "source.json");
  fs.writeFileSync(input, '{"flowDataSet":{}}');
  const base = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace: path.join(root, "workspace"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(base));
  const account = {
    projectRef: "aaaaaaaaaaaaaaaaaaaa",
    userId: "11111111-1111-4111-8111-111111111111",
  };
  const context = createFoundryRuntimeContext({
    ...base,
    taskId: "production",
    actorId: "actor",
    inputs: [captureFoundryInput(input)],
    accountIntent: { ...account, accountMode: "production-test" },
  });
  createFoundryRuntime(context).startTask();
  const file = path.join(context.taskRoot!, "account-intent.json");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).account_mode, "production-test");
  for (const intent of [account, { ...account, accountMode: "ordinary" as const }]) {
    const changed = createFoundryRuntimeContext({
      ...base,
      taskId: "production",
      actorId: "actor",
      inputs: [captureFoundryInput(input)],
      accountIntent: intent,
    });
    await assert.rejects(createFoundryRuntime(changed).inspectTask(), (error: unknown) =>
      Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "task_account_mismatch",
      ),
    );
  }
  const ordinary = createFoundryRuntimeContext({
    ...base,
    taskId: "ordinary",
    actorId: "actor",
    inputs: [captureFoundryInput(input)],
    accountIntent: account,
    environment: { ...process.env, FOUNDRY_ACCOUNT_MODE: "production-test" },
  });
  createFoundryRuntime(ordinary).startTask();
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(ordinary.taskRoot!, "account-intent.json"), "utf8"))
      .account_mode,
    undefined,
  );
  assert.equal(ordinary.accountIntent?.accountMode, undefined);
  const specFile = path.join(root, "ordinary-task.json");
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "explicit-host-mode",
      actor_id: "actor",
      lane: "external-dataset-curated-import",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: input }],
      seed: null,
      preparation: null,
      account_intent: {
        project_ref: account.projectRef,
        user_id: account.userId,
        session_reference: null,
      },
    }),
  );
  const facade = createFoundryFacade({
    ...base,
    accountIntent: { ...account, accountMode: "production-test" },
  });
  const rejected = await facade.start({ specFile });
  assert.equal(
    rejected.blockers[0]?.code,
    "task_account_mismatch",
    "public task input cannot silently weaken explicit host intent",
  );
});
