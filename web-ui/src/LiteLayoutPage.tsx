import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconDeviceFloppy,
  IconDownload,
  IconEdit,
  IconFocusCentered,
  IconHelpCircle,
  IconPlus,
  IconPointer,
  IconPower,
  IconRefresh,
  IconSettings,
  IconShieldCheck,
  IconTrafficLights,
  IconTrain,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { showNotification } from "@mantine/notifications";

import type { DccExStatusPayload, Loco } from "@domain/types";
import { ELEMENT_TYPES, type ElementType } from "@domain/layout/elementTypes";
import TrackCanvas from "@/components/TrackCanvas";
import FullscreenLoader from "@/components/FullscreenLoader";
import SignalLogicDialog from "@/components/SignalLogicDialog";
import IntegrityCheckDialog from "@/components/IntegrityCheckDialog";
import LayoutRuntimeLogPanel from "@/components/LayoutRuntimeLogPanel";
import SystemInfoPanel from "@/components/SystemInfoPanel";
import VisibilitySettings from "@/components/VisibilitySettings";
import { useCommandCenter } from "@/context/CommandCenterContext";
import { useLayoutPageShortcuts } from "@/hooks/layout/useLayoutPageShortcuts";
import BasicPropertyEditor from "@/layout/property-panel/BasicPropertyEditor";
import BlockTypeSelectPropertyEditor from "@/layout/property-panel/BlockTypeSelectPropertyEditor";
import SignalAspectPropertyEditor from "@/layout/property-panel/SignalAspectPropertyEditor";
import TurnoutBitPropertyEditor from "@/layout/property-panel/TurnoutBitPropertyEditor";
import RouteTurnoutSelectionPropertyEditor from "@/layout/property-panel/RouteTurnoutSelectionPropertyEditor";
import LocoPanel from "@/layout/LocoPanel";
import AutomationPanel from "@/components/AutomationPanel";
import type { BaseElementView } from "@/models/editor/core/BaseElementView";
import { isTurnoutElement, LayoutView } from "@/models/editor/core/LayoutView";
import { TrackCornerElementView } from "@/models/editor/elements/TrackCornerElementView";
import { TrackCrossingElementView } from "@/models/editor/elements/TrackCrossingElementView";
import { TrackCurveElementView } from "@/models/editor/elements/TrackCurveElementView";
import { TrackEndElementView } from "@/models/editor/elements/TrackEndElementView";
import { TrackLevelCrossingElementView } from "@/models/editor/elements/TrackLevelCrossingElementView";
import { AudioButtonElementView } from "@/models/editor/elements/AudioButtonElementView";
import { BlockElementView } from "@/models/editor/elements/BlockElementView";
import { ButtonElementView } from "@/models/editor/elements/ButtonElementView";
import { TrackSensorElementView } from "@/models/editor/elements/TrackSensorElementView";
import { TrackSignalElementView } from "@/models/editor/elements/TrackSignalElementView";
import type { IEditableProperty } from "@/models/editor/elements/PropertyDescriptor";
import { TrackStraightElementView } from "@/models/editor/elements/TrackStraightElementView";
import TrackTurnoutDoubleElementView from "@/models/editor/elements/TrackTurnoutDoubleElementView";
import { TrackTurnoutLeftElementView } from "@/models/editor/elements/TrackTurnoutLeftElementView";
import { TrackTurnoutRightElementView } from "@/models/editor/elements/TrackTurnoutRightElementView";
import { TrackTurnoutTwoWayElementView } from "@/models/editor/elements/TrackTurnoutTwoWayElementView";
import { LabelElementView } from "@/models/editor/elements/LabelElementView";
import { RouteButtonElementView } from "@/models/editor/elements/RouteButtonElementView";
import ElementPreview from "@/models/editor/rendering/ElementPreviewRenderer";
import type { EditorTool } from "@/models/editor/types/EditorTypes";
import { wsApi } from "@/services/wsApi";
import { wsClient, type WsConnectionStatus } from "@/services/wsClient";
import {
  createAutomationId,
  createAutomationPayload,
  loadAutomationScripts,
  normalizeAutomationScripts,
  saveAutomationScripts,
  type AutomationScriptDefinition,
} from "@/services/automationApi";
import "@/styles/propertypanel.css";

type LiteLayoutPageProps = {
  version: string;
  locos: Loco[];
  onBack: () => void;
  onOpenLocoEditor: () => void;
};

type FlashInfo = {
  total: number;
  used: number;
  free: number;
  totalBytes?: number;
  usedBytes?: number;
  freeBytes?: number;
  flashChipBytes?: number;
  firmwareBytes?: number;
  firmwarePartitionBytes?: number;
  otaPartitionBytes?: number;
  systemReservedBytes?: number;
};

type PickerItem = {
  type: ElementType;
  label: string;
  preview: BaseElementView;
};

type LayoutWithLegacyAutomation = {
  automationScript?: string;
  automationScripts?: AutomationScriptDefinition[];
  layers?: Array<{
    elements?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

type DccExpressProjectExport = {
  format: "dccexpress-project";
  version: 1;
  exportedAt: string;
  layout: unknown;
  automations: {
    version: 1;
    scripts: AutomationScriptDefinition[];
  };
};

function prepareLayoutForLoad(raw: unknown): {
  layoutData: unknown;
  legacyAutomationScripts: AutomationScriptDefinition[];
} {
  const source =
    raw && typeof raw === "object"
      ? structuredClone(raw) as LayoutWithLegacyAutomation
      : {} as LayoutWithLegacyAutomation;

  let legacyAutomationScripts = normalizeAutomationScripts(source.automationScripts);

  if (
    legacyAutomationScripts.length === 0 &&
    typeof source.automationScript === "string" &&
    source.automationScript.trim()
  ) {
    legacyAutomationScripts = [
      {
        id: createAutomationId(),
        name: "Layout automation",
        script: source.automationScript,
      },
    ];
  }

  const legacyButtonScripts: AutomationScriptDefinition[] = [];

  if (Array.isArray(source.layers)) {
    for (const layer of source.layers) {
      if (!Array.isArray(layer.elements)) continue;

      layer.elements = layer.elements.filter((element, index) => {
        if (element.type !== ELEMENT_TYPES.BUTTON_SCRIPT) {
          return true;
        }

        const script = typeof element.script === "string" ? element.script.trim() : "";

        if (script) {
          const name =
            typeof element.name === "string" && element.name.trim()
              ? element.name.trim()
              : `Script Button ${index + 1}`;

          legacyButtonScripts.push({
            id: createAutomationId(),
            name,
            script,
          });
        }

        return false;
      });
    }
  }

  if (legacyAutomationScripts.length === 0 && legacyButtonScripts.length > 0) {
    legacyAutomationScripts = legacyButtonScripts;
  }

  delete source.automationScript;
  delete source.automationScripts;

  return {
    layoutData: source,
    legacyAutomationScripts,
  };
}

function serializeLayoutOnly(layout: LayoutView): string {
  const plainLayout = JSON.parse(JSON.stringify(layout)) as Record<string, unknown>;

  delete plainLayout.automationScript;
  delete plainLayout.automationScripts;

  return JSON.stringify(plainLayout);
}

function createProjectExport(
  layout: LayoutView,
  automationScripts: AutomationScriptDefinition[]
): DccExpressProjectExport {
  return {
    format: "dccexpress-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    layout: JSON.parse(serializeLayoutOnly(layout)),
    automations: createAutomationPayload(automationScripts),
  };
}

function parseImportedProject(raw: unknown): {
  layoutData: unknown;
  automationScripts: AutomationScriptDefinition[];
} {
  if (raw && typeof raw === "object") {
    const candidate = raw as Record<string, unknown>;

    if (
      candidate.format === "dccexpress-project" &&
      Number(candidate.version) === 1 &&
      "layout" in candidate
    ) {
      const prepared = prepareLayoutForLoad(candidate.layout);
      const automations =
        candidate.automations && typeof candidate.automations === "object"
          ? candidate.automations as Record<string, unknown>
          : {};
      const importedScripts = normalizeAutomationScripts(automations.scripts);

      return {
        layoutData: prepared.layoutData,
        automationScripts:
          importedScripts.length > 0
            ? importedScripts
            : prepared.legacyAutomationScripts,
      };
    }
  }

  const prepared = prepareLayoutForLoad(raw);

  return {
    layoutData: prepared.layoutData,
    automationScripts: prepared.legacyAutomationScripts,
  };
}

function createSignalPreview(): TrackSignalElementView {
  return new TrackSignalElementView(0, 0);
}

const PICKER_ITEMS: PickerItem[] = [
  { type: ELEMENT_TYPES.TRACK_STRAIGHT, label: "Straight", preview: new TrackStraightElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_END, label: "Track end", preview: new TrackEndElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_CORNER, label: "Corner", preview: new TrackCornerElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_CURVE, label: "Curve", preview: new TrackCurveElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_CROSSING, label: "Crossing", preview: new TrackCrossingElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_TURNOUT_LEFT, label: "Left turnout", preview: new TrackTurnoutLeftElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_TURNOUT_RIGHT, label: "Right turnout", preview: new TrackTurnoutRightElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY, label: "Y turnout", preview: new TrackTurnoutTwoWayElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE, label: "Double turnout", preview: new TrackTurnoutDoubleElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_SENSOR, label: "Sensor", preview: new TrackSensorElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_BLOCK, label: "Block", preview: new BlockElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_SIGNAL2, label: "Signal", preview: createSignalPreview() },
  { type: ELEMENT_TYPES.BUTTON, label: "Output button", preview: new ButtonElementView(0, 0) },
  { type: ELEMENT_TYPES.BUTTON_ROUTE, label: "Route", preview: new RouteButtonElementView(0, 0) },
  { type: ELEMENT_TYPES.BUTTON_AUDIO, label: "Audio button", preview: new AudioButtonElementView(0, 0) },
  { type: ELEMENT_TYPES.LABEL, label: "Label", preview: new LabelElementView(0, 0) },
];

const LOCO_WIDTH_KEY = "dcc-express-lite.layout.locoPanelWidth";
const PROPERTY_WIDTH_KEY = "dcc-express-lite.layout.propertyPanelWidth";
const LOCO_COLLAPSED_KEY = "dcc-express-lite.layout.locoPanelCollapsed";
const PROPERTY_COLLAPSED_KEY = "dcc-express-lite.layout.propertyPanelCollapsed";
const RIGHT_PANEL_MODE_KEY = "dcc-express-lite.layout.rightPanelMode";
const RIGHT_LOCO_STORAGE_KEY = "dcc-express-lite.loco-panel.right.selected-loco-id";

type RightPanelMode = "property" | "loco";

function readStoredNumber(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value >= 240 && value <= 640 ? value : fallback;
}

function readStoredBoolean(key: string): boolean {
  return localStorage.getItem(key) === "true";
}

function readStoredRightPanelMode(): RightPanelMode {
  return localStorage.getItem(RIGHT_PANEL_MODE_KEY) === "loco" ? "loco" : "property";
}

function updateProperty(element: BaseElementView, property: IEditableProperty, rawValue: unknown): void {
  if (property.type === "number") {
    const numberValue = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (!Number.isNaN(numberValue) && (!property.validate || property.validate(numberValue))) {
      (element as unknown as Record<string, unknown>)[property.key] = numberValue;
    }
    return;
  }

  if (property.type === "boolean" || property.type === "checkbox") {
    (element as unknown as Record<string, unknown>)[property.key] = Boolean(rawValue);
    return;
  }

  (element as unknown as Record<string, unknown>)[property.key] = rawValue;
}

function LitePropertyPanel({
  selectedElement,
  layout,
  setLayout,
  turnoutSelectionMode,
  setTurnoutSelectionMode,
  setBusy,
  invalidate,
}: {
  selectedElement: BaseElementView | null;
  layout: LayoutView;
  setLayout: React.Dispatch<React.SetStateAction<LayoutView>>;
  turnoutSelectionMode: boolean;
  setTurnoutSelectionMode: (on: boolean) => void;
  setBusy: (busy: boolean, text?: string) => void;
  invalidate: () => void;
}) {
  const properties = useMemo(
    () => selectedElement?.getEditableProperties() ?? [],
    [selectedElement],
  );

  if (!selectedElement) {
    return <VisibilitySettings title="Layout visibility" />;
  }

  const onChange = (property: IEditableProperty, value: unknown) => {
    updateProperty(selectedElement, property, value);
    invalidate();
  };

  return (
    <ScrollArea h="100%">
      <Stack gap="xs">
        <Text fw={800}>{selectedElement.name || selectedElement.type}</Text>
        {properties.map(property => (
          <Card key={property.key} withBorder p="xs">
            {property.type === "turnoutSelection" ? (
              <RouteTurnoutSelectionPropertyEditor
                prop={property}
                selectedElement={selectedElement}
                layout={layout}
                turnoutSelectionMode={turnoutSelectionMode}
                setTurnoutSelectionMode={setTurnoutSelectionMode}
                onLayoutChange={setLayout}
                onUpdateSelectedElement={() => invalidate()}
                setBusy={setBusy}
              />
            ) : property.type === "bittoggle" ? (
              <TurnoutBitPropertyEditor
                prop={property}
                selectedElement={selectedElement}
                onChange={onChange}
              />
            ) : property.type === "signal2" ? (
              <SignalAspectPropertyEditor
                prop={property}
                selectedElement={selectedElement}
                onUpdateSelectedElement={invalidate}
              />
            ) : property.type === "blockTypeSelect" ? (
              <BlockTypeSelectPropertyEditor
                prop={property}
                selectedElement={selectedElement}
                onChange={onChange}
              />
            ) : (
              <BasicPropertyEditor
                prop={property}
                selectedElement={selectedElement}
                onChange={onChange}
              />
            )}
          </Card>
        ))}
      </Stack>
    </ScrollArea>
  );
}

export default function LiteLayoutPage({ version, locos, onBack, onOpenLocoEditor }: LiteLayoutPageProps) {
  const commandCenter = useCommandCenter();
  const [layout, setLayout] = useState(() => new LayoutView());
  const [automationScripts, setAutomationScripts] = useState<AutomationScriptDefinition[]>([]);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [selectedElement, setSelectedElement] = useState<BaseElementView | null>(null);
  const [tool, setTool] = useState<EditorTool>({ mode: "cursor", elementType: "general" });
  const [editMode, setEditMode] = useState(false);
  const [turnoutSelectionMode, setTurnoutSelectionMode] = useState(false);
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [canvasBusyText, setCanvasBusyText] = useState("Loading...");
  const [pickerOpened, setPickerOpened] = useState(false);
  const [signalLogicOpened, setSignalLogicOpened] = useState(false);
  const [integrityCheckOpened, setIntegrityCheckOpened] = useState(false);
  const [temperatureAlertOpened, setTemperatureAlertOpened] = useState(false);
  const [invalidateCounter, setInvalidateCounter] = useState(0);
  const [fitCounter, setFitCounter] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<WsConnectionStatus>(() => wsClient.getStatus());
  const [dccExStatus, setDccExStatus] = useState<DccExStatusPayload | null>(null);
  const [flashInfo, setFlashInfo] = useState<FlashInfo | null>(null);
  const [locoPanelWidth, setLocoPanelWidth] = useState(() => readStoredNumber(LOCO_WIDTH_KEY, 380));
  const [propertyPanelWidth, setPropertyPanelWidth] = useState(() => readStoredNumber(PROPERTY_WIDTH_KEY, 380));
  const [locoPanelCollapsed, setLocoPanelCollapsed] = useState(() => readStoredBoolean(LOCO_COLLAPSED_KEY));
  const [propertyPanelCollapsed, setPropertyPanelCollapsed] = useState(() => readStoredBoolean(PROPERTY_COLLAPSED_KEY));
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>(readStoredRightPanelMode);
  const resizeRef = useRef<{ side: "left" | "right"; startX: number; startWidth: number } | null>(null);
  const temperatureCriticalRef = useRef(false);

  const invalidate = useCallback(() => setInvalidateCounter(value => value + 1), []);

  const setBusy = useCallback((busy: boolean, text?: string) => {
    setCanvasBusy(busy);
    if (text) setCanvasBusyText(text);
  }, []);

  const loadLayout = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [layoutResponse, storedAutomations] = await Promise.all([
        fetch("/api/layout", { cache: "no-store" }),
        loadAutomationScripts(),
      ]);

      if (!layoutResponse.ok) {
        throw new Error("The layout could not be loaded from the EX-CSB1.");
      }

      const prepared = prepareLayoutForLoad(await layoutResponse.json());
      const nextLayout = LayoutView.fromJSON(prepared.layoutData);
      nextLayout.checkRoutes();
      setLayout(nextLayout);
      setAutomationScripts(
        storedAutomations.length > 0
          ? storedAutomations
          : prepared.legacyAutomationScripts
      );
      setSelectedElement(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLayout();
  }, [loadLayout]);

  useEffect(() => {
    if (!editMode || !(selectedElement instanceof RouteButtonElementView)) {
      setTurnoutSelectionMode(false);
    }
  }, [editMode, selectedElement]);

  useEffect(() => {
    if (editMode) layout.resetRoutes();
    else layout.checkRoutes();
    invalidate();
  }, [editMode, layout, invalidate]);

  useEffect(() => wsClient.subscribeStatus(setWsStatus), []);
  useEffect(() => wsClient.on("dccExStatus", setDccExStatus), []);

  useEffect(() => {
    const temperature = dccExStatus?.chipTemperatureC;
    if (temperature === undefined) return;

    if (temperature > 85 && !temperatureCriticalRef.current) {
      temperatureCriticalRef.current = true;
      setTemperatureAlertOpened(true);
    } else if (temperature < 80) {
      temperatureCriticalRef.current = false;
    }
  }, [dccExStatus?.chipTemperatureC]);

  useEffect(() => {
    void fetch("/fsinfo", { cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error("Flash information is unavailable.");
        return response.json() as Promise<FlashInfo>;
      })
      .then(setFlashInfo)
      .catch(() => setFlashInfo(null));
  }, []);

  useEffect(() => wsClient.on("error", data => {
    if (data.message === "track_power_off") {
      showNotification({
        color: "red",
        title: "Track power is off",
        message: "Turn POWER ON before operating a turnout.",
      });
    } else if (data.message === "turnout_address_out_of_range") {
      showNotification({
        color: "red",
        title: "Invalid turnout address",
        message: "Use a linear DCC accessory address between 1 and 2048.",
      });
    }
  }), []);

  useEffect(() => {
    const focusCanvasForRotate = (event: KeyboardEvent) => {
      if (!editMode || event.key.toLowerCase() !== "r" || event.ctrlKey || event.altKey || event.metaKey) return;

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isTypingField = tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target?.isContentEditable === true;
      if (isTypingField || target?.closest('[role="dialog"]')) return;

      document.querySelector<HTMLCanvasElement>(".lite-track-card canvas.track-canvas")?.focus();
    };

    window.addEventListener("keydown", focusCanvasForRotate, true);
    return () => window.removeEventListener("keydown", focusCanvasForRotate, true);
  }, [editMode]);

  useEffect(() => {
    localStorage.setItem(LOCO_WIDTH_KEY, String(locoPanelWidth));
  }, [locoPanelWidth]);

  useEffect(() => {
    localStorage.setItem(PROPERTY_WIDTH_KEY, String(propertyPanelWidth));
  }, [propertyPanelWidth]);

  useEffect(() => {
    localStorage.setItem(LOCO_COLLAPSED_KEY, String(locoPanelCollapsed));
  }, [locoPanelCollapsed]);

  useEffect(() => {
    localStorage.setItem(PROPERTY_COLLAPSED_KEY, String(propertyPanelCollapsed));
  }, [propertyPanelCollapsed]);

  useEffect(() => {
    localStorage.setItem(RIGHT_PANEL_MODE_KEY, rightPanelMode);
  }, [rightPanelMode]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize) return;
      const delta = event.clientX - resize.startX;
      const nextWidth = Math.max(240, Math.min(640,
        resize.startWidth + (resize.side === "left" ? delta : -delta),
      ));
      if (resize.side === "left") setLocoPanelWidth(nextWidth);
      else setPropertyPanelWidth(nextWidth);
    };
    const handlePointerUp = () => {
      resizeRef.current = null;
      document.body.classList.remove("lite-panel-resizing");
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

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
    for (const element of layout.getAllElements()) {
      if (element instanceof TrackSensorElementView && element.address === data.address) {
        element.on = data.on;
      }
    }
    invalidate();
  }), [layout, invalidate]);

  useEffect(() => wsClient.on("accessoryChanged", data => {
    for (const element of layout.getAllElements()) {
      if (
        element instanceof TrackSignalElementView &&
        element.signalOutput.protocol === "dcc" &&
        element.signalOutput.address <= data.address &&
        element.lastAddress >= data.address
      ) {
        element.setValue(data.address, data.active);
      } else if (element instanceof ButtonElementView && element.outputMode === "accessory" && element.address === data.address) {
        element.on = data.active === element.activeValue;
      } else if (element instanceof TrackLevelCrossingElementView && element.basicAccessoryAddress === data.address) {
        element.barrierClosed = data.active === element.basicAccessoryClosedValue;
      }
    }
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

  useEffect(() => wsClient.on("signalAspectChanged", data => {
    for (const element of layout.getAllElements()) {
      if (
        element instanceof TrackSignalElementView &&
        element.signalOutput.protocol === "dccext" &&
        element.signalOutput.address === data.address
      ) {
        element.setCurrentStateByAspect(data.aspect);
      }
    }
    invalidate();
  }), [layout, invalidate]);

  useEffect(() => wsClient.on("blockStateChanged", data => {
    const blocks = layout.getAllElements().filter(
      (element): element is BlockElementView => element instanceof BlockElementView,
    );
    for (const block of blocks) block.locoAddress = 0;
    for (const [wireBlockId, state] of Object.entries(data ?? {})) {
      const blockId = Number(wireBlockId);
      if (!Number.isInteger(blockId) || blockId < 1 || blockId > 0xffff) continue;
      const block = blocks.find(item => item.id === blockId);
      if (!block || state === null || typeof state !== "object") continue;

      const blockState = state as {
        locoAddress?: number | null;
        locoId?: string | number | null;
      };

      block.locoAddress = blockState.locoAddress ??
        locos.find(loco => String(loco.id) === String(blockState.locoId))?.address ?? 0;
    }
    invalidate();
  }), [layout, locos, invalidate]);

  useEffect(() => {
    if (wsStatus === "connected") {
      wsApi.getLayoutRuntimeSnapshot();
    }
  }, [wsStatus, layout]);

  const saveLayout = useCallback(async () => {
    setSaving(true);
    setError(null);

    try {
      const layoutResponse = await fetch(
        "/api/layout",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: serializeLayoutOnly(layout),
        }
      );

      if (!layoutResponse.ok) {
        throw new Error("The layout could not be saved to the EX-CSB1.");
      }

      await saveAutomationScripts(automationScripts);

      showNotification({
        color: "teal",
        title: "Project saved",
        message: "Layout and automation scripts were saved to their separate Hub stores.",
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, [layout, automationScripts]);

  const exportLayout = useCallback(() => {
    const project = createProjectExport(layout, automationScripts);
    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = `dccexpress-project-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [layout, automationScripts]);

  const importProject = useCallback(
    async (file: File): Promise<void> => {
      setSaving(true);
      setError(null);

      try {
        const parsed = JSON.parse(await file.text()) as unknown;
        const imported = parseImportedProject(parsed);
        const nextLayout = LayoutView.fromJSON(imported.layoutData);
        nextLayout.checkRoutes();

        const layoutResponse = await fetch(
          "/api/layout",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: serializeLayoutOnly(nextLayout),
          }
        );

        if (!layoutResponse.ok) {
          throw new Error("Imported layout could not be saved to the Hub.");
        }

        await saveAutomationScripts(imported.automationScripts);
        setLayout(nextLayout);
        setAutomationScripts(imported.automationScripts);
        setSelectedElement(null);

        showNotification({
          color: "teal",
          title: "Project imported",
          message: `Layout and ${imported.automationScripts.length} automation script(s) were restored.`,
        });
      } catch (importError) {
        const message = importError instanceof Error ? importError.message : String(importError);
        setError(message);
        showNotification({ color: "red", title: "Import failed", message });
      } finally {
        setSaving(false);
        if (importFileRef.current) {
          importFileRef.current.value = "";
        }
      }
    },
    []
  );

  useLayoutPageShortcuts({
    saveLayoutToServer: saveLayout,
    setTool,
    setEditMode,
  });

  const removeSelected = () => {
    if (!selectedElement) return;
    layout.removeElement(selectedElement);
    setSelectedElement(null);
    invalidate();
  };

  const beginResize = (side: "left" | "right", event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === "left" ? locoPanelWidth : propertyPanelWidth,
    };
    document.body.classList.add("lite-panel-resizing");
  };

  const workspaceStyle = {
    "--lite-loco-width": locoPanelCollapsed ? "0px" : `${locoPanelWidth}px`,
    "--lite-property-width": propertyPanelCollapsed ? "0px" : `${propertyPanelWidth}px`,
  } as CSSProperties;

  return (
    <Stack gap={6} className="lite-layout-page">
      <input
        ref={importFileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          if (file) void importProject(file);
        }}
      />

      <Card withBorder px={6} py={3} radius="sm" className="lite-layout-toolbar">
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="xs">
            <ActionIcon variant="subtle" color="gray" onClick={onBack} aria-label="Back" title="Home">
              <IconArrowLeft size={20} />
            </ActionIcon>
            <Title order={3} lh={1}>Layout</Title>
            <Badge size="sm" variant="light" color="violet">v{version}</Badge>
          </Group>

          <Group gap={6} wrap="nowrap">
            <ActionIcon
              variant={editMode ? "filled" : "light"}
              color="violet"
              title="Edit mode"
              onClick={() => {
                setEditMode(value => !value);
                setTool({ mode: "cursor", elementType: "general" });
                setSelectedElement(null);
              }}
            >
              <IconEdit size={18} />
            </ActionIcon>

            {editMode && (
              <>
                <ActionIcon variant={tool.mode === "cursor" ? "filled" : "light"} onClick={() => setTool({ mode: "cursor", elementType: "general" })} title="Select">
                  <IconPointer size={18} />
                </ActionIcon>
                <ActionIcon variant={tool.mode === "draw" ? "filled" : "light"} onClick={() => setPickerOpened(true)} title="Add layout element">
                  <IconPlus size={18} />
                </ActionIcon>
                <ActionIcon variant="light" color="red" disabled={!selectedElement} onClick={removeSelected} title="Delete selected">
                  <IconTrash size={18} />
                </ActionIcon>
              </>
            )}

            <Divider orientation="vertical" className="lite-toolbar-divider" />
            <ActionIcon variant="light" onClick={() => setFitCounter(value => value + 1)} aria-label="Fit layout" title="Fit layout">
              <IconFocusCentered size={19} />
            </ActionIcon>
            <ActionIcon variant="light" loading={loading} onClick={() => void loadLayout()} aria-label="Reload layout" title="Reload">
              <IconRefresh size={19} />
            </ActionIcon>
            <ActionIcon color="teal" variant="light" loading={saving} onClick={() => void saveLayout()} aria-label="Save layout" title="Save">
              <IconDeviceFloppy size={19} />
            </ActionIcon>
            <ActionIcon color="blue" variant="light" onClick={exportLayout} aria-label="Export layout" title="Export layout JSON">
              <IconDownload size={19} />
            </ActionIcon>
            <ActionIcon
              color="cyan"
              variant="light"
              onClick={() => importFileRef.current?.click()}
              aria-label="Import project"
              title="Import project JSON"
            >
              <IconUpload size={19} />
            </ActionIcon>

            <Divider orientation="vertical" className="lite-toolbar-divider" />
            <Button
              size="xs"
              variant={commandCenter.powerInfo?.trackVoltageOn ? "filled" : "light"}
              color={commandCenter.powerInfo?.trackVoltageOn ? "green" : "red"}
              leftSection={<IconPower size={16} />}
              disabled={wsStatus !== "connected" || !commandCenter.alive}
              onClick={() => wsApi.setTrackPower(!commandCenter.powerInfo?.trackVoltageOn)}
              title={commandCenter.powerInfo?.trackVoltageOn ? "Turn track power off" : "Turn track power on"}
            >
              POWER {commandCenter.powerInfo?.trackVoltageOn ? "ON" : "OFF"}
            </Button>

            <Divider orientation="vertical" className="lite-toolbar-divider" />
            <Button size="xs" variant="light" color="violet" leftSection={<IconTrain size={16} />} onClick={onOpenLocoEditor} title="Edit locomotives">
              LOCOS
            </Button>
            <Button size="xs" variant="light" color="yellow" leftSection={<IconTrafficLights size={16} />} onClick={() => setSignalLogicOpened(true)} title="Automatic signal aspects">
              SIGNALS
            </Button>
            <Button size="xs" variant="light" color="teal" leftSection={<IconShieldCheck size={16} />} onClick={() => setIntegrityCheckOpened(true)} title="Check all project references">
              CHECK
            </Button>
            <Button
              component="a"
              href="https://github.com/DCCExpress/DCCExpressLite/wiki"
              target="_blank"
              rel="noopener noreferrer"
              size="xs"
              variant="light"
              color="blue"
              leftSection={<IconHelpCircle size={16} />}
              title="Open the online DCCExpressLite documentation"
            >
              HELP
            </Button>
            <ActionIcon variant={locoPanelCollapsed ? "light" : "filled"} onClick={() => setLocoPanelCollapsed(value => !value)} title="Toggle locomotive panel">
              <IconTrain size={19} />
            </ActionIcon>
            <ActionIcon variant={propertyPanelCollapsed ? "light" : "filled"} onClick={() => setPropertyPanelCollapsed(value => !value)} title="Toggle property panel">
              <IconSettings size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </Card>

      {error && <Alert color="red">{error}</Alert>}

      <div className="lite-layout-workspace" style={workspaceStyle}>
        {!locoPanelCollapsed && (
          <div className="lite-loco-panel">
            <LocoPanel locos={locos} />
          </div>
        )}

        <div className="lite-panel-resizer lite-panel-resizer-left" onPointerDown={event => beginResize("left", event)}>
          <button type="button" onPointerDown={event => event.stopPropagation()} onClick={() => setLocoPanelCollapsed(value => !value)} title="Toggle locomotive panel">
            {locoPanelCollapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
          </button>
        </div>

        <Card withBorder p={4} className="lite-track-card">
          <TrackCanvas
            editMode={editMode}
            tool={tool}
            layout={layout}
            onLayoutChange={setLayout}
            selectedElement={selectedElement}
            onSelectedElementChange={setSelectedElement}
            invalidateCounter={invalidateCounter}
            onInvalidate={invalidate}
            fitCounter={fitCounter}
            turnoutSelectionMode={turnoutSelectionMode}
            setBusy={setBusy}
            locos={locos}
          />
        </Card>

        <div className="lite-panel-resizer lite-panel-resizer-right" onPointerDown={event => beginResize("right", event)}>
          <button type="button" onPointerDown={event => event.stopPropagation()} onClick={() => setPropertyPanelCollapsed(value => !value)} title="Toggle property panel">
            {propertyPanelCollapsed ? <IconChevronLeft size={16} /> : <IconChevronRight size={16} />}
          </button>
        </div>

        {!propertyPanelCollapsed && (
          rightPanelMode === "loco" ? (
            <div className="lite-property-panel lite-right-loco-panel">
              <LocoPanel locos={locos} selectedLocoStorageKey={RIGHT_LOCO_STORAGE_KEY} />
            </div>
          ) : (
            <Card withBorder p="sm" className="lite-property-panel">
              {editMode ? (
                <>
                  <Title order={5} mb="sm">{selectedElement ? "Properties" : "Display"}</Title>
                  <LitePropertyPanel
                    selectedElement={selectedElement}
                    layout={layout}
                    setLayout={setLayout}
                    turnoutSelectionMode={turnoutSelectionMode}
                    setTurnoutSelectionMode={setTurnoutSelectionMode}
                    setBusy={setBusy}
                    invalidate={invalidate}
                  />
                </>
              ) : (
                <Tabs defaultValue="automation" className="lite-runtime-tabs">
                  <Tabs.List grow mb="sm">
                    <Tabs.Tab value="automation">Automation</Tabs.Tab>
                    <Tabs.Tab value="info">Info</Tabs.Tab>
                    <Tabs.Tab value="log">Log</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="automation" className="lite-info-tab-panel">
                    <AutomationPanel
                      scripts={automationScripts}
                      onScriptsChange={setAutomationScripts}
                    />
                  </Tabs.Panel>

                  <Tabs.Panel value="info" className="lite-info-tab-panel">
                    <SystemInfoPanel
                      status={dccExStatus}
                      wsStatus={wsStatus}
                      flashInfo={flashInfo}
                      version={version}
                    />
                  </Tabs.Panel>

                  <Tabs.Panel value="log" className="lite-info-tab-panel">
                    <LayoutRuntimeLogPanel />
                  </Tabs.Panel>
                </Tabs>
              )}
            </Card>
          )
        )}
      </div>

      <Card withBorder p={5} radius="sm" className="lite-status-bar">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap={6} wrap="nowrap">
            <Badge
              size="sm"
              variant={wsStatus === "connected" ? "light" : "filled"}
              color={wsStatus === "connected" ? "green" : "red"}
              className={wsStatus === "connected" ? "" : "lite-ws-alert"}
              title={wsStatus === "connected" ? "WebSocket connected" : `WebSocket ${wsStatus} — reconnecting automatically`}
            >
              {wsStatus === "connected" ? "WS" : wsStatus === "reconnecting" ? "WS RETRY" : "WS LOST"}
            </Badge>
            <Badge
              size="sm"
              variant="light"
              color={commandCenter.powerInfo?.emergencyStop ? "red" : "gray"}
              onClick={() => commandCenter.powerInfo?.emergencyStop ? wsApi.powerOn() : wsApi.emergencyStop()}
              className={`lite-status-action${commandCenter.powerInfo?.emergencyStop ? " blinkBadge" : ""}`}
            >
              ESTOP
            </Badge>
            <Badge style={{ display: "none" }} size="sm" variant="light" color={commandCenter.locked ? "orange" : "gray"}>{commandCenter.locked ? "LOCK" : "FREE"}</Badge>
            <ActionIcon
              size="sm"
              variant={rightPanelMode === "loco" ? "filled" : "light"}
              color={rightPanelMode === "loco" ? "green" : "gray"}
              aria-label="Toggle right locomotive panel"
              title={rightPanelMode === "loco" ? "Right panel: locomotive control" : "Right panel: properties"}
              onClick={() => {
                setRightPanelMode(value => value === "property" ? "loco" : "property");
                setPropertyPanelCollapsed(false);
              }}
            >
              <IconTrain size={15} />
            </ActionIcon>
          </Group>
          <Text size="xs" c="dimmed" truncate>
            {layout.getAllElements().length} elements · {locos.length} locos
          </Text>
        </Group>
      </Card>

      <Modal opened={pickerOpened} onClose={() => setPickerOpened(false)} title="Add layout element" size="lg" returnFocus={false}>
        <ScrollArea.Autosize mah="70dvh">
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            {PICKER_ITEMS.map(item => (
              <Card
                key={item.type}
                withBorder
                p="xs"
                style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <ElementPreview
                  element={item.preview}
                  label={item.label}
                  width={54}
                  height={54}
                  translateX={4}
                  translateY={10}
                  onClick={() => {
                    setTool({ mode: "draw", elementType: item.type });
                    setPickerOpened(false);
                  }}
                />
              </Card>
            ))}
          </SimpleGrid>
        </ScrollArea.Autosize>
      </Modal>

      <Modal
        opened={temperatureAlertOpened}
        onClose={() => setTemperatureAlertOpened(false)}
        title="Critical Hub ESP32 temperature"
        size="sm"
        centered
      >
        <Stack>
          <Alert color="red" icon={<IconAlertTriangle size={20} />} title="DCCExpressHub temperature is critical">
            The ESP32 reports {dccExStatus?.chipTemperatureC?.toFixed(1) ?? "—"} °C. Check enclosure ventilation,
            nearby heat sources and sustained processor/network load.
          </Alert>
          <Text size="sm" c="dimmed">
            This is the internal silicon temperature of the ESP32, not the room temperature and not a separate reading for each CPU core.
          </Text>
          <Button color="red" onClick={() => setTemperatureAlertOpened(false)}>Acknowledge</Button>
        </Stack>
      </Modal>

      <SignalLogicDialog
        opened={signalLogicOpened}
        onClose={() => setSignalLogicOpened(false)}
        layout={layout}
      />

      <IntegrityCheckDialog
        opened={integrityCheckOpened}
        onClose={() => setIntegrityCheckOpened(false)}
        layout={layout}
        locos={locos}
      />

      <FullscreenLoader visible={canvasBusy} text={canvasBusyText} />
    </Stack>
  );
}
