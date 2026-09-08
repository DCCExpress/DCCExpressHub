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
  | "z21"
  | string;

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
  defaultPort: number;
  connected: boolean;
  capabilities: CommandCenterCapabilities;
  message?: string;
};

type CommandCenterConfigDto = {
  ok: boolean;
  host: string;
  port: number;
  powerIncludesProgramming: boolean;
  connected: boolean;
  message?: string;
};

type CommandCenterTestDto = {
  ok: boolean;

  // Legacy backend field names. For Z21 these mean transport/session
  // reachability even though the transport is UDP rather than TCP.
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

export default function CommandCenterSettingsDialog(
  props: Props,
) {
  const {
    opened,
    onClose,
  } = props;

  const [info, setInfo] =
    useState<CommandCenterInfoDto | null>(
      null,
    );

  const [host, setHost] =
    useState("");

  const [port, setPort] =
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

  const commandCenterName =
    info?.name ??
    "Command center";

  const transportLabel =
    isZ21
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
              `Could not load command-center settings (HTTP ${configResponse.status}).`,
            );
          }

          const loadedInfo =
            await infoResponse.json() as
              CommandCenterInfoDto;

          const config =
            await configResponse.json() as
              CommandCenterConfigDto;

          setInfo(
            loadedInfo,
          );

          setHost(
            config.host,
          );

          setPort(
            String(
              config.port,
            ),
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
      [],
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
    | {
        host: string;
        port: number;
      }
    | null {
    const cleanHost =
      host.trim();

    const numericPort =
      Number(port);

    if (!cleanHost) {
      setError(
        "IP address / hostname is required.",
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
        "Port must be between 1 and 65535.",
      );

      return null;
    }

    return {
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
          "Invalid connection settings.",
      });

      return;
    }

    setTesting(true);
    setError("");
    setTestResult(null);

    try {
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
            `Invalid test response (HTTP ${response.status}).`,
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
              formBody({
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
              }),
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

      showNotification({
        color:
          "green",

        title:
          `${commandCenterName} settings saved`,

        message:
          `${endpoint.host}:${endpoint.port}`,
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
          isZ21
            ? "Press TEST to verify the Z21 UDP session."
            : "Press TEST to verify TCP connectivity and the DCC-EX <#> reply.";

        let reply =
          "Reply: —";

        let elapsed =
          "Elapsed: —";

        if (testing) {
          title =
            `Testing ${commandCenterName} connection...`;

          message =
            `Checking ${host.trim() || "host"}:${port || "port"}`;

          reply =
            isZ21
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
              isZ21
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
                  isZ21
                    ? "The configured endpoint answered the Z21 system-state query."
                    : "The configured endpoint answered the DCC-EX <#> query."
                )
                : (
                  isZ21
                    ? "No valid Z21 system-state reply was received."
                    : "No valid DCC-EX <#> reply was received."
                )
            );

          reply =
            `Reply: ${testResult.reply ?? "—"}`;

          elapsed =
            testResult.elapsedMs ===
            undefined
              ? "Elapsed: —"
              : `Elapsed: ${testResult.elapsedMs} ms`;
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
        isZ21,
        port,
        testResult,
        testing,
      ],
    );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`${commandCenterName} connection`}
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
            >
              Current connection
            </Text>

            {
              info && (
                <Text
                  size="xs"
                  c="dimmed"
                >
                  Firmware: {info.name} ({info.type})
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
                ? "ONLINE"
                : "OFFLINE"
            }
          </Badge>
        </Group>

        <TextInput
          label="IP address / hostname"
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
              label="POWER button also controls the PROG track"
              description={
                powerIncludesProgramming
                  ? "POWER ON/OFF controls MAIN + PROG."
                  : "POWER ON/OFF controls MAIN only; PROG remains independent."
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
          >
            TEST
          </Button>

          <Group gap="xs">
            <Button
              variant="subtle"
              color="gray"
              onClick={onClose}
              disabled={
                saving ||
                testing
              }
            >
              Cancel
            </Button>

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
            >
              SAVE
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
