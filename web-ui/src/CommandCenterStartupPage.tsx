import { useCallback, useEffect, useState } from "react";
import {
  Alert, Badge, Button, Card, Group, Loader, NumberInput,
  Select, Stack, Switch, Text, TextInput, Title
} from "@mantine/core";
import { IconDeviceFloppy, IconPlugConnected, IconRefresh, IconTrain } from "@tabler/icons-react";

type Vendor = "dcc-ex" | "roco-z21" | "yamorc-yd7010" | "loconet";
type Transport = "tcp" | "serial" | "z21" | "loconet" | "loconet-serial";

type Settings = {
  vendor: Vendor;
  transport: Transport;
  tcpHost: string;
  tcpPort: number;
  serialPort: string;
  rBusOffset: number;
  locoNetOffset: number;
  useLocoNet: boolean;
  commandIntervalMs: number;
};

const defaultSettings: Settings = {
  vendor: "dcc-ex", transport: "tcp", tcpHost: "127.0.0.1",
  tcpPort: 2560, serialPort: "", rBusOffset: 0,
  locoNetOffset: 0, useLocoNet: true, commandIntervalMs: 25
};

const vendors: { value: Vendor; label: string }[] = [
  { value: "dcc-ex", label: "DCC-EX CommandStation" },
  { value: "roco-z21", label: "Roco Z21" },
  { value: "yamorc-yd7010", label: "YaMoRC YD7010" },
  { value: "loconet", label: "LocoNet (Digitrax-compatible)" }
];

type Result = { ok: boolean; message?: string; started?: boolean; config?: Partial<Settings> };

const isSerial = (t: Transport) => t === "serial" || t === "loconet-serial";

export default function CommandCenterStartupPage({ onStarted }: { onStarted: () => void }) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [ports, setPorts] = useState<string[]>([]);

  const update = (value: Partial<Settings>) => setSettings(previous => ({ ...previous, ...value }));

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/command-center/startup", { cache: "no-store" });
      if (!response.ok) throw new Error("Cannot load command-center configuration.");
      const data = await response.json() as Result;
      if (data.config) setSettings(previous => ({ ...previous, ...data.config }));
      setReady(true);
    } catch (err) {
      setResult({ ok: false, message: String(err) });
      setReady(true);
    }
  }, []);

  const loadPorts = useCallback(async () => {
    try {
      const response = await fetch("/api/external-devices/ports", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { ports?: string[] };
      setPorts(data.ports ?? []);
    } catch { /* Manual COM/tty path input remains available. */ }
  }, []);

  useEffect(() => {
    void load();
    void loadPorts();
  }, [load, loadPorts]);

  const changeVendor = (value: string | null) => {
    if (!value) return;
    const vendor = value as Vendor;
    const transport: Transport = vendor === "dcc-ex" ? "tcp" :
      vendor === "loconet" ? "loconet" : "z21";
    const tcpPort = vendor === "dcc-ex" ? 2560 :
      vendor === "loconet" ? 1234 : 21105;
    update({
      vendor, transport, tcpPort,
      // Avoid colliding with R-BUS 1–160 on a newly selected YaMoRC.
      // Previously saved offsets are preserved when loading this page.
      ...(vendor === "yamorc-yd7010" && settings.vendor !== vendor &&
          settings.locoNetOffset === 0
        ? { locoNetOffset: Math.min(settings.rBusOffset + 160, 61439) }
        : {})
    });
    setResult(null);
  };

  const body = (kind?: string) => {
    const values: Record<string, string> = {
      vendor: settings.vendor,
      transport: settings.transport,
      host: settings.tcpHost,
      port: String(settings.tcpPort),
      serialPort: settings.serialPort,
      rBusOffset: String(settings.rBusOffset),
      locoNetOffset: String(settings.locoNetOffset),
      useLocoNet: String(settings.useLocoNet),
      commandIntervalMs: String(settings.commandIntervalMs)
    };
    if (kind) values.kind = kind;
    return new URLSearchParams(values);
  };

  const run = async (action: "start" | "test", kind?: string) => {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/command-center/startup/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body(kind)
      });
      const data = await response.json() as Result;
      if (!response.ok || !data.ok) throw new Error(data.message ?? "Command-center operation failed.");
      if (action === "start") {
        onStarted(); // Core and WebSocket were already running; start the physical driver now.
      } else {
        setResult({ ok: true, message: data.message ?? "Connection test successful." });
      }
    } catch (err) {
      setResult({ ok: false, message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const serial = isSerial(settings.transport);
  const z21 = settings.vendor === "roco-z21" || settings.vendor === "yamorc-yd7010";
  const yamorc = settings.vendor === "yamorc-yd7010";

  if (!ready) return <Group justify="center" p="xl"><Loader /></Group>;

  return (
    <Stack p="md" gap="lg" maw={880} mx="auto">
      <Group gap="md">
        <IconTrain size={36} />
        <div>
          <Title order={2}>DCCExpressHub</Title>
          <Text c="dimmed">Command Center Configuration</Text>
        </div>
        <Badge ml="auto" variant="light">Disconnected until OK</Badge>
      </Group>

      <Card withBorder radius="lg" p="lg">
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Select or edit a command center, test its connection and click OK to enter the Hub.
            Your last settings are restored, but hardware is never connected automatically at startup.
          </Text>
          <Select
            label="Command center" data={vendors} value={settings.vendor}
            onChange={changeVendor} allowDeselect={false} required
          />
          {(settings.vendor === "dcc-ex" || settings.vendor === "loconet") && (
            <Select
              label="Transport" allowDeselect={false}
              data={settings.vendor === "dcc-ex"
                ? [{ value: "tcp", label: "TCP / Ethernet" }, { value: "serial", label: "USB / Serial" }]
                : [{ value: "loconet", label: "LocoNet TCP" }, { value: "loconet-serial", label: "LocoNet Serial" }]}
              value={settings.transport}
              onChange={value => { if (value) update({ transport: value as Transport }); }}
            />
          )}
          {serial ? (
            <Group align="end" gap="sm">
              <TextInput
                label="Serial port (COM / tty)" placeholder="COM3 or /dev/ttyUSB0"
                value={settings.serialPort}
                onChange={event => update({ serialPort: event.currentTarget.value })}
                style={{ flex: 1 }}
                list="cc-serial-ports"
              />
              <datalist id="cc-serial-ports">
                {ports.map(name => <option key={name} value={name} />)}
              </datalist>
              <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={() => void loadPorts()}>Ports</Button>
            </Group>
          ) : (
            <Group grow align="start">
              <TextInput
                label="IP address / hostname" value={settings.tcpHost}
                onChange={event => update({ tcpHost: event.currentTarget.value })}
                required
              />
              <NumberInput
                label={z21 ? "UDP port" : "TCP port"}
                value={settings.tcpPort} min={1} max={65535} allowDecimal={false}
                onChange={value => update({ tcpPort: Number(value) || 0 })}
              />
            </Group>
          )}

          {z21 && <NumberInput
            label="R-BUS sensor offset" value={settings.rBusOffset}
            min={0} max={65375} allowDecimal={false}
            onChange={value => update({ rBusOffset: Number(value) || 0 })}
          />}

          {yamorc && <>
            <Switch label="Enable YaMoRC LocoNet sensor feedback"
              checked={settings.useLocoNet}
              onChange={event => update({ useLocoNet: event.currentTarget.checked })}
            />
            {settings.useLocoNet && <NumberInput
              label="LocoNet sensor offset" min={0} max={61439}
              value={settings.locoNetOffset} allowDecimal={false}
              onChange={value => update({ locoNetOffset: Number(value) || 0 })}
            />}
          </>}

          {settings.vendor === "dcc-ex" && <NumberInput
            label="DCC command interval (ms)" value={settings.commandIntervalMs}
            min={0} max={1000} allowDecimal={false}
            onChange={value => update({ commandIntervalMs: Number(value) || 0 })}
          />}

          {result && <Alert color={result.ok ? "teal" : "red"}>{result.message}</Alert>}

          <Group justify="space-between">
            <Group gap="sm">
              <Button variant="light" disabled={busy} leftSection={<IconPlugConnected size={18} />}
                onClick={() => void run("test")}>Test connection</Button>
              {yamorc && settings.useLocoNet && (
                <Button variant="light" disabled={busy} onClick={() => void run("test", "loconet")}>Test LocoNet</Button>
              )}
            </Group>
            <Button loading={busy} leftSection={<IconDeviceFloppy size={18} />}
              onClick={() => void run("start")}>OK · Save &amp; Connect</Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
