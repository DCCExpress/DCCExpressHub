import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
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

  const [error, setError] =
    useState("");

  const isZ21 =
    info?.type ===
    "z21";

  const isSerial =
    transport ===
    "serial";

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
            };

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

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={i18next.t("ui.connection", { value1: commandCenterName })}
      size={500}
      centered
      closeOnClickOutside={
        !saving &&
        !testing
      }
      closeOnEscape={
        !saving &&
        !testing
      }
      styles={{
        content: {
          height:
            info?.capabilities
              .programmingTrackPower
              ? 570
              : 500,

          maxHeight:
            info?.capabilities
              .programmingTrackPower
              ? 570
              : 500,
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
                testing
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
                testing
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
              saving
            }
            onClick={
              () => {
                void testConnection();
              }
            }
          > {i18next.t("ui.test")} </Button>

          <Group gap="xs">
            <Button
              variant="subtle"
              color="gray"
              onClick={onClose}
              disabled={
                saving ||
                testing
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
                testing
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
