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
  IconBug,
  IconLockOpen,
  IconRoute,
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
import PathsPanel from "@/components/PathsPanel";
import TimetableDialog from "@/components/TimetableDialog";
import TimetablePanel from "@/components/TimetablePanel";
import RoutesDialog from "@/components/RoutesDialog";
import AutomationFlowDialog from "@/components/automation/AutomationFlowDialog";
import { restorePersistedTopologyMetadata } from "@/services/layoutTopologyPersistence";
import {
  attachClientRouteTopologyToLayoutJson,
  ensureClientRouteGraph,
  hydrateClientRouteGraphCache,
} from "@/services/clientRouteGraphCache";
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
import { TrackDirectionElement } from "./models/editor/elements/TrackDirectionElement";
import TrackTurnoutDoubleElement from "./models/editor/elements/TrackTurnoutDoubleElement";
import { TrackTurnoutLeftElement } from "./models/editor/elements/TrackTurnoutLeftElement";
import { TrackTurnoutRightElement } from "./models/editor/elements/TrackTurnoutRightElement";
import { TrackTurnoutTwoWayElement } from "./models/editor/elements/TrackTurnoutTwoWayElement";
import { TrackTurnoutThreeWayElement } from "./models/editor/elements/TrackTurnoutThreeWayElement";
import { ClockElement } from "./models/editor/elements/ClockElement";
import { LabelElement } from "./models/editor/elements/LabelElement";
import { RouteButtonElement } from "./models/editor/elements/RouteButtonElement";
import ElementPreview from "@/models/editor/rendering/ElementPreviewRenderer";
import type { EditorTool } from "@/models/editor/types/EditorTypes";
import { wsApi } from "@/services/wsApi";
import { wsClient, type WsConnectionStatus } from "@/services/wsClient";
import { getActiveClientScriptExecutions } from "@/services/clientScriptRunner";
import {
  createAutomationId,
  createAutomationPayload,
  loadAutomationFlow,
  loadAutomationScripts,
  normalizeAutomationScripts,
  saveAutomationFlow,
  saveAutomationScripts,
  type AutomationScriptDefinition,
  type AutomationStoragePayload,
} from "@/services/automationApi";
import {
  createEmptyAutomationFlowDocument,
  normalizeAutomationFlowDocument,
  type AutomationFlowDocument,
} from "@/domain/automationFlow";
import "@/styles/propertypanel.css";
import DebugDialog from "@/components/debug/DebugDialog";
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
  automations: AutomationStoragePayload;
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

  /*
   * Save/export the authoritative client-generated route topology only when
   * its fingerprint and revisions match the current layout.
   */
  attachClientRouteTopologyToLayoutJson(
    layout,
    plainLayout
  );

  return JSON.stringify(plainLayout);
}

function createProjectExport(
  layout: LayoutView,
  automationScripts: AutomationScriptDefinition[],
  visualFlow: AutomationFlowDocument
): DccExpressProjectExport {
  return {
    format: "dccexpress-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    layout: JSON.parse(serializeLayoutOnly(layout)),
    automations:
      createAutomationPayload(
        automationScripts,
        undefined,
        visualFlow
      ),
  };
}

function parseImportedProject(raw: unknown): {
  layoutData: unknown;
  automationScripts: AutomationScriptDefinition[];
  visualFlow: AutomationFlowDocument;
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
        visualFlow:
          normalizeAutomationFlowDocument(
            automations.visualFlow
          ),
      };
    }
  }

  const prepared = prepareLayoutForLoad(raw);

  return {
    layoutData: prepared.layoutData,
    automationScripts: prepared.legacyAutomationScripts,
    visualFlow:
      createEmptyAutomationFlowDocument(),
  };
}

function createClockPreview(): ClockElement {
  const clock = new ClockElement(0, 0);
  clock.scale = 0.35;
  return clock;
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
  { type: ELEMENT_TYPES.TRACK_DIRECTION, get label() { return i18next.t("ui.direction"); }, preview: new TrackDirectionElement(0, 0) },
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
  { type: ELEMENT_TYPES.CLOCK, get label() { return i18next.t("fastClock.title"); }, preview: createClockPreview() },
  { type: ELEMENT_TYPES.LABEL, get label() { return i18next.t("ui.label"); }, preview: new LabelElement(0, 0) },
];

const LOCO_WIDTH_KEY = "dcc-express-lite.layout.locoPanelWidth";
const PROPERTY_WIDTH_KEY = "dcc-express-lite.layout.propertyPanelWidth";
const LOCO_COLLAPSED_KEY = "dcc-express-lite.layout.locoPanelCollapsed";
const PROPERTY_COLLAPSED_KEY = "dcc-express-lite.layout.propertyPanelCollapsed";
const RIGHT_PANEL_MODE_KEY = "dcc-express-lite.layout.rightPanelMode";
const RUNTIME_TAB_SESSION_KEY = "dcc-express-lite.layout.runtimeTab";
const RIGHT_LOCO_STORAGE_KEY = "dcc-express-lite.loco-panel.right.selected-loco-id";

type RightPanelMode = "property" | "loco";
type RuntimeTab = "paths" | "automation" | "timetable" | "info" | "log";

type SwitchManLockSnapshotItem = {
  address?: unknown;
};

function switchManTurnoutAddresses(element: BaseElement): number[] {
  if (isTurnoutElement(element)) {
    return Number.isInteger(element.turnoutAddress) && element.turnoutAddress > 0
      ? [element.turnoutAddress]
      : [];
  }

  if (
    element instanceof TrackTurnoutDoubleElement ||
    element instanceof TrackTurnoutThreeWayElement
  ) {
    return [element.turnout1Address, element.turnout2Address]
      .filter(address => Number.isInteger(address) && address > 0);
  }

  return [];
}

function isSwitchManTurnoutElement(element: BaseElement): boolean {
  return switchManTurnoutAddresses(element).length > 0;
}

function applySwitchManLocksToLayout(
  layout: LayoutView,
  rawLocks: unknown
): boolean {
  const lockedAddresses = new Set<number>();

  if (Array.isArray(rawLocks)) {
    for (const rawLock of rawLocks) {
      const address = Number(
        (rawLock as SwitchManLockSnapshotItem | null)?.address
      );

      if (
        Number.isInteger(address) &&
        address >= 1 &&
        address <= 2048
      ) {
        lockedAddresses.add(address);
      }
    }
  }

  let changed = false;

  for (const element of layout.getAllElements()) {
    const addresses = switchManTurnoutAddresses(element);

    if (addresses.length === 0) {
      continue;
    }

    const nextLocked = addresses.some(address => lockedAddresses.has(address));

    if (element.locked !== nextLocked) {
      element.locked = nextLocked;
      changed = true;
    }
  }

  return changed;
}

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

function readStoredRuntimeTab(): RuntimeTab {
  const value = sessionStorage.getItem(RUNTIME_TAB_SESSION_KEY);

  if (
    value === "paths" ||
    value === "timetable" ||
    value === "info" ||
    value === "log"
  ) {
    return value;
  }

  return "automation";
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
  const [automationFlow, setAutomationFlow] =
    useState<AutomationFlowDocument>(
      () =>
        createEmptyAutomationFlowDocument()
    );
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
  const [runtimeTab, setRuntimeTab] = useState<RuntimeTab>(readStoredRuntimeTab);
  const resizeRef = useRef<{ side: "left" | "right"; startX: number; startWidth: number } | null>(null);
  const temperatureCriticalRef = useRef(false);
  const [debugOpened, setDebugOpened] = useState(false);
  const [timetableOpened, setTimetableOpened] = useState(false);
  const [routesOpened, setRoutesOpened] = useState(false);
  const [automationFlowOpened, setAutomationFlowOpened] = useState(false);
  const [automationFlowPageId, setAutomationFlowPageId] =
    useState<string | null>(
      null
    );
  const [timetableRevision, setTimetableRevision] = useState(0);

  const invalidate = useCallback(() => setInvalidateCounter(value => value + 1), []);

  const forceReleaseAllSwitchManLocks = useCallback(async (): Promise<void> => {
    const activeScripts =
      getActiveClientScriptExecutions();

    if (activeScripts.length > 0) {
      showNotification({
        color: "orange",
        title: i18next.t("ui.stopScriptsFirst"),
        message: i18next.t(
          "ui.scriptsStillRunningOrPaused",
          {
            value1: activeScripts
              .map(script => script.name)
              .join(", "),
          }
        ),
      });
      return;
    }

    if (!window.confirm(
      i18next.t("ui.forceReleaseAllTurnoutLocksConfirm")
    )) {
      return;
    }

    const requestId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `switchman-unlock-${Date.now()}`;

    try {
      const released = await new Promise<number>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          unsubscribe();
          callback();
        };

        const unsubscribe = wsClient.subscribeMessages(message => {
          const raw = message as unknown as {
            type?: string;
            data?: {
              requestId?: string;
              action?: string;
              ok?: boolean;
              message?: string | null;
              extra?: { released?: number } | null;
            };
          };

          if (
            raw.type !== "switchManResponse" ||
            raw.data?.requestId !== requestId ||
            raw.data?.action !== "forceReleaseAll"
          ) {
            return;
          }

          if (!raw.data.ok) {
            finish(() => reject(new Error(raw.data?.message || i18next.t("ui.turnoutLockReleaseFailed"))));
            return;
          }

          finish(() => resolve(Number(raw.data?.extra?.released ?? 0)));
        });

        const timer = window.setTimeout(() => {
          finish(() => reject(new Error(i18next.t("ui.turnoutLockReleaseTimeout"))));
        }, 5000);

        const sent = wsClient.send({
          type: "switchManCommand",
          data: {
            requestId,
            action: "forceReleaseAll",
          },
        });

        if (!sent) {
          finish(() => reject(new Error(i18next.t("ui.noWebSocketConnection"))));
        }
      });

      showNotification({
        color: "green",
        title: i18next.t("ui.turnoutLocksReleased"),
        message: released > 0
          ? i18next.t(
              "ui.turnoutLocksReleasedCount",
              { value1: released }
            )
          : i18next.t("ui.noActiveTurnoutLocks"),
      });
    } catch (unlockError) {
      showNotification({
        color: "red",
        title: i18next.t("ui.releaseAllTurnoutLocksFailed"),
        message: unlockError instanceof Error ? unlockError.message : String(unlockError),
      });
    }
  }, []);

  // Level-crossing lamps and SwitchMan turnout locks are visual animations.
  // The canvas normally redraws only after UI/runtime events, so use the same
  // lightweight animation tick for both instead of creating another timer.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const needsBlinkRedraw =
        layout
          .getAllElements()
          .some(
            element =>
              (
                element instanceof TrackLevelCrossingElement &&
                element.lightsEnabled &&
                element.blinkingEnabled
              ) ||
              (
                isSwitchManTurnoutElement(element) &&
                element.locked
              )
          );

      if (needsBlinkRedraw) {
        invalidate();
      }
    }, 225);

    return () => window.clearInterval(timer);
  }, [layout, invalidate]);

  // Mirror the backend-authoritative SwitchMan lock snapshot onto the layout
  // turnout elements. The backend broadcasts switchManChanged on every acquire
  // and release; we also explicitly request one snapshot when this LayoutView
  // instance becomes active so a lock acquired before page mount is not missed.
  useEffect(() => {
    let disposed = false;

    const applyLocks = (locks: unknown): void => {
      if (disposed) return;

      if (applySwitchManLocksToLayout(layout, locks)) {
        invalidate();
      }
    };

    const unsubscribeMessages =
      wsClient.subscribeMessages(message => {
        const raw = message as unknown as {
          type?: string;
          data?: {
            action?: string;
            extra?: { locks?: unknown } | null;
            locks?: unknown;
          };
        };

        if (raw.type === "switchManChanged") {
          applyLocks(raw.data?.locks);
          return;
        }

        if (
          raw.type === "switchManResponse" &&
          raw.data?.action === "snapshot"
        ) {
          applyLocks(raw.data?.extra?.locks);
        }
      });

    const unsubscribeStatus =
      wsClient.subscribeStatus(status => {
        if (status !== "connected") {
          return;
        }

        const requestId =
          typeof crypto !== "undefined" &&
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `switchman-snapshot-${Date.now()}`;

        wsClient.send({
          type: "switchManCommand",
          data: {
            requestId,
            action: "snapshot",
          },
        });
      });

    return () => {
      disposed = true;
      unsubscribeMessages();
      unsubscribeStatus();
    };
  }, [layout, invalidate]);

  const setBusy = useCallback((busy: boolean, text?: string) => {
    setCanvasBusy(busy);
    if (text) setCanvasBusyText(text);
  }, []);

  const loadLayout = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [
        layoutResponse,
        storedAutomations,
        storedFlow,
      ] = await Promise.all([
        fetch("/api/layout", { cache: "no-store" }),
        loadAutomationScripts(),
        loadAutomationFlow(),
      ]);

      if (!layoutResponse.ok) {
        throw new Error(i18next.t("ui.theLayoutCouldNotBeLoadedFromTheExCsb1"));
      }

      const prepared = prepareLayoutForLoad(await layoutResponse.json());
      const nextLayout = LayoutView.fromJSON(prepared.layoutData);

      restorePersistedTopologyMetadata(
        nextLayout,
        prepared.layoutData
      );

      hydrateClientRouteGraphCache(
        nextLayout,
        prepared.layoutData
      );

      nextLayout.checkRoutes();
      setLayout(nextLayout);
      setAutomationScripts(
        storedAutomations.length > 0
          ? storedAutomations
          : prepared.legacyAutomationScripts
      );

      setAutomationFlow(
        normalizeAutomationFlowDocument(
          storedFlow
        )
      );

      setSelectedElement(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [i18next.resolvedLanguage,]);

  useEffect(() => {
    void loadLayout();
  }, [loadLayout]);

  useEffect(() => {
    if (!editMode || !(selectedElement instanceof RouteButtonElement)) {
      setTurnoutSelectionMode(false);
    }
  }, [editMode, selectedElement]);

  useEffect(() => {
    /*
     * Frontend route graph / segmentation is now authoritative.
     *
     * Do NOT call layout.resetRoutes() when entering edit mode: resetRoutes()
     * clears TrackElement.section, which made the generated S1/S2/... labels
     * disappear exactly when Layout Visibility -> Show segments was enabled.
     *
     * Route highlighting can still be recalculated in view mode, while the
     * generated section + travelDirection metadata stays attached to the
     * physical layout elements until the next graph generation.
     */
    if (!editMode) {
      layout.checkRoutes();
    }

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
    } else if (data.message === "turnout_locked") {
      const lockInfo = data as typeof data & {
        address?: number;
        ownerName?: string | null;
      };

      showNotification({
        color: "orange",
        title: i18next.t("ui.turnoutLocked"),
        message: lockInfo.ownerName
          ? i18next.t(
              "ui.turnoutLockedByOwner",
              {
                value1: lockInfo.address ?? "?",
                value2: lockInfo.ownerName,
              }
            )
          : i18next.t(
              "ui.turnoutLockedMessage",
              { value1: lockInfo.address ?? "?" }
            ),
      });

      // A RouteButton currently updates its local element optimistically after
      // the WebSocket send. If the backend rejects the physical command because
      // SwitchMan owns the turnout, immediately re-apply the authoritative
      // runtime state so the canvas cannot keep showing the rejected position.
      wsApi.getLayoutRuntimeSnapshot();
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
        element.setValue(
          data.address,
          data.active
        );
      } else if (
        element instanceof ButtonElement &&
        element.outputMode === "accessory" &&
        element.address === data.address
      ) {
        element.on =
          data.active ===
          element.activeValue;
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
      /*
       * SAVE is the authoritative graph-build point.
       *
       * The fingerprint cache makes this effectively free when only
       * non-topological editor properties changed.
       */
      const ensuredRouteGraph =
        ensureClientRouteGraph(
          layout
        );

      if (ensuredRouteGraph.rebuilt) {
        invalidate();
      }

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
  }, [i18next.resolvedLanguage, layout, automationScripts, invalidate]);

  const exportLayout = useCallback(async () => {
    try {
      const ensuredRouteGraph =
        ensureClientRouteGraph(
          layout
        );

      if (ensuredRouteGraph.rebuilt) {
        invalidate();
      }

      const visualFlow =
        await loadAutomationFlow();

      const project =
        createProjectExport(
          layout,
          automationScripts,
          visualFlow
        );
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
    } catch (exportError) {
      const message =
        exportError instanceof Error
          ? exportError.message
          : String(exportError);

      setError(message);

      showNotification({
        color: "red",
        title: "Export sikertelen",
        message,
      });
    }
  }, [layout, automationScripts, invalidate]);

  const importProject = useCallback(
    async (file: File): Promise<void> => {
      setSaving(true);
      setError(null);

      try {
        const parsed = JSON.parse(await file.text()) as unknown;
        const imported = parseImportedProject(parsed);
        const nextLayout = LayoutView.fromJSON(imported.layoutData);

        restorePersistedTopologyMetadata(
          nextLayout,
          imported.layoutData
        );

        hydrateClientRouteGraphCache(
          nextLayout,
          imported.layoutData
        );

        ensureClientRouteGraph(
          nextLayout
        );

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
        await saveAutomationFlow(imported.visualFlow);
        setLayout(nextLayout);
        setAutomationScripts(imported.automationScripts);
        setAutomationFlow(
          imported.visualFlow
        );
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
    [i18next.resolvedLanguage,]
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
            <Button variant="light" leftSection={<IconBug size={16} />} onClick={() => setDebugOpened(true)}>
              Debug
            </Button>
            <Button
              component="a"
              href="https://github.com/DCCExpress/DCCExpressHub"
              target="_blank"
              rel="noopener noreferrer"
              size="xs"
              variant="light"
              color="blue"
              leftSection={<IconBrandGithub size={16} />}
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
                <Tabs
                  value={runtimeTab}
                  onChange={value => {
                    const nextTab: RuntimeTab =
                      value === "paths" ||
                      value === "timetable" ||
                      value === "info" ||
                      value === "log"
                        ? value
                        : "automation";

                    setRuntimeTab(nextTab);
                    sessionStorage.setItem(RUNTIME_TAB_SESSION_KEY, nextTab);
                  }}
                  className="lite-runtime-tabs"
                >
                  <Tabs.List grow mb="sm">
                    <Tabs.Tab value="paths">{i18next.t("ui.paths")}</Tabs.Tab>
                    <Tabs.Tab value="automation">{i18next.t("ui.automation2")}</Tabs.Tab>
                    <Tabs.Tab value="timetable">{i18next.t("ui.timetable")}</Tabs.Tab>
                    <Tabs.Tab value="info">{i18next.t("ui.info")}</Tabs.Tab>
                    <Tabs.Tab value="log">{i18next.t("ui.log")}</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="paths" className="lite-info-tab-panel">
                    <PathsPanel
                      layout={layout}
                      invalidate={invalidate}
                    />
                  </Tabs.Panel>

                  <Tabs.Panel value="automation" className="lite-info-tab-panel">
                    <Stack h="100%" gap="xs">
                      <Group justify="flex-end">
                        <Group gap="xs">
                          <Button
                            size="xs"
                            variant="light"
                            color="blue"
                            leftSection={<IconRoute size={15} />}
                            onClick={() => setRoutesOpened(true)}
                          >
                            {i18next.t("ui.routes")}
                          </Button>

                          <Button
                            size="xs"
                            variant="light"
                            color="red"
                            leftSection={<IconLockOpen size={15} />}
                            onClick={() => void forceReleaseAllSwitchManLocks()}
                          >
                            {i18next.t("ui.releaseAllTurnoutLocks")}
                          </Button>
                        </Group>
                      </Group>

                      <div style={{ flex: 1, minHeight: 0 }}>
                        <AutomationPanel
                          scripts={automationScripts}
                          onScriptsChange={setAutomationScripts}
                          flows={automationFlow}
                          onFlowsChange={setAutomationFlow}
                          onOpenFlowEditor={pageId => {
                            setAutomationFlowPageId(pageId);
                            setAutomationFlowOpened(true);
                          }}
                        />
                      </div>
                    </Stack>
                  </Tabs.Panel>

                  <Tabs.Panel value="timetable" className="lite-info-tab-panel">
                    <TimetablePanel
                      scripts={automationScripts}
                      timetableRevision={timetableRevision}
                      onOpenTimetable={() => setTimetableOpened(true)}
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

      <DebugDialog
        opened={debugOpened}
        onClose={() => setDebugOpened(false)}
      />

      <RoutesDialog
        opened={routesOpened}
        onClose={() => setRoutesOpened(false)}
        layout={layout}
        onGenerated={invalidate}
      />

      <AutomationFlowDialog
        opened={automationFlowOpened}
        initialPageId={automationFlowPageId}
        onSaved={setAutomationFlow}
        onClose={() => {
          setAutomationFlowOpened(false);
          setAutomationFlowPageId(null);
        }}
      />

      <TimetableDialog
        opened={timetableOpened}
        onClose={() => setTimetableOpened(false)}
        onSaved={() => setTimetableRevision(value => value + 1)}
        scripts={automationScripts}
      />

      <FullscreenLoader visible={canvasBusy} text={canvasBusyText} />
    </Stack>
  );
}
