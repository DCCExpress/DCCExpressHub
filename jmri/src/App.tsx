import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, Alert, Badge, Box, Button, Card, Code, Container, Group, NavLink, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, Textarea, TextInput, Title, ActionIcon, Divider } from "@mantine/core";
import { IconActivity, IconAlertTriangle, IconArrowDown, IconCopy, IconDatabase, IconEye, IconList, IconPlugConnected, IconRefresh, IconSend, IconTerminal2, IconWifi, IconWifiOff } from "@tabler/icons-react";
import { BASE, DEFAULT_TYPES, format, jsonPath, needsWriteConfirmation, parseIncoming, wsUrl, type LogRecord } from "./protocol";
type Status = "disconnected" | "connecting" | "connected";
type Tab = "explorer" | "socket" | "log";
const presets = [
  { label: "Ping", value: '{"type":"ping"}' },
  { label: "Sensors", value: '{"list":"sensors"}' },
  { label: "Turnouts", value: '{"list":"turnouts"}' },
  { label: "Power", value: '{"type":"power"}' },
  { label: "Panels", value: '{"list":"panels"}' },
  { label: "Memories", value: '{"list":"memories"}' },
  { label: "Throttle #18 (acquires handle)", value: '{"type":"throttle","data":{"name":"HubDebug18","address":18}}' },
];
export default function App() {
  const [tab, setTab] = useState<Tab>("explorer");
  const [status, setStatus] = useState<Status>("disconnected");
  const [type, setType] = useState("sensor");
  const [name, setName] = useState("");
  const [types, setTypes] = useState<string[]>(DEFAULT_TYPES);
  const [entries, setEntries] = useState<unknown>(null);
  const [selected, setSelected] = useState<unknown>(null);
  const [httpError, setHttpError] = useState("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('{"type":"ping"}');
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [filter, setFilter] = useState("");
  const socket = useRef<WebSocket | null>(null);
  const logId = useRef(0);
  const log = useCallback((channel: LogRecord["channel"], direction: LogRecord["direction"], message: string) => {
    setLogs(old => [...old, { id: ++logId.current, at: new Date().toLocaleTimeString(), channel, direction, message }].slice(-350));
  }, []);

  const httpGet = useCallback(async (url: string): Promise<unknown> => {
    setBusy(true);
    setHttpError("");
    log("HTTP", "out", "GET " + url);
    try {
      const response = await fetch(url, { cache: "no-store" });
      const body = await response.text();
      const data = parseIncoming(body);
      log("HTTP", response.ok ? "in" : "error", response.status + " " + format(data));
      if (!response.ok) throw new Error("HTTP " + response.status + ": " + body.slice(0, 400));
      return data;
    } catch (error) {
      const message = String(error);
      setHttpError(message);
      log("SYSTEM", "error", message);
      throw error;
    } finally {
      setBusy(false);
    }
  }, [log]);

  const loadList = useCallback(async (chosen = type) => {
    try {
      setSelected(null);
      setEntries(await httpGet(jsonPath(chosen)));
    } catch { setEntries(null); }
  }, [type, httpGet]);

  const inspect = useCallback(async (key: string, chosen = type) => {
    try { setSelected(await httpGet(jsonPath(chosen, key))); }
    catch { setSelected(null); }
  }, [type, httpGet]);

  const discover = useCallback(async () => {
    try {
      const result = await httpGet(jsonPath("type"));
      const values = Array.isArray(result) ? result : [];
      const mapped = values.flatMap((x): string[] => typeof x === "string" ? [x] :
        x && typeof x === "object" && "data" in x && typeof x.data === "object" && x.data !== null && "name" in x.data && typeof x.data.name === "string" ? [x.data.name] : []);
      if (mapped.length) setTypes([...new Set([...DEFAULT_TYPES, ...mapped])]);
      setSelected(result);
    } catch { /* Already shown in diagnostic log. */ }
  }, [httpGet]);

  const connect = useCallback(() => {
    if (socket.current) socket.current.close();
    setStatus("connecting");
    const ws = new WebSocket(wsUrl());
    socket.current = ws;
    log("SYSTEM", "info", "Connecting to " + wsUrl());
    ws.onopen = () => {
      if (socket.current !== ws) return;
      setStatus("connected");
      log("SYSTEM", "info", "WebSocket connected");
    };
    ws.onmessage = event => {
      log("WS", "in", typeof event.data === "string" ? event.data : "[binary message]");
    };
    ws.onerror = () => log("SYSTEM", "error", "WebSocket error (check JMRI Web Server and proxy)");
    ws.onclose = event => {
      if (socket.current !== ws) return;
      socket.current = null;
      setStatus("disconnected");
      log("SYSTEM", "info", "WebSocket closed (" + event.code + ")");
    };
  }, [log]);

  const disconnect = () => {
    socket.current?.close();
    socket.current = null;
    setStatus("disconnected");
  };

  useEffect(() => () => { socket.current?.close(); socket.current = null; }, []);

  const send = () => {
    if (status !== "connected" || socket.current?.readyState !== WebSocket.OPEN) return;
    let parsed: unknown;
    try { parsed = JSON.parse(input); }
    catch (error) { log("SYSTEM", "error", "Invalid JSON: " + String(error)); return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      log("SYSTEM", "error", "Expected a JSON command object");
      return;
    }
    // Never silently issue writes: all mutations, including ambiguous commands, need confirmation.
    if (needsWriteConfirmation(input) &&
      !window.confirm("This may change your railway hardware state. Send this JMRI command?")) return;
    socket.current.send(input);
    log("WS", "out", input);
  };

  const rows = Array.isArray(entries) ? entries : entries && typeof entries === "object" ? [entries] : [];
  const labelOf = (item: unknown, index: number) => {
    if (!item || typeof item !== "object") return "#" + (index + 1);
    const v = item as Record<string, unknown>;
    const d = v.data && typeof v.data === "object" ? v.data as Record<string, unknown> : v;
    return String(d.name ?? d.userName ?? v.name ?? "#" + (index + 1));
  };
  const filteredLogs = logs.filter(item => !filter || (item.channel + item.message).toLowerCase().includes(filter.toLowerCase()));

  const eventList = (items: LogRecord[]) => <ScrollArea h={470} type="auto"><Stack gap="xs">{items.length ? items.slice().reverse().map(event =>
    <Card key={event.id} withBorder padding="sm" radius="md">
      <Group gap="xs" mb={5}><Text size="xs" c="dimmed">{event.at}</Text><Badge size="xs" color={event.direction==="error"?"red":event.direction==="in"?"teal":"blue"}>{event.channel} · {event.direction}</Badge></Group>
      <Code block className="json-output">{event.message}</Code>
    </Card>) : <Text ta="center" c="dimmed" py="xl">No events yet.</Text>}</Stack></ScrollArea>;
  return <AppShell navbar={{width:245,breakpoint:"sm",collapsed:{mobile:true}}} header={{height:64}} padding="md">
    <AppShell.Header>
      <Group h="100%" px="lg" justify="space-between">
        <Group gap="sm"><IconActivity size={26} color="var(--mantine-color-teal-5)"/><Box><Text fw={750} size="sm">DCCExpressHub</Text><Text size="xs" c="dimmed">JMRI JSON Explorer · alpha6</Text></Box></Group>
        <Badge size="lg" variant="light" color={status==="connected"?"teal":status==="connecting"?"yellow":"gray"} leftSection={status==="connected"?<IconWifi size={13}/>:<IconWifiOff size={13}/>}>{status}</Badge>
      </Group>
    </AppShell.Header>
    <AppShell.Navbar p="md">
      <Stack gap="xs"><Text size="xs" c="dimmed" fw={700} mb="xs">WORKSPACE</Text>
        <NavLink active={tab==="explorer"} onClick={()=>setTab("explorer")} label="Object explorer" leftSection={<IconDatabase size={18}/>} />
        <NavLink active={tab==="socket"} onClick={()=>setTab("socket")} label="WebSocket console" leftSection={<IconTerminal2 size={18}/>} />
        <NavLink active={tab==="log"} onClick={()=>setTab("log")} label="Event log" leftSection={<IconList size={18}/>} rightSection={<Badge size="sm" variant="light">{logs.length}</Badge>} />
        <Alert mt="xl" variant="light" color="yellow" title="Debug environment" icon={<IconAlertTriangle size={17}/>}>Standalone tool. Raw commands can operate real railway hardware.</Alert>
      </Stack>
    </AppShell.Navbar>
    <AppShell.Main><Container fluid maw={1500} py="md">
      <Stack gap="lg">
        <Box><Text size="xs" fw={700} c="teal">JMRI CONNECTIVITY / EXPERIMENTAL</Text><Title order={2} mt={5}>{tab==="explorer"?"JSON Object Explorer":tab==="socket"?"WebSocket Console":"Event Log"}</Title><Text size="sm" c="dimmed">Explore live JMRI data before designing the full integration.</Text></Box>
        <Card withBorder radius="lg" padding="lg"><Group justify="space-between" align="center" wrap="wrap" gap="md"><Box><Text size="xs" c="dimmed" fw={700}>JMRI WEB SERVER · DEVELOPMENT PROXY</Text><Group gap="xs" mt={6}><Code>/jmri</Code><Text size="sm">→</Text><Code>JMRI_TARGET</Code><Text size="xs" c="dimmed">(default 127.0.0.1:12080)</Text></Group></Box><Group gap="xs">
          <Button variant="light" leftSection={<IconRefresh size={16}/>} loading={busy} onClick={()=>void discover()}>Discover types</Button>
          <Button color={status==="connected"?"gray":"teal"} leftSection={<IconPlugConnected size={16}/>} loading={status==="connecting"} onClick={status==="connected"?disconnect:connect}>{status==="connected"?"Disconnect":"Connect WS"}</Button>
        </Group></Group></Card>
        {httpError && <Alert color="red" icon={<IconAlertTriangle size={18}/>} title="JMRI request failed">{httpError}</Alert>}
        {tab==="explorer" && <SimpleGrid cols={{base:1,md:2}} spacing="md">
          <Card withBorder radius="lg" padding="lg"><Stack gap="md">
            <Group justify="space-between"><Title order={4}>Objects</Title><Badge variant="outline">HTTP GET</Badge></Group><Divider/>
            <Group align="end" gap="xs" wrap="nowrap"><Select label="Object type" searchable data={types} value={type} onChange={v=>{if(v){setType(v);setEntries(null);setSelected(null);}}} style={{flex:1}}/><Button loading={busy} onClick={()=>void loadList()} leftSection={<IconRefresh size={16}/>}>List</Button></Group>
            <Group align="end" gap="xs" wrap="nowrap"><TextInput label="Inspect by system or user name" placeholder="IS1001, LT20, IM..." value={name} onChange={e=>setName(e.currentTarget.value)} onKeyDown={e=>{if(e.key==="Enter"&&name.trim())void inspect(name.trim());}} style={{flex:1}}/><ActionIcon size={36} variant="light" disabled={busy||!name.trim()} onClick={()=>void inspect(name.trim())} aria-label="Inspect object"><IconEye size={18}/></ActionIcon></Group>
            <Divider label={`Response items · ${rows.length}`}/>
            <ScrollArea h={360} type="auto"><Table striped highlightOnHover withRowBorders><Table.Tbody>{rows.slice(0,250).map((item,idx)=><Table.Tr key={idx} onClick={()=>{setSelected(item);const n=labelOf(item,idx);if(!n.startsWith("#"))setName(n);}} className="selectable-row"><Table.Td><Group gap="xs"><IconDatabase size={15}/><Text size="sm">{labelOf(item,idx)}</Text></Group></Table.Td></Table.Tr>)}</Table.Tbody></Table>{!rows.length&&<Text ta="center" c="dimmed" py="xl" size="sm">Choose a type and click List.</Text>}</ScrollArea>
            {rows.length>250&&<Text size="xs" c="dimmed">First 250 shown; all in raw response.</Text>}
          </Stack></Card>
          <Card withBorder radius="lg" padding="lg"><Stack gap="md">
            <Group justify="space-between"><Title order={4}>JSON response</Title><Badge variant="outline">READ ONLY</Badge></Group><Divider/>
            <Group justify="space-between"><Text c="dimmed" size="xs">{selected!==null?"Selected object":"List response"}</Text><Button variant="subtle" size="xs" leftSection={<IconCopy size={15}/>} onClick={()=>void navigator.clipboard?.writeText(format(selected??entries))}>Copy JSON</Button></Group>
            <ScrollArea h={520} type="auto"><Code block className="json-output">{selected!==null||entries!==null?format(selected??entries):"// Select an object type to inspect JMRI response payloads."}</Code></ScrollArea>
          </Stack></Card>
        </SimpleGrid>}
        {tab==="socket"&&<SimpleGrid cols={{base:1,md:2}} spacing="md">
          <Card withBorder radius="lg" padding="lg"><Stack gap="md"><Group justify="space-between"><Title order={4}>Send JSON message</Title><Badge variant="outline">WS /json</Badge></Group><Divider/><Text size="xs" c="dimmed" fw={700}>EXAMPLE COMMANDS</Text><Group gap="xs">{presets.map(p=><Button key={p.label} size="compact-sm" variant="light" color="gray" onClick={()=>setInput(p.value)}>{p.label}</Button>)}</Group><Textarea label="Raw JSON payload" autosize minRows={11} maxRows={20} value={input} onChange={e=>setInput(e.currentTarget.value)} styles={{input:{fontFamily:"monospace"}}}/><Button fullWidth disabled={status!=="connected"} leftSection={<IconSend size={16}/>} onClick={send}>Send message</Button><Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16}/>}>Writes require confirmation. Throttle requests may acquire control even without an explicit write method.</Alert></Stack></Card>
          <Card withBorder radius="lg" padding="lg"><Stack gap="md"><Group justify="space-between"><Title order={4}>Socket events</Title><Badge variant="outline">{logs.filter(x=>x.channel==="WS").length} messages</Badge></Group><Divider/>{eventList(logs.filter(x=>x.channel==="WS").slice(-60))}</Stack></Card>
        </SimpleGrid>}
        {tab==="log"&&<Card withBorder radius="lg" padding="lg"><Stack gap="md"><Group justify="space-between"><Title order={4}>Session diagnostics</Title><Group gap="xs"><Button variant="subtle" size="xs" leftSection={<IconCopy size={15}/>} onClick={()=>void navigator.clipboard?.writeText(format(filteredLogs))}>Export JSON</Button><Button variant="subtle" color="gray" size="xs" onClick={()=>setLogs([])}>Clear</Button></Group></Group><Divider/><TextInput placeholder="Filter HTTP, WS, errors, payloads…" value={filter} onChange={e=>setFilter(e.currentTarget.value)}/>{eventList(filteredLogs)}</Stack></Card>}
        <Text size="xs" c="dimmed">JMRI protocol: <a href="https://www.jmri.org/help/en/html/web/JsonServlet.shtml" target="_blank" rel="noreferrer">JSON Servlet</a> · Standalone debug app, no Hub runtime changes.</Text>
      </Stack>
    </Container></AppShell.Main>
  </AppShell>;
}
