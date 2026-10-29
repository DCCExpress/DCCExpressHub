import { Alert, Badge, Button, Card, Divider, Group, NumberInput, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { useState } from "react";

type HandheldSettings = {
  enabled: boolean;
  name: string;
  udpPort: number;
};
const STORAGE_KEY = "dccexpress.z21-handheld.settings.v1";
const DEFAULTS: HandheldSettings = { enabled: false, name: "Z21 WLANMAUS", udpPort: 21105 };

function readSettings(): HandheldSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const value = JSON.parse(raw) as Partial<HandheldSettings>;
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULTS.enabled,
      name: typeof value.name === "string" ? value.name : DEFAULTS.name,
      udpPort: typeof value.udpPort === "number" && Number.isInteger(value.udpPort)
        ? value.udpPort : DEFAULTS.udpPort,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export default function ExternalDevicesPage({ onBack }: {
  onBack: () => void;
  onDiagnostics: () => void;
}) {
  const [settings, setSettings] = useState<HandheldSettings>(readSettings);
  const [saved, setSaved] = useState(false);
  const valid = settings.name.trim().length > 0
    && Number.isInteger(settings.udpPort)
    && settings.udpPort >= 1 && settings.udpPort <= 65535;

  const save = () => {
    if (!valid) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  };

  return <Stack gap="md" p="md">
    <Group justify="space-between" align="center">
      <div>
        <Title order={2}>External Devices</Title>
        <Text c="dimmed" size="sm">
          Configure external handheld controllers connected to DCCExpressHub.
        </Text>
      </div>
      <Button variant="subtle" onClick={onBack}>Back to Home</Button>
    </Group>

    <Card withBorder radius="md" p="lg">
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Title order={4}>Z21 Handheld Controller</Title>
            <Text c="dimmed" size="sm">ROCO WLANMAUS · Z21 LAN protocol</Text>
          </div>
          <Badge color="yellow" variant="light">Planned</Badge>
        </Group>
        <Alert color="blue" title="Z21 server integration">
          This page prepares the handheld controller settings. The Z21 UDP server is not
          implemented yet. Saving these settings does not start a listener or connect a handset.
        </Alert>
        <Switch
          label="Enable Z21 handheld support"
          description="Saved as a preference only until the Z21 server runtime is available."
          checked={settings.enabled}
          onChange={event => { setSettings(old => ({ ...old, enabled: event.currentTarget.checked })); setSaved(false); }}
        />
        <TextInput
          label="Device name"
          value={settings.name}
          onChange={event => { setSettings(old => ({ ...old, name: event.currentTarget.value })); setSaved(false); }}
        />
        <NumberInput
          label="Z21 server UDP port"
          description="Default: 21105. The handheld will connect to the HUB computer's IP address."
          min={1} max={65535} clampBehavior="strict"
          value={settings.udpPort}
          onChange={value => { setSettings(old => ({ ...old, udpPort: typeof value === "number" ? value : 0 })); setSaved(false); }}
        />
        <Divider />
        <Text size="sm" c="dimmed">
          Planned behavior: the HUB will accept Z21 LAN commands from a WLANMAUS and
          forward locomotive, turnout and emergency-stop operations to the shared runtime.
          This will be independent of the selected physical command center.
        </Text>
        <Group justify="flex-end">
          {saved && <Text c="teal" size="sm">Draft settings saved in this browser.</Text>}
          <Button onClick={save} disabled={!valid}>Save draft</Button>
        </Group>
      </Stack>
    </Card>
  </Stack>;
}
