import { Alert, Badge, Button, Card, Group, NumberInput, Select, SimpleGrid, Stack, Switch, Text, Title } from "@mantine/core";
import { useCallback, useEffect, useState } from "react";

type CommandReply = { ok: boolean; message?: string; raw?: string };
const parseBits = (raw: string): number[] => {
  const lines = raw.match(/S88:\s*((?:_[01]{8}\s*){1,32})/g);
  if (!lines?.length) return [];
  const snapshot = lines.at(-1);
  if (!snapshot) return [];
  const bytes = [...snapshot.matchAll(/_([01]{8})/g)]
    .map(match => match[1])
    .filter((value): value is string => value !== undefined)
    .map(value => parseInt(value, 2));
  return bytes.flatMap(byte => Array.from({ length: 8 }, (_, bit) => (byte >> bit) & 1));
};

export default function S88AdapterPage({ onBack }: { onBack: () => void }) {
  const [ports, setPorts] = useState<string[]>([]);
  const [port, setPort] = useState<string | null>(null);
  const [bytes, setBytes] = useState<number | string>(4);
  const [address, setAddress] = useState<number | string>(48);
  const [monitor, setMonitor] = useState(false);
  const [connectedPort, setConnectedPort] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [bits, setBits] = useState<number[]>([]);
  const [updated, setUpdated] = useState<string | null>(null);

  const refreshPorts = useCallback(async () => {
    try {
      const r = await fetch("/api/s88-adapter/ports", { cache: "no-store" });
      const data = await r.json() as { ok: boolean; ports: string[] };
      setPorts(data.ports ?? []);
    } catch (e) { setMessage(String(e)); }
  }, []);

  const connectionAction = async (action: "connect" | "disconnect") => {
    if (action === "connect" && !port) return;
    setBusy(true);
    try {
      const response = await fetch("/api/s88-adapter/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(port ? { port } : {}),
      });
      const data = await response.json() as { ok: boolean; connected?: boolean; port?: string; message?: string };
      if (!response.ok || !data.ok) throw new Error(data.message ?? "Serial connection failed");
      if (action === "disconnect") {
        setMonitor(false);
        setConnectedPort(null);
        setBits([]);
        setUpdated(null);
        setStatus("");
      } else {
        setConnectedPort(data.port ?? port);
      }
      setMessage(action === "connect" ? "Connected to S88Adapter." : "Disconnected.");
    } catch (e) { setMessage("NOK: " + String(e)); }
    finally { setBusy(false); }
  };

  const command = useCallback(async (value: string) => {
    if (!port || connectedPort !== port) { setMessage("Connect to the selected S88Adapter first."); return; }
    setBusy(true);
    try {
      const form = new URLSearchParams({ port, command: value });
      const response = await fetch("/api/s88-adapter/command", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
      });
      const data = await response.json() as CommandReply;
      if (!response.ok || !data.ok) throw new Error(data.raw ?? data.message ?? "Adapter error");
      if (value === "REBOOT") { setConnectedPort(null); setMonitor(false); }
      if (value === "READ") {
        const snapshot = parseBits(data.raw ?? "");
        if (!snapshot.length) throw new Error("No valid S88 snapshot returned.");
        setBits(snapshot); setUpdated(new Date().toLocaleTimeString());
      } else {
        setStatus(data.raw ?? "");
        setMessage(value + " OK");
      }
    } catch (e) { setMessage("NOK: " + String(e)); }
    finally { setBusy(false); }
  }, [port, connectedPort]);

  useEffect(() => {
    void refreshPorts();
    void fetch("/api/s88-adapter/connection")
      .then(response => response.json())
      .then((data: { connected?: boolean; port?: string }) => {
        if (data.connected && data.port) { setPort(data.port); setConnectedPort(data.port); }
      })
      .catch(() => { /* Connection state may be unavailable while offline. */ });
  }, [refreshPorts]);
  useEffect(() => {
    if (!monitor || !port || connectedPort !== port) return;
    void command("READ");
    const id = window.setInterval(() => { void command("READ"); }, 2500);
    return () => window.clearInterval(id);
  // The chosen port/monitor toggle starts a new polling session.
  }, [monitor, port, connectedPort]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Stack gap="md" p="md">
    <Group justify="space-between">
      <div><Title order={2}>DCCExpress S88Adapter</Title><Text c="dimmed">USB serial configuration and live S88 monitor · 115200 baud</Text></div>
      <Button variant="subtle" onClick={onBack}>Back to Home</Button>
    </Group>
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group align="end"><Select label="Serial port" data={ports} value={port} onChange={setPort} disabled={!!connectedPort || busy} placeholder="Select adapter port" searchable style={{ flex: 1 }} /><Button variant="light" onClick={() => void refreshPorts()}>Refresh ports</Button><Badge color={connectedPort ? "green" : "gray"}>{connectedPort ? "Connected: " + connectedPort : "Disconnected"}</Badge></Group>
        <Text size="xs" c="dimmed">Connect to the adapter USB port, not the command-station port. Opening an Uno serial connection may reboot the adapter.</Text>
        <Group>{connectedPort ? <Button color="red" variant="light" disabled={busy} onClick={() => void connectionAction("disconnect")}>Disconnect</Button> : <Button disabled={!port || busy} onClick={() => void connectionAction("connect")}>Connect</Button>}<Button disabled={!port || connectedPort !== port || busy} onClick={() => void command("STATUS")}>STATUS</Button><Button variant="light" disabled={!port || connectedPort !== port || busy} onClick={() => void command("INFO")}>INFO</Button></Group>
      </Stack>
    </Card>
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <Card withBorder radius="md" p="md">
        <Stack gap="sm"><Title order={4}>Configuration</Title>
          <NumberInput label="I2C slave address (decimal)" min={8} max={119} value={address} onChange={setAddress} allowDecimal={false}/>
          <Button variant="light" disabled={!port || connectedPort !== port || busy || !Number.isInteger(Number(address)) || Number(address) < 8 || Number(address) > 119} onClick={() => void command("SET ADDRESS 0x" + Number(address).toString(16).toUpperCase())}>Stage address</Button>
          <NumberInput label="S88 bytes (8 inputs per byte)" min={1} max={32} value={bytes} onChange={setBytes} allowDecimal={false}/>
          <Text size="sm" c="dimmed">{Number(bytes) * 8} configured inputs</Text>
          <Button variant="light" disabled={!port || connectedPort !== port || busy || !Number.isInteger(Number(bytes)) || Number(bytes) < 1 || Number(bytes) > 32} onClick={() => void command("SET BYTES " + bytes)}>Apply byte count</Button>
          <Group><Button disabled={!port || connectedPort !== port || busy} onClick={() => void command("SAVE")}>SAVE to EEPROM</Button><Button color="orange" variant="light" disabled={!port || connectedPort !== port || busy} onClick={() => { if (window.confirm("Reboot the S88Adapter?")) void command("REBOOT"); }}>REBOOT</Button></Group>
          <Alert color="yellow">Changing the I2C address requires SAVE and REBOOT. Update the DCC-EX HAL address too. Byte count changes apply immediately; SAVE makes them persistent.</Alert>
        </Stack>
      </Card>
      <Card withBorder radius="md" p="md">
        <Stack gap="sm"><Title order={4}>Live S88 inputs</Title>
          <Group><Button variant="light" disabled={!port || connectedPort !== port || busy || monitor} onClick={() => void command("READ")}>READ snapshot</Button><Switch checked={monitor} onChange={event => setMonitor(event.currentTarget.checked)} disabled={!connectedPort || connectedPort !== port} label="Monitor (2.5 s)" /></Group>
          <Group><Badge color={bits.length ? "green" : "gray"}>{bits.length} inputs</Badge><Text size="xs" c="dimmed">{updated ? "Last snapshot: " + updated : "No snapshot yet"}</Text></Group>
          <SimpleGrid cols={{ base: 4, sm: 8 }} spacing="xs">
            {bits.map((value, index) => <Card key={index} withBorder p={6} {...(value ? { bg: "teal.8" } : {})} ta="center"><Text size="xs" fw={700}>{index + 1}</Text><Text size="xs">{value ? "ON" : "OFF"}</Text></Card>)}
          </SimpleGrid>
          <Group><Button variant="subtle" disabled={!port || connectedPort !== port || busy} onClick={() => void command("LOG ON")}>LOG ON</Button><Button variant="subtle" disabled={!port || connectedPort !== port || busy} onClick={() => void command("LOG OFF")}>LOG OFF</Button></Group>
        </Stack>
      </Card>
    </SimpleGrid>
    {message && <Alert color={message.startsWith("NOK") ? "red" : "blue"}>{message}</Alert>}
    {status && <Card withBorder><Title order={5}>Adapter reply</Title><Text component="pre" size="xs" style={{ whiteSpace: "pre-wrap" }}>{status}</Text></Card>}
  </Stack>;
}
