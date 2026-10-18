import { Button } from "@mantine/core";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { LocoFunction } from "../storage";
import FunctionIconAsset from "../loco-dialog/FunctionIconAsset";

import { useFunctionButtonDisplayMode } from "../loco-dialog/functionButtonDisplayMode";

type LocoFunctionButtonProps = {
  address: number;
  fnNumber: number;
  fn: LocoFunction | undefined;
  active: boolean;
  activeFunctions: Record<number, boolean>;
  disabled?: boolean;
  onActiveFunctionsChange: Dispatch<SetStateAction<Record<number, boolean>>>;
  onFunctionCommand: (address:number, functionNumber:number, active:boolean)=>void;
};

export default function LocoFunctionButton({
  address,
  fnNumber,
  fn,
  active,
  disabled = false,
  onActiveFunctionsChange,
  onFunctionCommand,
}: LocoFunctionButtonProps) {
  const displayMode = useFunctionButtonDisplayMode();
  const hasIcon = !!fn?.icon && (fn.icon.startsWith("builtin:") || fn.icon.startsWith("custom:"));
  const showIcon = displayMode !== "default" && displayMode !== "text" && hasIcon;
  const showNumber = displayMode === "default" || (displayMode === "icon" && !hasIcon);
  const showName = displayMode === "text" || displayMode === "icon-text";
  const hasName =
    !!fn?.name?.trim();

  const setLocalState = (nextActive: boolean) => {
    onActiveFunctionsChange(previous => ({
      ...previous,
      [fnNumber]: nextActive,
    }));
  };

  const releaseMomentaryFunction = () => {
    if (disabled || !fn?.momentary) {
      return;
    }

    setLocalState(false);

    onFunctionCommand(address, fnNumber, false);
  };

  return (
    <Button
      size="xs"
      variant={active ? "filled" : "light"}
      color={active ? "blue" : "gray"}
      disabled={disabled}
      style={{
        height: 48,
        padding: 2,
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      }}
      styles={{
        inner: {
          width: "100%",
          height: "100%",
          justifyContent: "center",
        },
        label: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
      }}
      onPointerDown={event => {
        event.preventDefault();

        if (disabled) {
          return;
        }

        if (fn?.momentary) {
          setLocalState(true);

          onFunctionCommand(address, fnNumber, true);
          return;
        }

        // IMPORTANT:
        // Use the rendered authoritative state (`active`) instead
        // of a potentially stale object captured elsewhere.
        const nextActive = !active;

        // Immediate UI feedback. The following locoState message
        // from the Hub will confirm/correct this value.
        setLocalState(nextActive);

        onFunctionCommand(address, fnNumber, nextActive);
      }}
      onPointerUp={event => {
        event.preventDefault();
        releaseMomentaryFunction();
      }}
      onPointerCancel={
        releaseMomentaryFunction
      }
      onPointerLeave={
        releaseMomentaryFunction
      }
      onContextMenu={event => {
        event.preventDefault();
      }}
    >
      <span
        style={{
          width: "100%",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          lineHeight: 1.15,
        }}
      >
        {showIcon && <FunctionIconAsset fn={fn} size={20} />}
        {showNumber && <span
          style={{
            display: "block",
            width: "100%",
            fontSize: 12,
            fontWeight: 700,
            textAlign: "center",
          }}
        >
          F{fnNumber}
        </span>}

        {showName && (
          <span
            style={{
              display: "block",
              width: "100%",
              minWidth: 0,
              fontSize: 10,
              opacity: 0.85,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "center",
            }}
          >
            {hasName ? fn?.name : `F${fnNumber}`}
            {fn?.momentary ? " *" : ""}
          </span>
        )}
      </span>
    </Button>
  );
}
