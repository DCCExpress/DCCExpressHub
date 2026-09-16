import { useTranslation } from "react-i18next";
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
                {dccAlive ? i18next.t("ui.online") : i18next.t("ui.offline")}
              </Badge>
            </Group>

            <InfoRow
              label={i18next.t("ui.target")}
              value={target}
              color="cyan"
            />

            <InfoRow
              label={i18next.t("ui.dccExVersion")}
              value={dccVersion}
              color="violet"
            />

            <InfoRow
              label={i18next.t("ui.processor")}
              value={telemetry?.processor || "—"}
              color="indigo"
            />

            <InfoRow
              label={i18next.t("ui.motorDriver")}
              value={telemetry?.hardware || "—"}
              color="cyan"
            />

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

            <InfoRow
              label={i18next.t("ui.trackPower")}
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
              <Text size="xs" c="dimmed"> {i18next.t("ui.waitingForDccExTrackmanagerCurrentTelemetry")} </Text>
            )}

            <InfoRow
              label={i18next.t("ui.tcpLinkUptime")}
              value={formatUptime(
                telemetry?.linkUptimeMs,
              )}
              color="teal"
            />

            <Text size="xs" c="dimmed"> {i18next.t("ui.trackCurrentIsRequestedFromDccExEvery1000Ms")} </Text>
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

            {(hub?.psramSizeBytes ?? 0) > 0 && (
              <InfoRow
                label={i18next.t("ui.psramFreeTotal")}
                value={`${formatBytes(
                  hub?.freePsramBytes,
                )} / ${formatBytes(
                  hub?.psramSizeBytes,
                )}`}
                color="indigo"
              />
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
