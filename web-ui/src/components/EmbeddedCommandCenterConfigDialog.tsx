import {
  Alert,
  Button,
  Group,
  NumberInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconDeviceFloppy, IconServerCog } from "@tabler/icons-react";
import { showNotification } from "@mantine/notifications";
import { useCallback, useEffect, useState } from "react";

import AppModal from "@/components/common/AppModal";

type CommandCenterInfoDto = {
  ok: boolean;
  embedded?: boolean;
  profile?: string;
  name?: string;
};

type CommandCenterConfigDto = {
  ok: boolean;
  host?: string;
  port?: number;
  feedbackHost?: string;
  feedbackPort?: number;
  powerIncludesProgramming?: boolean;
  commandIntervalMs?: number;
  message?: string;
};

type Props = {
  opened: boolean;
  onClose: () => void;
};

function validPort(value: number | string): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 65535
    ? numeric
    : null;
}

export default function EmbeddedCommandCenterConfigDialog({
  opened,
  onClose,
}: Props) {
  const [info, setInfo] = useState<CommandCenterInfoDto | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState<number | string>(21105);
  const [feedbackHost, setFeedbackHost] = useState("");
  const [feedbackPort, setFeedbackPort] = useState<number | string>(1234);
  const [powerIncludesProgramming, setPowerIncludesProgramming] = useState(true);
  const [commandIntervalMs, setCommandIntervalMs] = useState(25);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isYaMoRc = info?.profile === "yamorc7010";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [infoResponse, configResponse] = await Promise.all([
        fetch("/api/command-center-info", { cache: "no-store" }),
        fetch("/api/command-center-config", { cache: "no-store" }),
      ]);

      if (!infoResponse.ok || !configResponse.ok) {
        throw new Error("Command center configuration could not be loaded.");
      }

      const loadedInfo = await infoResponse.json() as CommandCenterInfoDto;
      const config = await configResponse.json() as CommandCenterConfigDto;

      if (loadedInfo.embedded !== true) {
        throw new Error("Command center configuration is available only on the embedded Hub.");
      }

      setInfo(loadedInfo);
      setHost(config.host ?? "");
      setPort(config.port ?? 21105);
      setFeedbackHost(config.feedbackHost ?? config.host ?? "");
      setFeedbackPort(config.feedbackPort ?? 1234);
      setPowerIncludesProgramming(config.powerIncludesProgramming !== false);
      setCommandIntervalMs(
        Number.isInteger(config.commandIntervalMs)
          ? Math.max(0, Math.min(1000, config.commandIntervalMs ?? 25))
          : 25
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (opened) {
      void load();
    }
  }, [opened, load]);

  const save = async (): Promise<void> => {
    const commandPort = validPort(port);

    if (!host.trim()) {
      setError("Command center IP address or hostname is required.");
      return;
    }

    if (commandPort === null) {
      setError("Command center port must be between 1 and 65535.");
      return;
    }

    const locoNetPort = isYaMoRc ? validPort(feedbackPort) : 1234;

    if (isYaMoRc && !feedbackHost.trim()) {
      setError("LocoNet IP address or hostname is required.");
      return;
    }

    if (isYaMoRc && locoNetPort === null) {
      setError("LocoNet port must be between 1 and 65535.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const body = new URLSearchParams();
      body.set("host", host.trim());
      body.set("port", String(commandPort));
      body.set(
        "powerIncludesProgramming",
        powerIncludesProgramming ? "true" : "false"
      );
      body.set("commandIntervalMs", String(commandIntervalMs));

      if (isYaMoRc) {
        body.set("feedbackHost", feedbackHost.trim());
        body.set("feedbackPort", String(locoNetPort));
      }

      const response = await fetch(
        "/api/command-center-config",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body,
        }
      );

      let result: CommandCenterConfigDto | null = null;

      try {
        result = await response.json() as CommandCenterConfigDto;
      } catch {
        // HTTP status fallback below.
      }

      if (!response.ok || result?.ok !== true) {
        throw new Error(
          result?.message ??
          `Command center configuration could not be saved (HTTP ${response.status}).`
        );
      }

      showNotification({
        color: "teal",
        title: "Command center configuration saved",
        message: "The ESP32 Hub is rebooting with the new settings.",
      });

      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      title="Command Center Config"
      size="sm"
      centered
      draggable
    >
      <Stack gap="sm">
        {error && <Alert color="red">{error}</Alert>}

        <Group gap="xs">
          <IconServerCog size={18} />
          <Text fw={700}>{info?.name ?? "Command center"}</Text>
        </Group>

        <Text size="xs" c="dimmed">
          Settings are stored in the ESP32 Hub. Saving reboots the Hub and the new endpoints are used from the next boot.
        </Text>

        <Text fw={700} size="sm">
          {isYaMoRc ? "Z21 endpoint" : "Command center endpoint"}
        </Text>

        <TextInput
          label="IP address / hostname"
          value={host}
          disabled={loading}
          onChange={event => setHost(event.currentTarget.value)}
        />

        <NumberInput
          label={isYaMoRc ? "Z21 UDP port" : "Port"}
          value={port}
          min={1}
          max={65535}
          allowDecimal={false}
          allowNegative={false}
          disabled={loading}
          onChange={setPort}
        />

        {isYaMoRc && (
          <>
            <Text fw={700} size="sm" mt="xs">LocoNet endpoint</Text>

            <TextInput
              label="LocoNet IP address / hostname"
              value={feedbackHost}
              disabled={loading}
              onChange={event => setFeedbackHost(event.currentTarget.value)}
            />

            <NumberInput
              label="LocoNet LBServer port"
              value={feedbackPort}
              min={1}
              max={65535}
              allowDecimal={false}
              allowNegative={false}
              disabled={loading}
              onChange={setFeedbackPort}
            />
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            color="teal"
            leftSection={<IconDeviceFloppy size={16} />}
            loading={saving}
            disabled={loading}
            onClick={() => void save()}
          >
            Save & reboot
          </Button>
        </Group>
      </Stack>
    </AppModal>
  );
}
