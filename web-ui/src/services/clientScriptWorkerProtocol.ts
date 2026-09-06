export type ClientScriptWorkerExecutionId =
  | number
  | string;

export type ClientScriptWorkerElement = {
  id: ClientScriptWorkerExecutionId;
  name: string;
  type: string;
};

export type ClientScriptWorkerDccMethod =
  | "power"
  | "programmingPower"
  | "emergencyStop"
  | "loco"
  | "locoFunction"
  | "turnout"
  | "sensor"
  | "accessory"
  | "signal"
  | "block"
  | "setBlock"
  | "setBlockTargetLoco"
  | "clearBlockTargetLoco"
  | "clearBlock"
  | "resetBlocks"
  | "raw";

export type MainToWorkerMessage =
  | {
      type: "blockCatalog";
      blocks: Array<{
        id: string;
        name: string;
      }>;
      ready: boolean;
    }
  | {
      type: "blockSnapshot";
      blocks: Record<string, number>;
      ready: boolean;
    }
  | {
      type: "blockTargetSnapshot";
      targets: Record<string, number>;
      ready: boolean;
    }
  | {
      type: "start";
      executionId: ClientScriptWorkerExecutionId;
      script: string;
      element: ClientScriptWorkerElement;
    }
  | {
      type: "pause";
      executionId: ClientScriptWorkerExecutionId;
    }
  | {
      type: "resume";
      executionId: ClientScriptWorkerExecutionId;
    }
  | {
      type: "abort";
      executionId: ClientScriptWorkerExecutionId;
      reason: string;
    }
  | {
      type: "commandError";
      executionId: ClientScriptWorkerExecutionId;
      message: string;
    };

export type WorkerToMainMessage =
  | {
      type: "dcc";
      executionId: ClientScriptWorkerExecutionId;
      method: ClientScriptWorkerDccMethod;
      args: unknown[];
    }
  | {
      type: "info";
      executionId: ClientScriptWorkerExecutionId;
      message: string;
    }
  | {
      type: "log";
      executionId: ClientScriptWorkerExecutionId;
      values: unknown[];
    }
  | {
      type: "done";
      executionId: ClientScriptWorkerExecutionId;
      result: unknown;
    }
  | {
      type: "error";
      executionId: ClientScriptWorkerExecutionId;
      message: string;
      name: string;
      stack: string | null;
      aborted: boolean;
    };
