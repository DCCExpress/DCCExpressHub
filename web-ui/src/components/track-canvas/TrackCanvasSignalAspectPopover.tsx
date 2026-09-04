import {
  Box,
  Group,
  Popover,
  Stack,
} from "@mantine/core";

import ElementPreview from "../../models/editor/rendering/ElementPreviewRenderer";

import type {
  SignalAspectPopoverState,
} from "./TrackCanvas.types";

export type TrackCanvasSignalAspectPopoverProps = {
  state: SignalAspectPopoverState;
  onClose: () => void;
};

export function TrackCanvasSignalAspectPopover({
  state,
  onClose,
}: TrackCanvasSignalAspectPopoverProps) {
  const signal = state.signal;

  return (
    <Popover
      opened={state.opened}
      onChange={opened => {
        if (!opened) {
          onClose();
        }
      }}
      withArrow
      shadow="xl"
      closeOnClickOutside={false}
      closeOnEscape
      withinPortal
      offset={18}
      transitionProps={{
        transition: "scale",
        duration: 200,
        timingFunction: "ease-out",
      }}
    >
      <Popover.Target>
        <Box
          p={4}
          style={{
            position: "fixed",
            left: state.x,
            top: state.y,
            width: 0,
            height: 0,
            pointerEvents: "none",
          }}
        />
      </Popover.Target>

      <Popover.Dropdown
        p={4}
        onPointerDown={event => {
          event.stopPropagation();
        }}
        onMouseDown={event => {
          event.stopPropagation();
        }}
        onClick={event => {
          event.stopPropagation();
        }}
      >
        <Stack gap="xs">
          <Group gap={4}>
            {signal?.signalOutput.states.map(
              (signalState, index) => {
                const preview =
                  state.previews?.[index];

                if (!preview) {
                  return null;
                }

                return (
                  <Box
                    key={signalState.id}
                    className="signal-aspect-button"
                    onClick={() => {
                      onClose();
                      signal.sendState(signalState);
                    }}
                  >
                    <ElementPreview
                      style={{ cursor: "pointer" }}
                      element={preview}
                      label={signalState.label}
                      width={40}
                      height={40}
                      translateX={-10}
                    />
                  </Box>
                );
              }
            )}
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
