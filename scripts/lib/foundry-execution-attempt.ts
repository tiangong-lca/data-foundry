export type ExecutionAttemptState = {
  dispatch_state?: string;
  readback_state?: string;
};

export type ExecutionAttemptDisposition = {
  disposition:
    | "UNATTEMPTED"
    | "SUCCEEDED_EXACT_READBACK"
    | "SUCCEEDED_RECOVERED_EXACT_READBACK"
    | "UNKNOWN_DO_NOT_REPLAY";
  attempt_consumed: boolean;
  replay_allowed: boolean;
  terminal: boolean;
};

const ATTEMPT_DISPATCH_STATES = new Set([
  "NOT_DISPATCHED",
  "DISPATCH_CONFIRMED",
  "DISPATCH_UNKNOWN",
]);

export function modelExecutionAttemptDisposition(
  state: ExecutionAttemptState,
): ExecutionAttemptDisposition {
  const dispatchState = state?.dispatch_state;
  const desiredExact = state?.readback_state === "EXACT_DESIRED";
  if (dispatchState === "NOT_DISPATCHED") {
    return {
      disposition: "UNATTEMPTED",
      attempt_consumed: false,
      replay_allowed: true,
      terminal: false,
    };
  }
  if (ATTEMPT_DISPATCH_STATES.has(dispatchState ?? "") && desiredExact) {
    return {
      disposition:
        dispatchState === "DISPATCH_UNKNOWN"
          ? "SUCCEEDED_RECOVERED_EXACT_READBACK"
          : "SUCCEEDED_EXACT_READBACK",
      attempt_consumed: true,
      replay_allowed: false,
      terminal: true,
    };
  }
  return {
    disposition: "UNKNOWN_DO_NOT_REPLAY",
    attempt_consumed: dispatchState !== "NOT_DISPATCHED",
    replay_allowed: false,
    terminal: false,
  };
}
