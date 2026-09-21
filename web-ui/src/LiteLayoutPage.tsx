import { useTranslation } from "react-i18next";
import i18next from "i18next";
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
  IconSeparator,
  IconBrandGithub,
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
import type { BaseElement } from "./models/editor/core/BaseElement";
import { isTurnoutElement, LayoutView } from "@/models/editor/core/LayoutView";
import { TrackCornerElement } from "./models/editor/elements/TrackCornerElement";
import { TrackCrossingElement } from "./models/editor/elements/TrackCrossingElement";
import { TrackCurveElement } from "./models/editor/elements/TrackCurveElement";
import { TrackEndElement } from "./models/editor/elements/TrackEndElement";
import { TrackLevelCrossingElement } from "./models/editor/elements/TrackLevelCrossingElement";
import { AudioButtonElement } from "./models/editor/elements/AudioButtonElement";
import { BlockElement } from "./models/editor/elements/BlockElement";
import { ButtonElement } from "./models/editor/elements/ButtonElement";
import { TrackSensorElement } from "./models/editor/elements/TrackSensorElement";
import { TrackSignalElement } from "./models/editor/elements/TrackSignalElement";
import type { IEditableProperty } from "@/models/editor/elements/PropertyDescriptor";
import { TrackStraightElement } from "./models/editor/elements/TrackStraightElement";
import TrackTurnoutDoubleElement from "./models/editor/elements/TrackTurnoutDoubleElement";
import { TrackTurnoutLeftElement } from "./models/editor/elements/TrackTurnoutLeftElement";
import { TrackTurnoutRightElement } from "./models/editor/elements/TrackTurnoutRightElement";
import { TrackTurnoutTwoWayElement } from "./models/editor/elements/TrackTurnoutTwoWayElement";
import { TrackTurnoutThreeWayElement } from "./models/editor/elements/TrackTurnoutThreeWayElement";
import { LabelElement } from "./models/editor/elements/LabelElement";
import { RouteButtonElement } from "./models/editor/elements/RouteButtonElement";
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
  preview: BaseElement;
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

function createSignalPreview(): TrackSignalElement {
  return new TrackSignalElement(0, 0);
}

async function readHttpErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  const fallbackWithStatus =
    `${fallback} (HTTP ${response.status})`;

  try {
    const body =
      (await response.text()).trim();

    if (!body) {
      return fallbackWithStatus;
    }

    try {
      const parsed =
        JSON.parse(body) as {
          message?: unknown;
        };

      if (
        typeof parsed.message === "string" &&
        parsed.message.trim()
      ) {
        return parsed.message.trim();
      }
    } catch {
      // Plain-text backend response; show it as-is.
    }

    return body;
  } catch {
    return fallbackWithStatus;
  }
}

const PICKER_ITEMS: PickerItem[] = [
  { type: ELEMENT_TYPES.TRACK_STRAIGHT, get label() { return i18next.t("ui.straight"); }, preview: new TrackStraightElement(0, 0) },
  { type: ELEMENT_TYPES.TRACK_END, get label() { return i18next.t("ui.trackEnd"); }, preview: new TrackEndElement(0, 0) },
  { type: ELEMENT_TYPES.TRACK_CORNER, get label() { return i18next.t("ui.corner"); }, preview: new TrackCornerElement(0, 0) },
  { type: ELEMENT_TYPES.TRACK_CURVE, get label() { return i18next.t("ui.curve"); }, preview: new TrackCurveElement(0, 0) },
  { type: ELEMENT_TYPES.TRACK_CROSSING, get label() { return i18next.t("ui.crossing"); }, preview: new TrackCrossingElement(0, 0) },
  { type: ELEMENT_TYPES.TRACK_LEVEL_CROSSING, get label() { return i18next.t("ui.levelCrossing"); }, preview: new TrackLevelCrossingElement(0, 0) },
  { type: ELEMENT_TYPES.TRACK_TURNOUT_LEFT, get label() { return i18next.t("ui.leftTurnout"); }, preview: new TrackTurnoutLeftElement(0, 0) },
  { type: ELEMENT_TYPES.TRACK_TURNOUT_RIGHT, get label() { return i18next.t("ui.rightTurnout"); }, preview: new TrackTurnoutRightElement(0, 0) },
  { type: ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY, get label() { return i18next.t("ui.yTurnout"); }, preview: new TrackTurnoutTwoWayElement(0, 0) },
  { type: ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY, get label() { return i18next.t("ui.wThreeWayTurnout"); }, preview: new TrackTurnoutThreeWayElement(0, 0) },
  { type: ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE, get label() { return i18next.t("ui.doubleTurnout2"); }, preview: new TrackTurnoutDoubleElement(0, 0) },
  { type: ELEMENT_TYPES.TRACK_SENSOR, get label() { return i18next.t("ui.sensor2"); }, preview: new TrackSensorElement(0, 0) },
  { type: ELEMENT_TYPES.TRACK_BLOCK, get label() { return i18next.t("ui.block2"); }, preview: new BlockElement(0, 0) },
  { type: ELEMENT_TYPES.TRACK_SIGNAL2, get label() { return i18next.t("ui.signal2"); }, preview: createSignalPreview() },
  { type: ELEMENT_TYPES.BUTTON, get label() { return i18next.t("ui.outputButton"); }, preview: new ButtonElement(0, 0) },
  { type: ELEMENT_TYPES.BUTTON_ROUTE, get label() { return i18next.t("ui.route"); }, preview: new RouteButtonElement(0, 0) },
  { type: ELEMENT_TYPES.BUTTON_AUDIO, get label() { return i18next.t("ui.audioButton"); }, preview: new AudioButtonElement(0, 0) },
  { type: ELEMENT_TYPES.LABEL, get label() { return i18next.t("ui.label"); }, preview: new LabelElement(0, 0) },
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

function updateProperty(element: BaseElement, property: IEditableProperty, rawValue: unknown): void {
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
  selectedElement: BaseElement | null;
  layout: LayoutView;
  setLayout: React.Dispatch<React.SetStateAction<LayoutView>>;
  turnoutSelectionMode: boolean;
  setTurnoutSelectionMode: (on: boolean) => void;
  setBusy: (busy: boolean, text?: string) => void;
  invalidate: () => void;
}) {
  useTranslation();
  const properties = useMemo(
    () => selectedElement?.getEditableProperties() ?? [],
    [selectedElement, i18next.resolvedLanguage],
  );

  if (!selectedElement) {
    return <VisibilitySettings title={i18next.t("ui.layoutVisibility")} />;
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
  useTranslation();
  const commandCenter = useCommandCenter();
  const [layout, setLayout] = useState(() => new LayoutView());
  const [automationScripts, setAutomationScripts] = useState<AutomationScriptDefinition[]>([]);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [selectedElement, setSelectedElement] = useState<BaseElement | null>(null);
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

  // Level-crossing lamps are a visual animation. The canvas normally redraws
  // only after UI/runtime events, so request a lightweight redraw while at
  // least one level crossing has blinking enabled.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const needsBlinkRedraw =
        layout
          .getAllElements()
          .some(
            element =>
              element instanceof TrackLevelCrossingElement &&
              element.lightsEnabled &&
              element.blinkingEnabled
          );

      if (needsBlinkRedraw) {
        invalidate();
      }
    }, 225);

    return () => window.clearInterval(timer);
  }, [layout, invalidate]);

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
        throw new Error(i18next.t("ui.theLayoutCouldNotBeLoadedFromTheExCsb1"));
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
  }, [i18next.resolvedLanguage, ]);

  useEffect(() => {
    void loadLayout();
  }, [loadLayout]);

  useEffect(() => {
    if (!editMode || !(selectedElement instanceof RouteButtonElement)) {
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
        if (!response.ok) throw new Error(i18next.t("ui.flashInformationIsUnavailable"));
        return response.json() as Promise<FlashInfo>;
      })
      .then(setFlashInfo)
      .catch(() => setFlashInfo(null));
  }, []);

  useEffect(() => wsClient.on("error", data => {
    if (data.message === "track_power_off") {
      showNotification({
        color: "red",
        title: i18next.t("ui.trackPowerIsOff"),
        message: i18next.t("ui.turnPowerOnBeforeOperatingATurnout"),
      });
    } else if (data.message === "turnout_address_out_of_range") {
      showNotification({
        color: "red",
        title: i18next.t("ui.invalidTurnoutAddress"),
        message: i18next.t("ui.useALinearDccAccessoryAddressBetween1And2048"),
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
      } else if (
        (element instanceof TrackTurnoutDoubleElement ||
          element instanceof TrackTurnoutThreeWayElement) &&
        element.outputMode === "accessory"
      ) {
        if (element.turnout1Address === data.address) element.turnout1Closed = data.closed;
        if (element.turnout2Address === data.address) element.turnout2Closed = data.closed;
      }
    }
    layout.checkRoutes();
    invalidate();
  }), [layout, invalidate]);

  useEffect(() => wsClient.on("sensorChanged", data => {
    for (const element of layout.getAllElements()) {
      if (element instanceof TrackSensorElement && element.address === data.address) {
        element.on = data.on;
      }
    }
    invalidate();
  }), [layout, invalidate]);

  useEffect(() => wsClient.on("accessoryChanged", data => {
    for (const element of layout.getAllElements()) {
      if (
        element instanceof TrackSignalElement &&
        element.signalOutput.protocol === "dcc" &&
        element.signalOutput.address <= data.address &&
        element.lastAddress >= data.address
      ) {
        element.setValue(data.address, data.active);
      } else if (element instanceof ButtonElement && element.outputMode === "accessory" && element.address === data.address) {
        element.on = data.active === element.activeValue;
      } else if (element instanceof TrackLevelCrossingElement && element.basicAccessoryAddress === data.address) {
        element.barrierClosed = data.active === element.basicAccessoryClosedValue;
      }
    }
    invalidate();
  }), [layout, invalidate]);

  useEffect(() => wsClient.on("sensorSnapshot", data => {
    for (const [baseAddress, activeBits, knownBits] of data.groups) {
      for (const element of layout.getAllElements()) {
        if (!(element instanceof TrackSensorElement)) continue;
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
        element instanceof TrackSignalElement &&
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
      (element): element is BlockElement => element instanceof BlockElement,
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
        throw new Error(
          await readHttpErrorMessage(
            layoutResponse,
            i18next.t("ui.theLayoutCouldNotBeSavedToTheExCsb1")
          )
        );
      }

      await saveAutomationScripts(automationScripts);

      showNotification({
        color: "teal",
        title: i18next.t("ui.projectSaved"),
        message: i18next.t("ui.layoutAndAutomationScriptsWereSavedToTheirSeparateHub"),
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, [i18next.resolvedLanguage, layout, automationScripts]);

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
          throw new Error(
            await readHttpErrorMessage(
              layoutResponse,
              i18next.t("ui.importedLayoutCouldNotBeSavedToTheHub")
            )
          );
        }

        await saveAutomationScripts(imported.automationScripts);
        setLayout(nextLayout);
        setAutomationScripts(imported.automationScripts);
        setSelectedElement(null);

        showNotification({
          color: "teal",
          title: i18next.t("ui.projectImported"),
          message: i18next.t("ui.layoutAndAutomationScriptSWereRestored", { value1: imported.automationScripts.length }),
        });
      } catch (importError) {
        const message = importError instanceof Error ? importError.message : String(importError);
        setError(message);
        showNotification({ color: "red", title: i18next.t("ui.importFailed"), message });
      } finally {
        setSaving(false);
        if (importFileRef.current) {
          importFileRef.current.value = "";
        }
      }
    },
    [i18next.resolvedLanguage, ]
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

  const overloadedTracks =
    ((dccExStatus as any)?.tracks ?? [])
      .filter((track: any) => Boolean(track.overload));

  const anyTrackOverload =
    overloadedTracks.length > 0;

  const overloadedTrackNames =
    overloadedTracks
      .map((track: any) => track.letter)
      .join(", ");


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
            <ActionIcon variant="subtle" color="gray" onClick={onBack} aria-label={i18next.t("ui.back")} title={i18next.t("ui.home")}>
              <IconArrowLeft size={20} />
            </ActionIcon>
            <Title order={3} lh={1}>{i18next.t("ui.layoutPanel")}</Title>
            <Badge size="sm" variant="light" color="violet">v{version}</Badge>
          </Group>

          <Group gap={6} wrap="nowrap">
            <ActionIcon
              variant={editMode ? "filled" : "light"}
              color="violet"
              title={i18next.t("ui.editMode")}
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
                <ActionIcon variant={tool.mode === "cursor" ? "filled" : "light"} onClick={() => setTool({ mode: "cursor", elementType: "general" })} title={i18next.t("ui.select")}>
                  <IconPointer size={18} />
                </ActionIcon>
                <ActionIcon variant={tool.mode === "draw" ? "filled" : "light"} onClick={() => setPickerOpened(true)} title={i18next.t("ui.addLayoutElement")}>
                  <IconPlus size={18} />
                </ActionIcon>
                <ActionIcon variant="light" color="red" disabled={!selectedElement} onClick={removeSelected} title={i18next.t("ui.deleteSelected")}>
                  <IconTrash size={18} />
                </ActionIcon>
              </>
            )}

            <Divider orientation="vertical" className="lite-toolbar-divider" />
            <ActionIcon variant="light" onClick={() => setFitCounter(value => value + 1)} aria-label={i18next.t("ui.fitLayout")} title={i18next.t("ui.fitLayout")}>
              <IconFocusCentered size={19} />
            </ActionIcon>
            <ActionIcon variant="light" loading={loading} onClick={() => void loadLayout()} aria-label={i18next.t("ui.reloadLayout")} title={i18next.t("ui.reload")}>
              <IconRefresh size={19} />
            </ActionIcon>
            <ActionIcon color="teal" variant="light" loading={saving} onClick={() => void saveLayout()} aria-label={i18next.t("ui.saveLayout")} title={i18next.t("ui.save2")}>
              <IconDeviceFloppy size={19} />
            </ActionIcon>
            <ActionIcon color="blue" variant="light" onClick={exportLayout} aria-label={i18next.t("ui.exportLayout")} title={i18next.t("ui.exportLayoutJson")}>
              <IconDownload size={19} />
            </ActionIcon>
            <ActionIcon
              color="cyan"
              variant="light"
              onClick={() => importFileRef.current?.click()}
              aria-label={i18next.t("ui.importProject")}
              title={i18next.t("ui.importProjectJson")}
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
              title={commandCenter.powerInfo?.trackVoltageOn ? i18next.t("ui.turnTrackPowerOff") : i18next.t("ui.turnTrackPowerOn")}
            > {i18next.t("ui.power")} {commandCenter.powerInfo?.trackVoltageOn ? i18next.t("ui.on") : i18next.t("ui.off")}
            </Button>

            <Divider orientation="vertical" className="lite-toolbar-divider" />
            <Button size="xs" variant="light" color="violet" leftSection={<IconTrain size={16} />} onClick={onOpenLocoEditor} title={i18next.t("ui.editLocomotives")}> {i18next.t("ui.locos")} </Button>
            <Button size="xs" variant="light" color="yellow" leftSection={<IconTrafficLights size={16} />} onClick={() => setSignalLogicOpened(true)} title={i18next.t("ui.automaticSignalAspects")}> {i18next.t("ui.signals2")} </Button>
            <Button size="xs" variant="light" color="teal" leftSection={<IconShieldCheck size={16} />} onClick={() => setIntegrityCheckOpened(true)} title={i18next.t("ui.checkAllProjectReferences")}> {i18next.t("ui.check")} </Button>
            <Button
              component="a"
              href="https://github.com/DCCExpress/DCCExpressHub"
              target="_blank"
              rel="noopener noreferrer"
              size="xs"
              variant="light"
              color="blue"
              leftSection={<IconBrandGithub  size={16} />}
              title="GITHUB"
            > GITHUB </Button>
            <ActionIcon variant={locoPanelCollapsed ? "light" : "filled"} onClick={() => setLocoPanelCollapsed(value => !value)} title={i18next.t("ui.toggleLocomotivePanel")}>
              <IconTrain size={19} />
            </ActionIcon>
            <ActionIcon variant={propertyPanelCollapsed ? "light" : "filled"} onClick={() => setPropertyPanelCollapsed(value => !value)} title={i18next.t("ui.togglePropertyPanel")}>
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
          <button type="button" onPointerDown={event => event.stopPropagation()} onClick={() => setLocoPanelCollapsed(value => !value)} title={i18next.t("ui.toggleLocomotivePanel")}>
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
          <button type="button" onPointerDown={event => event.stopPropagation()} onClick={() => setPropertyPanelCollapsed(value => !value)} title={i18next.t("ui.togglePropertyPanel")}>
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
                  <Title order={5} mb="sm">{selectedElement ? i18next.t("ui.properties") : i18next.t("ui.display")}</Title>
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
                    <Tabs.Tab value="automation">{i18next.t("ui.automation2")}</Tabs.Tab>
                    <Tabs.Tab value="info">{i18next.t("ui.info")}</Tabs.Tab>
                    <Tabs.Tab value="log">{i18next.t("ui.log")}</Tabs.Tab>
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
              title={wsStatus === "connected" ? i18next.t("ui.websocketConnected") : i18next.t("ui.websocketReconnectingAutomatically", { value1: wsStatus })}
            >
              {wsStatus === "connected" ? "WS" : wsStatus === "reconnecting" ? i18next.t("ui.wsRetry") : i18next.t("ui.wsLost")}
            </Badge>

            <Divider orientation="vertical" />

            <Badge
              size="sm"
              variant="light"
              color={commandCenter.powerInfo?.emergencyStop ? "red" : "gray"}
              onClick={() => wsApi.emergencyStop()}
              className={`lite-status-action${commandCenter.powerInfo?.emergencyStop
                  ? " blinkBadge"
                  : ""
                }`}
            > {i18next.t("ui.estop")} </Badge>
            <Divider orientation="vertical" />
            <Badge
              size="sm"
              variant={anyTrackOverload ? "filled" : "light"}
              color={anyTrackOverload ? "red" : "gray"}
              className={anyTrackOverload ? "blinkBadge" : ""}
              title={
                anyTrackOverload
                  ? i18next.t("ui.overloadTrack", { value1: overloadedTrackNames })
                  : i18next.t("ui.noTrackOverload")
              }
            > {i18next.t("ui.overload")} </Badge>

            <Divider orientation="vertical" />

            <Badge style={{ display: "none" }} size="sm" variant="light" color={commandCenter.locked ? "orange" : "gray"}>{commandCenter.locked ? i18next.t("ui.lock") : i18next.t("ui.free")}</Badge>
            <ActionIcon
              size="sm"
              variant={rightPanelMode === "loco" ? "filled" : "light"}
              color={rightPanelMode === "loco" ? "green" : "gray"}
              aria-label={i18next.t("ui.toggleRightLocomotivePanel")}
              title={rightPanelMode === "loco" ? i18next.t("ui.rightPanelLocomotiveControl") : i18next.t("ui.rightPanelProperties")}
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

      <Modal opened={pickerOpened} onClose={() => setPickerOpened(false)} title={i18next.t("ui.addLayoutElement")} size="lg" returnFocus={false}>
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
        title={i18next.t("ui.criticalHubEsp32Temperature")}
        size="sm"
        centered
      >
        <Stack>
          <Alert color="red" icon={<IconAlertTriangle size={20} />} title={i18next.t("ui.dccexpresshubTemperatureIsCritical")}>
            The ESP32 reports {dccExStatus?.chipTemperatureC?.toFixed(1) ?? "—"} °C. Check enclosure ventilation,
            nearby heat sources and sustained processor/network load.
          </Alert>
          <Text size="sm" c="dimmed"> {i18next.t("ui.thisIsTheInternalSiliconTemperatureOfTheEsp32Not")} </Text>
          <Button color="red" onClick={() => setTemperatureAlertOpened(false)}>{i18next.t("ui.acknowledge")}</Button>
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
