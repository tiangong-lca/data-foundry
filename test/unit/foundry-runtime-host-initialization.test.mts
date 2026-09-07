import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runFoundryPublicCommand } from "../../scripts/runtime-entry.ts";
import { FoundryContextError } from "../../scripts/lib/foundry-runtime-error.ts";
import { assertFoundryOperationResult } from "../../scripts/lib/foundry-operation-result.ts";
import { createFoundryFacade } from "../../scripts/public-api.ts";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-host-init-"));
  const workspace = path.join(root, "workspace");
  const output: string[] = [],
    exits: number[] = [];
  return {
    root,
    workspace,
    output,
    exits,
    argv: [
      process.execPath,
      "package-entry.js",
      "workspace",
      "init",
      "--workspace",
      workspace,
      "--json",
    ],
    host: {
      writeStdout: (text: string) => {
        output.push(text);
      },
      setExitCode: (code: number) => {
        exits.push(code);
      },
    },
    result: () => {
      assert.equal(output.length, 1);
      return assertFoundryOperationResult(JSON.parse(output[0]));
    },
  };
}

test("host initialization failures produce one safe result before workspace effects and release signal handlers", async (t) => {
  const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  for (const [index, error] of [
    new Error("private fixture diagnostic"),
    new FoundryContextError("managed_runtime_unsupported", "Unsupported managed protocol."),
  ].entries()) {
    const f = fixture();
    t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
    await runFoundryPublicCommand(f.argv, f.host, async () => {
      throw error;
    });
    assert.equal(f.result().status, index === 0 ? "failed" : "blocked");
    assert.deepEqual(f.exits, [index === 0 ? 1 : 4]);
    assert.equal(f.output[0].includes("private fixture diagnostic"), false);
    assert.equal(fs.existsSync(f.workspace), false);
    assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], before);
  }
});

test("cancellation during asynchronous host admission preserves the interrupted envelope and no workspace", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const controller = new AbortController();
  let preparations = 0;
  const running = runFoundryPublicCommand(
    f.argv,
    { ...f.host, signal: controller.signal },
    async (signal) => {
      preparations += 1;
      assert.equal(signal, controller.signal);
      return new Promise<never>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("interrupted admission")), {
          once: true,
        }),
      );
    },
  );
  controller.abort();
  await running;
  assert.equal(preparations, 1);
  assert.deepEqual(f.exits, [130]);
  assert.equal(f.result().blockers[0].code, "operation_interrupted");
  assert.equal(fs.existsSync(f.workspace), false);
});

test("pre-observed cancellation does not start host initialization", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const controller = new AbortController();
  controller.abort();
  let preparations = 0;
  await runFoundryPublicCommand(f.argv, { ...f.host, signal: controller.signal }, async () => {
    preparations += 1;
    return {};
  });
  assert.equal(preparations, 0);
  assert.deepEqual(f.exits, [130]);
  assert.equal(f.result().blockers[0].code, "operation_interrupted");
  assert.equal(fs.existsSync(f.workspace), false);
});

test("a managed API cannot use its cache as a migration source with an external destination", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const cache = path.join(f.root, "components-cache");
  const facade = createFoundryFacade({
    workspace: cache,
    runtimeManager: { cacheDir: cache },
    cacheBase: path.join(f.root, "work-cache"),
  });
  const result = await facade.migrationTransfer({
    destination: f.workspace,
    actorId: "actor",
    requestId: "request",
    plan: {},
  });
  assert.equal(result.blockers[0].code, "runtime_cache_boundary");
  assert.equal(fs.existsSync(f.workspace), false);
  assert.equal(fs.existsSync(cache), false);
});
