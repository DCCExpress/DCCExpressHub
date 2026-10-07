import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconDeviceFloppy,
  IconPlugConnected,
} from "@tabler/icons-react";
import {
  showNotification,
} from "@mantine/notifications";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type CommandCenterType =
  | "dcc-ex"
  | "dcc-ex-tcp"
  | "dcc-ex-serial"
  | "z21"
  | string;

type CommandCenterTransport =
  | "tcp"
  | "serial";

type CommandCenterCapabilities = {
  trackPower: boolean;
  programmingTrackPower: boolean;
  rawCommand: boolean;
  vPin: boolean;
  extendedAccessory: boolean;
  currentTelemetry: boolean;
  trackConfiguration: boolean;
  locomotiveControl: boolean;
  locomotiveFunctions: boolean;
  turnoutControl: boolean;
  basicAccessory: boolean;
  signalAspect: boolean;
  locoNet?: boolean;
};

type CommandCenterInfoDto = {
  ok: boolean;
  type: CommandCenterType;
  name: string;
  transport?: string;
  defaultPort: number;
  defaultBaudRate?: number;
  connected: boolean;
  host?: string;
  port?: number;
  serialPort?: string;
  baudRate?: number;
  capabilities: CommandCenterCapabilities;
  message?: string;
};

type CommandCenterConfigDto = {
  ok: boolean;
  transport?: string;
  host: string;
  port: number;
  serialPort?: string;
  baudRate?: number;
  powerIncludesProgramming: boolean;
  commandIntervalMs?: number;
  rBusOffset?: number;
  rBusOffsetConfigurable?: boolean;
  connected: boolean;
  message?: string;
};

type CommandCenterTestDto = {
  ok: boolean;

  // Kept for compatibility with the existing TCP/Z21 probe endpoint.
  tcpConnected: boolean;
  dccExAlive: boolean;

  reply?: string;
  elapsedMs?: number;
  message?: string;
};

type LocoNetTestDto = {
  ok: boolean;
  tcpConnected: boolean;
  host?: string;
  port?: number;
  reply?: string;
  elapsedMs?: number;
  backgroundConnected?: boolean;
  lbServerVersion?: string;
  lbServerLinesObserved?: number;
  message?: string;
};

type Props = {
  opened: boolean;
  onClose: () => void;
};

type Endpoint =
  | {
      transport: "tcp";
      host: string;
      port: number;
    }
  | {
      transport: "serial";
      serialPort: string;
    };

function formBody(
  values: Record<string, string>,
): URLSearchParams {
  const body =
    new URLSearchParams();

  Object.entries(values).forEach(
    ([key, value]) => {
      body.set(
        key,
        value,
      );
    },
  );

  return body;
}

function normalizeTransport(
  value: string | null | undefined,
  type: CommandCenterType | null | undefined,
): CommandCenterTransport {
  if (
    value?.toLowerCase() === "serial" ||
    type === "dcc-ex-serial"
  ) {
    return "serial";
  }

  return "tcp";
}

export default function CommandCenterSettingsDialog(
  props: Props,
) {
  useTranslation();
  const {
    opened,
    onClose,
  } = props;

  const [info, setInfo] =
    useState<CommandCenterInfoDto | null>(
      null,
    );

  const [transport, setTransport] =
    useState<CommandCenterTransport>(
      "tcp",
    );

  const [host, setHost] =
    useState("");

  const [port, setPort] =
    useState("");

  const [serialPort, setSerialPort] =
    useState("");

  const [
    powerIncludesProgramming,
    setPowerIncludesProgramming,
  ] = useState(true);

  const [
    commandIntervalMs,
    setCommandIntervalMs,
  ] = useState(25);

  const [
    rBusOffset,
    setRBusOffset,
  ] = useState(0);

  const [
    rBusOffsetConfigurable,
    setRBusOffsetConfigurable,
  ] = useState(false);

  const [connected, setConnected] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [testing, setTesting] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [
    testResult,
    setTestResult,
  ] =
    useState<CommandCenterTestDto | null>(
      null,
    );

  const [
    locoNetTesting,
    setLocoNetTesting,
  ] =
    useState(false);

  const [
    locoNetTestResult,
    setLocoNetTestResult,
  ] =
    useState<LocoNetTestDto | null>(
      null,
    );

  const [error, setError] =
    useState("");

  const isZ21 =
    info?.type ===
    "z21";

  const isSerial =
    transport ===
    "serial";

  const hasLocoNet =
    info?.capabilities
      .locoNet === true;

  const commandCenterName =
    info?.name ??
    "Command center";

  const transportLabel =
    isSerial
      ? "COM port"
      : isZ21
        ? "Z21 UDP port"
        : "DCC-EX TCP port";

  const defaultPortPlaceholder =
    String(
      info?.defaultPort ??
        (
          isZ21
            ? 21105
            : 2560
        ),
    );

  const serialBaudRate =
    info?.defaultBaudRate ??
    info?.baudRate ??
    115200;

  const loadConfig =
    useCallback(
      async () => {
        setLoading(true);
        setError("");
        setTestResult(null);
        setLocoNetTestResult(null);

        try {
          const [
            infoResponse,
            configResponse,
          ] =
            await Promise.all([
              fetch(
                "/api/command-center-info",
                {
                  cache:
                    "no-store",
                },
              ),
              fetch(
                "/api/command-center-config",
                {
                  cache:
                    "no-store",
                },
              ),
            ]);

          if (!infoResponse.ok) {
            throw new Error(
              `Could not load command-center capabilities (HTTP ${infoResponse.status}).`,
            );
          }

          if (!configResponse.ok) {
            throw new Error(
              i18next.t("ui.couldNotLoadCommandCenterSettingsHttp", { value1: configResponse.status }),
            );
          }

          const loadedInfo =
            await infoResponse.json() as
              CommandCenterInfoDto;

          const config =
            await configResponse.json() as
              CommandCenterConfigDto;

          const loadedTransport =
            normalizeTransport(
              config.transport ??
                loadedInfo.transport,
              loadedInfo.type,
            );

          setInfo(
            loadedInfo,
          );

          setTransport(
            loadedTransport,
          );

          setHost(
            config.host ?? "",
          );

          setPort(
            config.port > 0
              ? String(config.port)
              : "",
          );

          setSerialPort(
            config.serialPort ??
              loadedInfo.serialPort ??
              "",
          );

          setPowerIncludesProgramming(
            loadedInfo
              .capabilities
              .programmingTrackPower
              ? config
                  .powerIncludesProgramming
              : false,
          );

          setCommandIntervalMs(
            Number.isInteger(
              config.commandIntervalMs,
            )
              ? Math.max(
                  0,
                  Math.min(
                    1000,
                    config.commandIntervalMs ?? 25,
                  ),
                )
              : 25,
          );

          setRBusOffsetConfigurable(
            config.rBusOffsetConfigurable === true,
          );

          setRBusOffset(
            Number.isInteger(
              config.rBusOffset,
            )
              ? Math.max(
                  0,
                  Math.min(
                    65375,
                    config.rBusOffset ?? 0,
                  ),
                )
              : 0,
          );

          setConnected(
            config.connected,
          );
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : String(cause),
          );
        } finally {
          setLoading(false);
        }
      },
      [i18next.resolvedLanguage, ],
    );

  useEffect(
    () => {
      if (opened) {
        void loadConfig();
      }
    },
    [
      opened,
      loadConfig,
    ],
  );

  function validatedEndpoint():
    Endpoint | null {
    if (isSerial) {
      const cleanSerialPort =
        serialPort.trim();

      if (!cleanSerialPort) {
        setError(
          "COM port is required.",
        );

        return null;
      }

      return {
        transport:
          "serial",
        serialPort:
          cleanSerialPort,
      };
    }

    const cleanHost =
      host.trim();

    const numericPort =
      Number(port);

    if (!cleanHost) {
      setError(
        i18next.t("ui.ipAddressHostnameIsRequired"),
      );

      return null;
    }

    if (
      !Number.isInteger(
        numericPort,
      ) ||
      numericPort < 1 ||
      numericPort > 65535
    ) {
      setError(
        i18next.t("ui.portMustBeBetween1And65535"),
      );

      return null;
    }

    return {
      transport:
        "tcp",
      host:
        cleanHost,
      port:
        numericPort,
    };
  }

  async function testConnection():
    Promise<void> {
    const endpoint =
      validatedEndpoint();

    if (!endpoint) {
      setTestResult({
        ok: false,
        tcpConnected: false,
        dccExAlive: false,
        message:
          i18next.t("ui.invalidConnectionSettings"),
      });

      return;
    }

    setTesting(true);
    setError("");
    setTestResult(null);

    try {
      if (
        endpoint.transport ===
        "serial"
      ) {
        /*
         * The backend owns the COM port, therefore the browser must not try
         * to open the same port a second time. Read the authoritative live
         * command-station state instead.
         */
        const response =
          await fetch(
            "/api/command-center-config",
            {
              cache:
                "no-store",
            },
          );

        const config =
          await response.json() as
            CommandCenterConfigDto;

        const target =
          config.serialPort ||
          endpoint.serialPort;

        setConnected(
          Boolean(
            config.connected,
          ),
        );

        setTestResult({
          ok:
            Boolean(
              config.connected,
            ),
          tcpConnected:
            Boolean(
              config.connected,
            ),
          dccExAlive:
            Boolean(
              config.connected,
            ),
          message:
            config.connected
              ? `DCC-EX connected on ${target} @ ${config.baudRate || serialBaudRate} baud.`
              : `DCC-EX is not connected on ${target} @ ${config.baudRate || serialBaudRate} baud.`,
        });

        return;
      }

      const response =
        await fetch(
          "/api/command-center-test",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded;charset=UTF-8",
            },

            body:
              formBody({
                host:
                  endpoint.host,

                port:
                  String(
                    endpoint.port,
                  ),
              }),
          },
        );

      let result:
        CommandCenterTestDto;

      try {
        result =
          await response.json() as
            CommandCenterTestDto;
      } catch {
        result = {
          ok: false,
          tcpConnected: false,
          dccExAlive: false,
          message:
            i18next.t("ui.invalidTestResponseHttp", { value1: response.status }),
        };
      }

      setTestResult(
        result,
      );
    } catch (cause) {
      setTestResult({
        ok: false,
        tcpConnected: false,
        dccExAlive: false,
        message:
          cause instanceof Error
            ? cause.message
            : String(cause),
      });
    } finally {
      setTesting(false);
    }
  }

  async function testLocoNetConnection():
    Promise<void> {
    const cleanHost =
      host.trim();

    if (!cleanHost) {
      setLocoNetTestResult({
        ok: false,
        tcpConnected: false,
        message:
          i18next.t("ui.ipAddressHostnameIsRequired"),
      });

      return;
    }

    setLocoNetTesting(true);
    setError("");
    setLocoNetTestResult(null);

    try {
      const response =
        await fetch(
          "/api/command-center-loconet-test",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded;charset=UTF-8",
            },

            body:
              formBody({
                host:
                  cleanHost,
              }),
          },
        );

      let result:
        LocoNetTestDto;

      try {
        result =
          await response.json() as
            LocoNetTestDto;
      } catch {
        result = {
          ok: false,
          tcpConnected: false,
          message:
            i18next.t("ui.invalidTestResponseHttp", { value1: response.status }),
        };
      }

      setLocoNetTestResult(
        result,
      );
    } catch (cause) {
      setLocoNetTestResult({
        ok: false,
        tcpConnected: false,
        message:
          cause instanceof Error
            ? cause.message
            : String(cause),
      });
    } finally {
      setLocoNetTesting(false);
    }
  }

  async function saveConfig():
    Promise<void> {
    const endpoint =
      validatedEndpoint();

    if (!endpoint) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const effectivePowerIncludesProgramming =
        info?.capabilities
          .programmingTrackPower
          ? powerIncludesProgramming
          : false;

      const values:
        Record<string, string> =
        endpoint.transport ===
        "serial"
          ? {
              serialPort:
                endpoint.serialPort,

              powerIncludesProgramming:
                effectivePowerIncludesProgramming
                  ? "true"
                  : "false",

              commandIntervalMs:
                String(
                  commandIntervalMs,
                ),
            }
          : {
              host:
                endpoint.host,

              port:
                String(
                  endpoint.port,
                ),

              powerIncludesProgramming:
                effectivePowerIncludesProgramming
                  ? "true"
                  : "false",

              commandIntervalMs:
                String(
                  commandIntervalMs,
                ),
            };

      if (rBusOffsetConfigurable) {
        values.rBusOffset =
          String(
            rBusOffset,
          );
      }

      const response =
        await fetch(
          "/api/command-center-config",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded;charset=UTF-8",
            },

            body:
              formBody(
                values,
              ),
          },
        );

      const result =
        await response.json() as
          CommandCenterConfigDto;

      if (
        !response.ok ||
        !result.ok
      ) {
        throw new Error(
          result.message ??
            "Could not save command-center settings.",
        );
      }

      if (
        rBusOffsetConfigurable &&
        Number.isInteger(
          result.rBusOffset,
        )
      ) {
        setRBusOffset(
          result.rBusOffset ?? 0,
        );
      }

      setConnected(
        result.connected,
      );

      if (
        endpoint.transport ===
        "serial"
      ) {
        setSerialPort(
          result.serialPort ??
            endpoint.serialPort,
        );
      }

      showNotification({
        color:
          "green",

        title:
          i18next.t("ui.settingsSaved", { value1: commandCenterName }),

        message:
          endpoint.transport ===
          "serial"
            ? `${result.serialPort ?? endpoint.serialPort} @ ${result.baudRate || serialBaudRate} baud`
            : `${endpoint.host}:${endpoint.port}`,
      });

      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : String(cause),
      );
    } finally {
      setSaving(false);
    }
  }

  const testPresentation =
    useMemo(
      () => {
        let color =
          "gray";

        let title =
          "Connection test";

        let message =
          isSerial
            ? "Press TEST to read the backend's live DCC-EX Serial connection state."
            : isZ21
              ? "Press TEST to verify the Z21 UDP session."
              : "Press TEST to verify TCP connectivity and the DCC-EX <#> reply.";

        let reply =
          isSerial
            ? `Target: ${serialPort.trim() || "—"} @ ${serialBaudRate} baud`
            : "Reply: —";

        let elapsed =
          isSerial
            ? "The backend owns the COM port."
            : "Elapsed: —";

        if (testing) {
          title =
            `Testing ${commandCenterName} connection...`;

          message =
            isSerial
              ? `Checking ${serialPort.trim() || "COM port"} @ ${serialBaudRate} baud`
              : `Checking ${host.trim() || "host"}:${port || "port"}`;

          reply =
            isSerial
              ? "Reading backend command-station status..."
              : isZ21
                ? "Waiting for Z21 system-state reply..."
                : "Waiting for DCC-EX reply...";
        } else if (testResult) {
          if (testResult.dccExAlive) {
            color =
              "green";

            title =
              `${commandCenterName} connection OK`;
          } else {
            color =
              "red";

            title =
              isSerial
                ? "DCC-EX Serial connection failed"
                : isZ21
                  ? "Z21 connection failed"
                  : (
                    testResult.tcpConnected
                      ? "TCP connected, but no DCC-EX reply"
                      : "DCC-EX connection failed"
                  );
          }

          message =
            testResult.message ??
            (
              testResult.dccExAlive
                ? (
                  isSerial
                    ? "The backend reports the DCC-EX Serial connection online."
                    : isZ21
                      ? "The configured endpoint answered the Z21 system-state query."
                      : "The configured endpoint answered the DCC-EX <#> query."
                )
                : (
                  isSerial
                    ? "The backend reports the DCC-EX Serial connection offline."
                    : isZ21
                      ? "No valid Z21 system-state reply was received."
                      : "No valid DCC-EX <#> reply was received."
                )
            );

          if (!isSerial) {
            reply =
              `Reply: ${testResult.reply ?? "—"}`;

            elapsed =
              testResult.elapsedMs ===
              undefined
                ? "Elapsed: —"
                : `Elapsed: ${testResult.elapsedMs} ms`;
          }
        }

        return {
          color,
          title,
          message,
          reply,
          elapsed,
        };
      },
      [
        commandCenterName,
        host,
        isSerial,
        isZ21,
        port,
        serialBaudRate,
        serialPort,
        testResult,
        testing,
      ],
    );

  const locoNetPresentation =
    useMemo(
      () => {
        let color =
          "gray";

        let title =
          "LocoNet / LBServer test";

        let message =
          "Press LOCONET TEST to verify the YaMoRC LBServer service independently from Z21.";

        let reply =
          "LBServer: —";

        let elapsed =
          "Elapsed: —";

        if (locoNetTesting) {
          title =
            "Testing LocoNet / LBServer...";

          message =
            `Checking ${host.trim() || "host"}:1234`;

          reply =
            "Waiting for LBServer TCP connection...";
        } else if (locoNetTestResult) {
          color =
            locoNetTestResult.ok
              ? "green"
              : "red";

          title =
            locoNetTestResult.ok
              ? "LocoNet / LBServer connection OK"
              : "LocoNet / LBServer connection failed";

          message =
            locoNetTestResult.message ??
            (
              locoNetTestResult.ok
                ? "The YaMoRC LBServer accepted the connection."
                : "The YaMoRC LBServer did not accept the connection."
            );

          const target =
            `${(locoNetTestResult.host ?? host.trim()) || "—"}:${locoNetTestResult.port ?? 1234}`;

          const background =
            locoNetTestResult.backgroundConnected
              ? "feedback ONLINE"
              : "feedback OFFLINE";

          const version =
            locoNetTestResult.lbServerVersion?.trim() ||
            locoNetTestResult.reply?.trim() ||
            "no version";

          reply =
            `${target} · ${background} · ${version} · lines ${locoNetTestResult.lbServerLinesObserved ?? 0}`;

          elapsed =
            locoNetTestResult.elapsedMs ===
              undefined
                ? "Elapsed: —"
                : `Elapsed: ${locoNetTestResult.elapsedMs} ms`;
        }

        return {
          color,
          title,
          message,
          reply,
          elapsed,
        };
      },
      [
        host,
        locoNetTestResult,
        locoNetTesting,
      ],
    );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={i18next.t("ui.connection", { value1: commandCenterName })}
      size={500}
      centered
      closeOnClickOutside={
        !saving &&
        !testing &&
        !locoNetTesting
      }
      closeOnEscape={
        !saving &&
        !testing &&
        !locoNetTesting
      }
      styles={{
        content: {
          height:
            hasLocoNet
              ? 720
              : (
                info?.capabilities
                  .programmingTrackPower
                  ? (
                    isZ21
                      ? 570
                      : 650
                  )
                  : (
                    isZ21
                      ? (
                        rBusOffsetConfigurable
                          ? 590
                          : 500
                      )
                      : 580
                  )
              ),

          maxHeight:
            hasLocoNet
              ? 720
              : (
                info?.capabilities
                  .programmingTrackPower
                  ? (
                    isZ21
                      ? 570
                      : 650
                  )
                  : (
                    isZ21
                      ? (
                        rBusOffsetConfigurable
                          ? 590
                          : 500
                      )
                      : 580
                  )
              ),
        },

        body: {
          height:
            "calc(100% - 60px)",

          overflow:
            "hidden",
        },
      }}
    >
      <Stack
        gap="sm"
        h="100%"
      >
        <Group
          justify="space-between"
          wrap="nowrap"
        >
          <Stack
            gap={0}
          >
            <Text
              size="sm"
              c="dimmed"
            > {i18next.t("ui.currentConnection")} </Text>

            {
              info && (
                <Text
                  size="xs"
                  c="dimmed"
                > {i18next.t("ui.firmware")} {info.name} ({info.type})
                </Text>
              )
            }
          </Stack>

          <Badge
            color={
              connected
                ? "green"
                : "red"
            }
            variant="light"
          >
            {
              connected
                ? i18next.t("ui.online")
                : i18next.t("ui.offline")
            }
          </Badge>
        </Group>

        {
          isSerial ? (
            <TextInput
              label={transportLabel}
              placeholder="COM3"
              value={serialPort}
              onChange={
                event =>
                  setSerialPort(
                    event.currentTarget.value,
                  )
              }
              disabled={
                loading ||
                saving ||
                testing ||
                locoNetTesting
              }
            />
          ) : (
            <>
              <TextInput
                label={i18next.t("ui.ipAddressHostname")}
                placeholder={
                  isZ21
                    ? "192.168.0.111"
                    : "192.168.1.143"
                }
                value={host}
                onChange={
                  event =>
                    setHost(
                      event.currentTarget.value,
                    )
                }
                disabled={
                  loading ||
                  saving ||
                  testing
                }
              />

              <TextInput
                label={transportLabel}
                placeholder={
                  defaultPortPlaceholder
                }
                value={port}
                inputMode="numeric"
                onChange={
                  event =>
                    setPort(
                      event.currentTarget.value,
                    )
                }
                disabled={
                  loading ||
                  saving ||
                  testing
                }
              />
            </>
          )
        }

        {
          rBusOffsetConfigurable && (
            <NumberInput
              label="R-BUS offset"
              description="Added to raw R-BUS sensor addresses. Example: offset 1000 maps 1 → 1001."
              value={
                rBusOffset
              }
              min={0}
              max={65375}
              step={1}
              clampBehavior="strict"
              onChange={
                value =>
                  setRBusOffset(
                    typeof value ===
                      "number"
                      ? value
                      : 0,
                  )
              }
              disabled={
                loading ||
                saving ||
                testing ||
                locoNetTesting
              }
            />
          )
        }

        {
          !isZ21 && (
            <NumberInput
              label="DCC-EX command interval"
              description="Minimum spacing between queued normal commands. Emergency stop bypasses this delay."
              value={
                commandIntervalMs
              }
              min={0}
              max={1000}
              step={5}
              suffix=" ms"
              clampBehavior="strict"
              onChange={
                value =>
                  setCommandIntervalMs(
                    typeof value ===
                      "number"
                      ? value
                      : 25,
                  )
              }
              disabled={
                loading ||
                saving ||
                testing ||
                locoNetTesting
              }
            />
          )
        }

        {
          info?.capabilities
            .programmingTrackPower && (
            <Switch
              checked={
                powerIncludesProgramming
              }
              onChange={
                event =>
                  setPowerIncludesProgramming(
                    event.currentTarget.checked,
                  )
              }
              disabled={
                loading ||
                saving ||
                testing ||
                locoNetTesting
              }
              label={i18next.t("ui.powerButtonAlsoControlsTheProgTrack")}
              description={
                powerIncludesProgramming
                  ? i18next.t("ui.powerOnOffControlsMainProg")
                  : i18next.t("ui.powerOnOffControlsMainOnlyProgRemainsIndependent")
              }
            />
          )
        }

        <Alert
          color={
            testPresentation.color
          }
          variant="light"
          style={{
            height:
              132,

            overflowY:
              "auto",

            flexShrink:
              0,
          }}
        >
          <Stack gap={4}>
            <Text
              size="sm"
              fw={700}
            >
              {testPresentation.title}
            </Text>

            <Text size="xs">
              {testPresentation.message}
            </Text>

            <Text
              size="xs"
              ff="monospace"
            >
              {testPresentation.reply}
            </Text>

            <Text
              size="xs"
              c="dimmed"
            >
              {testPresentation.elapsed}
            </Text>
          </Stack>
        </Alert>

        {
          hasLocoNet && (
            <Alert
              color={
                locoNetPresentation.color
              }
              variant="light"
              style={{
                height:
                  112,

                overflowY:
                  "auto",

                flexShrink:
                  0,
              }}
            >
              <Stack gap={4}>
                <Text
                  size="sm"
                  fw={700}
                >
                  {locoNetPresentation.title}
                </Text>

                <Text size="xs">
                  {locoNetPresentation.message}
                </Text>

                <Text
                  size="xs"
                  ff="monospace"
                >
                  {locoNetPresentation.reply}
                </Text>

                <Text
                  size="xs"
                  c="dimmed"
                >
                  {locoNetPresentation.elapsed}
                </Text>
              </Stack>
            </Alert>
          )
        }

        <Text
          size="xs"
          c="red"
          style={{
            height:
              34,

            overflowY:
              "auto",

            flexShrink:
              0,
          }}
        >
          {error}
        </Text>

        <Group
          justify="space-between"
          mt="auto"
        >
          <Group gap="xs">
            <Button
              variant="light"
              color="cyan"
              leftSection={
                <IconPlugConnected
                  size={16}
                />
              }
              loading={testing}
              disabled={
                loading ||
                saving ||
                locoNetTesting
              }
              onClick={
                () => {
                  void testConnection();
                }
              }
            > {isZ21 ? "Z21 TEST" : i18next.t("ui.test")} </Button>

            {
              hasLocoNet && (
                <Button
                  variant="light"
                  color="grape"
                  leftSection={
                    <IconPlugConnected
                      size={16}
                    />
                  }
                  loading={
                    locoNetTesting
                  }
                  disabled={
                    loading ||
                    saving ||
                    testing
                  }
                  onClick={
                    () => {
                      void testLocoNetConnection();
                    }
                  }
                > LOCONET TEST </Button>
              )
            }
          </Group>

          <Group gap="xs">
            <Button
              variant="subtle"
              color="gray"
              onClick={onClose}
              disabled={
                saving ||
                testing ||
                locoNetTesting
              }
            > {i18next.t("ui.cancel")} </Button>

            <Button
              color="teal"
              leftSection={
                <IconDeviceFloppy
                  size={16}
                />
              }
              loading={saving}
              disabled={
                loading ||
                testing ||
                locoNetTesting
              }
              onClick={
                () => {
                  void saveConfig();
                }
              }
            > {i18next.t("ui.save")} </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
