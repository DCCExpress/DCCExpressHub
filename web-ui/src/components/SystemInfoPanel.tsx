import { useTranslation } from "react-i18next";
import { useCommandCenter } from "@/context/CommandCenterContext";
import { useTrackPowerOn } from "@/hooks/useTrackPowerOn";
import i18next from "i18next";
import {
  Badge,
  Card,
  Group,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";

import type {
  DccExStatusPayload,
} from "@domain/types";

import type {
  WsConnectionStatus,
} from "@/services/wsClient";

export type SystemFlashInfo = {
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

type DccTrackTelemetry = {
  letter: string;
  mode: string;
  currentMa: number | null;
  tripMa: number | null;
  overload?: boolean;
};

type HubTelemetry = {
  uptimeMs?: number;
  chipModel?: string;
  chipRevision?: number;
  cpuCores?: number;
  cpuFrequencyMhz?: number;
  cpuCore0Percent?: number;
  cpuCore1Percent?: number;
  chipTemperatureC?: number;
  heapSizeBytes?: number;
  freeHeapBytes?: number;
  minimumFreeHeapBytes?: number;
  runtimeMinimumFreeHeapBytes?: number;
  largestFreeHeapBlockBytes?: number;
  internalFreeHeapBytes?: number;
  minimumInternalFreeHeapBytes?: number;
  runtimeMinimumInternalFreeHeapBytes?: number;
  largestInternalFreeHeapBlockBytes?: number;
  psramSizeBytes?: number;
  freePsramBytes?: number;
  minimumFreePsramBytes?: number;
  runtimeMinimumFreePsramBytes?: number;
  largestFreePsramBlockBytes?: number;
  hostname?: string;
  wifiIp?: string;
  wifiRssiDbm?: number;
  wifiSsid?: string;
  wifiMac?: string;
  wifiChannel?: number;
  wsClients?: number;
  runtimeAccessories?: number;
  runtimeSensors?: number;
  flashChipBytes?: number;
  sketchBytes?: number;
  freeSketchBytes?: number;
  sdkVersion?: string;
  resetReason?: string;
};

type ExtendedDccExStatus = DccExStatusPayload & {
  processor?: string;
  build?: string;
  transport?: "tcp" | "serial" | string;
  host?: string;
  port?: number;
  serialPort?: string;
  baudRate?: number;
  alive?: boolean;
  maxLocos?: number;
  tracks?: DccTrackTelemetry[];
  currentUpdatedAtMs?: number;
  linkUptimeMs?: number | null;
  hub?: HubTelemetry;
};

type SystemInfoPanelProps = {
  status: DccExStatusPayload | null;
  wsStatus: WsConnectionStatus;
  flashInfo: SystemFlashInfo | null;
  version: string;
};

type TemperatureLevel = {
  label: string;
  color: "green" | "yellow" | "orange" | "red";
};

function getTemperatureLevel(
  temperatureC: number,
): TemperatureLevel {
  if (temperatureC > 85) {
    return {
      label: i18next.t("ui.critical"),
      color: "red",
    };
  }

  if (temperatureC >= 75) {
    return {
      label: i18next.t("ui.warning"),
      color: "orange",
    };
  }

  if (temperatureC >= 65) {
    return {
      label: i18next.t("ui.warm"),
      color: "yellow",
    };
  }

  return {
    label: i18next.t("ui.normal"),
    color: "green",
  };
}

function formatBytes(
  bytes: number | null | undefined,
): string {
  if (
    bytes === null ||
    bytes === undefined ||
    !Number.isFinite(bytes) ||
    bytes < 0
  ) {
    return "—";
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  return `${Math.round(bytes / 1024)} KB`;
}

function formatUptime(
  uptimeMs: number | null | undefined,
): string {
  if (
    uptimeMs === null ||
    uptimeMs === undefined ||
    !Number.isFinite(uptimeMs)
  ) {
    return "—";
  }

  const totalSeconds =
    Math.max(
      0,
      Math.floor(uptimeMs / 1000),
    );

  const days =
    Math.floor(totalSeconds / 86400);

  const hours =
    Math.floor(
      (totalSeconds % 86400) / 3600,
    );

  const minutes =
    Math.floor(
      (totalSeconds % 3600) / 60,
    );

  const seconds =
    totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  return `${hours}h ${minutes}m ${seconds}s`;
}

function formatAge(
  ageMs: number | null | undefined,
): string {
  if (
    ageMs === null ||
    ageMs === undefined ||
    !Number.isFinite(ageMs) ||
    ageMs < 0
  ) {
    return "—";
  }

  const seconds =
    Math.max(
      0,
      Math.floor(ageMs / 1000),
    );

  if (seconds < 2) {
    return i18next.t("ui.justNow");
  }

  if (seconds < 60) {
    return i18next.t(
      "ui.secondsAgo",
      { value1: seconds },
    );
  }

  const minutes =
    Math.floor(seconds / 60);

  if (minutes < 60) {
    return i18next.t(
      "ui.minutesAgo",
      { value1: minutes },
    );
  }

  const hours =
    Math.floor(minutes / 60);

  return i18next.t(
    "ui.hoursAgo",
    { value1: hours },
  );
}

function InfoRow({
  label,
  value,
  color = "blue",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <Group
      justify="space-between"
      gap="xs"
      wrap="nowrap"
    >
      <Text size="sm" c="dimmed">
        {label}
      </Text>

      <Badge
        size="lg"
        variant="light"
        color={color}
        maw="65%"
      >
        {value}
      </Badge>
    </Group>
  );
}

function currentColor(
  currentMa: number | null,
  tripMa: number | null,
  overload = false,
): string {
  if (overload) {
    return "red";
  }

  if (
    currentMa === null ||
    tripMa === null ||
    tripMa <= 0
  ) {
    return "orange";
  }

  const percent =
    currentMa / tripMa;

  if (percent >= 0.9) {
    return "red";
  }

  if (percent >= 0.7) {
    return "orange";
  }

  return "teal";
}

function currentValue(
  track: DccTrackTelemetry,
): string {
  if (track.overload) {
    return "OVERLOAD";
  }

  const current =
    track.currentMa === null
      ? "—"
      : `${track.currentMa} mA`;

  if (
    track.tripMa === null ||
    track.tripMa <= 0
  ) {
    return current;
  }

  return `${current} / ${track.tripMa} mA`;
}

function wifiRssiColor(
  value: number | undefined,
): string {
  if (value === undefined) {
    return "gray";
  }

  if (value >= -60) {
    return "green";
  }

  if (value >= -72) {
    return "yellow";
  }

  return "red";
}

export default function SystemInfoPanel({
  status,
  wsStatus,
  flashInfo,
  version,
}: SystemInfoPanelProps) {
  useTranslation();
  const commandCenter =
    useCommandCenter();

  const trackPowerOn =
    useTrackPowerOn();

  const telemetry =
    status as ExtendedDccExStatus | null;

  const hub =
    telemetry?.hub;

  const fallbackType =
    commandCenter.type ??
    undefined;

  const fallbackName =
    commandCenter.name ??
    undefined;

  const fallbackHost =
    commandCenter.ip ??
    undefined;

  const fallbackPort =
    commandCenter.port ??
    undefined;

  // CommandCenterContext is the UI's authoritative live connection state.
  // dccExStatus is periodic telemetry and can briefly lag behind a real Z21
  // connection transition, so use it only as a compatibility fallback.
  const dccAlive =
    wsStatus === "connected" &&
    (
      commandCenter.alive ||
      Boolean(telemetry?.alive)
    );

  const z21 =
    telemetry?.z21 ?? null;

  const isZ21 =
    telemetry?.commandCenterType === "z21" ||
    fallbackType === "z21" ||
    z21 !== null;

  const isYaMoRc =
    telemetry?.commandCenterProfile === "yamorc7010" ||
    z21?.profile === "yamorc7010" ||
    fallbackName === "YD7010";

  const commandCenterTitle =
    isYaMoRc
      ? "YD7010"
      : isZ21
        ? "Z21"
        : fallbackName ||
          "DCC-EX / EX-CSB1";

  const targetHost =
    telemetry?.host ??
    fallbackHost;

  const targetPort =
    telemetry?.port ??
    fallbackPort;

  const target =
    telemetry?.transport === "serial" ||
    Boolean(telemetry?.serialPort)
      ? telemetry?.serialPort
        ? `${telemetry.serialPort} @ ${telemetry.baudRate ?? 115200} baud`
        : "—"
      : targetHost
        ? `${targetHost}:${targetPort ?? (isZ21 ? 21105 : 2560)}${isZ21 ? " / UDP" : ""}`
        : "—";

  const commandVersion =
    telemetry?.version
      ? isZ21
        ? telemetry.version
        : `V-${telemetry.version}`
      : "—";

  const z21StateAvailable =
    z21 !== null &&
    z21.lastSystemStateAgeMs >= 0;

  const commandStationTemperatureLevel =
    z21StateAvailable
      ? getTemperatureLevel(
          z21.temperatureC,
        )
      : null;

  const tracks =
    telemetry?.tracks ?? [];

  const anyTrackOverload =
    tracks.some(track => Boolean(track.overload));

  const totalTrackCurrentMa =
    tracks.reduce(
      (sum, track) =>
        sum +
        (track.currentMa ?? 0),
      0,
    );

  const temperature =
    hub?.chipTemperatureC;

  const temperatureLevel =
    temperature !== undefined
      ? getTemperatureLevel(temperature)
      : null;

  const heapTotal =
    hub?.heapSizeBytes;

  const heapFree =
    hub?.freeHeapBytes;

  const heapUsedPercent =
    heapTotal &&
    heapFree !== undefined &&
    heapTotal > 0
      ? Math.round(
          ((heapTotal - heapFree) /
            heapTotal) *
            100,
        )
      : null;

  const dataTotal =
    flashInfo?.totalBytes ??
    (flashInfo
      ? flashInfo.total * 1024
      : 0);

  const dataUsed =
    flashInfo?.usedBytes ??
    (flashInfo
      ? flashInfo.used * 1024
      : 0);

  const dataFree =
    flashInfo?.freeBytes ??
    (flashInfo
      ? flashInfo.free * 1024
      : 0);

  const dataUsedPercent =
    dataTotal > 0
      ? Math.round(
          (dataUsed / dataTotal) * 100,
        )
      : null;

  return (
    <ScrollArea
      h="100%"
      type="always"
      scrollbarSize={9}
      className="lite-info-scroll"
    >
      <Stack gap="sm">
        <Card withBorder p="sm">
          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={700}>
                {commandCenterTitle}
              </Text>

              <Badge
                color={dccAlive ? "green" : "red"}
                variant={dccAlive ? "light" : "filled"}
              >
                {dccAlive ? i18next.t("ui.online") : i18next.t("ui.offline")}
              </Badge>
            </Group>

            <InfoRow
              label={i18next.t("ui.target")}
              value={target}
              color="cyan"
            />

            <InfoRow
              label={
                isYaMoRc
                  ? i18next.t("ui.z21InterfaceFirmware")
                  : isZ21
                    ? i18next.t("ui.firmware")
                    : i18next.t("ui.dccExVersion")
              }
              value={commandVersion}
              color="violet"
            />

            <InfoRow
              label={
                isZ21
                  ? i18next.t("ui.protocol")
                  : i18next.t("ui.processor")
              }
              value={telemetry?.processor || "—"}
              color="indigo"
            />

            <InfoRow
              label={
                isZ21
                  ? i18next.t("ui.hardware")
                  : i18next.t("ui.motorDriver")
              }
              value={telemetry?.hardware || "—"}
              color="cyan"
            />

            {!isZ21 && (
              <>
                <InfoRow
                  label={i18next.t("ui.build")}
                  value={telemetry?.build || "—"}
                  color="gray"
                />

                <InfoRow
                  label={i18next.t("ui.maxLocoSlots")}
                  value={
                    telemetry?.maxLocos
                      ? String(telemetry.maxLocos)
                      : "—"
                  }
                  color="blue"
                />
              </>
            )}

            <InfoRow
              label={i18next.t("ui.trackPower")}
              value={
                trackPowerOn
                  ? "ON"
                  : "OFF"
              }
              color={
                trackPowerOn
                  ? "green"
                  : "red"
              }
            />

            {isZ21 && (
              <InfoRow
                label={i18next.t("ui.emergencyStop")}
                value={
                  telemetry?.emergencyStop
                    ? "ACTIVE"
                    : "CLEAR"
                }
                color={
                  telemetry?.emergencyStop
                    ? "red"
                    : "green"
                }
              />
            )}

            {tracks.length > 0 && (
              <InfoRow
                label={i18next.t("ui.totalTrackCurrent")}
                value={
                  anyTrackOverload
                    ? "OVERLOAD"
                    : `${totalTrackCurrentMa} mA`
                }
                color={
                  anyTrackOverload
                    ? "red"
                    : "orange"
                }
              />
            )}

            {tracks.map(track => (
              <InfoRow
                key={track.letter}
                label={i18next.t("ui.track", { value1: track.letter, value2: track.mode })}
                value={currentValue(track)}
                color={currentColor(
                  track.currentMa,
                  track.tripMa,
                  track.overload,
                )}
              />
            ))}

            {tracks.length === 0 && (
              <Text size="xs" c="dimmed">
                {isZ21
                  ? i18next.t("ui.waitingForZ21SystemState")
                  : i18next.t("ui.waitingForDccExTrackmanagerCurrentTelemetry")}
              </Text>
            )}

            {isZ21 && z21 && (
              <>
                <InfoRow
                  label={i18next.t("ui.filteredMainCurrent")}
                  value={
                    z21StateAvailable
                      ? `${z21.filteredMainCurrentMa} mA`
                      : "—"
                  }
                  color="teal"
                />

                <InfoRow
                  label={i18next.t("ui.trackVoltage")}
                  value={
                    z21StateAvailable
                      ? `${(z21.trackVoltageMv / 1000).toFixed(2)} V`
                      : "—"
                  }
                  color="blue"
                />

                <InfoRow
                  label={i18next.t("ui.supplyVoltage")}
                  value={
                    z21StateAvailable
                      ? `${(z21.supplyVoltageMv / 1000).toFixed(2)} V`
                      : "—"
                  }
                  color="blue"
                />

                <InfoRow
                  label={i18next.t("ui.commandStationTemperature")}
                  value={
                    z21StateAvailable
                      ? `${z21.temperatureC} °C`
                      : "—"
                  }
                  color={
                    commandStationTemperatureLevel?.color ??
                    "gray"
                  }
                />

                <InfoRow
                  label={i18next.t("ui.z21CentralState")}
                  value={
                    z21StateAvailable
                      ? `0x${z21.centralState.toString(16).padStart(2, "0").toUpperCase()} · EX 0x${z21.centralStateEx.toString(16).padStart(2, "0").toUpperCase()}`
                      : "—"
                  }
                  color="gray"
                />

                <InfoRow
                  label={i18next.t("ui.z21Capabilities")}
                  value={
                    z21StateAvailable
                      ? `0x${z21.capabilities.toString(16).padStart(2, "0").toUpperCase()}`
                      : "—"
                  }
                  color="gray"
                />

                <InfoRow
                  label={i18next.t("ui.z21BroadcastFlags")}
                  value={z21.broadcastFlags}
                  color="indigo"
                />

                <InfoRow
                  label={i18next.t("ui.z21UdpUptime")}
                  value={formatUptime(
                    z21.udpUptimeMs,
                  )}
                  color="teal"
                />

                <InfoRow
                  label={i18next.t("ui.lastSystemState")}
                  value={formatAge(
                    z21.lastSystemStateAgeMs,
                  )}
                  color="cyan"
                />

                {!isYaMoRc && (
                  <InfoRow
                    label={i18next.t("ui.feedback")}
                    value={i18next.t("ui.z21FeedbackSource")}
                    color="blue"
                  />
                )}

                <Text size="xs" c="dimmed">
                  {i18next.t("ui.z21TelemetryBroadcastHint")}
                </Text>
              </>
            )}

            {!isZ21 && (
              <>
                <InfoRow
                  label={i18next.t("ui.tcpLinkUptime")}
                  value={formatUptime(
                    telemetry?.linkUptimeMs,
                  )}
                  color="teal"
                />

                <Text size="xs" c="dimmed">
                  {i18next.t("ui.trackCurrentIsRequestedFromDccExEvery1000Ms")}
                </Text>
              </>
            )}
          </Stack>
        </Card>

        {isYaMoRc && z21 && (
          <Card withBorder p="sm">
            <Stack gap="xs">
              <Group justify="space-between">
                <Text fw={700}>
                  LocoNet / S88
                </Text>

                <Badge
                  color={
                    z21.lbServerConnected
                      ? "green"
                      : "red"
                  }
                  variant={
                    z21.lbServerConnected
                      ? "light"
                      : "filled"
                  }
                >
                  {z21.lbServerConnected
                    ? i18next.t("ui.online")
                    : i18next.t("ui.offline")}
                </Badge>
              </Group>

              <InfoRow
                label={i18next.t("ui.lbServer")}
                value={
                  `${telemetry?.host ?? "—"}:${z21.lbServerPort} / TCP`
                }
                color={
                  z21.lbServerConnected
                    ? "green"
                    : "red"
                }
              />

              <InfoRow
                label={i18next.t("ui.lbServerVersion")}
                value={z21.lbServerVersion || "—"}
                color="violet"
              />

              <InfoRow
                label={i18next.t("ui.lbServerUptime")}
                value={formatUptime(
                  z21.lbServerUptimeMs,
                )}
                color="teal"
              />

              <InfoRow
                label={i18next.t("ui.lbServerRx")}
                value={
                  `${z21.lbServerLinesObserved} · ${formatAge(z21.lastLbServerRxAgeMs)}`
                }
                color="cyan"
              />

              <InfoRow
                label={i18next.t("ui.s88FeedbackSource")}
                value="LBServer · OPC_INPUT_REP"
                color="blue"
              />

              <InfoRow
                label={i18next.t("ui.s88FeedbackReports")}
                value={String(
                  z21.sensorFeedbackCount,
                )}
                color={
                  z21.sensorFeedbackCount > 0
                    ? "green"
                    : "yellow"
                }
              />

              <InfoRow
                label={i18next.t("ui.lastS88Feedback")}
                value={
                  z21.sensorFeedbackCount > 0 &&
                  z21.lastSensorAddress > 0
                    ? `#${z21.lastSensorAddress} ${z21.lastSensorOn ? "ON" : "OFF"} · ${formatAge(z21.lastSensorFeedbackAgeMs)}`
                    : "—"
                }
                color={
                  z21.sensorFeedbackCount > 0
                    ? "green"
                    : "yellow"
                }
              />

              <InfoRow
                label={i18next.t("ui.sensorInterrogation")}
                value={
                  z21.interrogateEnabled
                    ? `${i18next.t("ui.enabled")} · ${formatAge(z21.lastInterrogateAgeMs)}`
                    : i18next.t("ui.disabled")
                }
                color={
                  z21.interrogateEnabled
                    ? "green"
                    : "red"
                }
              />

              <Text size="xs" c="dimmed">
                {i18next.t("ui.yamorcS88DiagnosticHint")}
              </Text>
            </Stack>
          </Card>
        )}

        <Card withBorder p="sm">
          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={700}>
                DCCExpressHub
              </Text>

              <Badge
                color={
                  wsStatus === "connected"
                    ? "green"
                    : "red"
                }
                variant="light"
              >
                {wsStatus === "connected"
                  ? i18next.t("ui.wsOnline")
                  : `WS ${wsStatus.toUpperCase()}`}
              </Badge>
            </Group>

            <InfoRow
              label={i18next.t("ui.hubVersion")}
              value={`v${version}`}
              color="violet"
            />

            <InfoRow
              label={i18next.t("ui.hostname")}
              value={hub?.hostname || "—"}
              color="gray"
            />

            <InfoRow
              label={i18next.t("ui.hubIp")}
              value={hub?.wifiIp || "—"}
              color="cyan"
            />

            <InfoRow
              label="Wi-Fi"
              value={
                hub?.wifiSsid
                  ? `${hub.wifiSsid} · ${hub.wifiRssiDbm ?? "—"} dBm · ch ${hub.wifiChannel ?? "—"}`
                  : "—"
              }
              color={wifiRssiColor(
                hub?.wifiRssiDbm,
              )}
            />

            <InfoRow
              label="Wi-Fi MAC"
              value={hub?.wifiMac || "—"}
              color="gray"
            />

            <InfoRow
              label={i18next.t("ui.processor")}
              value={
                hub?.chipModel
                  ? `${hub.chipModel} rev ${hub.chipRevision ?? "—"}`
                  : "—"
              }
              color="violet"
            />

            <InfoRow
              label="CPU"
              value={
                hub?.cpuCores !== undefined
                  ? `${hub.cpuCores} cores · ${hub.cpuFrequencyMhz ?? "—"} MHz`
                  : "—"
              }
              color="violet"
            />

            <InfoRow
              label={i18next.t("ui.cpuCore0")}
              value={
                hub?.cpuCore0Percent !== undefined
                  ? `${hub.cpuCore0Percent}%`
                  : "—"
              }
              color={
                (hub?.cpuCore0Percent ?? 0) >= 85
                  ? "red"
                  : "cyan"
              }
            />

            <InfoRow
              label={i18next.t("ui.cpuCore1")}
              value={
                hub?.cpuCore1Percent !== undefined
                  ? `${hub.cpuCore1Percent}%`
                  : "—"
              }
              color={
                (hub?.cpuCore1Percent ?? 0) >= 85
                  ? "red"
                  : "teal"
              }
            />

            <InfoRow
              label={i18next.t("ui.chipTemperature")}
              value={
                temperature !== undefined &&
                temperatureLevel
                  ? `${temperature.toFixed(1)} °C · ${temperatureLevel.label}`
                  : "—"
              }
              color={
                temperatureLevel?.color ??
                "gray"
              }
            />

            <InfoRow
              label={i18next.t("ui.uptime")}
              value={formatUptime(
                hub?.uptimeMs,
              )}
              color="teal"
            />

            <InfoRow
              label={i18next.t("ui.heapFreeTotal")}
              value={
                heapTotal !== undefined
                  ? `${formatBytes(heapFree)} / ${formatBytes(heapTotal)}${
                      heapUsedPercent !== null
                        ? ` · ${heapUsedPercent}% used`
                        : ""
                    }`
                  : "—"
              }
              color={
                (heapFree ?? 999999) < 40000
                  ? "red"
                  : "blue"
              }
            />

            <InfoRow
              label={i18next.t("ui.minimumFreeHeap")}
              value={formatBytes(
                hub?.minimumFreeHeapBytes,
              )}
              color={
                (hub?.minimumFreeHeapBytes ??
                  999999) < 40000
                  ? "red"
                  : "blue"
              }
            />

            <InfoRow
              label={i18next.t("ui.runtimeMinimumFreeHeap")}
              value={formatBytes(
                hub?.runtimeMinimumFreeHeapBytes,
              )}
              color={
                (hub?.runtimeMinimumFreeHeapBytes ??
                  999999) < 40000
                  ? "red"
                  : "teal"
              }
            />

            <InfoRow
              label={i18next.t("ui.largestFreeBlock")}
              value={formatBytes(
                hub?.largestFreeHeapBlockBytes,
              )}
              color={
                (hub?.largestFreeHeapBlockBytes ??
                  999999) < 16000
                  ? "red"
                  : "blue"
              }
            />

            <InfoRow
              label={i18next.t("ui.internalHeapFree")}
              value={formatBytes(
                hub?.internalFreeHeapBytes,
              )}
              color="cyan"
            />

            <InfoRow
              label={i18next.t("ui.minimumInternalHeap")}
              value={formatBytes(
                hub?.minimumInternalFreeHeapBytes,
              )}
              color={
                (hub?.minimumInternalFreeHeapBytes ??
                  999999) < 40000
                  ? "red"
                  : "cyan"
              }
            />

            <InfoRow
              label={i18next.t("ui.runtimeMinimumInternalHeap")}
              value={formatBytes(
                hub?.runtimeMinimumInternalFreeHeapBytes,
              )}
              color={
                (hub?.runtimeMinimumInternalFreeHeapBytes ??
                  999999) < 40000
                  ? "red"
                  : "teal"
              }
            />

            <InfoRow
              label={i18next.t("ui.largestInternalHeapBlock")}
              value={formatBytes(
                hub?.largestInternalFreeHeapBlockBytes,
              )}
              color="cyan"
            />

            {(hub?.psramSizeBytes ?? 0) > 0 && (
              <>
                <InfoRow
                  label={i18next.t("ui.psramFreeTotal")}
                  value={`${formatBytes(
                    hub?.freePsramBytes,
                  )} / ${formatBytes(
                    hub?.psramSizeBytes,
                  )}`}
                  color="indigo"
                />

                <InfoRow
                  label={i18next.t("ui.minimumFreePsram")}
                  value={formatBytes(
                    hub?.minimumFreePsramBytes,
                  )}
                  color="indigo"
                />

                <InfoRow
                  label={i18next.t("ui.runtimeMinimumFreePsram")}
                  value={formatBytes(
                    hub?.runtimeMinimumFreePsramBytes,
                  )}
                  color="indigo"
                />

                <InfoRow
                  label={i18next.t("ui.largestFreePsramBlock")}
                  value={formatBytes(
                    hub?.largestFreePsramBlockBytes,
                  )}
                  color="indigo"
                />
              </>
            )}

            <InfoRow
              label={i18next.t("ui.websocketClients")}
              value={
                hub?.wsClients !== undefined
                  ? String(hub.wsClients)
                  : "—"
              }
              color="cyan"
            />

            <InfoRow
              label={i18next.t("ui.runtimeObjects")}
              value={
                hub?.runtimeAccessories !== undefined &&
                hub?.runtimeSensors !== undefined
                  ? `${hub.runtimeAccessories} accessories · ${hub.runtimeSensors} sensors`
                  : "—"
              }
              color="blue"
            />

            <InfoRow
              label={i18next.t("ui.flashChip")}
              value={formatBytes(
                hub?.flashChipBytes,
              )}
              color="violet"
            />

            <InfoRow
              label="Firmware"
              value={
                hub?.sketchBytes !== undefined
                  ? `${formatBytes(hub.sketchBytes)} · OTA free ${formatBytes(hub.freeSketchBytes)}`
                  : "—"
              }
              color="teal"
            />

            <InfoRow
              label={i18next.t("ui.littlefsData")}
              value={
                dataTotal > 0
                  ? `${formatBytes(dataUsed)} / ${formatBytes(dataTotal)}${
                      dataUsedPercent !== null
                        ? ` · ${dataUsedPercent}%`
                        : ""
                    }`
                  : "—"
              }
              color={
                (dataUsedPercent ?? 0) >= 85
                  ? "red"
                  : (dataUsedPercent ?? 0) >= 70
                    ? "orange"
                    : "teal"
              }
            />

            <InfoRow
              label={i18next.t("ui.littlefsFree")}
              value={
                dataTotal > 0
                  ? formatBytes(dataFree)
                  : "—"
              }
              color="green"
            />

            <InfoRow
              label="ESP-IDF / SDK"
              value={hub?.sdkVersion || "—"}
              color="gray"
            />

            <InfoRow
              label={i18next.t("ui.resetReason")}
              value={hub?.resetReason || "—"}
              color={
                hub?.resetReason === "panic" ||
                hub?.resetReason?.includes(
                  "watchdog",
                )
                  ? "red"
                  : "gray"
              }
            />
          </Stack>
        </Card>
      </Stack>
    </ScrollArea>
  );
}
