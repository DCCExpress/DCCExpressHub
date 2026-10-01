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
  abortDispatcherMovement,
  getDispatcherState,
  startDispatcherMovement,
  stopDispatcherMovement,
  subscribeDispatcherState,
  type DispatcherState,
} from "../../services/dispatcherRuntime";

import {
  isTrackPowerOn,
  subscribeTrackPower,
} from "../../services/trackPowerRuntime";

import {
  useMovementTranslation,
} from "./movementI18n";

type Props = {
  page:
    MovementPage;
  compact?: boolean;
  routeResolved?: boolean;
  showStatus?: boolean;
  showInfo?: boolean;
  onStateChange?: (
    state:
      DispatcherState
  ) => void;
};

export function movementRuntimeStatusColor(
  state:
    DispatcherState
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
): DispatcherState {
  const [
    state,
    setState,
  ] =
    useState<DispatcherState>(
      () =>
        getDispatcherState(
          pageId
        )
    );

  useEffect(
    () =>
      subscribeDispatcherState(
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
  const mt =
    useMovementTranslation();

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
          mt("movementTrackPowerOff"),
        message:
          mt("movementTurnPowerOnBeforeStart"),
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
        await startDispatcherMovement(
          page
        );

        showNotification({
          color: "green",
          title:
            mt("movementCompleted"),
          message:
            page.name,
        });
      } catch (error) {
        showNotification({
          color: "red",
          title:
            mt("movementFailed"),
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
              mt(
                state.status === "running"
                  ? "movementStatusRunning"
                  : state.status === "stopping"
                    ? "movementStatusStopping"
                    : state.status === "error"
                      ? "movementStatusError"
                      : "movementStatusIdle"
              )
            }
          </Badge>
        )
      }

      <Tooltip
        withArrow
        label={
          trackPowerOn
            ? mt("movementStart")
            : mt("movementTrackPowerOff")
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
        label={mt("movementStop")}
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

              stopDispatcherMovement(
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
        label={mt("movementAbortEstop")}
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

              abortDispatcherMovement(
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
