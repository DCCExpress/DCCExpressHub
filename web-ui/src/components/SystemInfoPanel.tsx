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
  largestFreeHeapBlockBytes?: number;
  psramSizeBytes?: number;
  freePsramBytes?: number;
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
  host?: string;
  port?: number;
  alive?: boolean;
  maxLocos?: number;
  tracks?: DccTrackTelemetry[];
  currentUpdatedAtMs?: number;
  linkUptimeMs?: number;
  hub?: HubTelemetry;
};

type SystemInfoPanelProps = {
  status: DccExStatusPayload | null;
  wsStatus: WsConnectionStatus;
  flashInfo: SystemFlashInfo | null;
  version: string;
};

type TemperatureLevel = {
  label: "NORMAL" | "WARM" | "WARNING" | "CRITICAL";
  color: "green" | "yellow" | "orange" | "red";
};

function getTemperatureLevel(
  temperatureC: number,
): TemperatureLevel {
  if (temperatureC > 85) {
    return {
      label: "CRITICAL",
      color: "red",
    };
  }

  if (temperatureC >= 75) {
    return {
      label: "WARNING",
      color: "orange",
    };
  }

  if (temperatureC >= 65) {
    return {
      label: "WARM",
      color: "yellow",
    };
  }

  return {
    label: "NORMAL",
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
  const telemetry =
    status as ExtendedDccExStatus | null;

  const hub =
    telemetry?.hub;

  const dccAlive =
    wsStatus === "connected" &&
    Boolean(telemetry?.alive);

  const target =
    telemetry?.host
      ? `${telemetry.host}:${telemetry.port ?? 2560}`
      : "—";

  const dccVersion =
    telemetry?.version
      ? `V-${telemetry.version}`
      : "—";

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
                DCC-EX / EX-CSB1
              </Text>

              <Badge
                color={dccAlive ? "green" : "red"}
                variant={dccAlive ? "light" : "filled"}
              >
                {dccAlive ? "ONLINE" : "OFFLINE"}
              </Badge>
            </Group>

            <InfoRow
              label="Target"
              value={target}
              color="cyan"
            />

            <InfoRow
              label="DCC-EX version"
              value={dccVersion}
              color="violet"
            />

            <InfoRow
              label="Processor"
              value={telemetry?.processor || "—"}
              color="indigo"
            />

            <InfoRow
              label="Motor driver"
              value={telemetry?.hardware || "—"}
              color="cyan"
            />

            <InfoRow
              label="Build"
              value={telemetry?.build || "—"}
              color="gray"
            />

            <InfoRow
              label="Max loco slots"
              value={
                telemetry?.maxLocos
                  ? String(telemetry.maxLocos)
                  : "—"
              }
              color="blue"
            />

            <InfoRow
              label="Track power"
              value={
                telemetry?.trackVoltageOn
                  ? "ON"
                  : "OFF"
              }
              color={
                telemetry?.trackVoltageOn
                  ? "green"
                  : "red"
              }
            />

            {tracks.length > 0 && (
              <InfoRow
                label="Total track current"
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
                label={`Track ${track.letter} · ${track.mode}`}
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
                Waiting for DCC-EX TrackManager/current telemetry…
              </Text>
            )}

            <InfoRow
              label="TCP link uptime"
              value={formatUptime(
                telemetry?.linkUptimeMs,
              )}
              color="teal"
            />

            <Text size="xs" c="dimmed">
              Track current is requested from DCC-EX every 1000 ms. The value after “/” is the current trip limit. DCC-EX exposes current per track output, not per individual decoder. Remote RAM, CPU load and chip temperature are not standard native telemetry, so they are intentionally not invented here.
            </Text>
          </Stack>
        </Card>

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
                  ? "WS ONLINE"
                  : `WS ${wsStatus.toUpperCase()}`}
              </Badge>
            </Group>

            <InfoRow
              label="Hub version"
              value={`v${version}`}
              color="violet"
            />

            <InfoRow
              label="Hostname"
              value={hub?.hostname || "—"}
              color="gray"
            />

            <InfoRow
              label="Hub IP"
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
              label="Processor"
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
              label="CPU core 0"
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
              label="CPU core 1"
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
              label="Chip temperature"
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
              label="Uptime"
              value={formatUptime(
                hub?.uptimeMs,
              )}
              color="teal"
            />

            <InfoRow
              label="Heap free / total"
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
              label="Minimum free heap"
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
              label="Largest free block"
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

            {(hub?.psramSizeBytes ?? 0) > 0 && (
              <InfoRow
                label="PSRAM free / total"
                value={`${formatBytes(
                  hub?.freePsramBytes,
                )} / ${formatBytes(
                  hub?.psramSizeBytes,
                )}`}
                color="indigo"
              />
            )}

            <InfoRow
              label="WebSocket clients"
              value={
                hub?.wsClients !== undefined
                  ? String(hub.wsClients)
                  : "—"
              }
              color="cyan"
            />

            <InfoRow
              label="Runtime objects"
              value={
                hub?.runtimeAccessories !== undefined &&
                hub?.runtimeSensors !== undefined
                  ? `${hub.runtimeAccessories} accessories · ${hub.runtimeSensors} sensors`
                  : "—"
              }
              color="blue"
            />

            <InfoRow
              label="Flash chip"
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
              label="LittleFS data"
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
              label="LittleFS free"
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
              label="Reset reason"
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
