export type StageContractInput = {
  stage: string;
  phase?: string;
  purpose?: string;
  inputs?: unknown[];
  outputs?: unknown[];
  blockers?: unknown[];
  artifacts?: unknown[];
  side_effects?: unknown[];
  report_contract?: Record<string, unknown>;
};

export function stageContract(stages: readonly StageContractInput[]) {
  return stages.map((stage) => ({
    stage: stage.stage,
    phase: stage.phase ?? stage.stage,
    purpose: stage.purpose,
    inputs: stage.inputs ?? [],
    outputs: stage.outputs ?? [],
    blockers: stage.blockers ?? [],
    artifacts: stage.artifacts ?? stage.outputs ?? [],
    side_effects: stage.side_effects ?? [],
    report_contract: stage.report_contract ?? {
      status: "required",
      counts: "required",
      files: "required",
      blockers: "required",
      remote_write_mode: "read-only",
    },
  }));
}

export function readOnlyStageContract(stages: readonly StageContractInput[]) {
  return {
    remote_write_mode: "read-only",
    stage_pipeline: stageContract(stages),
  };
}
