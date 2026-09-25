import type {
  TurnoutStateRequirement,
} from "@domain/railway/graph";

import type {
  LayoutView,
} from "@/models/editor/core/LayoutView";

import TrackTurnoutDoubleElement from "@/models/editor/elements/TrackTurnoutDoubleElement";
import {
  TrackTurnoutThreeWayElement,
} from "@/models/editor/elements/TrackTurnoutThreeWayElement";

import {
  wsClient,
} from "@/services/wsClient";

type SwitchManResponseData = {
  requestId?: string;
  action?: string;
  ok?: boolean;
  message?: string | null;
  extra?: {
    locks?: unknown[];
    conflicts?: unknown[];
    released?: number;
  } | null;
};

function createRequestId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve =>
    window.setTimeout(resolve, ms)
  );
}

async function switchManRequest(
  action: string,
  data: Record<string, unknown>,
  timeoutMs = 10000
): Promise<SwitchManResponseData> {
  const requestId =
    createRequestId(
      `route-test-${action}`
    );

  return await new Promise<SwitchManResponseData>(
    (resolve, reject) => {
      let settled = false;

      const finish = (
        callback: () => void
      ) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timer);
        unsubscribe();
        callback();
      };

      const unsubscribe =
        wsClient.subscribeMessages(
          message => {
            const raw =
              message as unknown as {
                type?: string;
                data?: SwitchManResponseData;
              };

            if (
              raw.type !==
                "switchManResponse" ||
              raw.data?.requestId !==
                requestId ||
              raw.data?.action !==
                action
            ) {
              return;
            }

            if (!raw.data.ok) {
              finish(() =>
                reject(
                  new Error(
                    raw.data?.message ||
                    `SwitchMan ${action} failed.`
                  )
                )
              );

              return;
            }

            finish(() =>
              resolve(
                raw.data ?? {}
              )
            );
          }
        );

      const timer =
        window.setTimeout(
          () => {
            finish(() =>
              reject(
                new Error(
                  `SwitchMan ${action} timed out.`
                )
              )
            );
          },
          timeoutMs
        );

      const sent =
        wsClient.send({
          type:
            "switchManCommand",
          data: {
            requestId,
            action,
            ...data,
          },
        } as any);

      if (!sent) {
        finish(() =>
          reject(
            new Error(
              "Nincs WebSocket kapcsolat a backendhez."
            )
          )
        );
      }
    }
  );
}

function normalizeRequirements(
  turnoutStates:
    readonly TurnoutStateRequirement[]
): TurnoutStateRequirement[] {
  const byAddress =
    new Map<number, boolean>();

  for (const state of turnoutStates) {
    const address =
      Math.trunc(
        Number(
          state.address
        )
      );

    if (
      !Number.isInteger(address) ||
      address <= 0 ||
      address > 2048
    ) {
      throw new Error(
        `Érvénytelen váltócím a gráfban: ${state.address}.`
      );
    }

    const existing =
      byAddress.get(address);

    if (
      existing !== undefined &&
      existing !== state.closed
    ) {
      throw new Error(
        `Ellentmondó váltóállapot a gráfban: ${address}. cím egyszerre CLOSED és THROWN.`
      );
    }

    byAddress.set(
      address,
      state.closed
    );
  }

  return [
    ...byAddress.entries(),
  ]
    .sort(
      ([a], [b]) =>
        a - b
    )
    .map(
      ([address, closed]) => ({
        address,
        closed,
      })
    );
}

function physicalBit(
  logicalClosed: boolean,
  closedValue: boolean
): boolean {
  return logicalClosed
    ? closedValue
    : !closedValue;
}

function validateMultiMotorRequirements(
  layout: LayoutView,
  requirements:
    readonly TurnoutStateRequirement[]
): void {
  const byAddress =
    new Map(
      requirements.map(
        item => [
          item.address,
          item.closed,
        ] as const
      )
    );

  for (const element of layout.getAllElements()) {
    if (
      element instanceof TrackTurnoutDoubleElement
    ) {
      const first =
        byAddress.get(
          element.turnout1Address
        );
      const second =
        byAddress.get(
          element.turnout2Address
        );

      if (
        first === undefined &&
        second === undefined
      ) {
        continue;
      }

      if (
        first === undefined ||
        second === undefined
      ) {
        throw new Error(
          `Double turnout #${element.id}: az útvonal csak az egyik motort tartalmazza. A két motor állapotát együtt kell megadni.`
        );
      }

      const physicalFirst =
        physicalBit(
          first,
          element.turnout1ClosedValue
        );
      const physicalSecond =
        physicalBit(
          second,
          element.turnout2ClosedValue
        );

      const validPairs = [
        [
          element.ooMotor1Value,
          element.ooMotor2Value,
          "OO",
        ] as const,
        [
          element.ocMotor1Value,
          element.ocMotor2Value,
          "OC",
        ] as const,
        [
          element.coMotor1Value,
          element.coMotor2Value,
          "CO",
        ] as const,
        [
          element.ccMotor1Value,
          element.ccMotor2Value,
          "CC",
        ] as const,
      ];

      if (
        !validPairs.some(
          ([a, b]) =>
            a === physicalFirst &&
            b === physicalSecond
        )
      ) {
        throw new Error(
          `Double turnout #${element.id}: a gráf által kért fizikai bitpár (${physicalFirst ? 1 : 0}${physicalSecond ? 1 : 0}) nem szerepel a konfigurált OO/OC/CO/CC táblában.`
        );
      }

      continue;
    }

    if (
      element instanceof TrackTurnoutThreeWayElement
    ) {
      const first =
        byAddress.get(
          element.turnout1Address
        );
      const second =
        byAddress.get(
          element.turnout2Address
        );

      if (
        first === undefined &&
        second === undefined
      ) {
        continue;
      }

      if (
        first === undefined ||
        second === undefined
      ) {
        throw new Error(
          `3-way turnout #${element.id}: az útvonal csak az egyik motort tartalmazza. A két motor állapotát együtt kell megadni.`
        );
      }

      const physicalFirst =
        physicalBit(
          first,
          element.turnout1ClosedValue
        );
      const physicalSecond =
        physicalBit(
          second,
          element.turnout2ClosedValue
        );

      const positions = [
        [
          element.leftMotor1Value,
          element.leftMotor2Value,
          "LEFT",
        ] as const,
        [
          element.straightMotor1Value,
          element.straightMotor2Value,
          "STRAIGHT",
        ] as const,
        [
          element.rightMotor1Value,
          element.rightMotor2Value,
          "RIGHT",
        ] as const,
      ];

      if (
        !positions.some(
          ([a, b]) =>
            a === physicalFirst &&
            b === physicalSecond
        )
      ) {
        throw new Error(
          `3-way turnout #${element.id}: a gráf által kért fizikai bitpár (${physicalFirst ? 1 : 0}${physicalSecond ? 1 : 0}) nem LEFT / STRAIGHT / RIGHT állapot. A parancs NEM lett elküldve.`
        );
      }
    }
  }
}

function verifyAddressesExist(
  layout: LayoutView,
  requirements:
    readonly TurnoutStateRequirement[]
): void {
  const elements =
    layout.getAllElements();

  const knownAddresses =
    new Set<number>();

  for (const raw of elements) {
    const element =
      raw as unknown as
        Record<string, unknown>;

    const addresses = [
      Number(
        element.turnoutAddress ??
          0
      ),
      Number(
        element.turnout1Address ??
          0
      ),
      Number(
        element.turnout2Address ??
          0
      ),
    ];

    for (const address of addresses) {
      if (
        Number.isInteger(address) &&
        address > 0
      ) {
        knownAddresses.add(
          address
        );
      }
    }
  }

  for (const state of requirements) {
    if (
      !knownAddresses.has(
        state.address
      )
    ) {
      throw new Error(
        `A gráf ${state.address}. váltócíme nem található a layoutban.`
      );
    }
  }
}

/**
 * Test a graph edge / complete route using the backend's authoritative
 * SwitchMan path.
 *
 * IMPORTANT:
 * - Graph turnout states are LOGICAL CLOSED/THROWN states.
 * - We do NOT convert to physical accessory bits in the frontend.
 * - switchManCommand/set converts logical state to physical output through
 *   LayoutRuntime.ClosedValue in the backend.
 * - All required turnout addresses are acquired atomically before the first
 *   command, so no other script/manual operation can interleave the route test.
 * - Every set operation waits for the backend ACK.
 */
export async function testRouteTurnoutStates(
  layout: LayoutView,
  turnoutStates:
    readonly TurnoutStateRequirement[],
  delayMs = 500
): Promise<number> {
  const requirements =
    normalizeRequirements(
      turnoutStates
    );

  if (
    requirements.length === 0
  ) {
    return 0;
  }

  verifyAddressesExist(
    layout,
    requirements
  );

  /*
   * Fail closed before acquiring or moving anything if a Double / 3-way
   * requirement is partial or maps to a non-configured physical bit pair.
   */
  validateMultiMotorRequirements(
    layout,
    requirements
  );

  const addresses =
    requirements.map(
      state =>
        state.address
    );

  const ownerId =
    createRequestId(
      "route-test-owner"
    );

  const ownerName =
    "Route graph test";

  let acquired = false;

  try {
    await switchManRequest(
      "acquire",
      {
        ownerId,
        ownerName,
        addresses,
        timeoutMs: 5000,
      },
      7000
    );

    acquired = true;

    for (
      let index = 0;
      index < requirements.length;
      index += 1
    ) {
      const requirement =
        requirements[index]!;

      /*
       * Send LOGICAL CLOSED/THROWN.
       *
       * Backend:
       *   logicalClosed = data.closed
       *   physicalValue =
       *       logicalClosed
       *         ? turnout.ClosedValue
       *         : !turnout.ClosedValue
       *
       * This is the same authoritative conversion used by scripted SwitchMan.
       */
      await switchManRequest(
        "set",
        {
          ownerId,
          ownerName,
          address:
            requirement.address,
          closed:
            requirement.closed,
        },
        7000
      );

      if (
        delayMs > 0 &&
        index <
          requirements.length - 1
      ) {
        await sleep(
          delayMs
        );
      }
    }

    /*
     * Ask for an authoritative runtime snapshot after the final command so
     * the canvas turnout visuals are reconciled immediately with backend state.
     */
    wsClient.send({
      type:
        "getLayoutRuntimeSnapshot",
      data: {},
    } as any);

    return requirements.length;
  } finally {
    if (acquired) {
      try {
        await switchManRequest(
          "release",
          {
            ownerId,
            ownerName,
            addresses,
          },
          5000
        );
      } catch {
        /*
         * Do not hide the original command result because a cleanup ACK was
         * lost. The owner ID is unique per test and the backend normally
         * releases the complete group here.
         */
      }
    }
  }
}
