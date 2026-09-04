import { ActionIcon, Alert, Box, Center, Group, Loader } from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { IconArrowsMaximize, IconCrosshair, IconPlayerStop } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import type { Loco } from "@domain/types";
import FullscreenLoader from "@/components/FullscreenLoader";
import TrackCanvas from "@/components/TrackCanvas";
import { useCommandCenter } from "@/context/CommandCenterContext";
import type { BaseElementView } from "@/models/editor/core/BaseElementView";
import { isTurnoutElement, LayoutView } from "@/models/editor/core/LayoutView";
import { TrackLevelCrossingElementView } from "@/models/editor/elements/TrackLevelCrossingElementView";
import { TrackSensorElementView } from "@/models/editor/elements/TrackSensorElementView";
import { TrackSignalElementView } from "@/models/editor/elements/TrackSignalElementView";
import { BlockElementView } from "@/models/editor/elements/BlockElementView";
import { ButtonElementView } from "@/models/editor/elements/ButtonElementView";
import TrackTurnoutDoubleElementView from "@/models/editor/elements/TrackTurnoutDoubleElementView";
import { getCanvasImage } from "@/models/editor/rendering/ImageCache";
import type { EditorTool } from "@/models/editor/types/EditorTypes";
import { wsApi } from "@/services/wsApi";
import { wsClient, type WsConnectionStatus } from "@/services/wsClient";

const CURSOR_TOOL: EditorTool = { mode: "cursor", elementType: "general" };
type RuntimeLayoutOverlayProps = { locos: Loco[]; open: boolean };

export default function RuntimeLayoutOverlay({ locos, open }: RuntimeLayoutOverlayProps) {
  const commandCenter = useCommandCenter();
  const [layout, setLayout] = useState(() => new LayoutView());
  const [selectedElement, setSelectedElement] = useState<BaseElementView | null>(null);
  const [invalidateCounter, setInvalidateCounter] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<WsConnectionStatus>(wsClient.getStatus());
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [canvasBusyText, setCanvasBusyText] = useState("Loading...");
  const [fitCounter, setFitCounter] = useState(0);
  const [centerCounter, setCenterCounter] = useState(0);

  const invalidate = useCallback(() => setInvalidateCounter(value => value + 1), []);
  const setBusy = useCallback((busy: boolean, text?: string) => {
    setCanvasBusy(busy);
    if (text) setCanvasBusyText(text);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/layout", { cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error("The layout could not be loaded from the EX-CSB1.");
        return response.json();
      })
      .then(data => {
        if (cancelled) return;
        const nextLayout = LayoutView.fromJSON(data);
        nextLayout.checkRoutes();
        setLayout(nextLayout);
      })
      .catch(loadError => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => wsClient.subscribeStatus(setWsStatus), []);
  useEffect(() => { for (const loco of locos) if (loco.image) getCanvasImage(loco.image); }, [locos]);

  useEffect(() => wsClient.on("error", data => {
    if (data.message === "track_power_off") {
      showNotification({ color: "red", title: "Track power is off", message: "Turn POWER ON before operating a turnout." });
    } else if (data.message === "turnout_address_out_of_range") {
      showNotification({ color: "red", title: "Invalid turnout address", message: "Use a linear DCC accessory address between 1 and 2048." });
    }
  }), []);

  useEffect(() => wsClient.on("turnoutChanged", data => {
    for (const element of layout.getAllElements()) {
      if (isTurnoutElement(element) && element.outputMode === "accessory" && element.turnoutAddress === data.address) {
        element.turnoutClosed = data.closed;
      } else if (element instanceof TrackTurnoutDoubleElementView && element.outputMode === "accessory") {
        if (element.turnout1Address === data.address) element.turnout1Closed = data.closed;
        if (element.turnout2Address === data.address) element.turnout2Closed = data.closed;
      }
    }
    layout.checkRoutes();
    invalidate();
  }), [layout, invalidate]);

  useEffect(() => wsClient.on("sensorChanged", data => {
    for (const element of layout.getAllElements()) if (element instanceof TrackSensorElementView && element.address === data.address) element.on = data.on;
    invalidate();
  }), [layout, invalidate]);

  useEffect(() => wsClient.on("sensorSnapshot", data => {
    for (const [baseAddress, activeBits, knownBits] of data.groups) {
      for (const element of layout.getAllElements()) {
        if (!(element instanceof TrackSensorElementView)) continue;
        const offset = element.address - baseAddress;
        if (offset < 0 || offset > 15) continue;
        const bit = 1 << offset;
        if ((knownBits & bit) === 0) continue;
        element.on = (activeBits & bit) !== 0;
      }
    }
    invalidate();
  }), [layout, invalidate]);

  useEffect(() => wsClient.on("accessoryChanged", data => {
    for (const element of layout.getAllElements()) {
      if (element instanceof TrackSignalElementView && element.outputMode === "accessory" && element.address <= data.address && element.lastAddress >= data.address) {
        element.setValue(data.address, data.active);
      } else if (element instanceof ButtonElementView && element.outputMode === "accessory" && element.address === data.address) {
        element.on = data.active === element.activeValue;
      } else if (element instanceof TrackLevelCrossingElementView && element.basicAccessoryAddress === data.address) {
        element.barrierClosed = data.active === element.basicAccessoryClosedValue;
      }
    }
    invalidate();
  }), [layout, invalidate]);

  useEffect(() => wsClient.on("vpinChanged", data => {
    for (const element of layout.getAllElements()) {
      if (isTurnoutElement(element) && element.outputMode === "vpin" && element.turnoutAddress === data.vpin) {
        element.turnoutClosed = data.active;
      } else if (element instanceof TrackTurnoutDoubleElementView && element.outputMode === "vpin") {
        if (element.turnout1Address === data.vpin) element.turnout1Closed = data.active;
        if (element.turnout2Address === data.vpin) element.turnout2Closed = data.active;
      } else if (element instanceof TrackSignalElementView && element.outputMode === "vpin" && element.address <= data.vpin && element.lastAddress >= data.vpin) {
        element.setValue(data.vpin, data.active);
      } else if (element instanceof ButtonElementView && element.outputMode === "vpin" && element.address === data.vpin) {
        element.on = data.active === element.activeValue;
      }
    }
    layout.checkRoutes();
    invalidate();
  }), [layout, invalidate]);

  useEffect(() => wsClient.on("signalAspectChanged", data => {
    for (const element of layout.getAllElements()) {
      if (element instanceof TrackSignalElementView && element.signalOutput.protocol === "dccext" && element.signalOutput.address === data.address) {
        element.setCurrentStateByAspect(data.aspect);
      }
    }
    invalidate();
  }), [layout, invalidate]);

  useEffect(() => wsClient.on("blockStateChanged", data => {
    const blocks = layout.getAllElements().filter((element): element is BlockElementView => element instanceof BlockElementView);
    for (const block of blocks) block.locoAddress = 0;
    for (const [wireBlockId, state] of Object.entries(data)) {
      const blockId = Number(wireBlockId);
      if (!Number.isInteger(blockId) || blockId < 1 || blockId > 0xffff) continue;
      const block = blocks.find(item => item.id === blockId);
      if (!block) continue;
      block.locoAddress = state.locoAddress ?? locos.find(loco => loco.id === state.locoId)?.address ?? 0;
    }
    invalidate();
  }), [layout, locos, invalidate]);

  useEffect(() => { if (wsStatus === "connected") wsApi.getLayoutRuntimeSnapshot(); }, [wsStatus, layout]);
  useEffect(() => {
    if (!open || loading || error) return;
    const frame = window.requestAnimationFrame(() => invalidate());
    return () => window.cancelAnimationFrame(frame);
  }, [open, loading, error, invalidate]);
  useEffect(() => { if (!open) { setFitCounter(0); setCenterCounter(0); } }, [open]);

  if (!open) return null;
  if (loading) return <Center className="mobile-runtime-layout-overlay"><Loader /></Center>;
  if (error) return <Box className="mobile-runtime-layout-overlay" p="md"><Alert color="red">{error}</Alert></Box>;

  return (
    <>
      <Box className="mobile-runtime-layout-overlay">
        <Box className="mobile-runtime-layout-canvas">
          <TrackCanvas
            editMode={false}
            tool={CURSOR_TOOL}
            layout={layout}
            onLayoutChange={setLayout}
            selectedElement={selectedElement}
            onSelectedElementChange={setSelectedElement}
            invalidateCounter={invalidateCounter}
            onInvalidate={invalidate}
            fitCounter={fitCounter}
            centerCounter={centerCounter}
            viewStorageKey="dcc-express.mobile.trackCanvas.view"
            turnoutSelectionMode={false}
            setBusy={setBusy}
            locos={locos}
          />
        </Box>
      </Box>
      {open && <Group className="mobile-layout-tools" gap="xs" wrap="nowrap">
        <ActionIcon size={52} radius="xl" variant="filled" color="cyan" aria-label="Center layout view" title="Center layout view" onClick={() => setCenterCounter(value => value + 1)}>
          <IconCrosshair size={25} />
        </ActionIcon>
        <ActionIcon size={52} radius="xl" variant="filled" color="teal" aria-label="Fit layout view" title="Fit layout view" onClick={() => setFitCounter(value => value + 1)}>
          <IconArrowsMaximize size={25} />
        </ActionIcon>
        <ActionIcon
          size={52}
          radius="xl"
          variant={commandCenter.powerInfo?.emergencyStop ? "filled" : "light"}
          color={commandCenter.powerInfo?.emergencyStop ? "red" : "gray"}
          className={commandCenter.powerInfo?.emergencyStop ? "blinkBadge" : ""}
          aria-label={commandCenter.powerInfo?.emergencyStop ? "Clear emergency stop" : "Emergency stop"}
          title={commandCenter.powerInfo?.emergencyStop ? "Clear emergency stop" : "Emergency stop"}
          onClick={() => commandCenter.powerInfo?.emergencyStop ? wsApi.powerOn() : wsApi.emergencyStop()}
        >
          <IconPlayerStop size={27} />
        </ActionIcon>
      </Group>}
      <FullscreenLoader visible={open && canvasBusy} text={canvasBusyText} />
    </>
  );
}
