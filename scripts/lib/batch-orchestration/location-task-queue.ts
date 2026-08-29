type JsonRecord = Record<string, unknown>;

export interface LocationTaskQueueFact {
  path: string;
  bytes: number;
  sha256: string;
}

export interface BoundLocationTaskQueue {
  resolvedPath: string;
  fact: LocationTaskQueueFact;
}

export interface LocationTaskQueueDeferred {
  status: "deferred";
  stage: "location.queue.bind" | "location.queue.verify";
  blocker: JsonRecord;
  report: string | null;
}

export interface LocationTaskQueueIo {
  repoRelative: (filePath: string | null | undefined) => string;
  fileExists: (filePath: string | null | undefined) => boolean;
  fileBytes: (filePath: string) => number;
  sha256File: (filePath: string) => string;
}

function readFact(filePath: string | null, io: LocationTaskQueueIo): LocationTaskQueueFact | null {
  if (!filePath || !io.fileExists(filePath)) return null;
  try {
    const path = io.repoRelative(filePath);
    const bytes = io.fileBytes(filePath);
    const sha256 = io.sha256File(filePath).toLowerCase();
    if (!path || !Number.isSafeInteger(bytes) || bytes < 0 || !/^[a-f0-9]{64}$/u.test(sha256)) {
      return null;
    }
    return { path, bytes, sha256 };
  } catch {
    return null;
  }
}

export function bindLocationTaskQueue(
  filePath: string | null,
  report: string | null,
  io: LocationTaskQueueIo,
): BoundLocationTaskQueue | LocationTaskQueueDeferred {
  const fact = readFact(filePath, io);
  if (!filePath || !fact) {
    return {
      status: "deferred",
      stage: "location.queue.bind",
      blocker: {
        code: "location_task_queue_missing",
        message: "Location suggestion requires one readable content-bound task queue.",
        queue_path: filePath ? io.repoRelative(filePath) : null,
      },
      report,
    };
  }
  return { resolvedPath: filePath, fact };
}

export function verifyLocationTaskQueue(
  bound: BoundLocationTaskQueue,
  report: string | null,
  io: LocationTaskQueueIo,
): LocationTaskQueueDeferred | null {
  const observed = readFact(bound.resolvedPath, io);
  if (
    observed &&
    observed.path === bound.fact.path &&
    observed.bytes === bound.fact.bytes &&
    observed.sha256 === bound.fact.sha256
  ) {
    return null;
  }
  return {
    status: "deferred",
    stage: "location.queue.verify",
    blocker: {
      code: "location_task_queue_drift",
      message: "Location task queue changed after suggestion; apply was not executed.",
      expected: bound.fact,
      observed: observed ?? { path: bound.fact.path, missing: true },
    },
    report,
  };
}
