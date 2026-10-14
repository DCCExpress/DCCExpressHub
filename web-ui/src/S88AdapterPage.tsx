import { Alert, Badge, Button, Card, Group, NumberInput, Select, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { S88SensorIndicator } from "./components/S88SensorIndicator";
import { wsClient } from "./services/wsClient";

type CommandReply = { ok: boolean; message?: string; raw?: string };
const activeBytesFromStatus = (raw: string): number | null => {
  const match = raw.match(/Active S88 bytes:\s*(\d+)/i);
  const value = match?.[1] ? Number(match[1]) : NaN;
  return Number.isInteger(value) && value >= 1 && value <= 32 ? value : null;
};

// Firmware v0.6 uses ASCII HEX + CRC16. VIEW BIN (and v0.5 firmware)
// retain the original human-readable underscore-bit snapshot.
const parseBits = (raw: string): number[] => {
  let latest: number[] = [];
  for (const entry of raw.split(/\r?\n/)) {
    const line = entry.trim();
    const hex = /^S88:([0-9a-f]{2}):([0-9a-f]+)\*([0-9a-f]{4})$/i.exec(line);
    let bytes: number[] = [];
    if (hex) {
      const count = parseInt(hex[1] ?? "", 16);
      const encoded = hex[2] ?? "";
      if (count < 1 || count > 32 || encoded.length !== count * 2) continue;
      bytes = Array.from({ length: count }, (_, i) => parseInt(encoded.slice(i * 2, i * 2 + 2), 16));
      let crc = 0xffff;
      for (const value of [count, ...bytes]) {
        crc ^= value << 8;
        for (let i = 0; i < 8; i++) {
          crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
        }
      }
      if (crc !== parseInt(hex[3] ?? "", 16)) continue;
    } else {
      const bin = /^S88:\s*((?:_[01]{8}(?:\s+|$)){1,32})$/i.exec(line);
      if (!bin) continue;
      bytes = [...(bin[1] ?? "").matchAll(/_([01]{8})/g)]
        .map(match => parseInt(match[1] ?? "0", 2));
    }
    latest = bytes.flatMap(value =>
      Array.from({ length: 8 }, (_, bit) => (value >> bit) & 1));
  }
  return latest;
};

export default function S88AdapterPage({ onBack }: { onBack: () => void }) {
  const [ports, setPorts] = useState<string[]>([]);
  const [port, setPort] = useState<string | null>(null);
  const [bytes, setBytes] = useState<number | string>(4);
  const [address, setAddress] = useState<number | string>(48);
  const [connectedPort, setConnectedPort] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [bits, setBits] = useState<number[]>([]);
  const [activeByteCount, setActiveByteCount] = useState<number | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const pendingCommandRef = useRef<Promise<void> | null>(null);

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
        setConnectedPort(null);
        setBits([]);
        setActiveByteCount(null);
        setUpdated(null);
        setStatus("");
      } else {
        setConnectedPort(data.port ?? port);
      }
      setMessage(action === "connect" ? "Connected to S88Adapter." : "Disconnected.");
    } catch (e) { setMessage("NOK: " + String(e)); }
    finally { setBusy(false); }
  };

  const command = useCallback(async (value: string, background = false) => {
    if (!port || connectedPort !== port) {
      if (!background) setMessage("Connect to the selected S88Adapter first.");
      return;
    }
    // Monitor ticks never queue up. A user command waits for the current
    // serial read to finish, but the monitor itself does not disable controls.
    if (background && pendingCommandRef.current) return;
    const previous = pendingCommandRef.current;
    const operation = (async () => {
      if (previous) await previous;
      if (!background) setBusy(true);
      try {
        const form = new URLSearchParams({ port, command: value });
        const response = await fetch("/api/s88-adapter/command", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
        });
        const data = await response.json() as CommandReply;
        if (!response.ok || !data.ok) throw new Error(data.raw ?? data.message ?? "Adapter error");
        if (value === "REBOOT") { setConnectedPort(null); }
        if (value === "READ") {
          const snapshot = parseBits(data.raw ?? "");
          if (!snapshot.length) throw new Error("No valid S88 snapshot returned.");
          setBits(snapshot);
          setActiveByteCount(snapshot.length / 8);
          setUpdated(new Date().toLocaleTimeString());
        } else {
          if (value === "STATUS") {
            const actualBytes = activeBytesFromStatus(data.raw ?? "");
            if (actualBytes !== null) { setActiveByteCount(actualBytes); setBytes(actualBytes); }
          }
          if (value.startsWith("SET BYTES ")) {
            const updatedBytes = Number(value.slice("SET BYTES ".length));
            if (Number.isInteger(updatedBytes) && updatedBytes >= 1 && updatedBytes <= 32) {
              setActiveByteCount(updatedBytes);
              setBits([]);
              setUpdated(null);
            }
          }
          setStatus(data.raw ?? "");
          setMessage(value + " OK");
        }
      } catch (e) {
        if (!background) setMessage("NOK: " + String(e));
      } finally {
        if (!background) setBusy(false);
      }
    })();
    pendingCommandRef.current = operation;
    try {
      await operation;
    } finally {
      if (pendingCommandRef.current === operation) pendingCommandRef.current = null;
    }
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
    if (!connectedPort) return;
    const applySnapshot = (raw: string) => {
      const snapshot = parseBits(raw);
      if (!snapshot.length) return;
      setBits(snapshot);
      setActiveByteCount(snapshot.length / 8);
      setUpdated(new Date().toLocaleTimeString());
    };
    const unsubscribe = wsClient.subscribeMessages(message => {
      const incoming = message as unknown as { type: string; data?: { port?: string; raw?: string } };
      if (incoming.type === "s88AdapterSnapshot" && incoming.data?.port === connectedPort) {
        applySnapshot(incoming.data.raw ?? "");
      }
    });
    void fetch("/api/s88-adapter/snapshot", { cache: "no-store" })
      .then(response => response.json() as Promise<{ port?: string; raw?: string }>)
      .then(snapshot => {
        if (snapshot.port === connectedPort) applySnapshot(snapshot.raw ?? "");
      })
      .catch(() => { /* Live updates will still arrive over WebSocket. */ });
    return unsubscribe;
  }, [connectedPort]);

  return <Stack gap="md" p="md">
    <Group justify="space-between">
      <div><Title order={2}>DCCExpress S88Adapter</Title><Text c="dimmed">USB serial configuration and live S88 monitor · 115200 baud</Text></div>
      <Button variant="subtle" onClick={onBack}>Back to Devices</Button>
    </Group>
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group align="end"><Select label="Serial port" data={ports} value={port} onChange={setPort} disabled={!!connectedPort || busy} placeholder="Select adapter port" searchable style={{ flex: 1 }} /><Button variant="light" onClick={() => void refreshPorts()}>Refresh ports</Button><Badge color={connectedPort ? "green" : "gray"}>{connectedPort ? "Connected: " + connectedPort : "Disconnected"}</Badge></Group>
        <Text size="xs" c="dimmed">Connect to the adapter USB port, not the command-station port. Opening an Uno serial connection may reboot the adapter.</Text>
        <Group>{connectedPort ? <Button color="red" variant="light" disabled={busy} onClick={() => void connectionAction("disconnect")}>Disconnect</Button> : <Button disabled={!port || busy} onClick={() => void connectionAction("connect")}>Connect</Button>}<Button disabled={!port || connectedPort !== port || busy} onClick={() => void command("STATUS")}>STATUS</Button><Button variant="light" disabled={!port || connectedPort !== port || busy} onClick={() => void command("INFO")}>INFO</Button><Button variant="light" disabled={!connectedPort || busy} onClick={() => void command("VIEW HEX")}>VIEW HEX</Button><Button variant="light" disabled={!connectedPort || busy} onClick={() => void command("VIEW BIN")}>VIEW BIN</Button></Group>
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
          <Group><Badge variant="light" color={connectedPort ? "green" : "gray"}>{connectedPort ? "Live serial monitoring" : "Connect to monitor"}</Badge></Group>
          <Group><Badge color={bits.length ? "green" : "gray"}>{activeByteCount === null ? "Unknown inputs" : `${activeByteCount * 8} inputs · ${activeByteCount} groups`}</Badge><Text size="xs" c="dimmed">{updated ? "Last snapshot: " + updated : "No snapshot yet"}</Text></Group>
          <Stack gap="sm">
            {Array.from({ length: activeByteCount ?? 0 }, (_, groupIndex) => (
              <Card key={groupIndex} withBorder radius="sm" p="xs">
                <Stack gap={6}>
                  <Group justify="space-between">
                    <Text size="xs" fw={700}>S88 Group {groupIndex + 1}</Text>
                    <Text size="xs" c="dimmed">Inputs {groupIndex * 8 + 1}–{groupIndex * 8 + 8}</Text>
                  </Group>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 4 }}>
                    {Array.from({ length: 8 }, (_, offset) => {
                      const index = groupIndex * 8 + offset;
                      return <S88SensorIndicator key={index} number={index + 1} known={index < bits.length} active={bits[index] === 1} />;
                    })}
                  </div>
                </Stack>
              </Card>
            ))}
            {activeByteCount === null && <Text size="xs" c="dimmed">Connect the USB adapter to see incoming S88 groups automatically.</Text>}
          </Stack>
        </Stack>
      </Card>
    </SimpleGrid>
    {message && <Alert color={message.startsWith("NOK") ? "red" : "blue"}>{message}</Alert>}
    {status && <Card withBorder><Title order={5}>Adapter reply</Title><Text component="pre" size="xs" style={{ whiteSpace: "pre-wrap" }}>{status}</Text></Card>}
  </Stack>;
}
