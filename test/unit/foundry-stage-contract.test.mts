import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

interface StageContract {
  stage: string;
  phase: string;
  purpose: string;
  inputs: unknown[];
  outputs: unknown[];
  blockers: unknown[];
  artifacts: unknown[];
  side_effects: unknown[];
  report_contract: {
    status: string;
    counts: string;
    files: string;
    blockers: string;
    remote_write_mode: string;
  };
}

interface StageHelp {
  remote_write_mode: string;
  stage_pipeline: StageContract[];
}

function runFoundryJson(args: string[]): StageHelp {
  const result = spawnSync(process.execPath, ["scripts/foundry.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout) as StageHelp;
}

test("complex workflow commands publish AI-readable stage contracts", () => {
  const commands: string[] = [
    "dataset-bundle-sample-rows",
    "dataset-post-authoring-finalize",
    "dataset-authoring-plan",
    "dataset-identity-preflight-run",
    "dataset-incremental-change-set-compose",
    "dataset-topology-convergence-compose",
  ];
  for (const command of commands) {
    const help = runFoundryJson([command, "--help"]);
    assert.equal(help.remote_write_mode, "read-only", command);
    assert.ok(Array.isArray(help.stage_pipeline), command);
    assert.ok(help.stage_pipeline.length >= 3, command);
    for (const stage of help.stage_pipeline) {
      assert.equal(typeof stage.stage, "string", command);
      assert.equal(typeof stage.phase, "string", command);
      assert.equal(typeof stage.purpose, "string", command);
      assert.ok(Array.isArray(stage.inputs), command);
      assert.ok(Array.isArray(stage.outputs), command);
      assert.ok(Array.isArray(stage.blockers), command);
      assert.ok(Array.isArray(stage.artifacts), command);
      assert.ok(Array.isArray(stage.side_effects), command);
      assert.equal(stage.report_contract.status, "required", command);
      assert.equal(stage.report_contract.counts, "required", command);
      assert.equal(stage.report_contract.files, "required", command);
      assert.equal(stage.report_contract.blockers, "required", command);
      assert.equal(stage.report_contract.remote_write_mode, "read-only", command);
    }
    const phases = help.stage_pipeline.map((stage) => stage.phase);
    for (const phase of ["prepare", "rewrite_cleanup", "gate_validate", "report"]) {
      assert.ok(phases.includes(phase), `${command} missing phase ${phase}`);
    }
    assert.ok(
      phases.indexOf("prepare") < phases.indexOf("rewrite_cleanup") &&
        phases.indexOf("rewrite_cleanup") < phases.indexOf("gate_validate") &&
        phases.indexOf("gate_validate") < phases.indexOf("report"),
      `${command} phase order should be prepare -> rewrite_cleanup -> gate_validate -> report`,
    );
  }
});
