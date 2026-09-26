import {
  useEffect,
  useState,
} from "react";

import {
  ActionIcon,
  Badge,
  Group,
  Text,
  Tooltip,
} from "@mantine/core";

import {
  showNotification,
} from "@mantine/notifications";

import {
  IconAlertTriangle,
  IconPlayerPlay,
  IconPlayerStop,
} from "@tabler/icons-react";

import type {
  MovementPage,
} from "../../domain/movement";

import {
  abortMovement,
  getMovementEngineState,
  startMovement,
  stopMovement,
  subscribeMovementEngineState,
  type MovementEngineState,
} from "../../services/movementEngine";

import {
  isTrackPowerOn,
  subscribeTrackPower,
} from "../../services/trackPowerRuntime";

type Props = {
  page:
    MovementPage;
  compact?: boolean;
  routeResolved?: boolean;
  showStatus?: boolean;
  showInfo?: boolean;
  onStateChange?: (
    state:
      MovementEngineState
  ) => void;
};

export function movementRuntimeStatusColor(
  state:
    MovementEngineState
): string {
  if (
    state.status ===
    "running"
  ) {
    return "green";
  }

  if (
    state.status ===
    "stopping"
  ) {
    return "yellow";
  }

  if (
    state.status ===
      "error" ||
    state.error
  ) {
    return "red";
  }

  return "gray";
}

export function useTrackPowerOn(): boolean {
  const [
    powerOn,
    setPowerOn,
  ] =
    useState(
      () =>
        isTrackPowerOn()
    );

  useEffect(
    () =>
      subscribeTrackPower(
        setPowerOn
      ),
    []
  );

  return powerOn;
}

export function useMovementRuntimeState(
  pageId: string
): MovementEngineState {
  const [
    state,
    setState,
  ] =
    useState<MovementEngineState>(
      () =>
        getMovementEngineState(
          pageId
        )
    );

  useEffect(
    () =>
      subscribeMovementEngineState(
        pageId,
        setState
      ),
    [
      pageId,
    ]
  );

  return state;
}

export default function MovementRuntimeControls({
  page,
  compact = false,
  routeResolved = true,
  showStatus = true,
  showInfo = false,
  onStateChange,
}: Props) {
  const state =
    useMovementRuntimeState(
      page.id
    );

  const trackPowerOn =
    useTrackPowerOn();

  useEffect(
    () => {
      onStateChange?.(
        state
      );
    },
    [
      onStateChange,
      state,
    ]
  );

  const idle =
    state.status ===
      "idle" ||
    state.status ===
      "error";

  const notifyTrackPowerOff =
    (): void => {
      showNotification({
        color: "red",
        title:
          "Track power is OFF",
        message:
          "Turn on track power before starting Movement.",
      });
    };

  const run =
    async (): Promise<void> => {
      if (
        !trackPowerOn
      ) {
        notifyTrackPowerOff();

        return;
      }

      try {
        await startMovement(
          page
        );

        showNotification({
          color: "green",
          title:
            "Movement completed",
          message:
            page.name,
        });
      } catch (error) {
        showNotification({
          color: "red",
          title:
            "Movement failed",
          message:
            error instanceof Error
              ? error.message
              : String(
                  error
                ),
        });
      }
    };

  const iconSize =
    compact
      ? 13
      : 15;

  const buttonSize =
    compact
      ? "xs"
      : "sm";

  return (
    <Group
      gap={4}
      wrap="nowrap"
      className={
        compact
          ? "movement-runtime-controls is-compact"
          : "movement-runtime-controls"
      }
    >
      {
        showStatus && (
          <Badge
            size="xs"
            variant="light"
            color={
              movementRuntimeStatusColor(
                state
              )
            }
          >
            {
              state.status
            }
          </Badge>
        )
      }

      <Tooltip
        withArrow
        label={
          trackPowerOn
            ? "Start movement"
            : "Track power is OFF"
        }
      >
        <span
          style={{
            display:
              "inline-flex",
          }}
          onPointerDown={
            event => {
              if (
                !trackPowerOn
              ) {
                event.stopPropagation();
                notifyTrackPowerOff();
              }
            }
          }
        >
          <ActionIcon
            size={
              buttonSize
            }
            variant="light"
            color="green"
            disabled={
              !idle ||
              !page.enabled ||
              !routeResolved ||
              !trackPowerOn
            }
            onClick={
              event => {
                event.stopPropagation();

                void run();
              }
            }
          >
            <IconPlayerPlay
              size={
                iconSize
              }
            />
          </ActionIcon>
        </span>
      </Tooltip>

      <Tooltip
        withArrow
        label="Stop movement"
      >
        <ActionIcon
          size={
            buttonSize
          }
          variant="light"
          color="yellow"
          disabled={
            idle
          }
          onClick={
            event => {
              event.stopPropagation();

              stopMovement(
                page.id
              );
            }
          }
        >
          <IconPlayerStop
            size={
              iconSize
            }
          />
        </ActionIcon>
      </Tooltip>

      <Tooltip
        withArrow
        label="Abort + emergency stop"
      >
        <ActionIcon
          size={
            buttonSize
          }
          variant="light"
          color="red"
          disabled={
            idle
          }
          onClick={
            event => {
              event.stopPropagation();

              abortMovement(
                page.id
              );
            }
          }
        >
          <IconAlertTriangle
            size={
              iconSize
            }
          />
        </ActionIcon>
      </Tooltip>

      {
        showInfo &&
        state.info && (
          <Text
            size="xs"
            c={
              state.status ===
                "error"
                ? "red"
                : state.status ===
                    "running"
                  ? "blue"
                  : "dimmed"
            }
            truncate
            className="movement-runtime-info"
          >
            {
              state.info
            }
          </Text>
        )
      }
    </Group>
  );
}
