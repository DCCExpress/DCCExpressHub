export type CalibrationResultRow = {
  speedStep: number;
  direction:
    | "outbound"
    | "return";
  elapsedMs: number;
  millimetersPerSecond: number;
};

export type CalibrationRuntimeState = {
  status:
    | "idle"
    | "running"
    | "completed"
    | "error";
  locoId: string | null;
  locoAddress: number | null;
  routeKey: string | null;
  reverseRouteKey: string | null;
  routeLabel: string | null;
  routeLengthMm: number;
  maxSpeed: number;
  speedStep: number;
  currentSpeed: number | null;
  currentDirection:
    | "outbound"
    | "return"
    | null;
  info: string | null;
  error: string | null;
  results: CalibrationResultRow[];
};

export type CalibrationStartRequest = {
  locoId: string;
  locoAddress: number;
  routeKey: string;
  reverseRouteKey: string;
  routeLabel: string;
  routeLengthMm: number;
  maxSpeed: number;
  speedStep: number;
};

async function jsonRequest<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response =
    await fetch(
      url,
      {
        cache:
          "no-store",
        ...init,
      }
    );

  const data =
    await response.json() as
      T & {
        ok?: boolean;
        message?: string;
      };

  if (
    !response.ok ||
    data.ok ===
      false
  ) {
    throw new Error(
      data.message ??
      `Calibration request failed (${response.status}).`
    );
  }

  return data;
}

export async function getCalibrationState():
  Promise<CalibrationRuntimeState> {
  return jsonRequest<CalibrationRuntimeState>(
    "/api/calibration"
  );
}

export async function startCalibration(
  request: CalibrationStartRequest
): Promise<CalibrationRuntimeState> {
  const response =
    await jsonRequest<{
      state:
        CalibrationRuntimeState;
    }>(
      "/api/calibration/start",
      {
        method:
          "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body:
          JSON.stringify(
            request
          ),
      }
    );

  return response.state;
}

async function control(
  action:
    | "stop"
    | "abort"
    | "estop"
): Promise<CalibrationRuntimeState> {
  const response =
    await jsonRequest<{
      state:
        CalibrationRuntimeState;
    }>(
      `/api/calibration/${action}`,
      {
        method:
          "POST",
      }
    );

  return response.state;
}

export const stopCalibration =
  () =>
    control(
      "stop"
    );

export const abortCalibration =
  () =>
    control(
      "abort"
    );

export const emergencyStopCalibration =
  () =>
    control(
      "estop"
    );
