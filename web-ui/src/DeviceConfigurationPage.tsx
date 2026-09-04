import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCpu,
  IconDeviceFloppy,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import AppModal from "@/components/common/AppModal";
import { loadSignalLogicRulesWs } from "@/api/signalLogicWsApi";
import type { SignalLogicRuntimeStateDto } from "@domain/signalLogic";
import { wsApi } from "@/services/wsApi";
import {
  wsClient,
  type WsConnectionStatus,
} from "@/services/wsClient";

type Props = {
  onBack: () => void;
};

export type DeviceType =
  | "pca9685"
  | "mcp23017"
  | "pcf8574"
  | "pcf8575";

export type DeviceConfiguration = {
  id: string;
  name: string;
  type: DeviceType;
  enabled: boolean;
  address: number;
  firstVpin: number;
  pinCount: number;
  frequency?: number;
  interruptPin?: number | null;
  servoChannels?: ServoChannelConfiguration[];
  digitalChannels?: DigitalChannelConfiguration[];
};

export type ServoChannelConfiguration = {
  channel: number;
  offPosition: number;
  onPosition: number;
  durationMs: number;
  keepPowered: boolean;
};

export type DigitalChannelConfiguration = {
  channel: number;
  mode: "input" | "output";
  id: number;
  pullUp?: boolean;
  inverted?: boolean;
  initialState?: boolean;
};

export type DeviceConfigurationDocument = {
  version: number;
  devices: DeviceConfiguration[];
};

export function isDeviceConfigurationDocument(
  value: unknown
): value is DeviceConfigurationDocument {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DeviceConfigurationDocument>;
  return Array.isArray(candidate.devices) && candidate.devices.every(item => {
    if (!item || typeof item !== "object") return false;
    const device = item as Partial<DeviceConfiguration>;
    return typeof device.id === "string" &&
      typeof device.name === "string" &&
      typeof device.type === "string" &&
      Object.prototype.hasOwnProperty.call(DEVICE_DEFINITIONS, device.type) &&
      typeof device.enabled === "boolean" &&
      Number.isInteger(device.address) &&
      Number.isInteger(device.firstVpin) &&
      Number.isInteger(device.pinCount) &&
      (device.servoChannels === undefined || (
        Array.isArray(device.servoChannels) &&
        device.servoChannels.every(channel =>
          Number.isInteger(channel.channel) &&
          Number.isInteger(channel.offPosition) &&
          Number.isInteger(channel.onPosition) &&
          Number.isInteger(channel.durationMs) &&
          typeof channel.keepPowered === "boolean"
        )
      )) &&
      (device.digitalChannels === undefined || (
        Array.isArray(device.digitalChannels) &&
        device.digitalChannels.every(channel =>
          Number.isInteger(channel.channel) &&
          (channel.mode === "input" || channel.mode === "output") &&
          Number.isInteger(channel.id)
        )
      ));
  });
}

type DeviceForm = {
  id: string | null;
  name: string;
  type: DeviceType;
  enabled: boolean;
  address: string;
  firstVpin: number;
  frequency: number;
  interruptPin: number | null;
};

type DeviceDefinition = {
  type: DeviceType;
  label: string;
  description: string;
  pinCount: number;
  addressMin: number;
  addressMax: number;
  defaultAddress: number;
  defaultFirstVpin: number;
  color: string;
};

type RuntimeConfiguredDevice = {
  address: number | null;
  firstVpin: number;
  lastVpin: number;
  state: string;
  online: boolean;
};

type HardwareDevicesResponse = {
  configuredDevices?: RuntimeConfiguredDevice[];
  i2cDevices?: Array<{
    addressHex?: string;
    address?: number;
  }>;
};

const STORAGE_KEY =
  "dcc-express-lite.device-configuration-draft.v1";

const DEVICE_DEFINITIONS: Record<
  DeviceType,
  DeviceDefinition
> = {
  pca9685: {
    type: "pca9685",
    label: "PCA9685",
    description: "16-channel PWM and servo controller",
    pinCount: 16,
    addressMin: 0x40,
    addressMax: 0x7d,
    defaultAddress: 0x40,
    defaultFirstVpin: 100,
    color: "violet",
  },
  mcp23017: {
    type: "mcp23017",
    label: "MCP23017",
    description: "16-channel digital input/output expander",
    pinCount: 16,
    addressMin: 0x20,
    addressMax: 0x27,
    defaultAddress: 0x20,
    defaultFirstVpin: 164,
    color: "cyan",
  },
  pcf8574: {
    type: "pcf8574",
    label: "PCF8574",
    description: "8-channel digital input/output expander",
    pinCount: 8,
    addressMin: 0x20,
    addressMax: 0x27,
    defaultAddress: 0x22,
    defaultFirstVpin: 200,
    color: "teal",
  },
  pcf8575: {
    type: "pcf8575",
    label: "PCF8575",
    description: "16-channel digital input/output expander",
    pinCount: 16,
    addressMin: 0x20,
    addressMax: 0x27,
    defaultAddress: 0x23,
    defaultFirstVpin: 208,
    color: "blue",
  },
};

const DEVICE_TYPE_OPTIONS = Object.values(
  DEVICE_DEFINITIONS
).map(definition => ({
  value: definition.type,
  label: `${definition.label} · ${definition.description}`,
}));

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `device-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
}

function hexAddress(address: number): string {
  return `0x${address
    .toString(16)
    .toUpperCase()
    .padStart(2, "0")}`;
}

function parseAddress(value: string): number | null {
  const trimmed = value.trim();
  if (!/^(?:0x)?[0-9a-f]{1,2}$/i.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(
    trimmed.replace(/^0x/i, ""),
    16
  );

  return Number.isInteger(parsed) ? parsed : null;
}

function createForm(type: DeviceType): DeviceForm {
  const definition = DEVICE_DEFINITIONS[type];

  return {
    id: null,
    name: definition.label,
    type,
    enabled: true,
    address: hexAddress(definition.defaultAddress),
    firstVpin: definition.defaultFirstVpin,
    frequency: 50,
    interruptPin: null,
  };
}

const DEFAULT_SERVO_CHANNEL: Omit<
  ServoChannelConfiguration,
  "channel"
> = {
  offPosition: 205,
  onPosition: 410,
  durationMs: 500,
  keepPowered: false,
};

function servoChannelConfiguration(
  device: DeviceConfiguration,
  channel: number
): ServoChannelConfiguration {
  return device.servoChannels?.find(item => item.channel === channel) ?? {
    channel,
    ...DEFAULT_SERVO_CHANNEL,
  };
}

function digitalChannelConfiguration(
  device: DeviceConfiguration,
  channel: number
): DigitalChannelConfiguration | null {
  return device.digitalChannels?.find(item => item.channel === channel) ?? null;
}

function loadDraft(): DeviceConfiguration[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];

    return value.filter(
      (item): item is DeviceConfiguration => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Partial<DeviceConfiguration>;
        return (
          typeof candidate.id === "string" &&
          typeof candidate.name === "string" &&
          typeof candidate.type === "string" &&
          candidate.type in DEVICE_DEFINITIONS &&
          typeof candidate.enabled === "boolean" &&
          Number.isInteger(candidate.address) &&
          Number.isInteger(candidate.firstVpin) &&
          Number.isInteger(candidate.pinCount)
        );
      }
    );
  } catch {
    return [];
  }
}

function saveDraft(devices: DeviceConfiguration[]): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(devices)
  );
}

export default function DeviceConfigurationPage({
  onBack,
}: Props) {
  const [devices, setDevices] =
    useState<DeviceConfiguration[]>(loadDraft);
  const [form, setForm] =
    useState<DeviceForm>(() => createForm("pca9685"));
  const [dialogOpened, setDialogOpened] =
    useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<DeviceConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detectedAddresses, setDetectedAddresses] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [wsStatus, setWsStatus] =
    useState<WsConnectionStatus>(() => wsClient.getStatus());
  const [runtimeDevices, setRuntimeDevices] =
    useState<RuntimeConfiguredDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] =
    useState<string | null>(null);
  const [servoTestStates, setServoTestStates] =
    useState<Record<number, boolean>>({});
  const [signalLogicState, setSignalLogicState] =
    useState<SignalLogicRuntimeStateDto | null>(null);
  const [sensorStates, setSensorStates] =
    useState<Record<number, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/device-config", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const document = await response.json() as unknown;
        if (!isDeviceConfigurationDocument(document)) {
          throw new Error("Invalid device configuration response");
        }
        if (!cancelled) {
          setDevices(document.devices);
          saveDraft(document.devices);
          setDirty(false);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            `Could not read the EX-CSB1 configuration (${error instanceof Error ? error.message : String(error)}). The local browser draft is shown.`
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubscribeStatus = wsClient.subscribeStatus(status => {
      setWsStatus(status);
      if (status !== "connected") {
        setRuntimeDevices([]);
        setSignalLogicState(null);
        setSensorStates({});
        return;
      }

      void fetch("/api/devices", { cache: "no-store" })
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json() as Promise<HardwareDevicesResponse>;
        })
        .then(snapshot => {
          if (cancelled) return;
          setRuntimeDevices(
            Array.isArray(snapshot.configuredDevices)
              ? snapshot.configuredDevices
              : []
          );
        })
        .catch(() => {
          if (!cancelled) setRuntimeDevices([]);
        });

      void loadSignalLogicRulesWs()
        .then(result => {
          if (!cancelled) setSignalLogicState(result.state);
        })
        .catch(() => {
          if (!cancelled) setSignalLogicState(null);
        });

      wsApi.getLayoutRuntimeSnapshot();
    });
    const unsubscribeSignalState = wsClient.on(
      "signalLogicStateChanged",
      state => setSignalLogicState(state)
    );
    const unsubscribeSignalResponse = wsClient.on(
      "signalLogicResponse",
      response => {
        if (response.state) setSignalLogicState(response.state);
      }
    );
    const unsubscribeSensorChanged = wsClient.on(
      "sensorChanged",
      sensor => setSensorStates(current => ({
        ...current,
        [sensor.address]: sensor.on,
      }))
    );
    const unsubscribeSensorSnapshot = wsClient.on(
      "sensorSnapshot",
      snapshot => {
        const next: Record<number, boolean> = {};
        for (const [baseAddress, activeBits, knownBits] of snapshot.groups) {
          for (let offset = 0; offset < 16; offset++) {
            const bit = 1 << offset;
            if ((knownBits & bit) !== 0) {
              next[baseAddress + offset] = (activeBits & bit) !== 0;
            }
          }
        }
        setSensorStates(next);
      }
    );

    return () => {
      cancelled = true;
      unsubscribeStatus();
      unsubscribeSignalState();
      unsubscribeSignalResponse();
      unsubscribeSensorChanged();
      unsubscribeSensorSnapshot();
    };
  }, []);

  useEffect(() => {
    if (devices.length === 0) {
      setSelectedDeviceId(null);
    } else if (!selectedDeviceId || !devices.some(device => device.id === selectedDeviceId)) {
      setSelectedDeviceId(devices[0]!.id);
    }
  }, [devices, selectedDeviceId]);

  const definition = DEVICE_DEFINITIONS[form.type];
  const parsedAddress = parseAddress(form.address);

  const formError = useMemo(() => {
    if (!form.name.trim()) return "Device name is required.";
    if (parsedAddress === null) {
      return "Enter a hexadecimal I²C address, for example 0x40.";
    }
    if (
      parsedAddress < definition.addressMin ||
      parsedAddress > definition.addressMax
    ) {
      return `${definition.label} address must be between ${hexAddress(
        definition.addressMin
      )} and ${hexAddress(definition.addressMax)}.`;
    }
    if (
      !Number.isInteger(form.firstVpin) ||
      form.firstVpin < 40 ||
      form.firstVpin + definition.pinCount - 1 > 32767
    ) {
      return "Choose a free VPIN range between 40 and 32767.";
    }

    const otherDevices = devices.filter(
      device => device.id !== form.id && device.enabled
    );

    if (
      form.enabled &&
      otherDevices.some(
        device => device.address === parsedAddress
      )
    ) {
      return `I²C address ${hexAddress(parsedAddress)} is already used.`;
    }

    const lastVpin =
      form.firstVpin + definition.pinCount - 1;
    const overlap = form.enabled
      ? otherDevices.find(device => {
        const deviceLast =
          device.firstVpin + device.pinCount - 1;
        return (
          form.firstVpin <= deviceLast &&
          lastVpin >= device.firstVpin
        );
      })
      : undefined;

    if (overlap) {
      return `VPIN range overlaps ${overlap.name} (${overlap.firstVpin}–${overlap.firstVpin + overlap.pinCount - 1
        }).`;
    }

    return null;
  }, [definition, devices, form, parsedAddress]);

  const replaceDevices = (
    nextDevices: DeviceConfiguration[]
  ) => {
    setDevices(nextDevices);
    saveDraft(nextDevices);
    setDirty(true);
  };

  const applyConfiguration = async () => {
    setSaving(true);
    try {
      const document: DeviceConfigurationDocument = { version: 1, devices };
      const response = await fetch("/api/device-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(document),
      });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(result?.message ?? `HTTP ${response.status}`);
      setDirty(false);
      setLoadError(null);
      wsClient.restartConnection();
      showNotification({
        color: "teal",
        title: "Device configuration saved",
        message: result?.message ?? "EX-CSB1 is restarting with the new HAL devices.",
      });
    } catch (error) {
      showNotification({
        color: "red",
        title: "Could not save device configuration",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const scanI2c = async () => {
    setScanning(true);
    try {
      const response = await fetch("/api/devices", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as HardwareDevicesResponse;
      const addresses = Array.isArray(result.i2cDevices)
        ? result.i2cDevices.map(device => device.addressHex ??
          (Number.isInteger(device.address) ? hexAddress(device.address as number) : "")).filter(Boolean)
        : [];
      setDetectedAddresses(addresses);
      setRuntimeDevices(
        Array.isArray(result.configuredDevices)
          ? result.configuredDevices
          : []
      );
      showNotification({
        color: "blue",
        title: "I²C scan complete",
        message: addresses.length ? `Detected: ${addresses.join(", ")}` : "No I²C devices detected.",
      });
    } catch (error) {
      showNotification({
        color: "red",
        title: "I²C scan failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setScanning(false);
    }
  };

  const openAdd = (type: DeviceType = "pca9685") => {
    setForm(createForm(type));
    setDialogOpened(true);
  };

  const openEdit = (device: DeviceConfiguration) => {
    setForm({
      id: device.id,
      name: device.name,
      type: device.type,
      enabled: device.enabled,
      address: hexAddress(device.address),
      firstVpin: device.firstVpin,
      frequency: device.frequency ?? 50,
      interruptPin: device.interruptPin ?? null,
    });
    setDialogOpened(true);
  };

  const saveDevice = () => {
    if (formError || parsedAddress === null) return;

    const nextDevice: DeviceConfiguration = {
      id: form.id ?? newId(),
      name: form.name.trim(),
      type: form.type,
      enabled: form.enabled,
      address: parsedAddress,
      firstVpin: form.firstVpin,
      pinCount: definition.pinCount,
      ...(form.type === "pca9685"
        ? {
          frequency: form.frequency,
          ...(devices.find(device => device.id === form.id)?.servoChannels
            ? {
              servoChannels: devices.find(device => device.id === form.id)!
                .servoChannels!,
            }
            : {}),
        }
        : {
          interruptPin: form.interruptPin,
          ...(devices.find(device => device.id === form.id)?.digitalChannels
            ? {
              digitalChannels: devices.find(device => device.id === form.id)!
                .digitalChannels!,
            }
            : {}),
        }),
    };

    replaceDevices(
      form.id
        ? devices.map(device =>
          device.id === form.id ? nextDevice : device
        )
        : [...devices, nextDevice]
    );
    setSelectedDeviceId(nextDevice.id);
    setDialogOpened(false);
  };

  const toggleDevice = (
    target: DeviceConfiguration,
    enabled: boolean
  ) => {
    if (enabled) {
      const addressConflict = devices.some(
        device =>
          device.id !== target.id &&
          device.enabled &&
          device.address === target.address
      );
      const targetLast =
        target.firstVpin + target.pinCount - 1;
      const rangeConflict = devices.some(device => {
        if (device.id === target.id || !device.enabled) return false;
        const deviceLast =
          device.firstVpin + device.pinCount - 1;
        return (
          target.firstVpin <= deviceLast &&
          targetLast >= device.firstVpin
        );
      });

      if (addressConflict || rangeConflict) {
        openEdit(target);
        return;
      }
    }

    replaceDevices(
      devices.map(device =>
        device.id === target.id
          ? { ...device, enabled }
          : device
      )
    );
  };

  const deleteDevice = () => {
    if (!deleteTarget) return;
    replaceDevices(
      devices.filter(device => device.id !== deleteTarget.id)
    );
    setDeleteTarget(null);
  };

  const updateServoChannel = (
    device: DeviceConfiguration,
    channel: number,
    patch: Partial<ServoChannelConfiguration>
  ) => {
    const current = servoChannelConfiguration(device, channel);
    const nextChannel = { ...current, ...patch, channel };
    const otherChannels = (device.servoChannels ?? [])
      .filter(item => item.channel !== channel);
    const servoChannels = [...otherChannels, nextChannel]
      .sort((left, right) => left.channel - right.channel);

    replaceDevices(devices.map(item =>
      item.id === device.id ? { ...item, servoChannels } : item
    ));
  };

  const testPca9685Channel = (
    vpin: number,
    active: boolean,
    configuration: ServoChannelConfiguration
  ) => {
    const position = active
      ? configuration.onPosition
      : configuration.offPosition;
    const profile = configuration.keepPowered ? 0x80 : 0;
    const durationDeciseconds = Math.round(configuration.durationMs / 100);
    const sent = wsApi.writeDccExDirectCommand(
      `<z ${vpin} ${position} ${profile} ${durationDeciseconds}>`
    );
    if (sent) {
      setServoTestStates(current => ({
        ...current,
        [vpin]: active,
      }));
    }

    showNotification({
      color: sent ? "blue" : "red",
      title: sent
        ? `VPIN ${vpin} switched ${active ? "ON" : "OFF"}`
        : "Test command not sent",
      message: sent
        ? `Position ${position}, movement ${durationDeciseconds / 10}s.`
        : "The WebSocket connection is not available.",
    });
  };

  const updateDigitalChannel = (
    device: DeviceConfiguration,
    channel: number,
    mode: "unused" | "input" | "output",
    patch: Partial<DigitalChannelConfiguration> = {}
  ) => {
    const current = digitalChannelConfiguration(device, channel);
    const otherChannels = (device.digitalChannels ?? [])
      .filter(item => item.channel !== channel);
    const digitalChannels = mode === "unused"
      ? otherChannels
      : [
        ...otherChannels,
        {
          channel,
          mode,
          id: current?.id ?? device.firstVpin + channel,
          ...(mode === "input"
            ? { pullUp: current?.pullUp ?? true }
            : {
              inverted: current?.inverted ?? false,
              initialState: current?.initialState ?? false,
            }),
          ...patch,
        } as DigitalChannelConfiguration,
      ].sort((left, right) => left.channel - right.channel);

    replaceDevices(devices.map(item =>
      item.id === device.id ? { ...item, digitalChannels } : item
    ));
  };

  const testDigitalOutput = (outputId: number, active: boolean) => {
    const sent = wsApi.writeDccExDirectCommand(
      `<Z ${outputId} ${active ? 1 : 0}>`
    );
    showNotification({
      color: sent ? "blue" : "red",
      title: sent ? `Output ${outputId} switched ${active ? "ON" : "OFF"}` : "Output not sent",
      message: sent ? "DCC-EX output updated." : "The WebSocket connection is not available.",
    });
  };

  const selectedDevice = devices.find(device => device.id === selectedDeviceId) ?? null;
  const selectedRuntimeDevice = selectedDevice
    ? runtimeDevices.find(device =>
      device.address === selectedDevice.address &&
      device.firstVpin === selectedDevice.firstVpin
    ) ?? null
    : null;
  const websocketConnected = wsStatus === "connected";

  return (
    <Stack gap="md">
      <AppModal
        opened={dialogOpened}
        onClose={() => setDialogOpened(false)}
        title={form.id ? "Edit device" : "Add I²C device"}
        centered
        size="lg"
        returnFocus={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        trapFocus={false}
        draggable
      >
        <Stack gap="md">
          <Select
            label="Driver"
            data={DEVICE_TYPE_OPTIONS}
            value={form.type}
            allowDeselect={false}
            onChange={value => {
              if (!value) return;
              const nextType = value as DeviceType;
              const nextDefinition =
                DEVICE_DEFINITIONS[nextType];
              setForm(current => ({
                ...current,
                type: nextType,
                name: current.id
                  ? current.name
                  : nextDefinition.label,
                address: hexAddress(
                  nextDefinition.defaultAddress
                ),
                firstVpin:
                  nextDefinition.defaultFirstVpin,
              }));
            }}
          />

          <TextInput
            label="Name"
            placeholder="Station servo board"
            value={form.name}
            onChange={event => {
              const value = event.currentTarget.value;
              setForm(current => ({
                ...current,
                name: value,
              }));
            }}
          />

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="I²C address"
              description={`${hexAddress(
                definition.addressMin
              )}–${hexAddress(definition.addressMax)}`}
              value={form.address}
              onChange={event => {
                const value = event.currentTarget.value;
                setForm(current => ({
                  ...current,
                  address: value,
                }));
              }}
            />

            <NumberInput
              label="First VPIN"
              description={`${definition.pinCount} VPINs will be reserved`}
              value={form.firstVpin}
              min={40}
              max={32767 - definition.pinCount + 1}
              allowDecimal={false}
              onChange={value => {
                if (typeof value === "number") {
                  setForm(current => ({
                    ...current,
                    firstVpin: value,
                  }));
                }
              }}
            />
          </SimpleGrid>

          {form.type === "pca9685" ? (
            <NumberInput
              label="PWM frequency"
              description="Standard analogue servo frequency is 50 Hz"
              suffix=" Hz"
              value={form.frequency}
              min={24}
              max={1526}
              allowDecimal={false}
              onChange={value => {
                if (typeof value === "number") {
                  setForm(current => ({
                    ...current,
                    frequency: value,
                  }));
                }
              }}
            />
          ) : (
            <NumberInput
              label="Interrupt GPIO (optional)"
              description="Leave empty to poll the input expander"
              placeholder="Not configured"
              value={form.interruptPin ?? ""}
              min={0}
              max={39}
              allowDecimal={false}
              onChange={value =>
                setForm(current => ({
                  ...current,
                  interruptPin:
                    typeof value === "number" ? value : null,
                }))
              }
            />
          )}

          <Switch
            label="Enabled"
            description="Enabled devices will be created during EX-CSB1 startup"
            checked={form.enabled}
            onChange={event => {
              const checked = event.currentTarget.checked;
              setForm(current => ({
                ...current,
                enabled: checked,
              }));
            }}
          />

          {formError && (
            <Alert
              color="red"
              icon={<IconAlertTriangle size={18} />}
            >
              {formError}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setDialogOpened(false)}
            >
              Cancel
            </Button>
            <Button
              leftSection={<IconDeviceFloppy size={17} />}
              disabled={!!formError}
              onClick={saveDevice}
            >
              Save draft
            </Button>
          </Group>
        </Stack>
      </AppModal>

      <AppModal
        opened={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete device"
        centered
        size="sm"
        returnFocus={false}
        draggable
      >
        <Stack>
          <Text>
            Remove <b>{deleteTarget?.name}</b> from the device
            configuration draft?
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button color="red" onClick={deleteDevice}>
              Delete
            </Button>
          </Group>
        </Stack>
      </AppModal>

      <Card withBorder radius={5} p="md">
        <Group justify="space-between" align="center" wrap="wrap">
          <Group gap="sm" wrap="nowrap">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              aria-label="Back to home"
              onClick={onBack}
            >
              <IconArrowLeft size={22} />
            </ActionIcon>
            <ThemeIcon
              size={42}
              radius="md"
              color="blue"
              variant="light"
            >
              <IconCpu size={24} />
            </ThemeIcon>
            <div>
              <Title order={3}>Device configuration</Title>
              <Text size="sm" c="dimmed">
                External DCC-EX HAL devices and VPIN ranges
              </Text>
            </div>
          </Group>

          <Group gap="xs">
            <Badge
              color={websocketConnected ? "green" : "red"}
              variant={websocketConnected ? "light" : "filled"}
            >
              WS {websocketConnected ? "ONLINE" : wsStatus.toUpperCase()}
            </Badge>
            <Badge color={dirty ? "orange" : "teal"} variant="light">
              {loading ? "Loading" : dirty ? "Unsaved changes" : "Saved on device"}
            </Badge>
            <Button
              variant="light"
              leftSection={<IconDeviceFloppy size={17} />}
              loading={saving}
              disabled={loading || !dirty}
              onClick={() => void applyConfiguration()}
            >
              Apply &amp; restart
            </Button>
            <Button
              leftSection={<IconPlus size={17} />}
              onClick={() => openAdd()}
            >
              Add device
            </Button>
          </Group>
        </Group>
      </Card>

      {loadError ? (
        <Alert color="yellow" icon={<IconAlertTriangle size={19} />}>
          {loadError}
        </Alert>
      ) : (
        <Alert color="blue" icon={<IconCpu size={19} />}>
          Changes are validated and saved to LittleFS. Applying a configuration
          restarts the EX-CSB1 so DCC-EX can create the selected HAL devices safely.
        </Alert>
      )}

      {signalLogicState?.enabled ? (
        <Alert color="orange" icon={<IconAlertTriangle size={19} />}>
          <Text fw={700}>Signal automation is active</Text>
          <Text size="sm">
            Its rules can immediately overwrite manual PCA9685, accessory or
            VPIN test outputs. Disable Signal automation before testing hardware
            if an output appears to switch back by itself.
          </Text>
        </Alert>
      ) : null}

      <Grid gap="md" align="stretch">
        <Grid.Col span={{ base: 12, md: 3 }}>
          <Card withBorder radius={5} p="md" h="100%">
            <Group justify="space-between" align="center">
              <div>
                <Title order={4}>Configured devices</Title>
                <Text size="sm" c="dimmed">{devices.length} configured</Text>
              </div>
              <ActionIcon
                variant="light"
                color="gray"
                size="lg"
                loading={scanning}
                aria-label="Scan I²C bus"
                onClick={() => void scanI2c()}
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Group>

            {detectedAddresses.length > 0 && (
              <Text size="xs" c="dimmed" mt="xs">
                Detected: {detectedAddresses.join(", ")}
              </Text>
            )}

            <Divider my="md" />

            {devices.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="xl">
                No configured devices. Use Add device to create one.
              </Text>
            ) : (
              <Stack gap="xs">
                {devices.map(device => {
                  const item = DEVICE_DEFINITIONS[device.type];
                  const lastVpin = device.firstVpin + device.pinCount - 1;
                  const selected = device.id === selectedDeviceId;
                  return (
                    <Card
                      key={device.id}
                      withBorder
                      radius={5}
                      p="sm"
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedDeviceId(device.id)}
                      onKeyDown={event => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedDeviceId(device.id);
                        }
                      }}
                      style={{
                        cursor: "pointer",
                        borderColor: selected
                          ? `var(--mantine-color-${item.color}-5)`
                          : undefined,
                        background: selected
                          ? `var(--mantine-color-${item.color}-light)`
                          : undefined,
                      }}
                    >
                      <Group gap="xs">
                        <Text fw={700}>{device.name}</Text>
                        <Badge size="xs" color={device.enabled ? "teal" : "gray"}>
                          {device.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </Group>
                      <Text size="sm" c="dimmed" mt={4}>
                        {item.label} · {hexAddress(device.address)} · VPIN {device.firstVpin}–{lastVpin}
                        {device.frequency ? ` · ${device.frequency} Hz` : ""}
                      </Text>
                    </Card>
                  );
                })}
              </Stack>
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 9 }}>
          <Card withBorder radius={5} p="md" h="100%">
            {!selectedDevice ? (
              <Stack align="center" justify="center" mih={300}>
                <IconCpu size={42} />
                <Text c="dimmed">Select a configured device.</Text>
              </Stack>
            ) : (() => {
              const item = DEVICE_DEFINITIONS[selectedDevice.type];
              const runtimeOnline = selectedDevice.enabled && selectedRuntimeDevice?.online === true;
              const testAvailable = websocketConnected && runtimeOnline && !dirty;
              return (
                <>
                  <Group justify="space-between" align="flex-start" wrap="wrap">
                    <div>
                      <Group gap="xs">
                        <Title order={4}>{selectedDevice.name}</Title>
                        <Badge
                          color={!websocketConnected ? "yellow" : runtimeOnline ? "green" : "red"}
                          variant="light"
                        >
                          {!websocketConnected
                            ? "Waiting for WebSocket"
                            : !selectedDevice.enabled
                              ? "Disabled"
                              : runtimeOnline
                                ? `Online · ${selectedRuntimeDevice?.state ?? "ready"}`
                                : "Offline / not loaded"}
                        </Badge>
                      </Group>
                      <Text size="sm" c="dimmed" mt={4}>
                        {item.label} · {hexAddress(selectedDevice.address)} · VPIN {selectedDevice.firstVpin}–{selectedDevice.firstVpin + selectedDevice.pinCount - 1}
                      </Text>
                    </div>
                    <Group gap="xs" wrap="nowrap">
                      <Switch
                        label="Enabled"
                        checked={selectedDevice.enabled}
                        onChange={event =>
                          toggleDevice(selectedDevice, event.currentTarget.checked)
                        }
                      />
                      <ActionIcon
                        variant="light"
                        color="blue"
                        aria-label={`Edit ${selectedDevice.name}`}
                        onClick={() => openEdit(selectedDevice)}
                      >
                        <IconEdit size={17} />
                      </ActionIcon>
                      <ActionIcon
                        variant="light"
                        color="red"
                        aria-label={`Delete ${selectedDevice.name}`}
                        onClick={() => setDeleteTarget(selectedDevice)}
                      >
                        <IconTrash size={17} />
                      </ActionIcon>
                    </Group>
                  </Group>

                  <Divider my="md" />
                  <Stack gap="sm">
                    {Array.from({ length: selectedDevice.pinCount }, (_, channel) => {
                      const vpin = selectedDevice.firstVpin + channel;
                      const servoConfig = servoChannelConfiguration(selectedDevice, channel);
                      const digitalConfig = digitalChannelConfiguration(selectedDevice, channel);
                      return (
                        <Card key={vpin} withBorder radius={5} p="sm">
                          <Group justify="space-between" align="center">
                            <Group gap="xs">
                              <Badge variant="light" color={item.color}>CH {channel}</Badge>
                              <Text size="sm" fw={600}>VPIN {vpin}</Text>
                            </Group>
                            {selectedDevice.type === "pca9685" && (
                              <Group gap={4}>
                                <Button
                                  size="compact-xs"
                                  color="gray"
                                  variant={servoTestStates[vpin] === false ? "filled" : "light"}
                                  disabled={!testAvailable}
                                  onClick={() => testPca9685Channel(vpin, false, servoConfig)}
                                >OFF</Button>
                                <Button
                                  size="compact-xs"
                                  color="teal"
                                  variant={servoTestStates[vpin] === true ? "filled" : "light"}
                                  disabled={!testAvailable}
                                  onClick={() => testPca9685Channel(vpin, true, servoConfig)}
                                >ON</Button>
                              </Group>
                            )}
                          </Group>

                          {selectedDevice.type === "pca9685" ? (
                            <>
                              <SimpleGrid cols={{ base: 1, sm: 3 }} mt="sm">
                                <NumberInput label="OFF position" value={servoConfig.offPosition} min={0} max={4095} size="xs" allowDecimal={false} onChange={value => typeof value === "number" && updateServoChannel(selectedDevice, channel, { offPosition: value })} />
                                <NumberInput label="ON position" value={servoConfig.onPosition} min={0} max={4095} size="xs" allowDecimal={false} onChange={value => typeof value === "number" && updateServoChannel(selectedDevice, channel, { onPosition: value })} />
                                <NumberInput label="Movement time" value={servoConfig.durationMs} min={0} max={60000} step={100} suffix=" ms" size="xs" allowDecimal={false} onChange={value => typeof value === "number" && updateServoChannel(selectedDevice, channel, { durationMs: value })} />
                              </SimpleGrid>
                              <Switch mt="sm" size="xs" label="Keep PWM active after movement" checked={servoConfig.keepPowered} onChange={event => updateServoChannel(selectedDevice, channel, { keepPowered: event.currentTarget.checked })} />
                            </>
                          ) : (
                            <>
                              <SimpleGrid cols={{ base: 1, sm: 2 }} mt="sm">
                                <Select
                                  label="Pin mode"
                                  value={digitalConfig?.mode ?? "unused"}
                                  allowDeselect={false}
                                  data={[
                                    { value: "unused", label: "Unused" },
                                    { value: "input", label: "Input / DCC-EX sensor" },
                                    { value: "output", label: "Output / DCC-EX output" },
                                  ]}
                                  onChange={value => updateDigitalChannel(selectedDevice, channel, (value ?? "unused") as "unused" | "input" | "output")}
                                />
                                {digitalConfig && (

                                  <NumberInput
                                    label={
                                      <Group gap="xs">
                                        <Text size="sm" fw={500}>
                                          {digitalConfig.mode === "input" ? "Sensor ID" : "Output ID"}
                                        </Text>

                                        <Badge
                                          variant="light"
                                          ff={"monospace"}
                                          style={{ textTransform: "none" }}
                                        >
                                          {digitalConfig.mode === "input"
                                            ? `<S ${digitalConfig.id} ${vpin} PULLUP>`
                                            : `<Z ${digitalConfig.id} ${vpin} IFLAG>`}
                                        </Badge>                                      </Group>
                                    }
                                    value={digitalConfig.id}
                                    min={0}
                                    max={32767}
                                    allowDecimal={false}
                                    onChange={value =>
                                      typeof value === "number" &&
                                      updateDigitalChannel(
                                        selectedDevice,
                                        channel,
                                        digitalConfig.mode,
                                        { id: value }
                                      )
                                    }
                                  />
                                )}
                              </SimpleGrid>

                              {digitalConfig?.mode === "input" && (
                                <Group justify="space-between" align="center" mt="sm" wrap="wrap">
                                  <Switch
                                    label="Pull-up"
                                    description={selectedDevice.type.startsWith("pcf") ? "PCF8574/PCF8575 inputs always use their weak pull-up." : "Enable the MCP23017 internal pull-up resistor."}
                                    checked={selectedDevice.type.startsWith("pcf") ? true : digitalConfig.pullUp ?? true}
                                    disabled={selectedDevice.type.startsWith("pcf")}
                                    onChange={event => updateDigitalChannel(selectedDevice, channel, "input", { pullUp: event.currentTarget.checked })}
                                  />
                                  <Badge
                                    size="lg"
                                    variant={sensorStates[digitalConfig.id] === undefined ? "light" : "filled"}
                                    color={sensorStates[digitalConfig.id] === undefined
                                      ? "gray"
                                      : sensorStates[digitalConfig.id]
                                        ? "green"
                                        : "dark"}
                                  >
                                    {sensorStates[digitalConfig.id] === undefined
                                      ? "UNKNOWN"
                                      : sensorStates[digitalConfig.id]
                                        ? "ACTIVE"
                                        : "INACTIVE"}
                                  </Badge>
                                </Group>
                              )}

                              {digitalConfig?.mode === "output" && (
                                <Group justify="space-between" align="flex-end" mt="sm" wrap="wrap">
                                  <Group gap="lg">
                                    <Switch label="Inverted" checked={digitalConfig.inverted ?? false} onChange={event => updateDigitalChannel(selectedDevice, channel, "output", { inverted: event.currentTarget.checked })} />
                                    <Switch label="Initial ON" checked={digitalConfig.initialState ?? false} onChange={event => updateDigitalChannel(selectedDevice, channel, "output", { initialState: event.currentTarget.checked })} />
                                  </Group>
                                  <Group gap={4}>
                                    <Button size="compact-xs" color="gray" variant="light" disabled={!testAvailable} onClick={() => testDigitalOutput(digitalConfig.id, false)}>OFF</Button>
                                    <Button size="compact-xs" color="teal" variant="light" disabled={!testAvailable} onClick={() => testDigitalOutput(digitalConfig.id, true)}>ON</Button>
                                  </Group>
                                </Group>
                              )}
                            </>
                          )}
                        </Card>
                      );
                    })}
                  </Stack>
                  {dirty && (
                    <Text size="xs" c="orange" mt="sm">
                      Apply and restart before testing changed pin settings.
                    </Text>
                  )}
                </>
              );
            })()}
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
