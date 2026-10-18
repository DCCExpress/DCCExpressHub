import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppShell, Badge, Button, Card, Container, Group, FileButton, Modal, SimpleGrid, Stack, Text, TextInput, Title, ThemeIcon, ActionIcon } from '@mantine/core';
import { IconAlertTriangle, IconPlugConnected, IconTrain, IconWifiOff, IconMap, IconSettings, IconHome, IconEdit, IconDownload, IconUpload } from '@tabler/icons-react';
import { functionCommand, parseFrames, throttleCommand } from './dccex';
import { LocoEditor } from './LocoEditor';
import { BrowserLayoutPage } from './BrowserLayoutPage';
import { exportProject, importProject, loadProject, saveProject, type Project } from './storage';

type Connection = 'disconnected' | 'connecting' | 'connected';
const DEFAULT_URL = 'ws://192.168.1.100:8080/';
function saved(key: string, fallback: string) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
export function App() {
  const [page, setPage] = useState<'home' | 'layout'>('home');
  const [project, setProject] = useState<Project>({ version: 1, elements: [], locos: [] });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { loadProject().then(p => { setProject(p); setLoaded(true); }).catch(e => setError('Cannot open IndexedDB: ' + String(e))); }, []);
  useEffect(() => { if (loaded) saveProject(project).catch(e => setError('Cannot save IndexedDB: ' + String(e))); }, [project, loaded]);
  const [url, setUrl] = useState(() => saved('dcc-ex-ui.wsUrl', DEFAULT_URL));
  const [address, setAddress] = useState<number | string>(() => Number(saved('dcc-ex-ui.loco', '18')));
  const [status, setStatus] = useState<Connection>('disconnected');
  const [speed, setSpeed] = useState(0);
  const [forward, setForward] = useState(true);
  const [light, setLight] = useState(false);
  const [, setPower] = useState<boolean | null>(null);
  const [, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const active = useRef({ address: 18, speed: 0, forward: true });
  const append = useCallback((line: string) => setLog(lines => [line, ...lines].slice(0, 30)), []);
  const send = useCallback((command: string): boolean => {
    if (socket.current?.readyState !== WebSocket.OPEN) { setError('Not connected to a WebSocket endpoint.'); return false; }
    socket.current.send(command); append('TX ' + command); return true;
  }, [append]);
  const stop = useCallback(() => {
    const { address: a, forward: d } = active.current;
    try { if (send(throttleCommand({ address: a, speed: 0, forward: d }))) { active.current.speed = 0; setSpeed(0); } } catch (e) { setError(String(e)); }
  }, [send]);
  const disconnect = useCallback(() => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      const { address: a, forward: d } = active.current;
      socket.current.send(throttleCommand({ address: a, speed: 0, forward: d }));
    }
    socket.current?.close(); socket.current = null; setStatus('disconnected'); setSpeed(0);
  }, []);
  useEffect(() => () => { socket.current?.close(); }, []);
  const connect = () => {
    setError('');
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') throw new Error('URL must start with ws:// or wss://');
      // DCC-EX replies with Sec-WebSocket-Protocol: DCCEX. Browsers require us to request it.
      const ws = new WebSocket(parsed.href, 'DCCEX');
      socket.current = ws; setStatus('connecting');
      ws.onopen = () => { if (socket.current !== ws) return; setStatus('connected'); append('Connected: ' + parsed.href); ws.send('<s>'); };
      ws.onmessage = event => {
        if (socket.current !== ws) return;
        if (typeof event.data !== 'string') return;
        const frames = parseFrames(event.data);
        for (const frame of frames.length ? frames : [event.data]) {
          append('RX ' + frame);
          if (/^<p1(?:\\s|>)/.test(frame)) setPower(true);
          if (/^<p0(?:\\s|>)/.test(frame)) setPower(false);
        }
      };
      ws.onerror = () => { if (socket.current === ws) setError('WebSocket connection failed. Verify that the station or bridge supports WebSocket, not just TCP.'); };
      ws.onclose = () => { if (socket.current === ws) { socket.current = null; setStatus('disconnected'); setSpeed(0); append('Disconnected'); } };
      try { localStorage.setItem('dcc-ex-ui.wsUrl', url); } catch { /* storage optional */ }
    } catch (e) { setStatus('disconnected'); setError(String(e)); }
  };
  const drive = (nextSpeed: number, nextForward = forward) => {
    const a = Number(address);
    if (!Number.isInteger(a) || a < 1 || a > 10239) { setError('Select a valid DCC address (1–10239).'); return; }
    try {
      // Stop the old locomotive when changing addresses before sending to the new locomotive.
      if (active.current.address !== a && active.current.speed > 0) {
        if (!send(throttleCommand({ address: active.current.address, speed: 0, forward: active.current.forward }))) return;
      }
      if (send(throttleCommand({ address: a, speed: nextSpeed, forward: nextForward }))) {
        active.current = { address: a, speed: nextSpeed, forward: nextForward };
        setSpeed(nextSpeed); setForward(nextForward);
        try { localStorage.setItem('dcc-ex-ui.loco', String(a)); } catch { /* optional */ }
      }
    } catch (e) { setError(String(e)); }
  };
  const ready = status === 'connected';
  const [connectSettingsOpen,setConnectSettingsOpen] = useState(false);
  const [locoEditorOpen,setLocoEditorOpen] = useState(false);
  return (
    <AppShell header={{height:66}} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm" style={{cursor:'pointer'}} onClick={()=>setPage('home')}>
            <IconTrain size={26}/><Title order={3}>DCCExpressHub</Title><Badge variant="outline">alpha7 · Browser</Badge>
          </Group>
          <Group gap="sm">
            <Badge color={ready?'green':'gray'}>{ready?'DCC-EX connected':status}</Badge>
            <Text size="xs" c="dimmed" visibleFrom="sm">{url}</Text>
            <Button leftSection={<IconSettings size={16}/>} variant="light" onClick={()=>setConnectSettingsOpen(true)}>Connection</Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Modal opened={connectSettingsOpen} onClose={()=>setConnectSettingsOpen(false)} title="DCC-EX WebSocket connection" centered>
          <Stack>
            <TextInput label="WebSocket address" value={url} disabled={status!=='disconnected'} onChange={e=>setUrl(e.currentTarget.value)} description="DCC-EX native DCCEX WebSocket subprotocol, e.g. ws://192.168.1.145:2560/"/>
            <Group><Button disabled={status!=='disconnected'} leftSection={<IconPlugConnected size={17}/>} onClick={connect}>Connect</Button><Button variant="outline" color="gray" disabled={status==='disconnected'} leftSection={<IconWifiOff size={17}/>} onClick={disconnect}>Disconnect</Button></Group>
          </Stack>
        </Modal>
        <Modal opened={locoEditorOpen} onClose={()=>setLocoEditorOpen(false)} title="Locomotives" size="min(1480px, 95vw)" styles={{body:{height:'min(820px, calc(100dvh - 100px))',display:'flex',flexDirection:'column',overflow:'hidden'}}} closeOnEscape={false} closeOnClickOutside={false} withCloseButton={false} centered>
          {locoEditorOpen && <LocoEditor locos={project.locos} onSave={locos=>{setProject(p=>({...p,locos}));setLocoEditorOpen(false);}} onCancel={()=>setLocoEditorOpen(false)} onDrive={value=>{if(speed===0)setAddress(value);else setError('Stop before changing locomotive.');}}/>}
        </Modal>
        {page==='home' ? (
          <Container size="lg" py="lg">
            <Stack gap="lg">
              <Card withBorder p="lg" radius="sm"><Group justify="space-between"><Stack gap={2}><Title order={3}>DCCExpressHub</Title><Text c="dimmed" size="sm">Browser-only layout and locomotive control</Text></Stack><Badge color={ready?'green':'gray'}>{ready?'ONLINE':'OFFLINE'}</Badge></Group></Card>
              <SimpleGrid cols={{base:1,sm:2}} spacing="md">
                <Card withBorder p="lg" radius="sm" style={{cursor:'pointer'}} onClick={()=>setPage('layout')}>
                  <ThemeIcon variant="light" color="teal" size={48} radius="lg"><IconMap size={27}/></ThemeIcon>
                  <Title order={4} mt="md">Layout</Title><Text size="sm" c="dimmed">Track layout editor and manual control</Text>
                </Card>
                <Card withBorder p="lg" radius="sm" style={{cursor:'pointer'}} onClick={()=>setLocoEditorOpen(true)}>
                  <ThemeIcon variant="light" color="cyan" size={48} radius="lg"><IconTrain size={27}/></ThemeIcon>
                  <Title order={4} mt="md">Locomotives</Title><Text size="sm" c="dimmed">{project.locos.length} locomotives · edit roster and pictures</Text>
                </Card>
              </SimpleGrid>
              <Group><Button variant="light" leftSection={<IconDownload size={16}/>} onClick={()=>exportProject(project).catch(e=>setError(String(e)))}>Export project</Button>
                <FileButton accept=".json,application/json" onChange={file=>{if(!file)return;importProject(file).then(p=>{if(window.confirm('Replace project?'))setProject(p);}).catch(e=>setError(String(e)));}}>{props=><Button {...props} variant="light" leftSection={<IconUpload size={16}/>}>Import project</Button>}</FileButton></Group>
            </Stack>
          </Container>
        ) : (
          <Stack gap={6} px={8} py={6} style={{height:'calc(100dvh - 66px)',minHeight:560}}>
            <Card withBorder p="xs" radius="sm">
              <Group justify="space-between" wrap="nowrap">
                <Group gap="xs">
                  <ActionIcon variant="light" size="lg" title="Home" onClick={()=>setPage('home')}><IconHome size={18}/></ActionIcon>
                  <Button variant="subtle" size="compact-sm" leftSection={<IconEdit size={16}/>}>Layout editor</Button>
                  <Button variant="subtle" size="compact-sm" onClick={()=>setLocoEditorOpen(true)}>Locomotives</Button>
                </Group>
                <Group gap="xs"><Badge variant="light">{project.locos.length} locos</Badge><Badge color={ready?'green':'gray'}>{ready?'Online':'Offline'}</Badge></Group>
              </Group>
            </Card>
            <BrowserLayoutPage
              locos={project.locos}
              activeAddress={Number(address)}
              onSelectLoco={value=>{if(speed===0)setAddress(value);else setError('Stop before changing locomotive.');}}
              connected={ready}
              speed={speed}
              forward={forward}
              onSpeed={setSpeed}
              onDrive={drive}
              onStop={stop}
              onDirection={direction=>{if(speed===0)drive(0,direction);else setError('Stop before reversing.');}}
              onFunction={enabled=>{try{if(send(functionCommand(Number(address),0,enabled)))setLight(enabled);}catch(e){setError(String(e));}}}
              light={light}
            />
          </Stack>
        )}
        {error&&<Alert color="red" icon={<IconAlertTriangle size={17}/>} title="Error" withCloseButton onClose={()=>setError('')} mx="md" my="xs">{error}</Alert>}
      </AppShell.Main>
    </AppShell>
  );
}
