export type SandboxState =
  | "idle"
  | "running"
  | "paused"
  | "stopping"
  | "aborting"
  | "completed"
  | "stopped"
  | "aborted"
  | "error";

export type SandboxStatus = {
  ok: boolean;
  state: SandboxState;
  error: string;
  log: string;
  startedAtMs: number;
  finishedAtMs: number;
  totalHeap: number;
  freeHeap: number;
  minFreeHeap: number;
  largestFreeHeapBlock: number;

  totalPsram: number;
  freePsram: number;
  minFreePsram: number;
  largestFreePsramBlock: number;

  baselineFreeHeap: number;
  baselineFreePsram: number;
  heapDeltaSinceStart: number;
  psramDeltaSinceStart: number;

  sourceBytes: number;
  vmMemoryLimitBytes: number;
  taskStackBytes: number;
};

type ApiResult = {
  ok: boolean;
  message?: string;
};

async function readJson<T>(
  response: Response,
): Promise<T> {
  const data =
    await response.json() as T;

  return data;
}

async function ensureOk(
  response: Response,
): Promise<ApiResult> {
  const data =
    await readJson<ApiResult>(
      response,
    );

  if (
    !response.ok ||
    !data.ok
  ) {
    throw new Error(
      data.message ||
      `Sandbox request failed: HTTP ${response.status}`,
    );
  }

  return data;
}

function codeBody(
  code: string,
): URLSearchParams {
  return new URLSearchParams({
    code,
  });
}

export async function loadSandboxSource(): Promise<string> {
  const response =
    await fetch(
      "/api/dev/js-sandbox/source",
      {
        cache: "no-store",
      },
    );

  const data =
    await readJson<{
      ok: boolean;
      source?: string;
      message?: string;
    }>(
      response,
    );

  if (
    !response.ok ||
    !data.ok
  ) {
    throw new Error(
      data.message ||
      "Could not load Sandbox source.",
    );
  }

  return data.source ?? "";
}

export async function saveSandboxSource(
  code: string,
): Promise<void> {
  const response =
    await fetch(
      "/api/dev/js-sandbox/source",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: codeBody(code),
      },
    );

  await ensureOk(
    response,
  );
}

export async function startSandbox(
  code: string,
): Promise<void> {
  const response =
    await fetch(
      "/api/dev/js-sandbox/start",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: codeBody(code),
      },
    );

  await ensureOk(
    response,
  );
}

async function postControl(
  action:
    | "pause"
    | "resume"
    | "stop"
    | "abort",
): Promise<void> {
  const response =
    await fetch(
      `/api/dev/js-sandbox/${action}`,
      {
        method: "POST",
      },
    );

  await ensureOk(
    response,
  );
}

export function pauseSandbox(): Promise<void> {
  return postControl(
    "pause",
  );
}

export function resumeSandbox(): Promise<void> {
  return postControl(
    "resume",
  );
}

export function stopSandbox(): Promise<void> {
  return postControl(
    "stop",
  );
}

export function abortSandbox(): Promise<void> {
  return postControl(
    "abort",
  );
}

export async function getSandboxStatus(): Promise<SandboxStatus> {
  const response =
    await fetch(
      "/api/dev/js-sandbox/status",
      {
        cache: "no-store",
      },
    );

  const data =
    await readJson<SandboxStatus>(
      response,
    );

  if (
    !response.ok ||
    !data.ok
  ) {
    throw new Error(
      `Could not read Sandbox status: HTTP ${response.status}`,
    );
  }

  return data;
}
