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
import VisibilitySettings from "@/components/VisibilitySettings";
import { useCommandCenter } from "@/context/CommandCenterContext";
import { useLayoutPageShortcuts } from "@/hooks/layout/useLayoutPageShortcuts";
import BasicPropertyEditor from "@/layout/property-panel/BasicPropertyEditor";
import BlockTypeSelectPropertyEditor from "@/layout/property-panel/BlockTypeSelectPropertyEditor";
import SignalAspectPropertyEditor from "@/layout/property-panel/SignalAspectPropertyEditor";
import TurnoutBitPropertyEditor from "@/layout/property-panel/TurnoutBitPropertyEditor";
import RouteTurnoutSelectionPropertyEditor from "@/layout/property-panel/RouteTurnoutSelectionPropertyEditor";
import LocoPanel from "@/layout/LocoPanel";
import type { BaseElementView } from "@/models/editor/core/BaseElementView";
import { isTurnoutElement, LayoutView } from "@/models/editor/core/LayoutView";
import { TrackCornerElementView } from "@/models/editor/elements/TrackCornerElementView";
import { TrackCrossingElementView } from "@/models/editor/elements/TrackCrossingElementView";
import { TrackCurveElementView } from "@/models/editor/elements/TrackCurveElementView";
import { TrackEndElementView } from "@/models/editor/elements/TrackEndElementView";
import { TrackLevelCrossingElementView } from "@/models/editor/elements/TrackLevelCrossingElementView";
import { BlockElementView } from "@/models/editor/elements/BlockElementView";
import { ButtonElementView } from "@/models/editor/elements/ButtonElementView";
import { TrackSensorElementView } from "@/models/editor/elements/TrackSensorElementView";
import { TrackSignalElementView } from "@/models/editor/elements/TrackSignalElementView";
import type { IEditableProperty } from "@/models/editor/elements/PropertyDescriptor";
import { TrackStraightElementView } from "@/models/editor/elements/TrackStraightElementView";
import TrackTurnoutDoubleElementView from "@/models/editor/elements/TrackTurnoutDoubleElementView";
import { TrackTurnoutLeftElementView } from "@/models/editor/elements/TrackTurnoutLeftElementView";
import { TrackTurnoutRightElementView } from "@/models/editor/elements/TrackTurnoutRightElementView";
import { LabelElementView } from "@/models/editor/elements/LabelElementView";
import { RouteButtonElementView } from "@/models/editor/elements/RouteButtonElementView";
import ElementPreview from "@/models/editor/rendering/ElementPreviewRenderer";
import type { EditorTool } from "@/models/editor/types/EditorTypes";
import { wsApi } from "@/services/wsApi";
import { wsClient, type WsConnectionStatus } from "@/services/wsClient";
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

type ConfiguredHardwareDevice = {
  type: string;
  bus: "GPIO" | "I2C";
  address: number | null;
  addressHex: string | null;
  firstVpin: number;
  lastVpin: number;
  pinCount: number;
  state: string;
  online: boolean;
};

type DetectedI2cDevice = {
  address: number;
  addressHex: string;
  typeGuess: string;
  detected: boolean;
};

type HardwareDevicesSnapshot = {
  scannedAtMs: number;
  configuredDevices: ConfiguredHardwareDevice[];
  i2cDevices: DetectedI2cDevice[];
};

type PickerItem = {
  type: ElementType;
  label: string;
  preview: BaseElementView;
};

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
  { type: ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE, label: "Double turnout", preview: new TrackTurnoutDoubleElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_SENSOR, label: "Sensor", preview: new TrackSensorElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_BLOCK, label: "Block", preview: new BlockElementView(0, 0) },
  { type: ELEMENT_TYPES.TRACK_SIGNAL2, label: "Signal", preview: createSignalPreview() },
  { type: ELEMENT_TYPES.BUTTON, label: "Output button", preview: new ButtonElementView(0, 0) },
  { type: ELEMENT_TYPES.BUTTON_ROUTE, label: "Route", preview: new RouteButtonElementView(0, 0) },
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

function formatUptime(uptimeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(uptimeMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m ${seconds}s`;
}

function InfoRow({ label, value, color = "blue" }: { label: string; value: string; color?: string }) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="sm" c="dimmed">{label}</Text>
      <Badge size="lg" variant="light" color={color}>{value}</Badge>
    </Group>
  );
}

type TemperatureLevel = {
  label: "NORMAL" | "WARM" | "WARNING" | "CRITICAL";
  color: "green" | "yellow" | "orange" | "red";
};

function getTemperatureLevel(temperatureC: number): TemperatureLevel {
  if (temperatureC > 85) return { label: "CRITICAL", color: "red" };
  if (temperatureC >= 75) return { label: "WARNING", color: "orange" };
  if (temperatureC >= 65) return { label: "WARM", color: "yellow" };
  return { label: "NORMAL", color: "green" };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function DccExInfoPanel({
  status,
  wsStatus,
  flashInfo,
}: {
  status: DccExStatusPayload | null;
  wsStatus: WsConnectionStatus;
  flashInfo: FlashInfo | null;
}) {
  const totalBytes = flashInfo?.totalBytes ?? (flashInfo ? flashInfo.total * 1024 : 0);
  const usedBytes = flashInfo?.usedBytes ?? (flashInfo ? flashInfo.used * 1024 : 0);
  const freeBytes = flashInfo?.freeBytes ?? (flashInfo ? flashInfo.free * 1024 : 0);
  const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
  const firmwarePercent = flashInfo?.firmwareBytes && flashInfo.firmwarePartitionBytes
    ? Math.round((flashInfo.firmwareBytes / flashInfo.firmwarePartitionBytes) * 100)
    : 0;
  const temperature = status?.chipTemperatureC;
  const temperatureLevel = temperature !== undefined ? getTemperatureLevel(temperature) : null;

  return (
    <ScrollArea h="100%" type="always" scrollbarSize={9} className="lite-info-scroll">
      <Stack gap="sm">
        <Card withBorder p="sm">
          <Stack gap="xs">
            <Text fw={700}>DCC-EX status</Text>
            <InfoRow label="Connection" value={wsStatus === "connected" ? "ONLINE" : wsStatus.toUpperCase()} color={wsStatus === "connected" ? "green" : "red"} />
            <InfoRow label="DCC-EX version" value={status ? `V-${status.version}` : "—"} color="violet" />
            <InfoRow label="Hardware" value={status?.hardware ?? "—"} color="cyan" />
            <InfoRow label="Track voltage" value={status?.trackVoltageOn ? "ON" : "OFF"} color={status?.trackVoltageOn ? "green" : "red"} />
            <InfoRow label="MAIN current" value={status ? `${status.mainCurrentMa} mA` : "—"} color="orange" />
            <InfoRow label="PROG current" value={status ? `${status.progCurrentMa} mA` : "—"} color="yellow" />
            <InfoRow label="Uptime" value={status ? formatUptime(status.uptimeMs) : "—"} color="teal" />
            <InfoRow label="Free memory" value={status ? `${Math.round(status.freeHeapBytes / 1024)} KB` : "—"} color="indigo" />
            <InfoRow label="Minimum free memory" value={status?.minimumFreeHeapBytes !== undefined ? `${Math.round(status.minimumFreeHeapBytes / 1024)} KB` : "—"} color={(status?.minimumFreeHeapBytes ?? 999999) < 40000 ? "red" : "blue"} />
            <InfoRow label="Processor" value={status?.cpuCores ? `${status.cpuCores} cores · ${status.cpuFrequencyMhz ?? 240} MHz` : "—"} color="violet" />
            <InfoRow label="Core 0 · Wi-Fi / web" value={status?.cpuCore0Percent !== undefined ? `${status.cpuCore0Percent}%` : "—"} color={(status?.cpuCore0Percent ?? 0) >= 85 ? "red" : "cyan"} />
            <InfoRow label="Core 1 · DCC-EX activity" value={status?.cpuCore1Percent !== undefined ? `${status.cpuCore1Percent}%` : "—"} color="teal" />
            <InfoRow
              label="Chip temperature"
              value={temperature !== undefined && temperatureLevel ? `${temperature.toFixed(1)} °C · ${temperatureLevel.label}` : "—"}
              color={temperatureLevel?.color ?? "gray"}
            />
            <InfoRow label="WebSocket clients" value={status?.wsClients !== undefined ? String(status.wsClients) : "—"} color="cyan" />
            <InfoRow label="WS command queue" value={status?.wsCommandQueueLength !== undefined ? String(status.wsCommandQueueLength) : "—"} color={(status?.wsCommandQueueLength ?? 0) >= 6 ? "red" : "teal"} />
            <InfoRow label="Dropped WS commands" value={status?.droppedWsCommands !== undefined ? String(status.droppedWsCommands) : "—"} color={(status?.droppedWsCommands ?? 0) > 0 ? "red" : "green"} />
            <InfoRow label="Dropped telemetry" value={status?.droppedWsTelemetry !== undefined ? String(status.droppedWsTelemetry) : "—"} color={(status?.droppedWsTelemetry ?? 0) > 0 ? "orange" : "green"} />
            <InfoRow label="Dropped control messages" value={status?.droppedWsControl !== undefined ? String(status.droppedWsControl) : "—"} color={(status?.droppedWsControl ?? 0) > 0 ? "red" : "green"} />
            <InfoRow label="Low-memory WS drops" value={status?.droppedWsLowMemory !== undefined ? String(status.droppedWsLowMemory) : "—"} color={(status?.droppedWsLowMemory ?? 0) > 0 ? "orange" : "green"} />
            <InfoRow label="Largest free heap block" value={status?.largestFreeHeapBlockBytes !== undefined ? `${Math.round(status.largestFreeHeapBlockBytes / 1024)} KB` : "—"} color={(status?.largestFreeHeapBlockBytes ?? 999999) < 16000 ? "red" : "blue"} />
            <InfoRow label="Reset reason" value={status?.resetReason ?? "—"} color={status?.resetReason === "panic" || status?.resetReason?.includes("watchdog") ? "red" : "gray"} />
            {status && !status.voltageMeasured && (
              <Text size="xs" c="dimmed">
                EX-CSB1 reports track power state, but this hardware does not expose a numeric track-voltage measurement.
              </Text>
            )}
          </Stack>
        </Card>

        <Card withBorder p="sm">
          <Stack gap="xs">
            <Text fw={700}>Flash storage</Text>
            <InfoRow label="Flash chip" value={flashInfo?.flashChipBytes ? formatBytes(flashInfo.flashChipBytes) : "—"} color="violet" />
            <InfoRow
              label="Firmware"
              value={flashInfo?.firmwareBytes && flashInfo.firmwarePartitionBytes ? `${formatBytes(flashInfo.firmwareBytes)} / ${formatBytes(flashInfo.firmwarePartitionBytes)} · ${firmwarePercent}%` : "—"}
              color={firmwarePercent >= 90 ? "red" : firmwarePercent >= 75 ? "orange" : "teal"}
            />
            <InfoRow label="OTA reserve" value={flashInfo?.otaPartitionBytes ? formatBytes(flashInfo.otaPartitionBytes) : "—"} color="indigo" />
            <InfoRow label="Data partition" value={totalBytes ? formatBytes(totalBytes) : "—"} color="blue" />
            <InfoRow label="Data used" value={totalBytes ? `${formatBytes(usedBytes)} · ${usedPercent}%` : "—"} color={usedPercent >= 85 ? "red" : usedPercent >= 70 ? "orange" : "teal"} />
            <InfoRow label="Data free" value={totalBytes ? formatBytes(freeBytes) : "—"} color="green" />
            <InfoRow label="System reserved" value={flashInfo?.systemReservedBytes ? formatBytes(flashInfo.systemReservedBytes) : "—"} color="gray" />
            <Text size="xs" c="dimmed">Firmware and data percentages refer to their own partitions, not the whole flash chip.</Text>
          </Stack>
        </Card>
      </Stack>
    </ScrollArea>
  );
}

const HAL_DRIVER_FAMILIES = [
  "GPIO", "PCA9685", "MCP23017 / MCP23008", "PCF8574 / PCF8575", "PCA9555 / TCA9555",
  "ADS111x", "VL53L0X", "HC-SR04", "DFPlayer", "EX-Turntable", "EX-IOExpander",
];

function DevicesPanel({
  snapshot,
  loading,
  error,
  onRefresh,
}: {
  snapshot: HardwareDevicesSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <ScrollArea h="100%" type="always" scrollbarSize={9} className="lite-info-scroll">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Text fw={700}>Hardware devices</Text>
          <Button size="xs" variant="light" leftSection={<IconRefresh size={15} />} loading={loading} onClick={onRefresh}>
            Refresh
          </Button>
        </Group>

        {error && <Alert color="red">{error}</Alert>}

        <Card withBorder p="sm">
          <Stack gap="xs">
            <Text fw={700}>Configured HAL devices</Text>
            <Text size="xs" c="dimmed">Devices and VPIN ranges defined in the DCC-EX hardware abstraction layer.</Text>
            {snapshot?.configuredDevices.map((device, index) => (
              <Card key={`${device.firstVpin}-${index}`} withBorder p="xs" radius="sm">
                <Stack gap={5}>
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Text size="sm" fw={600}>{device.type}</Text>
                    <Badge size="sm" color={device.online ? "green" : "red"} title={`DCC-EX state: ${device.state}`}>
                      {device.online ? "ONLINE" : "OFFLINE"}
                    </Badge>
                  </Group>
                  <Group gap={5}>
                    <Badge size="sm" variant="light" color={device.bus === "I2C" ? "blue" : "gray"}>{device.bus}</Badge>
                    {device.addressHex && <Badge size="sm" variant="light" color="cyan">{device.addressHex}</Badge>}
                    <Badge size="sm" variant="light" color="violet">VPIN {device.firstVpin}–{device.lastVpin}</Badge>
                    <Badge size="sm" variant="light" color="gray">{device.pinCount} pins</Badge>
                  </Group>
                </Stack>
              </Card>
            ))}
            {!loading && snapshot?.configuredDevices.length === 0 && <Text size="sm" c="dimmed">No HAL devices are configured.</Text>}
          </Stack>
        </Card>

        <Card withBorder p="sm">
          <Stack gap="xs">
            <Text fw={700}>Detected I²C devices</Text>
            <Text size="xs" c="dimmed">Live scan of the physical I²C bus. Device type is inferred from its address and can be ambiguous.</Text>
            {snapshot?.i2cDevices.map(device => (
              <Group key={device.address} justify="space-between" wrap="nowrap">
                <Text size="sm">{device.typeGuess}</Text>
                <Badge color="cyan" variant="light">{device.addressHex}</Badge>
              </Group>
            ))}
            {!loading && snapshot?.i2cDevices.length === 0 && <Text size="sm" c="dimmed">No device responded on the I²C bus.</Text>}
          </Stack>
        </Card>

        <Card withBorder p="sm">
          <Stack gap="xs">
            <Text fw={700}>DCC-EX HAL driver families</Text>
            <Text size="xs" c="dimmed">Common built-in and supported device families; only configured or physically detected devices appear above.</Text>
            <Group gap={5}>{HAL_DRIVER_FAMILIES.map(name => <Badge key={name} size="sm" variant="light" color="gray">{name}</Badge>)}</Group>
          </Stack>
        </Card>
      </Stack>
    </ScrollArea>
  );
}

export default function LiteLayoutPage({ version, locos, onBack, onOpenLocoEditor }: LiteLayoutPageProps) {
  const commandCenter = useCommandCenter();
  const [layout, setLayout] = useState(() => new LayoutView());
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
  const [hardwareDevices, setHardwareDevices] = useState<HardwareDevicesSnapshot | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
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
      const response = await fetch("/api/layout", { cache: "no-store" });
      if (!response.ok) throw new Error("The layout could not be loaded from the EX-CSB1.");
      const nextLayout = LayoutView.fromJSON(await response.json());
      nextLayout.checkRoutes();
      setLayout(nextLayout);
      setSelectedElement(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHardwareDevices = useCallback(async () => {
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const response = await fetch("/api/devices", { cache: "no-store" });
      if (!response.ok) throw new Error("Hardware device information is unavailable.");
      setHardwareDevices(await response.json() as HardwareDevicesSnapshot);
    } catch (loadError) {
      setDevicesError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setDevicesLoading(false);
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

  useEffect(() => wsClient.on("vpinChanged", data => {
    for (const element of layout.getAllElements()) {
      if (isTurnoutElement(element) && element.outputMode === "vpin" && element.turnoutAddress === data.vpin) {
        element.turnoutClosed = data.active;
      } else if (element instanceof TrackTurnoutDoubleElementView && element.outputMode === "vpin") {
        if (element.turnout1Address === data.vpin) element.turnout1Closed = data.active;
        if (element.turnout2Address === data.vpin) element.turnout2Closed = data.active;
      } else if (
        element instanceof TrackSignalElementView &&
        element.signalOutput.protocol === "dcc" &&
        element.outputMode === "vpin" &&
        element.signalOutput.address <= data.vpin &&
        element.lastAddress >= data.vpin
      ) {
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
    for (const [wireBlockId, state] of Object.entries(data)) {
      const blockId = Number(wireBlockId);
      if (!Number.isInteger(blockId) || blockId < 1 || blockId > 0xffff) continue;
      const block = blocks.find(item => item.id === blockId);
      if (!block) continue;
      block.locoAddress = state.locoAddress ??
        locos.find(loco => loco.id === state.locoId)?.address ?? 0;
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
      const response = await fetch("/api/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(layout),
      });
      if (!response.ok) throw new Error("The layout could not be saved to the EX-CSB1.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, [layout]);

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
              <ActionIcon variant={tool.mode === "draw" ? "filled" : "light"} onClick={() => setPickerOpened(true)} title="Add track">
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
        {!locoPanelCollapsed && <div className="lite-loco-panel">
          <LocoPanel locos={locos} />
        </div>}

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
                <Tabs
                  defaultValue="info"
                  className="lite-runtime-tabs"
                  onChange={value => { if (value === "devices") void loadHardwareDevices(); }}
                >
                  <Tabs.List grow mb="sm">
                    <Tabs.Tab value="info">Info</Tabs.Tab>
                    <Tabs.Tab value="devices">Devices</Tabs.Tab>
                    <Tabs.Tab value="log">Log</Tabs.Tab>
                  </Tabs.List>
                  <Tabs.Panel value="info" className="lite-info-tab-panel">
                    <DccExInfoPanel
                      status={dccExStatus}
                      wsStatus={wsStatus}
                      flashInfo={flashInfo}
                    />
                  </Tabs.Panel>
                  <Tabs.Panel value="devices" className="lite-info-tab-panel">
                    <DevicesPanel
                      snapshot={hardwareDevices}
                      loading={devicesLoading}
                      error={devicesError}
                      onRefresh={() => void loadHardwareDevices()}
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
        title="Critical ESP32 temperature"
        size="sm"
        centered
      >
        <Stack>
          <Alert color="red" icon={<IconAlertTriangle size={20} />} title="EX-CSB1 temperature is critical">
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
