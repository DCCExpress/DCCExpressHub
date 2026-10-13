import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Group, NumberInput, Select, SimpleGrid, Slider, Stack, Switch, Text, Title } from "@mantine/core";

type Loco = { name: string; address: number; isLongAddress?: boolean };
type ThrottleState = { name?: string; address?: number; speed?: number; forward?: boolean; clients?: number; speedSteps?: number; [key: string]: unknown };
type Props = {
  connected: boolean;
  connectionId: number;
  lastMessage: unknown;
  send: (value: Record<string, unknown>) => boolean;
};

const clientName = (address: number) => "HubThrottle" + address;
const bound = (x: number) => Math.max(0, Math.min(1, x));
function parseRoster(value: unknown): Loco[] {
  const values = Array.isArray(value) ? value : [];
  return values.flatMap((entry): Loco[] => {
    if (!entry || typeof entry !== "object") return [];
    const d = ("data" in entry && entry.data && typeof entry.data === "object") ? entry.data as Record<string, unknown> : entry as Record<string, unknown>;
    const address = Number(d.dccAddress ?? d.address);
    if (!Number.isInteger(address) || address < 1) return [];
    return [{ name: String(d.name ?? d.id ?? "Loco " + address), address, isLongAddress: typeof d.isLongAddress === "boolean" ? d.isLongAddress : undefined }];
  });
}
export default function JmriThrottle({ connected, connectionId, lastMessage, send }: Props) {
  const [roster, setRoster] = useState<Loco[]>([]);
  const [address, setAddress] = useState<number | string>(18);
  const [longAddress, setLongAddress] = useState(false);
  const [selectedRoster, setSelectedRoster] = useState<string | null>(null);
  const [active, setActive] = useState<{ name: string; address: number } | null>(null);
  const [state, setState] = useState<ThrottleState>({});
  const [error, setError] = useState("");
  const activeRef = useRef<typeof active>(null);
  const connectedRef = useRef(connected);
  const sendRef = useRef(send);
  connectedRef.current = connected;
  sendRef.current = send;
  activeRef.current = active;
  useEffect(() => {
    let cancel = false;
    fetch("/jmri/json/roster", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).then(data => { if (!cancel) setRoster(parseRoster(data)); })
      .catch(e => { if (!cancel) setError("Roster lekérés: " + String(e)); });
    return () => { cancel = true; };
  }, []);
  // A new socket cannot inherit the old socket's throttle allocation.
  useEffect(() => {
    setActive(null);
    setState({});
  }, [connectionId]);
  useEffect(() => {
    const message = lastMessage as { type?: string; data?: ThrottleState; message?: string } | null;
    const current = activeRef.current;
    if (!current || !message || message.type !== "throttle" || !message.data) return;
    const d = message.data;
    if (d.name !== current.name && d.throttle !== current.name) return;
    setState(previous => ({ ...previous, ...d }));
  }, [lastMessage]);
  // Release the acquired handle when this UI unmounts; a closed socket is automatically released by JMRI.
  useEffect(() => () => {
    const current = activeRef.current;
    if (current && connectedRef.current) sendRef.current({ type: "throttle", data: { name: current.name, release: null } });
  }, []);
  const acquire = () => {
    const n = Number(address);
    if (!connected || !Number.isInteger(n) || n < 1 || n > 10239) return;
    if (active) send({ type: "throttle", data: { name: active.name, release: null } });
    const name = clientName(n);
    setState({});
    setError("");
    const ok = send({ type: "throttle", data: { name, address: n, isLongAddress: longAddress } });
    setActive(ok ? { name, address: n } : null);
  };
  const release = () => {
    if (!active) return;
    send({ type: "throttle", data: { name: active.name, release: null } });
    setActive(null);
    setState({});
  };
  const command = (value: Record<string, unknown>) => {
    if (connected && active) send({ type: "throttle", data: { name: active.name, ...value } });
  };
  const functions = useMemo(() => Array.from({ length: 29 }, (_, n) => ({ n, on: state["F" + n] === true })), [state]);
  const ready = connected && !!active && state.name === active.name;
  const speedPercent = Math.round(bound(typeof state.speed === "number" ? state.speed : 0) * 100);
  return <Stack gap="lg">
    <Card withBorder radius="lg" padding="lg"><Stack gap="md">
      <Group justify="space-between"><Title order={4}>JMRI mozdonyvezérlő</Title><Badge color={ready ? "teal" : "gray"}>{ready ? "Throttle active" : active ? "Connecting…" : "Released"}</Badge></Group>
      <Text c="dimmed" size="sm">A Hub mozdonyvezérlőjének egyszerűsített tesztváltozata, közvetlen JMRI WebSocket kapcsolaton. A sebesség 0–100% parancsolt érték, nem mért km/h.</Text>
      <Select label="JMRI Roster" placeholder="Válassz mozdonyt" clearable searchable data={roster.map(x => ({ label: x.name + " (#" + x.address + ")", value: x.name }))} value={selectedRoster} disabled={!!active} onChange={v => { setSelectedRoster(v); const loco = roster.find(x => x.name === v); if (loco) { setAddress(loco.address); setLongAddress(loco.isLongAddress ?? loco.address > 127); } }} />
      <Group align="end">
        <NumberInput label="DCC cím" min={1} max={10239} value={address} disabled={!!active} onChange={setAddress} style={{flex:1}} />
        <Switch label="Hosszú cím" checked={longAddress} disabled={!!active} onChange={event => setLongAddress(event.currentTarget.checked)} />
      </Group>
      <Group>
        <Button color="teal" disabled={!connected || !!active} onClick={acquire}>Mozdony csatlakoztatása</Button>
        <Button color="gray" variant="light" disabled={!active} onClick={release}>Release</Button>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
    </Stack></Card>
    <Card withBorder radius="lg" padding="lg"><Stack gap="lg">
      <Group justify="space-between"><div><Text fw={700}>#{active?.address ?? address} {roster.find(x => x.address === (active?.address ?? Number(address)))?.name ?? ""}</Text><Text size="xs" c="dimmed">JMRI throttle clients: {state.clients ?? "—"} · {state.speedSteps ?? "—"} speed steps</Text></div><Title order={2}>{speedPercent}%</Title></Group>
      <Slider min={0} max={100} step={1} disabled={!ready} value={speedPercent} onChangeEnd={value => command({ speed: value / 100 })} marks={[{value:0,label:"0"},{value:50,label:"50"},{value:100,label:"100%"}]} mb="lg" />
      <Group grow>
        <Button variant={state.forward === false ? "filled" : "light"} disabled={!ready || speedPercent > 0} onClick={() => command({forward:false})}>Reverse</Button>
        <Button color="gray" disabled={!ready} onClick={() => command({speed:0})}>STOP</Button>
        <Button variant={state.forward === true ? "filled" : "light"} disabled={!ready || speedPercent > 0} onClick={() => command({forward:true})}>Forward</Button>
      </Group>
      <Button color="red" fullWidth disabled={!ready} onClick={() => command({speed:-1})}>EMERGENCY STOP</Button>
      <Text size="xs" c="dimmed">Irányváltás csak 0% sebességnél engedélyezett. Release nem állítja meg automatikusan a mozdonyt!</Text>
    </Stack></Card>
    <Card withBorder radius="lg" padding="lg"><Stack gap="md"><Title order={4}>Functions F0–F28</Title><SimpleGrid cols={{base:4,sm:7,lg:10}} spacing="xs">{functions.map(f => <Button key={f.n} color={f.on ? "teal" : "gray"} variant={f.on ? "filled" : "light"} disabled={!ready} size="compact-md" onClick={() => command({["F" + f.n]:!f.on})}>F{f.n}</Button>)}</SimpleGrid></Stack></Card>
  </Stack>;
}
