import { Card, Stack, Text } from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  Direction,
  Loco,
  LocoReservation,
} from "@domain/types";

import LocoPicker from "../components/loco/LocoPicker";
import { useCommandCenter } from "../context/CommandCenterContext";
import { showErrorMessage } from "../helpers";
import { wsApi } from "../services/wsApi";
import { wsClient } from "../services/wsClient";
import LocoControlCard from "./loco-panel/LocoControlCard";
import LocoFunctionGrid from "./loco-panel/LocoFunctionGrid";
import { useGamepadAction } from "../context/GamepadContext";

type LocoPanelProps = {
  locos?: Loco[];
  selectedLocoStorageKey?: string;
  mobileViewport?: boolean;
};

const SELECTED_LOCO_STORAGE_KEY =
  "dcc-express.loco-panel.selected-loco-id";

export default function LocoPanel({
  locos = [],
  selectedLocoStorageKey = SELECTED_LOCO_STORAGE_KEY,
  mobileViewport = false,
}: LocoPanelProps) {
  const { t } = useTranslation();

  const [selectedLocoId, setSelectedLocoId] =
    useState<string>(() => {
      return (
        window.localStorage.getItem(
          selectedLocoStorageKey
        ) ?? ""
      );
    });

  const currentAddressRef =
    useRef<number | null>(null);

  const [pickerOpened, setPickerOpened] =
    useState(false);

  const [speed, setSpeed] =
    useState(0);

  const [direction, setDirection] =
    useState<Direction>("forward");

  const [activeFunctions, setActiveFunctions] =
    useState<Record<number, boolean>>({});

  const [reservation, setReservation] =
    useState<LocoReservation | null>(null);

  const { powerInfo, alive } =
    useCommandCenter();

  const controlsDisabled = !alive;

  const fitContainerRef = useRef<HTMLDivElement>(null);
  const fitContentRef = useRef<HTMLDivElement>(null);

  const clearRuntimeState = useCallback(() => {
    setSpeed(0);
    setDirection("forward");
    setActiveFunctions({});
    setReservation(null);
  }, []);

  const requestCurrentLocoState = useCallback(() => {
    const address = currentAddressRef.current;

    if (address !== null) {
      wsApi.getLoco(address);
    }
  }, []);

  const selectLocoId = useCallback(
    (id: string) => {
      setSelectedLocoId(id);

      if (id) {
        window.localStorage.setItem(
          selectedLocoStorageKey,
          id
        );
      } else {
        window.localStorage.removeItem(
          selectedLocoStorageKey
        );
      }
    },
    [selectedLocoStorageKey]
  );

  useEffect(() => {
    if (locos.length === 0) {
      if (selectedLocoId) {
        selectLocoId("");
      }

      return;
    }

    if (
      selectedLocoId &&
      locos.some(loco => loco.id === selectedLocoId)
    ) {
      return;
    }

    selectLocoId(locos[0]?.id ?? "");
  }, [locos, selectedLocoId, selectLocoId]);

  const currentLoco = useMemo(() => {
    if (selectedLocoId) {
      const found =
        locos.find(loco => loco.id === selectedLocoId);

      if (found) {
        return found;
      }
    }

    return locos.length > 0
      ? locos[0]
      : null;
  }, [locos, selectedLocoId]);

  useEffect(() => {
    currentAddressRef.current =
      currentLoco?.address ?? null;

    clearRuntimeState();

    if (currentLoco) {
      wsApi.getLoco(currentLoco.address);
    }
  }, [currentLoco, clearRuntimeState]);

  useEffect(() => {
    const unsubscribe =
      wsClient.subscribeStatus(status => {
        if (status === "connected") {
          requestCurrentLocoState();
          return;
        }

        if (
          status === "disconnected" ||
          status === "reconnecting" ||
          status === "error"
        ) {
          clearRuntimeState();
        }
      });

    return unsubscribe;
  }, [
    clearRuntimeState,
    requestCurrentLocoState,
  ]);

  useEffect(() => {
    const unsubscribe =
      wsClient.on("locoState", data => {
        const loco = data.loco;

        if (!loco) {
          showErrorMessage(
            t("loco.stateTitle"),
            t("loco.errors.stateConvertFailed")
          );
          return;
        }

        if (
          loco.address !==
          currentAddressRef.current
        ) {
          return;
        }

        setSpeed(loco.speed);
        setDirection(loco.direction);
        setActiveFunctions(
          loco.functions ?? {}
        );

        setReservation(
          loco.reservation ?? null
        );
      });

    return unsubscribe;
  }, [t]);

  useEffect(() => {
    const unsubscribe =
      wsClient.on("locoReservationChanged", data => {
        if (
          data.locoAddress !==
          currentAddressRef.current
        ) {
          return;
        }

        wsApi.getLoco(data.locoAddress);
      });

    return unsubscribe;
  }, []);

  const handleSelectLoco = (
    loco: Loco
  ) => {
    selectLocoId(loco.id);
    setPickerOpened(false);
    clearRuntimeState();
  };

  const setLocoSpeed = (
    nextSpeed: number
  ) => {
    if (!currentLoco || controlsDisabled) {
      return;
    }

    setSpeed(nextSpeed);

    wsApi.setLoco(
      currentLoco.address,
      nextSpeed,
      direction
    );
  };

  const setLocoSpeedByPercent = (
    percent: number
  ) => {
    if (!currentLoco || controlsDisabled) {
      return;
    }

    const maxSpeed =
      currentLoco.maxSpeed || 100;

    const nextSpeed =
      Math.max(
        0,
        Math.min(
          Math.round(
            (maxSpeed * percent) / 100
          ),
          maxSpeed
        )
      );

    setLocoSpeed(nextSpeed);
  };

  const handleForward = () => {
    if (!currentLoco || controlsDisabled) {
      return;
    }

    setDirection("forward");

    wsApi.setLoco(
      currentLoco.address,
      speed,
      "forward"
    );
  };

  const handleReverse = () => {
    if (!currentLoco || controlsDisabled) {
      return;
    }

    setDirection("reverse");

    wsApi.setLoco(
      currentLoco.address,
      speed,
      "reverse"
    );
  };

  const handleStop = () => {
    if (!currentLoco || controlsDisabled) {
      return;
    }

    setSpeed(0);

    wsApi.setLoco(
      currentLoco.address,
      0,
      direction
    );
  };

  const handleEmergencyToggle = () => {
    if (!powerInfo || !alive) {
      return;
    }

    if (powerInfo.emergencyStop) {
      wsApi.powerOn();
      return;
    }

    wsApi.emergencyStop();
  };

  const handleFunctionToggle = (
    functionNumber: number
  ) => {
    if (!currentLoco || controlsDisabled) {
      return;
    }

    const active = !activeFunctions[functionNumber];

    setActiveFunctions(current => ({
      ...current,
      [functionNumber]: active,
    }));

    wsApi.setLocoFunction(
      currentLoco.address,
      functionNumber,
      active
    );
  };


  useEffect(() => {
    if (!mobileViewport) return;

    const container = fitContainerRef.current;
    const content = fitContentRef.current;

    if (!container || !content) return;

    let frame = 0;

    const updateScale = () => {
      content.style.setProperty("--throttle-scale", "1");
      content.style.setProperty("--throttle-offset-x", "0px");
      content.style.setProperty("--throttle-offset-y", "0px");

      const availableWidth = container.clientWidth;
      const availableHeight = container.clientHeight;

      const contentWidth = Math.max(
        content.offsetWidth,
        content.scrollWidth
      );
      const contentHeight = Math.max(
        content.offsetHeight,
        content.scrollHeight
      );

      if (
        availableWidth <= 0 ||
        availableHeight <= 0 ||
        contentWidth <= 0 ||
        contentHeight <= 0
      ) {
        return;
      }

      const scale = Math.min(
        availableWidth / contentWidth,
        availableHeight / contentHeight,
        1.25
      );

      const scaledWidth = contentWidth * scale;
      const scaledHeight = contentHeight * scale;

      content.style.setProperty(
        "--throttle-scale",
        String(scale)
      );

      content.style.setProperty(
        "--throttle-offset-x",
        `${Math.max(0, (availableWidth - scaledWidth) / 2)}px`
      );

      content.style.setProperty(
        "--throttle-offset-y",
        `${Math.max(0, (availableHeight - scaledHeight) / 2)}px`
      );
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateScale);
    };

    const observer = new ResizeObserver(scheduleUpdate);

    observer.observe(container);
    observer.observe(content);

    window.addEventListener("orientationchange", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener(
      "resize",
      scheduleUpdate
    );

    scheduleUpdate();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener(
        "orientationchange",
        scheduleUpdate
      );
      window.removeEventListener(
        "resize",
        scheduleUpdate
      );
      window.visualViewport?.removeEventListener(
        "resize",
        scheduleUpdate
      );
    };
  }, [currentLoco, mobileViewport]);


  useGamepadAction(
    "speedUp",
    () => {
      if (
        !currentLoco ||
        controlsDisabled
      ) {
        return;
      }

      const maxSpeed =
        currentLoco.maxSpeed || 100;

      setLocoSpeed(
        Math.min(
          speed + 5,
          maxSpeed
        )
      );
    }
  );

  useGamepadAction(
    "speedDown",
    () => {
      if (
        !currentLoco ||
        controlsDisabled
      ) {
        return;
      }

      setLocoSpeed(
        Math.max(
          speed - 5,
          0
        )
      );
    }
  );


  useGamepadAction(
    "forward",
    handleForward
  );

  useGamepadAction(
    "reverse",
    handleReverse
  );

  useGamepadAction(
    "stop",
    handleStop
  );

  useGamepadAction(
    "emergency",
    handleEmergencyToggle
  );

  useGamepadAction(
    "function0",
    () => handleFunctionToggle(0)
  );

  useGamepadAction(
    "function1",
    () => handleFunctionToggle(1)
  );

  useGamepadAction(
    "function2",
    () => handleFunctionToggle(2)
  );

  useGamepadAction(
    "function3",
    () => handleFunctionToggle(3)
  );

  return (
    <Card
      withBorder
      radius="sm"
      p="xs"
      h="100%"
      opacity={alive ? 1 : 0.75}
    >
      <div
        style={{
          position: "relative",
          height: "100%",
        }}
      >
        <LocoPicker
          opened={pickerOpened}
          locos={locos}
          selectedLocoId={currentLoco?.id}
          onClose={() => setPickerOpened(false)}
          onSelect={handleSelectLoco}
        />

        {/* <Stack gap="xs" h="100%">
          {!currentLoco ? (
            <Text size="sm" c="dimmed">
              {t("locopanel.nolocos")}
            </Text>
          ) : (
            <>
              <LocoControlCard
                loco={currentLoco}
                speed={speed}
                direction={direction}
                alive={alive}
                emergencyStop={
                  powerInfo?.emergencyStop ?? false
                }
                reservation={reservation}
                controlsDisabled={controlsDisabled}
                onOpenPicker={() =>
                  setPickerOpened(true)
                }
                onSpeedChange={setLocoSpeed}
                onSpeedPercentChange={
                  setLocoSpeedByPercent
                }
                onForward={handleForward}
                onReverse={handleReverse}
                onStop={handleStop}
                onEmergencyToggle={
                  handleEmergencyToggle
                }
              />

              <LocoFunctionGrid
                loco={currentLoco}
                activeFunctions={activeFunctions}
                disabled={controlsDisabled}
                onActiveFunctionsChange={
                  setActiveFunctions
                }
              />
            </>
          )}
        </Stack> */}

        <div
          ref={fitContainerRef}
          className={
            mobileViewport
              ? "mobile-throttle-fit mobile-throttle-fit--viewport"
              : "mobile-throttle-fit"
          }
        >
          <div
            ref={fitContentRef}
            className={
              mobileViewport
                ? "mobile-throttle-layout mobile-throttle-layout--viewport"
                : "mobile-throttle-layout"
            }
          >
            {!currentLoco ? (
              <Text size="sm" c="dimmed">
                {t("locopanel.nolocos")}
              </Text>
            ) : (
              <>
                <div className="mobile-throttle-controls">
                  <LocoControlCard
                    loco={currentLoco}
                    speed={speed}
                    direction={direction}
                    alive={alive}
                    emergencyStop={
                      powerInfo?.emergencyStop ?? false
                    }
                    reservation={reservation}
                    controlsDisabled={controlsDisabled}
                    onOpenPicker={() =>
                      setPickerOpened(true)
                    }
                    onSpeedChange={setLocoSpeed}
                    onSpeedPercentChange={
                      setLocoSpeedByPercent
                    }
                    onForward={handleForward}
                    onReverse={handleReverse}
                    onStop={handleStop}
                    onEmergencyToggle={
                      handleEmergencyToggle
                    }
                  />
                </div>

                <div className="mobile-throttle-functions">
                  <LocoFunctionGrid
                    loco={currentLoco}
                    activeFunctions={activeFunctions}
                    disabled={controlsDisabled}
                    onActiveFunctionsChange={
                      setActiveFunctions
                    }
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
