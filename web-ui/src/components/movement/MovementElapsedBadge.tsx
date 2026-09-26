import {
  useEffect,
  useState,
} from "react";

import {
  Badge,
} from "@mantine/core";

import type {
  MovementPage,
} from "../../domain/movement";

import type {
  MovementEngineState,
} from "../../services/movementEngine";

export function movementElapsedSeconds(
  page:
    MovementPage,
  state:
    MovementEngineState,
  now:
    number = Date.now()
): number | null {
  const runtimeHasTiming =
    state.startedAt !==
    null;

  const startedAt =
    runtimeHasTiming
      ? state.startedAt
      : page.startedAt;

  if (
    startedAt ===
    null
  ) {
    return null;
  }

  const live =
    runtimeHasTiming &&
    (
      state.status ===
        "running" ||
      state.status ===
        "stopping"
    );

  const stoppedAt =
    runtimeHasTiming
      ? state.stoppedAt
      : page.stoppedAt;

  const end =
    live
      ? now
      : stoppedAt ??
        startedAt;

  return Math.max(
    0,
    Math.floor(
      (
        end -
        startedAt
      ) /
      1000
    )
  );
}

export function formatMovementDuration(
  totalSeconds:
    number
): string {
  const safeSeconds =
    Math.max(
      0,
      Math.floor(
        totalSeconds
      )
    );

  const minutes =
    Math.floor(
      safeSeconds /
      60
    );

  const seconds =
    safeSeconds %
    60;

  return (
    `${String(
      minutes
    ).padStart(
      2,
      "0"
    )}:${String(
      seconds
    ).padStart(
      2,
      "0"
    )} (${safeSeconds} s)`
  );
}

export function useMovementElapsedSeconds(
  page:
    MovementPage,
  state:
    MovementEngineState
): number | null {
  const [
    now,
    setNow,
  ] =
    useState(
      () =>
        Date.now()
    );

  const live =
    state.startedAt !==
      null &&
    (
      state.status ===
        "running" ||
      state.status ===
        "stopping"
    );

  useEffect(
    () => {
      setNow(
        Date.now()
      );

      if (!live) {
        return;
      }

      const timer =
        window.setInterval(
          () =>
            setNow(
              Date.now()
            ),
          1000
        );

      return () => {
        window.clearInterval(
          timer
        );
      };
    },
    [
      live,
      state.startedAt,
    ]
  );

  return movementElapsedSeconds(
    page,
    state,
    now
  );
}

type Props = {
  page:
    MovementPage;
  state:
    MovementEngineState;
  compact?: boolean;
};

export default function MovementElapsedBadge({
  page,
  state,
  compact = false,
}: Props) {
  const elapsed =
    useMovementElapsedSeconds(
      page,
      state
    );

  if (
    elapsed ===
    null
  ) {
    return null;
  }

  const live =
    state.startedAt !==
      null &&
    (
      state.status ===
        "running" ||
      state.status ===
        "stopping"
    );

  return (
    <Badge
      size={
        compact
          ? "xs"
          : "sm"
      }
      variant="light"
      color={
        live
          ? "yellow"
          : "gray"
      }
      title={
        live
          ? "Elapsed Movement time"
          : "Last Movement duration"
      }
    >
      {
        formatMovementDuration(
          elapsed
        )
      }
    </Badge>
  );
}
