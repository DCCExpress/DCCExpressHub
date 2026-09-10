export type ClientScriptWorkerExecutionId =
  | number
  | string;

export type ClientScriptWorkerElement = {
  id: ClientScriptWorkerExecutionId;
  name: string;
  type: string;
};

export type ClientScriptSignalDccDirection =
  | "R"
  | "G";

export type ClientScriptSignalStateCatalogItem = {
  label: string;
  aspect: number;
  dccOutputs: ClientScriptSignalDccDirection[];
};

export type ClientScriptSignalCatalogItem = {
  address: number;
  name: string;
  protocol: "dcc" | "dccext";
  outputCount: number;
  states: ClientScriptSignalStateCatalogItem[];
};

export type ClientScriptTurnoutCatalogItem = {
  address: number;
  name: string;
  outputMode: "accessory" | "vpin" | "extended";
  closedValue: boolean;
  closedAspect: number;
  openedAspect: number;
};

export type ClientScriptWorkerDccMethod =
  | "setPower"
  | "setProgrammingPower"
  | "emergencyStop"
  | "setLoco"
  | "setLocoFunction"
  | "setTurnoutRaw"
  | "setTurnoutState"
  | "setSensor"
  | "setAccessory"
  | "setSignalAspect"
  | "setSignalState"
  | "block"
  | "setBlock"
  | "setBlockTargetLoco"
  | "clearBlockTargetLoco"
  | "clearBlock"
  | "resetBlocks"
  | "sendRaw";

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
      type: "sensorSnapshot";
      sensors: Record<string, boolean>;
      ready: boolean;
    }
  | {
      type: "signalCatalog";
      signals: ClientScriptSignalCatalogItem[];
      ready: boolean;
    }
  | {
      type: "turnoutCatalog";
      turnouts: ClientScriptTurnoutCatalogItem[];
      ready: boolean;
    }
  | {
      type: "signalStateSnapshot";
      states: Record<string, string>;
    }
  | {
      type: "turnoutStateSnapshot";
      states: Record<string, boolean>;
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
