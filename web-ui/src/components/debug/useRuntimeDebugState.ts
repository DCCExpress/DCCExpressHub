import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { wsClient } from "@/services/wsClient";

export type DebugStateValue<T> = {
  value: T;
  updatedAt: number;
};

export type SensorDebugState =
  Map<
    number,
    DebugStateValue<boolean>
  >;

export type TurnoutDebugValue = {
  physicalValue: boolean;
  outputMode: "accessory" | "extended";
  aspect: number | null;
  closedAspect: number;
  openedAspect: number;
};

export type TurnoutDebugState =
  Map<
    number,
    DebugStateValue<TurnoutDebugValue>
  >;

export type BasicAccessoryDebugState =
  Map<
    number,
    DebugStateValue<boolean>
  >;

export type ExtendedAccessoryDebugState =
  Map<
    number,
    DebugStateValue<number>
  >;

type RawInfoPayload = {
  raw: string;
};

const SENSOR_FRAME =
  /^<([Qq])\s+(\d+)>$/;

function updatedMap<T>(
  previous:
    Map<number,DebugStateValue<T>>,
  address: number,
  value: T,
  updatedAt=Date.now()
) {
  const next=
    new Map(
      previous
    );

  next.set(
    address,
    {
      value,
      updatedAt,
    }
  );

  return next;
}

export function useRuntimeDebugState(
  active: boolean
) {
  const [
    sensors,
    setSensors,
  ] =
    useState<SensorDebugState>(
      () => new Map()
    );

  const [
    turnouts,
    setTurnouts,
  ] =
    useState<TurnoutDebugState>(
      () => new Map()
    );

  const [
    basicAccessories,
    setBasicAccessories,
  ] =
    useState<BasicAccessoryDebugState>(
      () => new Map()
    );

  const [
    extendedAccessories,
    setExtendedAccessories,
  ] =
    useState<ExtendedAccessoryDebugState>(
      () => new Map()
    );

  const [
    connected,
    setConnected,
  ] =
    useState(
      wsClient.isConnected()
    );

  const refresh=
    useCallback(
      () => {
        if(
          !wsClient.isConnected()
        ) {
          return;
        }

        wsClient.send({
          type:
            "getLayoutRuntimeSnapshot",
          data: {},
        });

        wsClient.send({
          type:
            "writeDccExDirectCommand",
          data: {
            command:
              "<Q>",
          },
        });
      },
      []
    );

  useEffect(
    () =>
      wsClient.subscribeStatus(
        status =>
          setConnected(
            status===
            "connected"
          )
      ),
    []
  );

  useEffect(
    () => {
      if(!active) {
        return;
      }

      const unsubscribeMessages=
        wsClient.subscribeMessages(
          message => {
            if(
              message.type!==
              "rawInfo"
            ) {
              return;
            }

            const data=
              message.data as
                RawInfoPayload |
                undefined;

            const raw=
              data?.raw?.trim();

            if(!raw) {
              return;
            }

            const match=
              SENSOR_FRAME.exec(
                raw
              );

            if(!match) {
              return;
            }

            const address=
              Number.parseInt(
                match[2],
                10
              );

            if(
              !Number.isInteger(
                address
              ) ||
              address<=0 ||
              address>65535
            ) {
              return;
            }

            const on=
              match[1]===
              "Q";

            setSensors(
              previous =>
                updatedMap(
                  previous,
                  address,
                  on
                )
            );
          }
        );

      const unsubscribeTurnout=
        wsClient.on(
          "turnoutChanged",
          data => {
            const outputMode=
              data.outputMode===
              "extended"
                ? "extended"
                : "accessory";

            setTurnouts(
              previous =>
                updatedMap(
                  previous,
                  data.address,
                  {
                    physicalValue:
                      data.closed,

                    outputMode,

                    aspect:
                      typeof data.aspect===
                      "number"
                        ? data.aspect
                        : null,

                    closedAspect:
                      typeof data.closedAspect===
                      "number"
                        ? data.closedAspect
                        : 0,

                    openedAspect:
                      typeof data.openedAspect===
                      "number"
                        ? data.openedAspect
                        : 1,
                  }
                )
            );
          }
        );

      const unsubscribeBasicAccessory=
        wsClient.on(
          "accessoryChanged",
          data => {
            setBasicAccessories(
              previous =>
                updatedMap(
                  previous,
                  data.address,
                  data.active
                )
            );
          }
        );

      const unsubscribeExtendedAccessory=
        wsClient.on(
          "signalAspectChanged",
          data => {
            setExtendedAccessories(
              previous =>
                updatedMap(
                  previous,
                  data.address,
                  data.aspect
                )
            );
          }
        );

      setSensors(
        new Map()
      );

      refresh();

      return () => {
        unsubscribeMessages();
        unsubscribeTurnout();
        unsubscribeBasicAccessory();
        unsubscribeExtendedAccessory();
      };
    },
    [
      active,
      refresh,
    ]
  );

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
