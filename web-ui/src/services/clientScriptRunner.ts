import {
  wsApi,
} from "./wsApi";

export type ClientScriptElementContext = {
  id: number;
  name: string;
  type: string;
};

type ScriptDirection =
  | "forward"
  | "reverse";

type AsyncFunctionFactory =
  new (
    ...args: string[]
  ) => (
    ...values: unknown[]
  ) => Promise<unknown>;

const AsyncFunction =
  Object.getPrototypeOf(
    async function () {}
  ).constructor as AsyncFunctionFactory;

const runningElementIds =
  new Set<number>();

function requireSend(
  ok: boolean,
  label: string
): void {
  if (!ok) {
    throw new Error(
      `${label}: WebSocket command could not be sent.`
    );
  }
}

function integer(
  value: number,
  min: number,
  max: number,
  name: string
): number {
  if (
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(
      `${name} must be an integer between ${min} and ${max}.`
    );
  }

  return value;
}

function createDccApi() {
  return Object.freeze({
    power(on: boolean): void {
      requireSend(
        wsApi.setTrackPower(Boolean(on)),
        "dcc.power"
      );
    },

    programmingPower(on: boolean): void {
      requireSend(
        wsApi.setProgrammingPower(Boolean(on)),
        "dcc.programmingPower"
      );
    },

    emergencyStop(): void {
      requireSend(
        wsApi.emergencyStop(),
        "dcc.emergencyStop"
      );
    },

    loco(
      address: number,
      speed: number,
      direction: ScriptDirection = "forward"
    ): void {
      const locoAddress =
        integer(
          address,
          1,
          10239,
          "Locomotive address"
        );

      const locoSpeed =
        integer(
          speed,
          0,
          126,
          "Locomotive speed"
        );

      if (
        direction !== "forward" &&
        direction !== "reverse"
      ) {
        throw new Error(
          'Direction must be "forward" or "reverse".'
        );
      }

      requireSend(
        wsApi.setLoco(
          locoAddress,
          locoSpeed,
          direction
        ),
        "dcc.loco"
      );
    },

    locoFunction(
      address: number,
      functionNumber: number,
      active: boolean
    ): void {
      requireSend(
        wsApi.setLocoFunction(
          integer(
            address,
            1,
            10239,
            "Locomotive address"
          ),
          integer(
            functionNumber,
            0,
            28,
            "Function number"
          ),
          Boolean(active)
        ),
        "dcc.locoFunction"
      );
    },

    turnout(
      address: number,
      closed: boolean
    ): void {
      requireSend(
        wsApi.setTurnout(
          integer(
            address,
            1,
            2048,
            "Turnout address"
          ),
          Boolean(closed)
        ),
        "dcc.turnout"
      );
    },

    sensor(
      address: number,
      on: boolean
    ): void {
      requireSend(
        wsApi.setSensor(
          integer(
            address,
            1,
            65535,
            "Sensor address"
          ),
          Boolean(on)
        ),
        "dcc.sensor"
      );
    },

    accessory(
      address: number,
      active: boolean
    ): void {
      requireSend(
        wsApi.setBasicAccessory(
          integer(
            address,
            1,
            2048,
            "Accessory address"
          ),
          Boolean(active)
        ),
        "dcc.accessory"
      );
    },

    signal(
      address: number,
      aspect: number
    ): void {
      requireSend(
        wsApi.setSignalAspect(
          integer(
            address,
            1,
            2048,
            "Signal address"
          ),
          integer(
            aspect,
            0,
            255,
            "Signal aspect"
          )
        ),
        "dcc.signal"
      );
    },

    block(
      blockId: string | number,
      locoId: string | null,
      locoAddress?: number
    ): void {
      const wireBlockId =
        String(blockId);

      requireSend(
        wsApi.setBlock(
          wireBlockId,
          locoId,
          locoAddress === undefined
            ? undefined
            : integer(
                locoAddress,
                1,
                10239,
                "Locomotive address"
              )
        ),
        "dcc.block"
      );
    },

    clearBlock(
      blockId: string | number,
      locoId: string | null = null
    ): void {
      requireSend(
        wsApi.setBlockRemove(
          String(blockId),
          locoId
        ),
        "dcc.clearBlock"
      );
    },

    resetBlocks(): void {
      requireSend(
        wsApi.setBlocksReset(),
        "dcc.resetBlocks"
      );
    },

    raw(command: string): void {
      const value =
        String(command).trim();

      if (!value) {
        throw new Error(
          "dcc.raw requires a DCC-EX command."
        );
      }

      requireSend(
        wsApi.writeDccExDirectCommand(
          value
        ),
        "dcc.raw"
      );
    },
  });
}

export function delay(
  ms: number
): Promise<void> {
  const safeMs =
    Math.max(
      0,
      Math.min(
        600000,
        Number(ms) || 0
      )
    );

  return new Promise(resolve => {
    window.setTimeout(
      resolve,
      safeMs
    );
  });
}

export async function runClientScript(
  script: string,
  element: ClientScriptElementContext
): Promise<unknown> {
  if (!script.trim()) {
    return undefined;
  }

  if (
    runningElementIds.has(
      element.id
    )
  ) {
    throw new Error(
      `Script "${element.name || element.id}" is already running.`
    );
  }

  runningElementIds.add(
    element.id
  );

  const dcc =
    createDccApi();

  const log = (
    ...values: unknown[]
  ): void => {
    console.log(
      `[ScriptButton ${element.name || element.id}]`,
      ...values
    );
  };

  const safeElement =
    Object.freeze({
      ...element,
    });

  try {
    const fn =
      new AsyncFunction(
        "dcc",
        "delay",
        "log",
        "element",
        `"use strict";
${script}
//# sourceURL=dcc-express-script-button-${element.id}.js`
      );

    return await fn(
      dcc,
      delay,
      log,
      safeElement
    );
  } finally {
    runningElementIds.delete(
      element.id
    );
  }
}
