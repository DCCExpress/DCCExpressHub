import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

const LEFT_WIDTH_KEY =
  "dcc-express-flow.left-panel-width";

const RIGHT_WIDTH_KEY =
  "dcc-express-flow.right-panel-width";

const DEFAULT_LEFT_WIDTH =
  220;

const DEFAULT_RIGHT_WIDTH =
  340;

const MIN_LEFT_WIDTH =
  180;

const MAX_LEFT_WIDTH =
  520;

const MIN_RIGHT_WIDTH =
  260;

const MAX_RIGHT_WIDTH =
  720;

type ResizeSide =
  | "left"
  | "right";

type ResizeState = {
  side: ResizeSide;
  startX: number;
  startWidth: number;
};

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}

function readStoredWidth(
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  try {
    const stored =
      Number(
        localStorage.getItem(
          key
        )
      );

    if (
      Number.isFinite(
        stored
      )
    ) {
      return clamp(
        stored,
        min,
        max
      );
    }
  } catch {
    // localStorage may be unavailable in restricted browser contexts.
  }

  return fallback;
}

function writeStoredWidth(
  key: string,
  value: number
): void {
  try {
    localStorage.setItem(
      key,
      String(
        Math.round(
          value
        )
      )
    );
  } catch {
    // Keep resizing functional even when persistence is unavailable.
  }
}

export function useAutomationFlowPanelSizes() {
  const [
    leftWidth,
    setLeftWidth,
  ] =
    useState(
      () =>
        readStoredWidth(
          LEFT_WIDTH_KEY,
          DEFAULT_LEFT_WIDTH,
          MIN_LEFT_WIDTH,
          MAX_LEFT_WIDTH
        )
    );

  const [
    rightWidth,
    setRightWidth,
  ] =
    useState(
      () =>
        readStoredWidth(
          RIGHT_WIDTH_KEY,
          DEFAULT_RIGHT_WIDTH,
          MIN_RIGHT_WIDTH,
          MAX_RIGHT_WIDTH
        )
    );

  const resizeRef =
    useRef<
      ResizeState |
      null
    >(null);

  useEffect(
    () => {
      writeStoredWidth(
        LEFT_WIDTH_KEY,
        leftWidth
      );
    },
    [
      leftWidth,
    ]
  );

  useEffect(
    () => {
      writeStoredWidth(
        RIGHT_WIDTH_KEY,
        rightWidth
      );
    },
    [
      rightWidth,
    ]
  );

  useEffect(
    () => {
      const handlePointerMove =
        (
          event:
            PointerEvent
        ): void => {
          const resize =
            resizeRef.current;

          if (!resize) {
            return;
          }

          const delta =
            event.clientX -
            resize.startX;

          if (
            resize.side ===
            "left"
          ) {
            setLeftWidth(
              clamp(
                resize.startWidth +
                  delta,
                MIN_LEFT_WIDTH,
                MAX_LEFT_WIDTH
              )
            );

            return;
          }

          setRightWidth(
            clamp(
              resize.startWidth -
                delta,
              MIN_RIGHT_WIDTH,
              MAX_RIGHT_WIDTH
            )
          );
        };

      const handlePointerUp =
        (): void => {
          resizeRef.current =
            null;

          document.body.classList.remove(
            "automation-flow-panel-resizing"
          );
        };

      window.addEventListener(
        "pointermove",
        handlePointerMove
      );

      window.addEventListener(
        "pointerup",
        handlePointerUp
      );

      return () => {
        window.removeEventListener(
          "pointermove",
          handlePointerMove
        );

        window.removeEventListener(
          "pointerup",
          handlePointerUp
        );

        document.body.classList.remove(
          "automation-flow-panel-resizing"
        );
      };
    },
    []
  );

  const beginResize =
    useCallback(
      (
        side:
          ResizeSide,
        event:
          ReactPointerEvent<HTMLDivElement>
      ): void => {
        event.preventDefault();

        resizeRef.current = {
          side,
          startX:
            event.clientX,
          startWidth:
            side ===
            "left"
              ? leftWidth
              : rightWidth,
        };

        document.body.classList.add(
          "automation-flow-panel-resizing"
        );

        event.currentTarget
          .setPointerCapture?.(
            event.pointerId
          );
      },
      [
        leftWidth,
        rightWidth,
      ]
    );

  const resetWidth =
    useCallback(
      (
        side:
          ResizeSide
      ): void => {
        if (
          side ===
          "left"
        ) {
          setLeftWidth(
            DEFAULT_LEFT_WIDTH
          );

          return;
        }

        setRightWidth(
          DEFAULT_RIGHT_WIDTH
        );
      },
      []
    );

  const workspaceStyle =
    {
      "--automation-flow-left-width":
        `${Math.round(leftWidth)}px`,
      "--automation-flow-right-width":
        `${Math.round(rightWidth)}px`,
    } as CSSProperties;

  return {
    leftWidth,
    rightWidth,
    workspaceStyle,
    beginResize,
    resetWidth,
  };
}
