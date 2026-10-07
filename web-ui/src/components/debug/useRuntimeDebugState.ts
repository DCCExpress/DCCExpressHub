import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { wsClient } from "@/services/wsClient";

export type DebugStateValue<T> = {
  value: T;
  updatedAt: number;
};

export type SensorDebugState =
  Map<number, DebugStateValue<boolean>>;

export type TurnoutDebugValue = {
  physicalValue: boolean;
  logicalClosed: boolean | null;
  outputMode: "accessory" | "extended" | "vpin";
  aspect: number | null;
  closedAspect: number;
  openedAspect: number;
};

export type TurnoutDebugState =
  Map<number, DebugStateValue<TurnoutDebugValue>>;

export type BasicAccessoryDebugState =
  Map<number, DebugStateValue<boolean>>;

export type BasicAccessoryLayoutOwner = {
  type: string;
  name: string;
};

export type BasicAccessoryLayoutOwners =
  Map<number, BasicAccessoryLayoutOwner[]>;

export type ExtendedAccessoryDebugState =
  Map<number, DebugStateValue<number>>;

type TurnoutConfig = {
  outputMode: "accessory" | "extended" | "vpin";
  closedValue: boolean;
  closedAspect: number;
  openedAspect: number;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integerValue(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function turnoutMode(value: unknown): TurnoutConfig["outputMode"] {
  if (value === "extended") return "extended";
  if (value === "vpin") return "vpin";
  return "accessory";
}

function buildBasicAccessoryLayoutOwners(
  layoutValue: unknown
): BasicAccessoryLayoutOwners {
  const result: BasicAccessoryLayoutOwners = new Map();
  const layout = objectValue(layoutValue);
  const layers = Array.isArray(layout?.layers) ? layout.layers : [];

  const add = (
    addressValue: unknown,
    type: string,
    name: string
  ) => {
    const address = integerValue(addressValue);
    if (address <= 0 || address > 65535) return;

    const owners = result.get(address) ?? [];

    if (
      !owners.some(
        owner =>
          owner.type === type &&
          owner.name === name
      )
    ) {
      owners.push({ type, name });
      result.set(address, owners);
    }
  };

  const addRange = (
    startValue: unknown,
    countValue: unknown,
    type: string,
    name: string
  ) => {
    const start = integerValue(startValue);
    const count = Math.max(1, integerValue(countValue, 1));

    if (start <= 0 || start > 65535) return;

    for (let offset = 0; offset < count; offset += 1) {
      add(start + offset, type, name);
    }
  };

  for (const rawLayer of layers) {
    const layer = objectValue(rawLayer);
    const elements = Array.isArray(layer?.elements) ? layer.elements : [];

    for (const rawElement of elements) {
      const element = objectValue(rawElement);
      if (!element) continue;

      const type = String(element.type ?? "");
      const name = String(element.name ?? "").trim() || "—";

      const isTurnout = [
        "trackturnout",
        "trackturnoutleft",
        "trackturnoutright",
        "trackturnoutdouble",
        "trackturnouttwoway",
        "trackturnouttreeway",
      ].includes(type);

      if (isTurnout) {
        if (turnoutMode(element.outputMode) !== "accessory") {
          continue;
        }

        if (
          type === "trackturnoutdouble" ||
          type === "trackturnouttreeway"
        ) {
          add(element.turnout1Address, type, name);
          add(element.turnout2Address, type, name);
        } else {
          add(
            integerValue(element.turnoutAddress) ||
              integerValue(element.address),
            type,
            name
          );
        }

        continue;
      }

      if (type === "button") {
        if (element.outputMode !== "extended") {
          add(element.address, type, name);
        }
        continue;
      }

      const signalOutput = objectValue(element.signalOutput);

      if (type === "tracklevelcrossing") {
        if (signalOutput?.protocol === "dcc") {
          addRange(
            signalOutput.address,
            signalOutput.outputCount,
            type,
            name
          );
        } else if (!signalOutput) {
          add(element.basicAccessoryAddress, type, name);
        }
        continue;
      }

      if (
        type === "tracksignal" ||
        type === "tracksignal2" ||
        type === "tracksignal3" ||
        type === "tracksignal4"
      ) {
        if (signalOutput?.protocol === "dcc") {
          addRange(
            signalOutput.address,
            signalOutput.outputCount,
            type,
            name
          );
        } else if (!signalOutput) {
          addRange(
            element.address,
            element.addressLength,
            type,
            name
          );
        }
      }
    }
  }

  return result;
}

function buildTurnoutConfig(layoutValue: unknown): Map<number, TurnoutConfig> {
  const result = new Map<number, TurnoutConfig>();
  const layout = objectValue(layoutValue);
  const layers = Array.isArray(layout?.layers) ? layout.layers : [];

  for (const rawLayer of layers) {
    const layer = objectValue(rawLayer);
    const elements = Array.isArray(layer?.elements) ? layer.elements : [];

    for (const rawElement of elements) {
      const element = objectValue(rawElement);
      if (!element) continue;

      const type = String(element.type ?? "");
      const isTurnout = [
        "trackturnout",
        "trackturnoutleft",
        "trackturnoutright",
        "trackturnoutdouble",
        "trackturnouttwoway",
        "trackturnouttreeway",
      ].includes(type);

      if (!isTurnout) continue;

      const mode = turnoutMode(element.outputMode);

      const add = (
        addressValue: unknown,
        closedValue: unknown,
        closedAspect: unknown,
        openedAspect: unknown
      ) => {
        const address = integerValue(addressValue);
        if (address <= 0 || address > 65535) return;

        result.set(address, {
          outputMode: mode,
          closedValue: Boolean(closedValue ?? false),
          closedAspect: Math.max(0, Math.min(255, integerValue(closedAspect, 0))),
          openedAspect: Math.max(0, Math.min(255, integerValue(openedAspect, 1))),
        });
      };

      if (type === "trackturnoutdouble" || type === "trackturnouttreeway") {
        add(
          element.turnout1Address,
          element.turnout1ClosedValue,
          element.turnout1ClosedAspect,
          element.turnout1OpenedAspect
        );
        add(
          element.turnout2Address,
          element.turnout2ClosedValue,
          element.turnout2ClosedAspect,
          element.turnout2OpenedAspect
        );
      } else {
        add(
          integerValue(element.turnoutAddress) || integerValue(element.address),
          element.turnoutClosedValue,
          element.turnoutClosedAspect,
          element.turnoutOpenedAspect
        );
      }
    }
  }

  return result;
}
function updatedMap<T>(
  previous: Map<number, DebugStateValue<T>>,
  address: number,
  value: T,
  updatedAt = Date.now()
) {
  const next = new Map(previous);
  next.set(address, { value, updatedAt });
  return next;
}

export function useRuntimeDebugState(
  active: boolean
) {
  const [sensors, setSensors] =
    useState<SensorDebugState>(() => new Map());

  const [turnouts, setTurnouts] =
    useState<TurnoutDebugState>(() => new Map());

  const [basicAccessories, setBasicAccessories] =
    useState<BasicAccessoryDebugState>(() => new Map());

  const [
    basicAccessoryLayoutOwners,
    setBasicAccessoryLayoutOwners,
  ] =
    useState<BasicAccessoryLayoutOwners>(() => new Map());

  const [extendedAccessories, setExtendedAccessories] =
    useState<ExtendedAccessoryDebugState>(() => new Map());

  const [connected, setConnected] =
    useState(wsClient.isConnected());

  const turnoutConfigRef =
    useRef<Map<number, TurnoutConfig>>(new Map());

  const refresh = useCallback(async () => {
    if (!wsClient.isConnected()) {
      return;
    }

    try {
      const response = await fetch("/api/layout", { cache: "no-store" });
      if (response.ok) {
        const layoutValue = await response.json();

        turnoutConfigRef.current =
          buildTurnoutConfig(layoutValue);

        setBasicAccessoryLayoutOwners(
          buildBasicAccessoryLayoutOwners(layoutValue)
        );
      }
    } catch {
      // Runtime snapshot is still useful even if layout metadata fetch fails.
    }

    // Snapshot replaces the topology-backed views.
    setBasicAccessories(new Map());
    setExtendedAccessories(new Map());
    setTurnouts(new Map());

    wsClient.send({
      type: "getLayoutRuntimeSnapshot",
      data: {},
    });

  }, []);

  useEffect(
    () =>
      wsClient.subscribeStatus(status =>
        setConnected(status === "connected")
      ),
    []
  );

  useEffect(() => {
    if (!active) {
      return;
    }

    const unsubscribeMessages =
      wsClient.subscribeMessages(message => {
        const untypedMessage =
          message as unknown as {
            type: string;
            data?: unknown;
          };

        if (untypedMessage.type === "runtimePhysicalSnapshot") {
          const snapshot = objectValue(untypedMessage.data);

          const nextBasic: BasicAccessoryDebugState = new Map();
          const nextExtended: ExtendedAccessoryDebugState = new Map();
          const now = Date.now();

          const rawBasic =
            Array.isArray(snapshot?.basicAccessories)
              ? snapshot.basicAccessories
              : [];

          for (const rawItem of rawBasic) {
            const item = objectValue(rawItem);
            if (!item) continue;

            const address = integerValue(item.address);
            if (address <= 0 || address > 65535) continue;

            nextBasic.set(address, {
              value: Boolean(item.active),
              updatedAt: now,
            });
          }

          const rawExtended =
            Array.isArray(snapshot?.extendedAccessories)
              ? snapshot.extendedAccessories
              : [];

          for (const rawItem of rawExtended) {
            const item = objectValue(rawItem);
            if (!item) continue;

            const address = integerValue(item.address);
            const aspect = integerValue(item.aspect, -1);

            if (
              address <= 0 ||
              address > 65535 ||
              aspect < 0 ||
              aspect > 255
            ) {
              continue;
            }

            nextExtended.set(address, {
              value: aspect,
              updatedAt: now,
            });
          }

          setBasicAccessories(nextBasic);
          setExtendedAccessories(nextExtended);
          setTurnouts(new Map());

          return;
        }

        // Sensor state is handled through the backend-neutral
        // sensorChanged / sensorSnapshot protocol below.
        return;
      });

    const unsubscribeSensorChanged =
      wsClient.on("sensorChanged", data => {
        const address = Number(data.address);

        if (
          !Number.isInteger(address) ||
          address <= 0 ||
          address > 65535
        ) {
          return;
        }

        setSensors(previous =>
          updatedMap(
            previous,
            address,
            Boolean(data.on)
          )
        );
      });

    const unsubscribeSensorSnapshot =
      wsClient.on("sensorSnapshot", data => {
        const next: SensorDebugState =
          new Map();

        const now = Date.now();

        for (
          const [
            baseAddress,
            activeBits,
            knownBits,
          ] of data.groups
        ) {
          for (let bit = 0; bit < 16; bit += 1) {
            const mask = 1 << bit;

            if ((knownBits & mask) === 0) {
              continue;
            }

            const address =
              baseAddress + bit;

            if (
              address <= 0 ||
              address > 65535
            ) {
              continue;
            }

            next.set(address, {
              value:
                (activeBits & mask) !== 0,
              updatedAt: now,
            });
          }
        }

        setSensors(next);
      });

    const unsubscribeTurnout =
      wsClient.on("turnoutChanged", data => {
        const config = turnoutConfigRef.current.get(data.address);

        const outputMode = config?.outputMode ??
          (data.outputMode === "extended"
            ? "extended"
            : data.outputMode === "vpin"
              ? "vpin"
              : "accessory");

        const aspect =
          typeof data.aspect === "number"
            ? data.aspect
            : null;

        const closedAspect =
          config?.closedAspect ??
          (typeof data.closedAspect === "number" ? data.closedAspect : 0);

        const openedAspect =
          config?.openedAspect ??
          (typeof data.openedAspect === "number" ? data.openedAspect : 1);

        let logicalClosed: boolean | null =
          typeof data.logicalClosed === "boolean"
            ? data.logicalClosed
            : null;

        if (logicalClosed === null && config) {
          if (outputMode === "extended" && aspect !== null) {
            logicalClosed =
              aspect === closedAspect
                ? true
                : aspect === openedAspect
                  ? false
                  : null;
          } else if (outputMode !== "extended") {
            logicalClosed = data.closed === config.closedValue;
          }
        }

        setTurnouts(previous =>
          updatedMap(
            previous,
            data.address,
            {
              physicalValue: data.closed,
              logicalClosed,
              outputMode,
              aspect,
              closedAspect,
              openedAspect,
            }
          )
        );

        // A Basic turnout is a view over the same Basic accessory endpoint.
        // Keep the physical tab in lockstep even on backends that emit only
        // turnoutChanged for a turnout command.
        if (outputMode === "accessory") {
          setBasicAccessories(previous =>
            updatedMap(
              previous,
              data.address,
              data.closed
            )
          );
        }

        if (
          outputMode === "extended" &&
          typeof data.aspect === "number"
        ) {
          setExtendedAccessories(previous =>
            updatedMap(
              previous,
              data.address,
              data.aspect as number
            )
          );
        }
      });

    const unsubscribeBasicAccessory =
      wsClient.on("accessoryChanged", data => {
        setBasicAccessories(previous =>
          updatedMap(
            previous,
            data.address,
            data.active
          )
        );

        // ESP compatibility: older turnoutChanged payloads do not carry
        // outputMode. The physical endpoint type still tells us the truth.
        setTurnouts(previous => {
          const current = previous.get(data.address);
          if (!current) return previous;

          return updatedMap(
            previous,
            data.address,
            {
              ...current.value,
              outputMode: "accessory",
              physicalValue: data.active,
              logicalClosed: (() => {
                const config = turnoutConfigRef.current.get(data.address);
                return config ? data.active === config.closedValue : current.value.logicalClosed;
              })(),
            }
          );
        });
      });

    const unsubscribeExtendedAccessory =
      wsClient.on("signalAspectChanged", data => {
        setExtendedAccessories(previous =>
          updatedMap(
            previous,
            data.address,
            data.aspect
          )
        );

        setTurnouts(previous => {
          const current = previous.get(data.address);
          if (!current) return previous;

          return updatedMap(
            previous,
            data.address,
            {
              ...current.value,
              outputMode: "extended",
              aspect: data.aspect,
              logicalClosed: (() => {
                const config = turnoutConfigRef.current.get(data.address);
                if (!config) return current.value.logicalClosed;
                if (data.aspect === config.closedAspect) return true;
                if (data.aspect === config.openedAspect) return false;
                return null;
              })(),
              closedAspect: turnoutConfigRef.current.get(data.address)?.closedAspect ?? current.value.closedAspect,
              openedAspect: turnoutConfigRef.current.get(data.address)?.openedAspect ?? current.value.openedAspect,
            }
          );
        });
      });

    // Sensor state is rebuilt from the backend-neutral authoritative snapshot.
    setSensors(new Map());
    setTurnouts(new Map());

    void refresh();

    return () => {
      unsubscribeMessages();
      unsubscribeSensorChanged();
      unsubscribeSensorSnapshot();
      unsubscribeTurnout();
      unsubscribeBasicAccessory();
      unsubscribeExtendedAccessory();
    };
  }, [active, refresh]);

  return useMemo(
    () => ({
      sensors,
      turnouts,
      basicAccessories,
      basicAccessoryLayoutOwners,
      extendedAccessories,
      refresh,
      connected,
    }),
    [
      sensors,
      turnouts,
      basicAccessories,
      basicAccessoryLayoutOwners,
      extendedAccessories,
      refresh,
      connected,
    ]
  );
}
