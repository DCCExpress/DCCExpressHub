import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
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
import {
  showNotification,
} from "@mantine/notifications";
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
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import AppModal from "@/components/common/AppModal";
import {
  wsApi,
} from "@/services/wsApi";
import {
  wsClient,
  type WsConnectionStatus,
} from "@/services/wsClient";

type Props = {
  onBack: () => void;
};

export type LegacyDeviceType =
  | "pca9685"
  | "mcp23017"
  | "pcf8574"
  | "pcf8575";

export type DeviceType =
  | LegacyDeviceType
  | "s88adapter";

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

export type S88AdapterConfiguration = {
  id: string;
  name: string;
  type: "s88adapter";
  enabled: boolean;
  address: number;
};

export type LegacyDeviceConfiguration = {
  id: string;
  name: string;
  type: LegacyDeviceType;
  enabled: boolean;
  address: number;
  firstVpin: number;
  pinCount: number;
  frequency?: number;
  interruptPin?: number | null;
  servoChannels?: ServoChannelConfiguration[];
  digitalChannels?: DigitalChannelConfiguration[];
};

export type DeviceConfiguration =
  | S88AdapterConfiguration
  | LegacyDeviceConfiguration;

export type DeviceConfigurationDocument = {
  version: 1;
  devices: DeviceConfiguration[];
};

type S88Status = {
  enabled: boolean;
  online: boolean;
  ready: boolean;
  snapshotKnown: boolean;
  dataFresh: boolean;
  adapterInfoKnown: boolean;
  protocolVersion: number;
  firmwareVersion: string;
  firmwareMajor: number;
  firmwareMinor: number;
  firmwarePatch: number;
  maxByteCount: number;
  capabilities: number;
  address: number;
  addressHex: string;
  baseAddress: number;
  groupCount: number;
  byteCount: number;
  sensorCount: number;
  groups?: Array<{
    index: number;
    baseAddress: number;
    activeBits: number;
    knownBits: number;
  }>;
};

type SensorChangedPayload = {
  address: number;
  on: boolean;
};

type SensorSnapshotPayload = {
  groups: Array<
    [
      number,
      number,
      number,
    ]
  >;
};

type LegacyDeviceDefinition = {
  type: LegacyDeviceType;
  label: string;
  description: string;
  pinCount: number;
  addressMin: number;
  addressMax: number;
  defaultAddress: number;
  defaultFirstVpin: number;
};

type LegacyDeviceForm = {
  id: string | null;
  type: LegacyDeviceType;
  name: string;
  enabled: boolean;
  address: string;
  firstVpin: number;
  frequency: number;
  interruptPin: number | null;
};

const SHOW_OTHER_I2C_HAL_DEVICES = false;

const STORAGE_KEY =
  "dcc-express-lite.device-configuration-draft.v2";

const S88_DEFAULT:
  S88AdapterConfiguration = {
    id:
      "s88-main",
    name:
      "S88 Adapter",
    type:
      "s88adapter",
    enabled:
      true,
    address:
      0x30,
  };

const LEGACY_DEFINITIONS:
  Record<
    LegacyDeviceType,
    LegacyDeviceDefinition
  > = {
    pca9685: {
      type:
        "pca9685",
      label:
        "PCA9685",
      description:
        "16-channel PWM / servo controller",
      pinCount:
        16,
      addressMin:
        0x40,
      addressMax:
        0x7d,
      defaultAddress:
        0x40,
      defaultFirstVpin:
        100,
    },
    mcp23017: {
      type:
        "mcp23017",
      label:
        "MCP23017",
      description:
        "16-channel digital I/O expander",
      pinCount:
        16,
      addressMin:
        0x20,
      addressMax:
        0x27,
      defaultAddress:
        0x20,
      defaultFirstVpin:
        164,
    },
    pcf8574: {
      type:
        "pcf8574",
      label:
        "PCF8574",
      description:
        "8-channel digital I/O expander",
      pinCount:
        8,
      addressMin:
        0x20,
      addressMax:
        0x27,
      defaultAddress:
        0x22,
      defaultFirstVpin:
        200,
    },
    pcf8575: {
      type:
        "pcf8575",
      label:
        "PCF8575",
      description:
        "16-channel digital I/O expander",
      pinCount:
        16,
      addressMin:
        0x20,
      addressMax:
        0x27,
      defaultAddress:
        0x23,
      defaultFirstVpin:
        208,
    },
  };

const LEGACY_TYPE_OPTIONS =
  Object.values(
    LEGACY_DEFINITIONS
  ).map(
    definition => ({
      value:
        definition.type,
      label:
        `${definition.label} · ${definition.description}`,
    })
  );

function hexAddress(
  address: number
): string {
  return (
    "0x" +
    address
      .toString(16)
      .toUpperCase()
      .padStart(2, "0")
  );
}

function parseHexAddress(
  value: string
): number | null {
  const trimmed =
    value.trim();

  if (
    !/^(?:0x)?[0-9a-f]{1,2}$/i.test(
      trimmed
    )
  ) {
    return null;
  }

  const parsed =
    Number.parseInt(
      trimmed.replace(
        /^0x/i,
        ""
      ),
      16
    );

  return Number.isInteger(
    parsed
  )
    ? parsed
    : null;
}

function newId(): string {
  return (
    globalThis.crypto
      ?.randomUUID?.() ??
    `device-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
}

function isLegacyType(
  value: unknown
): value is LegacyDeviceType {
  return (
    typeof value ===
      "string" &&
    value in
      LEGACY_DEFINITIONS
  );
}

function isS88Adapter(
  device: DeviceConfiguration
): device is S88AdapterConfiguration {
  return (
    device.type ===
    "s88adapter"
  );
}

function isLegacyDevice(
  device: DeviceConfiguration
): device is LegacyDeviceConfiguration {
  return (
    device.type !==
    "s88adapter"
  );
}

function isS88Configuration(
  value: unknown
): value is S88AdapterConfiguration {
  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return false;
  }

  const device =
    value as Partial<S88AdapterConfiguration>;

  return (
    device.type ===
      "s88adapter" &&
    typeof device.id ===
      "string" &&
    typeof device.name ===
      "string" &&
    typeof device.enabled ===
      "boolean" &&
    Number.isInteger(
      device.address
    )
  );
}

function isLegacyConfiguration(
  value: unknown
): value is LegacyDeviceConfiguration {
  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return false;
  }

  const device =
    value as Partial<LegacyDeviceConfiguration>;

  return (
    typeof device.id ===
      "string" &&
    typeof device.name ===
      "string" &&
    isLegacyType(
      device.type
    ) &&
    typeof device.enabled ===
      "boolean" &&
    Number.isInteger(
      device.address
    ) &&
    Number.isInteger(
      device.firstVpin
    ) &&
    Number.isInteger(
      device.pinCount
    )
  );
}

export function isDeviceConfigurationDocument(
  value: unknown
): value is DeviceConfigurationDocument {
  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return false;
  }

  const document =
    value as Partial<DeviceConfigurationDocument>;

  return (
    Number(
      document.version ??
      1
    ) ===
      1 &&
    Array.isArray(
      document.devices
    ) &&
    document.devices.every(
      device =>
        isS88Configuration(
          device
        ) ||
        isLegacyConfiguration(
          device
        )
    )
  );
}

function normalizeDevices(
  devices: DeviceConfiguration[]
): DeviceConfiguration[] {
  const s88 =
    devices.find(
      isS88Adapter
    );

  const legacy =
    devices.filter(
      isLegacyDevice
    );

  return [
    s88
      ? {
          id:
            s88.id,
          name:
            s88.name,
          type:
            "s88adapter",
          enabled:
            s88.enabled,
          address:
            Math.max(
              0x08,
              Math.min(
                0x77,
                s88.address
              )
            ),
        }
      : {
          ...S88_DEFAULT,
        },
    ...legacy,
  ];
}

function loadDraft():
  DeviceConfiguration[] {
  try {
    const raw =
      window.localStorage.getItem(
        STORAGE_KEY
      );

    if (!raw) {
      return [
        {
          ...S88_DEFAULT,
        },
      ];
    }

    const value =
      JSON.parse(
        raw
      ) as unknown;

    if (!Array.isArray(value)) {
      return [
        {
          ...S88_DEFAULT,
        },
      ];
    }

    const devices =
      value.filter(
        (
          device
        ): device is DeviceConfiguration =>
          isS88Configuration(
            device
          ) ||
          isLegacyConfiguration(
            device
          )
      );

    return normalizeDevices(
      devices
    );
  } catch {
    return [
      {
        ...S88_DEFAULT,
      },
    ];
  }
}

function saveDraft(
  devices: DeviceConfiguration[]
): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      devices
    )
  );
}

function createLegacyForm(
  type: LegacyDeviceType
): LegacyDeviceForm {
  const definition =
    LEGACY_DEFINITIONS[
      type
    ];

  return {
    id:
      null,
    type,
    name:
      definition.label,
    enabled:
      true,
    address:
      hexAddress(
        definition.defaultAddress
      ),
    firstVpin:
      definition.defaultFirstVpin,
    frequency:
      50,
    interruptPin:
      null,
  };
}

export default function DeviceConfigurationPage({
  onBack,
}: Props) {
  const [
    devices,
    setDevices,
  ] =
    useState<DeviceConfiguration[]>(
      loadDraft
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    dirty,
    setDirty,
  ] =
    useState(false);

  const [
    loadError,
    setLoadError,
  ] =
    useState<string | null>(
      null
    );

  const [
    wsStatus,
    setWsStatus,
  ] =
    useState<WsConnectionStatus>(
      () =>
        wsClient.getStatus()
    );

  const [
    sensorStates,
    setSensorStates,
  ] =
    useState<
      Record<number, boolean>
    >({});

  const [
    s88Status,
    setS88Status,
  ] =
    useState<S88Status | null>(
      null
    );

  const [
    legacyDialogOpened,
    setLegacyDialogOpened,
  ] =
    useState(false);

  const [
    legacyForm,
    setLegacyForm,
  ] =
    useState<LegacyDeviceForm>(
      () =>
        createLegacyForm(
          "pca9685"
        )
    );

  const [
    deleteTarget,
    setDeleteTarget,
  ] =
    useState<LegacyDeviceConfiguration | null>(
      null
    );

  const s88 =
    useMemo(
      () =>
        devices.find(
          isS88Adapter
        ) ?? {
          ...S88_DEFAULT,
        },
      [devices]
    );

  const legacyDevices =
    useMemo(
      () =>
        devices.filter(
          isLegacyDevice
        ),
      [devices]
    );

  const websocketConnected =
    wsStatus ===
    "connected";

  const runtimeByteCount =
    s88Status?.adapterInfoKnown
      ? s88Status.byteCount
      : 0;

  const sensorCount =
    s88Status?.adapterInfoKnown
      ? s88Status.sensorCount
      : 0;

  const runtimeBaseAddress =
    s88Status?.baseAddress ??
    1;

  const lastSensorAddress =
    sensorCount > 0
      ? runtimeBaseAddress +
        sensorCount -
        1
      : runtimeBaseAddress;

  const [
    s88AddressText,
    setS88AddressText,
  ] =
    useState(
      () =>
        hexAddress(
          S88_DEFAULT.address
        )
    );

  useEffect(
    () => {
      setS88AddressText(
        hexAddress(
          s88.address
        )
      );
    },
    [s88.address]
  );

  const parsedS88Address =
    parseHexAddress(
      s88AddressText
    );

  const s88Error =
    useMemo(() => {
      if (
        parsedS88Address ===
          null ||
        parsedS88Address <
          0x08 ||
        parsedS88Address >
          0x77
      ) {
        return "S88 I2C address must be between 0x08 and 0x77.";
      }

      return null;
    }, [
      parsedS88Address,
    ]);

  const replaceDevices =
    useCallback(
      (
        next:
          DeviceConfiguration[]
      ) => {
        const normalized =
          normalizeDevices(
            next
          );

        setDevices(
          normalized
        );

        saveDraft(
          normalized
        );

        setDirty(
          true
        );
      },
      []
    );

  const updateS88 =
    useCallback(
      (
        patch:
          Partial<S88AdapterConfiguration>
      ) => {
        replaceDevices(
          devices.map(
            device =>
              isS88Adapter(
                device
              )
                ? {
                    ...device,
                    ...patch,
                  }
                : device
          )
        );
      },
      [
        devices,
        replaceDevices,
      ]
    );

  const refreshS88Status =
    useCallback(
      async () => {
        try {
          const response =
            await fetch(
              "/api/s88-status",
              {
                cache:
                  "no-store",
              }
            );

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status}`
            );
          }

          const status =
            await response.json() as S88Status;

          setS88Status(
            status
          );

          if (
            status.dataFresh &&
            Array.isArray(
              status.groups
            )
          ) {
            setSensorStates(
              current => {
                const next = {
                  ...current,
                };

                for (
                  const group of
                  status.groups ?? []
                ) {
                  for (
                    let offset = 0;
                    offset < 8;
                    ++offset
                  ) {
                    const bit =
                      1 <<
                      offset;

                    if (
                      (
                        group.knownBits &
                        bit
                      ) ===
                      0
                    ) {
                      continue;
                    }

                    next[
                      group.baseAddress +
                      offset
                    ] =
                      (
                        group.activeBits &
                        bit
                      ) !==
                      0;
                  }
                }

                return next;
              }
            );
          }
        } catch {
          setS88Status(
            null
          );
        }
      },
      []
    );

  useEffect(
    () => {
      let cancelled =
        false;

      void (
        async () => {
          try {
            const response =
              await fetch(
                "/api/device-config",
                {
                  cache:
                    "no-store",
                }
              );

            if (!response.ok) {
              throw new Error(
                `HTTP ${response.status}`
              );
            }

            const document =
              await response.json() as unknown;

            if (
              !isDeviceConfigurationDocument(
                document
              )
            ) {
              throw new Error(
                "Invalid device configuration response"
              );
            }

            if (!cancelled) {
              const normalized =
                normalizeDevices(
                  document.devices
                );

              setDevices(
                normalized
              );

              saveDraft(
                normalized
              );

              setDirty(
                false
              );

              setLoadError(
                null
              );
            }
          } catch (
            error
          ) {
            if (!cancelled) {
              setLoadError(
                `Could not read device configuration (${error instanceof Error ? error.message : String(error)}). Local draft is shown.`
              );
            }
          } finally {
            if (!cancelled) {
              setLoading(
                false
              );
            }
          }
        }
      )();

      return () => {
        cancelled =
          true;
      };
    },
    []
  );

  useEffect(
    () => {
      const unsubscribeStatus =
        wsClient.subscribeStatus(
          status => {
            setWsStatus(
              status
            );

            if (
              status ===
              "connected"
            ) {
              wsApi.getLayoutRuntimeSnapshot();

              void refreshS88Status();
            } else {
              // Do not present stale WebSocket data as live.
              setSensorStates(
                {}
              );
            }
          }
        );

      const unsubscribeSensorChanged =
        wsClient.on<SensorChangedPayload>(
          "sensorChanged",
          sensor => {
            setSensorStates(
              current => ({
                ...current,
                [sensor.address]:
                  sensor.on,
              })
            );
          }
        );

      const unsubscribeSensorSnapshot =
        wsClient.on<SensorSnapshotPayload>(
          "sensorSnapshot",
          snapshot => {
            setSensorStates(
              current => {
                const next = {
                  ...current,
                };

                for (
                  const [
                    baseAddress,
                    activeBits,
                    knownBits,
                  ] of
                  snapshot.groups
                ) {
                  for (
                    let offset = 0;
                    offset < 16;
                    ++offset
                  ) {
                    const bit =
                      1 <<
                      offset;

                    if (
                      (
                        knownBits &
                        bit
                      ) ===
                      0
                    ) {
                      continue;
                    }

                    next[
                      baseAddress +
                      offset
                    ] =
                      (
                        activeBits &
                        bit
                      ) !==
                      0;
                  }
                }

                return next;
              }
            );
          }
        );

      const timer =
        window.setInterval(
          () => {
            void refreshS88Status();
          },
          2000
        );

      return () => {
        unsubscribeStatus();
        unsubscribeSensorChanged();
        unsubscribeSensorSnapshot();

        window.clearInterval(
          timer
        );
      };
    },
    [
      refreshS88Status,
    ]
  );

  const saveConfiguration =
    async () => {
      if (s88Error) {
        return;
      }

      setSaving(
        true
      );

      try {
        const document:
          DeviceConfigurationDocument = {
            version:
              1,
            devices,
          };

        const response =
          await fetch(
            "/api/device-config",
            {
              method:
                "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body:
                JSON.stringify(
                  document
                ),
            }
          );

        const result =
          await response
            .json()
            .catch(
              () =>
                null
            ) as {
              message?: string;
              s88Applied?: boolean;
              s88Online?: boolean;
            } | null;

        if (!response.ok) {
          throw new Error(
            result?.message ??
            `HTTP ${response.status}`
          );
        }

        setDirty(
          false
        );

        setLoadError(
          null
        );

        await refreshS88Status();

        showNotification({
          color:
            result?.s88Applied ===
              false
              ? "yellow"
              : "teal",
          title:
            "Device configuration saved",
          message:
            result?.message ??
            "S88 I2C address applied.",
        });
      } catch (
        error
      ) {
        showNotification({
          color:
            "red",
          title:
            "Could not save device configuration",
          message:
            error instanceof Error
              ? error.message
              : String(
                  error
                ),
        });
      } finally {
        setSaving(
          false
        );
      }
    };

  const legacyDefinition =
    LEGACY_DEFINITIONS[
      legacyForm.type
    ];

  const parsedLegacyAddress =
    parseHexAddress(
      legacyForm.address
    );

  const legacyFormError =
    useMemo(() => {
      if (
        !legacyForm.name.trim()
      ) {
        return "Device name is required.";
      }

      if (
        parsedLegacyAddress ===
        null
      ) {
        return "Enter a hexadecimal I2C address.";
      }

      if (
        parsedLegacyAddress <
          legacyDefinition.addressMin ||
        parsedLegacyAddress >
          legacyDefinition.addressMax
      ) {
        return (
          `${legacyDefinition.label} address must be between ` +
          `${hexAddress(legacyDefinition.addressMin)} and ` +
          `${hexAddress(legacyDefinition.addressMax)}.`
        );
      }

      if (
        legacyForm.firstVpin < 40 ||
        legacyForm.firstVpin +
            legacyDefinition.pinCount -
            1 >
          32767
      ) {
        return "Choose a free VPIN range between 40 and 32767.";
      }

      if (legacyForm.enabled) {
        const addressConflict =
          devices.some(
            device =>
              device.id !==
                legacyForm.id &&
              device.enabled &&
              device.address ===
                parsedLegacyAddress
          );

        if (addressConflict) {
          return (
            `I2C address ${hexAddress(parsedLegacyAddress)} ` +
            "is already used by another configured device."
          );
        }

        const first =
          legacyForm.firstVpin;

        const last =
          first +
          legacyDefinition.pinCount -
          1;

        const rangeConflict =
          legacyDevices.find(
            device => {
              if (
                device.id ===
                  legacyForm.id ||
                !device.enabled
              ) {
                return false;
              }

              const deviceLast =
                device.firstVpin +
                device.pinCount -
                1;

              return (
                first <=
                  deviceLast &&
                last >=
                  device.firstVpin
              );
            }
          );

        if (rangeConflict) {
          return (
            `VPIN range overlaps ${rangeConflict.name} ` +
            `(${rangeConflict.firstVpin}–${rangeConflict.firstVpin + rangeConflict.pinCount - 1}).`
          );
        }
      }

      return null;
    }, [
      devices,
      legacyDefinition,
      legacyDevices,
      legacyForm,
      parsedLegacyAddress,
    ]);

  const openAddLegacy =
    () => {
      setLegacyForm(
        createLegacyForm(
          "pca9685"
        )
      );

      setLegacyDialogOpened(
        true
      );
    };

  const openEditLegacy =
    (
      device:
        LegacyDeviceConfiguration
    ) => {
      setLegacyForm({
        id:
          device.id,
        type:
          device.type,
        name:
          device.name,
        enabled:
          device.enabled,
        address:
          hexAddress(
            device.address
          ),
        firstVpin:
          device.firstVpin,
        frequency:
          device.frequency ??
          50,
        interruptPin:
          device.interruptPin ??
          null,
      });

      setLegacyDialogOpened(
        true
      );
    };

  const saveLegacyDevice =
    () => {
      if (
        legacyFormError ||
        parsedLegacyAddress ===
          null
      ) {
        return;
      }

      const existing =
        legacyDevices.find(
          device =>
            device.id ===
            legacyForm.id
        );

      const next:
        LegacyDeviceConfiguration = {
          ...(existing ?? {}),
          id:
            legacyForm.id ??
            newId(),
          name:
            legacyForm.name.trim(),
          type:
            legacyForm.type,
          enabled:
            legacyForm.enabled,
          address:
            parsedLegacyAddress,
          firstVpin:
            legacyForm.firstVpin,
          pinCount:
            legacyDefinition.pinCount,
          ...(legacyForm.type ===
          "pca9685"
            ? {
                frequency:
                  legacyForm.frequency,
              }
            : {
                interruptPin:
                  legacyForm.interruptPin,
              }),
        } as LegacyDeviceConfiguration;

      replaceDevices(
        legacyForm.id
          ? devices.map(
              device =>
                device.id ===
                legacyForm.id
                  ? next
                  : device
            )
          : [
              ...devices,
              next,
            ]
      );

      setLegacyDialogOpened(
        false
      );
    };

  const deleteLegacyDevice =
    () => {
      if (!deleteTarget) {
        return;
      }

      replaceDevices(
        devices.filter(
          device =>
            device.id !==
            deleteTarget.id
        )
      );

      setDeleteTarget(
        null
      );
    };

  const s88StatusColor =
    !s88.enabled
      ? "gray"
      : s88Status?.online
        ? "green"
        : "red";

  const s88StatusText =
    !s88.enabled
      ? "DISABLED"
      : s88Status?.online
        ? "ONLINE"
        : "OFFLINE";

  const s88InfoColor =
    !s88.enabled
      ? "gray"
      : s88Status?.adapterInfoKnown
        ? "teal"
        : s88Status?.online
          ? "yellow"
          : "gray";

  return (
    <Stack gap="md">
      <AppModal
        opened={
          legacyDialogOpened
        }
        onClose={() =>
          setLegacyDialogOpened(
            false
          )
        }
        title={
          legacyForm.id
            ? "Edit I2C HAL device"
            : "Add I2C HAL device"
        }
        centered
        size="lg"
        returnFocus={false}
        draggable
      >
        <Stack gap="md">
          <Select
            label="Driver"
            data={
              LEGACY_TYPE_OPTIONS
            }
            value={
              legacyForm.type
            }
            allowDeselect={
              false
            }
            onChange={
              value => {
                if (!value) {
                  return;
                }

                const type =
                  value as LegacyDeviceType;

                const definition =
                  LEGACY_DEFINITIONS[
                    type
                  ];

                setLegacyForm(
                  current => ({
                    ...current,
                    type,
                    address:
                      hexAddress(
                        definition.defaultAddress
                      ),
                    firstVpin:
                      definition.defaultFirstVpin,
                    name:
                      current.id
                        ? current.name
                        : definition.label,
                  })
                );
              }
            }
          />

          <TextInput
            label="Name"
            value={
              legacyForm.name
            }
            onChange={
              event =>
                setLegacyForm(
                  current => ({
                    ...current,
                    name:
                      event.currentTarget.value,
                  })
                )
            }
          />

          <SimpleGrid
            cols={{
              base: 1,
              sm: 2,
            }}
          >
            <TextInput
              label="I2C address"
              value={
                legacyForm.address
              }
              onChange={
                event =>
                  setLegacyForm(
                    current => ({
                      ...current,
                      address:
                        event.currentTarget.value,
                    })
                  )
              }
            />

            <NumberInput
              label="First VPIN"
              value={
                legacyForm.firstVpin
              }
              min={40}
              max={32767}
              allowDecimal={
                false
              }
              onChange={
                value => {
                  if (
                    typeof value ===
                    "number"
                  ) {
                    setLegacyForm(
                      current => ({
                        ...current,
                        firstVpin:
                          value,
                      })
                    );
                  }
                }
              }
            />
          </SimpleGrid>

          {legacyForm.type ===
          "pca9685" ? (
            <NumberInput
              label="PWM frequency"
              value={
                legacyForm.frequency
              }
              suffix=" Hz"
              min={24}
              max={1526}
              allowDecimal={
                false
              }
              onChange={
                value => {
                  if (
                    typeof value ===
                    "number"
                  ) {
                    setLegacyForm(
                      current => ({
                        ...current,
                        frequency:
                          value,
                      })
                    );
                  }
                }
              }
            />
          ) : (
            <NumberInput
              label="Interrupt GPIO (optional)"
              value={
                legacyForm.interruptPin ??
                ""
              }
              min={0}
              max={39}
              allowDecimal={
                false
              }
              onChange={
                value =>
                  setLegacyForm(
                    current => ({
                      ...current,
                      interruptPin:
                        typeof value ===
                        "number"
                          ? value
                          : null,
                    })
                  )
              }
            />
          )}

          <Switch
            label="Enabled"
            checked={
              legacyForm.enabled
            }
            onChange={
              event =>
                setLegacyForm(
                  current => ({
                    ...current,
                    enabled:
                      event.currentTarget.checked,
                  })
                )
            }
          />

          {legacyFormError && (
            <Alert
              color="red"
              icon={
                <IconAlertTriangle
                  size={18}
                />
              }
            >
              {legacyFormError}
            </Alert>
          )}

          <Group
            justify="flex-end"
          >
            <Button
              variant="default"
              onClick={() =>
                setLegacyDialogOpened(
                  false
                )
              }
            >
              Cancel
            </Button>

            <Button
              leftSection={
                <IconDeviceFloppy
                  size={17}
                />
              }
              disabled={
                !!legacyFormError
              }
              onClick={
                saveLegacyDevice
              }
            >
              Save draft
            </Button>
          </Group>
        </Stack>
      </AppModal>

      <AppModal
        opened={
          deleteTarget !==
          null
        }
        onClose={() =>
          setDeleteTarget(
            null
          )
        }
        title="Delete device"
        centered
        size="sm"
        returnFocus={false}
        draggable
      >
        <Stack>
          <Text>
            Remove{" "}
            <b>
              {deleteTarget?.name}
            </b>{" "}
            from the configuration?
          </Text>

          <Group
            justify="flex-end"
          >
            <Button
              variant="default"
              onClick={() =>
                setDeleteTarget(
                  null
                )
              }
            >
              Cancel
            </Button>

            <Button
              color="red"
              onClick={
                deleteLegacyDevice
              }
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </AppModal>

      <Card
        withBorder
        radius={5}
        p="md"
      >
        <Group
          justify="space-between"
          align="center"
          wrap="wrap"
        >
          <Group
            gap="sm"
            wrap="nowrap"
          >
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              aria-label="Back"
              onClick={
                onBack
              }
            >
              <IconArrowLeft
                size={22}
              />
            </ActionIcon>

            <ThemeIcon
              size={42}
              radius="md"
              color="blue"
              variant="light"
            >
              <IconCpu
                size={24}
              />
            </ThemeIcon>

            <div>
              <Title order={3}>
                Device configuration
              </Title>

              <Text
                size="sm"
                c="dimmed"
              >
                S88 occupancy adapter and external I2C devices
              </Text>
            </div>
          </Group>

          <Group gap="xs">
            <Badge
              color={
                websocketConnected
                  ? "green"
                  : "red"
              }
              variant="light"
            >
              WS{" "}
              {websocketConnected
                ? "ONLINE"
                : wsStatus.toUpperCase()}
            </Badge>

            <Badge
              color={
                dirty
                  ? "orange"
                  : "teal"
              }
              variant="light"
            >
              {loading
                ? "Loading"
                : dirty
                  ? "Unsaved changes"
                  : "Saved"}
            </Badge>

            <Button
              leftSection={
                <IconDeviceFloppy
                  size={17}
                />
              }
              loading={
                saving
              }
              disabled={
                loading ||
                !dirty ||
                !!s88Error
              }
              onClick={() =>
                void saveConfiguration()
              }
            >
              Save &amp; apply
            </Button>
          </Group>
        </Group>
      </Card>

      {loadError && (
        <Alert
          color="yellow"
          icon={
            <IconAlertTriangle
              size={19}
            />
          }
        >
          {loadError}
        </Alert>
      )}

      <Card
        withBorder
        radius={5}
        p="md"
      >
        <Group
          justify="space-between"
          align="flex-start"
          wrap="wrap"
        >
          <div>
            <Group gap="xs">
              <Title order={4}>
                S88 occupancy adapter
              </Title>

              <Badge
                color={
                  s88StatusColor
                }
                variant="light"
              >
                {s88StatusText}
              </Badge>

              <Badge
                color={
                  s88InfoColor
                }
                variant="light"
              >
                INFO{" "}
                {s88Status
                  ?.adapterInfoKnown
                  ? "OK"
                  : "PENDING"}
              </Badge>

              <Badge
                color={
                  s88Status
                    ?.dataFresh
                    ? "green"
                    : "orange"
                }
                variant="light"
              >
                DATA{" "}
                {s88Status
                  ?.dataFresh
                  ? "LIVE"
                  : "STALE"}
              </Badge>
            </Group>

            <Text
              size="sm"
              c="dimmed"
              mt={4}
            >
              YaMoRC / S88-N → Arduino adapter → I2C → DCCExpressHub
            </Text>
          </div>

          <ActionIcon
            variant="light"
            color="gray"
            size="lg"
            aria-label="Refresh S88 status"
            onClick={() =>
              void refreshS88Status()
            }
          >
            <IconRefresh
              size={18}
            />
          </ActionIcon>
        </Group>

        <Divider my="md" />

        <SimpleGrid
          cols={{
            base: 1,
            sm: 2,
            lg: 4,
          }}
        >
          <TextInput
            label="I2C address"
            description="Hub-side address used to find the adapter"
            value={
              s88AddressText
            }
            error={
              s88Error ??
              undefined
            }
            onChange={
              event => {
                const text =
                  event.currentTarget.value;

                setS88AddressText(
                  text
                );

                const parsed =
                  parseHexAddress(
                    text
                  );

                if (
                  parsed !== null &&
                  parsed >= 0x08 &&
                  parsed <= 0x77
                ) {
                  updateS88({
                    address:
                      parsed,
                  });
                }
              }
            }
          />

          <TextInput
            label="Adapter firmware"
            description="Reported by the S88 adapter INFO packet"
            value={
              s88Status?.adapterInfoKnown
                ? `v${s88Status.firmwareVersion}`
                : "-"
            }
            readOnly
          />

          <TextInput
            label="S88 payload"
            description="Owned and reported by the adapter"
            value={
              s88Status?.adapterInfoKnown
                ? `${runtimeByteCount} bytes · ${sensorCount} sensors`
                : "Waiting for adapter INFO"
            }
            readOnly
          />

          <TextInput
            label="Protocol"
            description="Read-only adapter capability information"
            value={
              s88Status?.adapterInfoKnown
                ? `INFO v${s88Status.protocolVersion} · max ${s88Status.maxByteCount} bytes · caps 0x${s88Status.capabilities
                    .toString(16)
                    .toUpperCase()}`
                : "-"
            }
            readOnly
          />
        </SimpleGrid>

        <Group
          mt="md"
          justify="space-between"
          wrap="wrap"
        >
          <Switch
            label="S88 adapter enabled"
            checked={
              s88.enabled
            }
            onChange={
              event =>
                updateS88({
                  enabled:
                    event.currentTarget.checked,
                })
            }
          />

          <Text
            size="sm"
            c="dimmed"
          >
            Input range:{" "}
            <b>
              {s88Status?.adapterInfoKnown
                ? `${runtimeBaseAddress} – ${lastSensorAddress}`
                : "waiting for INFO"}
            </b>
          </Text>
        </Group>

        {s88Error && (
          <Alert
            mt="md"
            color="red"
            icon={
              <IconAlertTriangle
                size={18}
              />
            }
          >
            {s88Error}
          </Alert>
        )}

        <Alert
          mt="md"
          color="blue"
        >
          The Arduino adapter owns the S88 byte length and is configured over its
          USB serial port. DCCExpressHub stores only the adapter I2C address, reads
          the adapter INFO packet, and then requests exactly the reported number of
          S88 bytes. The Hub never changes adapter configuration.
        </Alert>
      </Card>

      <Card
        withBorder
        radius={5}
        p="md"
      >
        <Group
          justify="space-between"
          align="center"
          wrap="wrap"
        >
          <div>
            <Title order={4}>
              Live S88 sensors
            </Title>

            <Text
              size="sm"
              c="dimmed"
            >
              Red = occupied, green = free, gray = not known yet
            </Text>
          </div>

          <Badge
            color={
              s88Status?.dataFresh
                ? "teal"
                : "gray"
            }
            variant="light"
          >
            {s88Status?.dataFresh
              ? `${sensorCount} states available`
              : s88Status?.adapterInfoKnown
                ? "Waiting for snapshot"
                : "Waiting for adapter INFO"}
          </Badge>
        </Group>

        <Divider my="md" />

        <Stack gap="md">
          {Array.from({
            length:
              runtimeByteCount,
          }).map(
            (
              _,
              groupIndex
            ) => {
              const groupBase =
                runtimeBaseAddress +
                groupIndex *
                  8;

              return (
                <div
                  key={
                    groupIndex
                  }
                >
                  <Group
                    gap="xs"
                    mb="xs"
                  >
                    <Text
                      fw={700}
                      size="sm"
                    >
                      Group{" "}
                      {groupIndex +
                        1}
                    </Text>

                    <Badge
                      size="sm"
                      variant="light"
                    >
                      {groupBase}
                      {" – "}
                      {groupBase +
                        7}
                    </Badge>
                  </Group>

                  <SimpleGrid
                    cols={{
                      base: 2,
                      xs: 4,
                      sm: 8,
                    }}
                    spacing="xs"
                  >
                    {Array.from({
                      length:
                        8,
                    }).map(
                      (
                        __,
                        bit
                      ) => {
                        const address =
                          groupBase +
                          bit;

                        const state =
                          sensorStates[
                            address
                          ];

                        const known =
                          s88Status?.dataFresh ===
                            true &&
                          typeof state ===
                            "boolean";

                        const occupied =
                          state ===
                          true;

                        return (
                          <Card
                            key={
                              address
                            }
                            withBorder
                            radius={5}
                            p="xs"
                            style={{
                              borderColor:
                                occupied
                                  ? "var(--mantine-color-red-6)"
                                  : known
                                    ? "var(--mantine-color-green-6)"
                                    : undefined,
                            }}
                          >
                            <Group
                              justify="space-between"
                              gap={4}
                              wrap="nowrap"
                            >
                              <Text
                                fw={700}
                                size="sm"
                              >
                                #
                                {address}
                              </Text>

                              <Badge
                                size="xs"
                                color={
                                  occupied
                                    ? "red"
                                    : known
                                      ? "green"
                                      : "gray"
                                }
                              >
                                {occupied
                                  ? "BUSY"
                                  : known
                                    ? "FREE"
                                    : "?"}
                              </Badge>
                            </Group>
                          </Card>
                        );
                      }
                    )}
                  </SimpleGrid>
                </div>
              );
            }
          )}
        </Stack>
      </Card>

      {SHOW_OTHER_I2C_HAL_DEVICES && (
      <Card
        withBorder
        radius={5}
        p="md"
      >
        <Group
          justify="space-between"
          align="center"
          wrap="wrap"
        >
          <div>
            <Title order={4}>
              Other I2C HAL devices
            </Title>

            <Text
              size="sm"
              c="dimmed"
            >
              PCA9685, MCP23017 and PCF expanders
            </Text>
          </div>

          <Button
            variant="light"
            leftSection={
              <IconPlus
                size={17}
              />
            }
            onClick={
              openAddLegacy
            }
          >
            Add I2C device
          </Button>
        </Group>

        <Divider my="md" />

        {legacyDevices.length ===
        0 ? (
          <Text
            c="dimmed"
            ta="center"
            py="lg"
          >
            No additional I2C HAL devices configured.
          </Text>
        ) : (
          <Stack gap="xs">
            {legacyDevices.map(
              device => {
                const definition =
                  LEGACY_DEFINITIONS[
                    device.type
                  ];

                const lastVpin =
                  device.firstVpin +
                  device.pinCount -
                  1;

                return (
                  <Card
                    key={
                      device.id
                    }
                    withBorder
                    radius={5}
                    p="sm"
                  >
                    <Group
                      justify="space-between"
                      align="center"
                      wrap="wrap"
                    >
                      <div>
                        <Group gap="xs">
                          <Text
                            fw={700}
                          >
                            {device.name}
                          </Text>

                          <Badge
                            size="xs"
                            color={
                              device.enabled
                                ? "teal"
                                : "gray"
                            }
                          >
                            {device.enabled
                              ? "Enabled"
                              : "Disabled"}
                          </Badge>
                        </Group>

                        <Text
                          size="sm"
                          c="dimmed"
                          mt={4}
                        >
                          {definition.label}
                          {" · "}
                          {hexAddress(
                            device.address
                          )}
                          {" · VPIN "}
                          {device.firstVpin}
                          {" – "}
                          {lastVpin}
                        </Text>
                      </div>

                      <Group gap="xs">
                        <Switch
                          checked={
                            device.enabled
                          }
                          onChange={
                            event => {
                              const enabled =
                                event.currentTarget.checked;

                              if (enabled) {
                                const addressConflict =
                                  devices.some(
                                    item =>
                                      item.id !==
                                        device.id &&
                                      item.enabled &&
                                      item.address ===
                                        device.address
                                  );

                                const targetLast =
                                  device.firstVpin +
                                  device.pinCount -
                                  1;

                                const rangeConflict =
                                  legacyDevices.some(
                                    item => {
                                      if (
                                        item.id ===
                                          device.id ||
                                        !item.enabled
                                      ) {
                                        return false;
                                      }

                                      const itemLast =
                                        item.firstVpin +
                                        item.pinCount -
                                        1;

                                      return (
                                        device.firstVpin <=
                                          itemLast &&
                                        targetLast >=
                                          item.firstVpin
                                      );
                                    }
                                  );

                                if (
                                  addressConflict ||
                                  rangeConflict
                                ) {
                                  showNotification({
                                    color:
                                      "red",
                                    title:
                                      "Device cannot be enabled",
                                    message:
                                      addressConflict
                                        ? "Its I2C address is already used by another enabled device."
                                        : "Its VPIN range overlaps another enabled HAL device.",
                                  });

                                  return;
                                }
                              }

                              replaceDevices(
                                devices.map(
                                  item =>
                                    item.id ===
                                    device.id
                                      ? {
                                          ...device,
                                          enabled,
                                        }
                                      : item
                                )
                              );
                            }
                          }
                        />

                        <ActionIcon
                          variant="light"
                          aria-label="Edit device"
                          onClick={() =>
                            openEditLegacy(
                              device
                            )
                          }
                        >
                          <IconEdit
                            size={17}
                          />
                        </ActionIcon>

                        <ActionIcon
                          variant="light"
                          color="red"
                          aria-label="Delete device"
                          onClick={() =>
                            setDeleteTarget(
                              device
                            )
                          }
                        >
                          <IconTrash
                            size={17}
                          />
                        </ActionIcon>
                      </Group>
                    </Group>
                  </Card>
                );
              }
            )}
          </Stack>
        )}

        <Alert
          mt="md"
          color="gray"
        >
          Existing servoChannels and digitalChannels definitions are preserved
          when basic device properties are edited here. The page intentionally
          keeps the device overview compact.
        </Alert>
      </Card>
      )}
    </Stack>
  );
}
