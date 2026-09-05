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
  useState,
} from "react";

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
  const body = new URLSearchParams();

  Object.entries(values).forEach(
    ([key, value]) => {
      body.set(key, value);
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

  const [host, setHost] = useState("");
  const [port, setPort] = useState("2560");
  const [
    powerIncludesProgramming,
    setPowerIncludesProgramming,
  ] = useState(true);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [
    testResult,
    setTestResult,
  ] = useState<CommandCenterTestDto | null>(null);
  const [error, setError] = useState("");

  const loadConfig = useCallback(
    async () => {
      setLoading(true);
      setError("");
      setTestResult(null);

      try {
        const response = await fetch(
          "/api/command-center-config",
          {
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error(
            `Could not load EX-CSB1 settings (HTTP ${response.status}).`,
          );
        }

        const config =
          await response.json() as CommandCenterConfigDto;

        setHost(config.host);
        setPort(String(config.port));
        setPowerIncludesProgramming(
          config.powerIncludesProgramming,
        );
        setConnected(config.connected);
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
    const cleanHost = host.trim();
    const numericPort = Number(port);

    if (!cleanHost) {
      setError(
        "IP address / hostname is required.",
      );
      return null;
    }

    if (
      !Number.isInteger(numericPort) ||
      numericPort < 1 ||
      numericPort > 65535
    ) {
      setError(
        "Port must be between 1 and 65535.",
      );
      return null;
    }

    return {
      host: cleanHost,
      port: numericPort,
    };
  }

  async function testConnection(): Promise<void> {
    const endpoint = validatedEndpoint();

    if (!endpoint) {
      setTestResult({
        ok: false,
        tcpConnected: false,
        dccExAlive: false,
        message: "Invalid connection settings.",
      });
      return;
    }

    setTesting(true);
    setError("");
    setTestResult(null);

    try {
      const response = await fetch(
        "/api/command-center-test",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: formBody({
            host: endpoint.host,
            port: String(endpoint.port),
          }),
        },
      );

      let result: CommandCenterTestDto;

      try {
        result =
          await response.json() as CommandCenterTestDto;
      } catch {
        result = {
          ok: false,
          tcpConnected: false,
          dccExAlive: false,
          message:
            `Invalid test response (HTTP ${response.status}).`,
        };
      }

      setTestResult(result);
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

  async function saveConfig(): Promise<void> {
    const endpoint = validatedEndpoint();

    if (!endpoint) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        "/api/command-center-config",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: formBody({
            host: endpoint.host,
            port: String(endpoint.port),
            powerIncludesProgramming:
              powerIncludesProgramming
                ? "true"
                : "false",
          }),
        },
      );

      const result =
        await response.json() as CommandCenterConfigDto;

      if (
        !response.ok ||
        !result.ok
      ) {
        throw new Error(
          result.message ??
            "Could not save EX-CSB1 settings.",
        );
      }

      setConnected(result.connected);

      showNotification({
        color: "green",
        title: "EX-CSB1 settings saved",
        message:
          `${endpoint.host}:${endpoint.port} · ` +
          (
            powerIncludesProgramming
              ? "POWER controls MAIN + PROG"
              : "POWER controls MAIN only"
          ),
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

  let testColor = "gray";
  let testTitle = "Connection test";
  let testMessage =
    "Press TEST to verify TCP connectivity and the DCC-EX <#> reply.";
  let testReply = "Reply: —";
  let testElapsed = "Elapsed: —";

  if (testing) {
    testColor = "gray";
    testTitle = "Testing EX-CSB1 connection...";
    testMessage =
      `Checking ${host.trim() || "host"}:${port || "port"}`;
    testReply = "Waiting for DCC-EX reply...";
  } else if (testResult) {
    if (testResult.dccExAlive) {
      testColor = "green";
      testTitle = "DCC-EX connection OK";
    } else {
      testColor = "red";
      testTitle =
        testResult.tcpConnected
          ? "TCP connected, but no DCC-EX reply"
          : "EX-CSB1 connection failed";
    }

    testMessage =
      testResult.message ??
      (
        testResult.dccExAlive
          ? "The configured endpoint answered the DCC-EX <#> query."
          : "No valid DCC-EX <#> reply was received."
      );

    testReply =
      `Reply: ${testResult.reply ?? "—"}`;

    testElapsed =
      testResult.elapsedMs === undefined
        ? "Elapsed: —"
        : `Elapsed: ${testResult.elapsedMs} ms`;
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="EX-CSB1 connection"
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
          height: 570,
          maxHeight: 570,
        },
        body: {
          height: "calc(100% - 60px)",
          overflow: "hidden",
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
          <Text
            size="sm"
            c="dimmed"
          >
            Current connection
          </Text>

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
          placeholder="192.168.1.143"
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
          label="DCC-EX TCP port"
          placeholder="2560"
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

        <Alert
          color={testColor}
          variant="light"
          style={{
            height: 132,
            overflowY: "auto",
            flexShrink: 0,
          }}
        >
          <Stack gap={4}>
            <Text
              size="sm"
              fw={700}
            >
              {testTitle}
            </Text>

            <Text size="xs">
              {testMessage}
            </Text>

            <Text
              size="xs"
              ff="monospace"
            >
              {testReply}
            </Text>

            <Text
              size="xs"
              c="dimmed"
            >
              {testElapsed}
            </Text>
          </Stack>
        </Alert>

        <Text
          size="xs"
          c="red"
          style={{
            height: 34,
            overflowY: "auto",
            flexShrink: 0,
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
