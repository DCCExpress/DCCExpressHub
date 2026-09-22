import { useCallback, useEffect, useMemo, useState } from "react";
import { wsClient } from "@/services/wsClient";

export type DebugStateValue<T> = {
  value: T;
  updatedAt: number;
};

export type SensorDebugState =
  Map<number, DebugStateValue<boolean>>;

export type TurnoutDebugState =
  Map<number, DebugStateValue<boolean>>;

export type BasicAccessoryDebugState =
  Map<number, DebugStateValue<boolean>>;

export type ExtendedAccessoryDebugState =
  Map<number, DebugStateValue<number>>;

type RawInfoPayload = {
  raw: string;
};

const SENSOR_FRAME =
  /^<([Qq])\s+(\d+)>$/;

function updatedMap<T>(
  previous: Map<number, DebugStateValue<T>>,
  address: number,
  value: T,
  updatedAt = Date.now()
) {
  const next = new Map(previous);

  next.set(address, {
    value,
    updatedAt,
  });

  return next;
}

export function useRuntimeDebugState(
  active: boolean
) {
  const [sensors, setSensors] =
    useState<SensorDebugState>(() => new Map());

  const [turnouts, setTurnouts] =
    useState<TurnoutDebugState>(() => new Map());

  const [
    basicAccessories,
    setBasicAccessories,
  ] = useState<BasicAccessoryDebugState>(
    () => new Map()
  );

  const [
    extendedAccessories,
    setExtendedAccessories,
  ] = useState<ExtendedAccessoryDebugState>(
    () => new Map()
  );

  const [connected, setConnected] =
    useState(wsClient.isConnected());

  /*
   * The Debug dialog deliberately asks DCC-EX itself
   * for the complete physical sensor state.
   *
   * <Q> makes DCC-EX return one <Q address> / <q address>
   * frame for every registered sensor.
   *
   * Those frames are already exposed by the .NET backend
   * through the existing rawInfo WebSocket event, so the
   * debug panel does not need to depend on layout.json.
   */
  const refresh = useCallback(() => {
    if (!wsClient.isConnected()) {
      return;
    }

    /*
     * Refresh turnout/accessory state already known by
     * LayoutRuntime.
     */
    wsClient.send({
      type: "getLayoutRuntimeSnapshot",
      data: {},
    });

    /*
     * Request the authoritative physical sensor snapshot
     * directly from DCC-EX.
     */
    wsClient.send({
      type: "writeDccExDirectCommand",
      data: {
        command: "<Q>",
      },
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

    /*
     * rawInfo contains the original DCC-EX frames.
     *
     * DccExProtocol publishes RawInfo BEFORE it handles
     * Q/q sensor feedback, therefore this sees every
     * physical sensor returned by <Q>, including addresses
     * which are not present anywhere in the layout.
     */
    const unsubscribeMessages =
      wsClient.subscribeMessages(message => {
        if (message.type !== "rawInfo") {
          return;
        }

        const data =
          message.data as RawInfoPayload | undefined;

        const raw =
          data?.raw?.trim();

        if (!raw) {
          return;
        }

        const match =
          SENSOR_FRAME.exec(raw);

        if (!match) {
          return;
        }

        const address =
          Number.parseInt(match[2], 10);

        if (
          !Number.isInteger(address) ||
          address <= 0 ||
          address > 65535
        ) {
          return;
        }

        const on =
          match[1] === "Q";

        setSensors(previous =>
          updatedMap(
            previous,
            address,
            on
          )
        );
      });

    /*
     * Keep the normal runtime events for the other tabs.
     */
    const unsubscribeTurnout =
      wsClient.on(
        "turnoutChanged",
        data => {
          setTurnouts(previous =>
            updatedMap(
              previous,
              data.address,
              data.closed
            )
          );
        }
      );

    const unsubscribeBasicAccessory =
      wsClient.on(
        "accessoryChanged",
        data => {
          setBasicAccessories(previous =>
            updatedMap(
              previous,
              data.address,
              data.active
            )
          );
        }
      );

    const unsubscribeExtendedAccessory =
      wsClient.on(
        "signalAspectChanged",
        data => {
          setExtendedAccessories(previous =>
            updatedMap(
              previous,
              data.address,
              data.aspect
            )
          );
        }
      );

    /*
     * Start with a clean sensor list. The following <Q>
     * response repopulates it from the actual command
     * station state, so stale addresses from an earlier
     * snapshot cannot remain visible.
     */
    setSensors(new Map());

    refresh();

    return () => {
      unsubscribeMessages();
      unsubscribeTurnout();
      unsubscribeBasicAccessory();
      unsubscribeExtendedAccessory();
    };
  }, [
    active,
    refresh,
  ]);

  return useMemo(
    () => ({
      sensors,
      turnouts,
      basicAccessories,
      extendedAccessories,
      refresh,
      connected,
    }),
    [
      sensors,
      turnouts,
      basicAccessories,
      extendedAccessories,
      refresh,
      connected,
    ]
  );
}
