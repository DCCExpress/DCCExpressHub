import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppShell, Badge, Box, Button, Card, Container, Group, FileButton, Modal, SimpleGrid, Stack, Text, TextInput, Title, ThemeIcon } from '@mantine/core';
import { IconAlertTriangle, IconPlugConnected, IconTrain, IconWifiOff, IconMap, IconSettings, IconDownload, IconUpload } from '@tabler/icons-react';
import { functionCommand, locoStatusQuery, parseFrames, parseLocoStatus, throttleCommand, type LocoLiveState } from './dccex';
import { registerTurnoutOutputSink } from './preview-webui/services/layoutOutput';
import { publishSensorFeedback, publishSensorSnapshot, publishConnectionStatus } from './preview-webui/services/wsClient';
import { LocoEditor } from './LocoEditor';
import AppModal from './components/common/AppModal';
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
  const [locoStates,setLocoStates]=useState<Record<number,LocoLiveState>>({});
  const queriedLocos=useRef(new Set<number>());
  const currentAddress=useRef(Number(address));
  currentAddress.current=Number(address);
  const applySelectedStatus=(state:LocoLiveState)=>{
    if(!state.known)return;
    if(state.address!==currentAddress.current)return;
    active.current={address:state.address,speed:state.speed,forward:state.forward};
    setSpeed(state.speed);setForward(state.forward);setLight((state.functionsMask&1)!==0);
  };
  const [power, setPower] = useState<boolean | null>(null);
  const [, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const active = useRef({ address: Number(address), speed: 0, forward: true });
  const append = useCallback((line: string) => setLog(lines => [line, ...lines].slice(0, 30)), []);
  const send = useCallback((command: string): boolean => {
    if (socket.current?.readyState !== WebSocket.OPEN) { setError('Not connected to a WebSocket endpoint.'); return false; }
    socket.current.send(command); append('TX ' + command); return true;
  }, [append]);
  useEffect(()=>registerTurnoutOutputSink(send),[send]);
  // Ask about each saved DCC address once per connection; when a new loco is added,
  // ask for that address too. Queries never set speed or reserve a slot.
  useEffect(()=>{
    if(status!=='connected'||socket.current?.readyState!==WebSocket.OPEN)return;
    const addresses=[...new Set([...project.locos.map(loco=>loco.address),Number(address)])]
      .filter(cab=>Number.isInteger(cab)&&cab>0&&cab<=10293&&!queriedLocos.current.has(cab));
    for(const cab of addresses)queriedLocos.current.add(cab);
    for(let i=0;i<addresses.length;i+=8){
      socket.current.send(addresses.slice(i,i+8).map(locoStatusQuery).join(''));
    }
  },[status,project.locos,address]);
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
    setLocoStates({});
    publishConnectionStatus('disconnected');
  }, []);
  useEffect(() => () => { socket.current?.close(); }, []);
  const connect = () => {
    setError('');
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') throw new Error('URL must start with ws:// or wss://');
      // DCC-EX replies with Sec-WebSocket-Protocol: DCCEX. Browsers require us to request it.
      const ws = new WebSocket(parsed.href, 'DCCEX');
      queriedLocos.current.clear();
      setLocoStates({});
      setSpeed(0);setLight(false);
      socket.current = ws; setStatus('connecting');
      publishConnectionStatus('reconnecting');
      ws.onopen = () => {
        if (socket.current !== ws) return;
        setStatus('connected');
        publishConnectionStatus('connected');
        publishSensorSnapshot([]);
        append('Connected: ' + parsed.href);
        ws.send('<s><Q>'); // DCC-EX sensor snapshot request after connecting
      };
      ws.onmessage = event => {
        if (socket.current !== ws) return;
        if (typeof event.data !== 'string') return;
        const frames = parseFrames(event.data);
        for (const frame of frames.length ? frames : [event.data]) {
          append('RX ' + frame);
          const locoStatus=parseLocoStatus(frame);
          if(locoStatus){
            setLocoStates(old=>({...old,[locoStatus.address]:locoStatus}));
            applySelectedStatus(locoStatus);
          }
          // DCC-EX reports <Q address> when a sensor becomes occupied,
          // and <q address> when it clears. <Q> with no address is not an event.
          const sensor = /^<([Qq])\s+(\d+)(?:\s|>)/.exec(frame.trim());
          if(sensor){
            const sensorAddress=Number(sensor[2]);
            publishSensorFeedback(sensorAddress,sensor[1]==='Q');
          }
          if (/^<p1(?:\\s|>)/.test(frame)) setPower(true);
          if (/^<p0(?:\\s|>)/.test(frame)) setPower(false);
        }
      };
      ws.onerror = () => { if (socket.current === ws) setError('WebSocket connection failed. Verify that the station or bridge supports WebSocket, not just TCP.'); };
      ws.onclose = () => { if (socket.current === ws) { socket.current = null; setStatus('disconnected'); publishConnectionStatus('disconnected'); setSpeed(0); setLocoStates({}); append('Disconnected'); } };
      try { localStorage.setItem('dcc-ex-ui.wsUrl', url); } catch { /* storage optional */ }
    } catch (e) { setStatus('disconnected'); publishConnectionStatus('disconnected'); setError(String(e)); }
  };
  const driveAddress=(locoAddress:number,nextSpeed:number,nextForward:boolean)=>{
    if(!Number.isInteger(locoAddress)||locoAddress<1||locoAddress>10239){
      setError('Invalid DCC address');return;
    }
    try {
      // Switching locomotive controls must not stop another locomotive.
      if(send(throttleCommand({address:locoAddress,speed:nextSpeed,forward:nextForward}))){
        active.current={address:locoAddress,speed:nextSpeed,forward:nextForward};
        setLocoStates(previous=>({
          ...previous,
          [locoAddress]:{
            address:locoAddress,speed:nextSpeed,forward:nextForward,
            functionsMask:previous[locoAddress]?.functionsMask??0,emergencyStop:false,known:true,
          },
        }));
        setAddress(locoAddress);setSpeed(nextSpeed);setForward(nextForward);
        try{localStorage.setItem('dcc-ex-ui.loco',String(locoAddress));}catch{/* optional */}
      }
    }catch(e){setError(String(e));}
  };
  const drive=(nextSpeed:number,nextForward=forward)=>driveAddress(Number(address),nextSpeed,nextForward);
  const ready = status === 'connected';
  const [connectSettingsOpen,setConnectSettingsOpen] = useState(false);
  const [locoEditorOpen,setLocoEditorOpen] = useState(false);
  return (
    <AppShell header={page==='home'?{height:66}:undefined} padding={0}>
      {page==='home' && (
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
      )}
      <AppShell.Main>
        <Modal opened={connectSettingsOpen} onClose={()=>setConnectSettingsOpen(false)} title="DCC-EX WebSocket connection" centered>
          <Stack>
            <TextInput label="WebSocket address" value={url} disabled={status!=='disconnected'} onChange={e=>setUrl(e.currentTarget.value)} description="DCC-EX native DCCEX WebSocket subprotocol, e.g. ws://192.168.1.145:2560/"/>
            <Group><Button disabled={status!=='disconnected'} leftSection={<IconPlugConnected size={17}/>} onClick={connect}>Connect</Button><Button variant="outline" color="gray" disabled={status==='disconnected'} leftSection={<IconWifiOff size={17}/>} onClick={disconnect}>Disconnect</Button></Group>
          </Stack>
        </Modal>
        <AppModal opened={locoEditorOpen} onClose={()=>setLocoEditorOpen(false)} title="Locomotives" size="min(1480px, 95vw)" centered draggable styles={{body:{height:'min(740px, calc(100vh - 120px))',display:'flex',flexDirection:'column',overflow:'hidden'}}} closeOnEscape={false} closeOnClickOutside={false} withCloseButton={false}>
          {locoEditorOpen && <LocoEditor locos={project.locos} functionBindings={project.functionBindings??[]} onFunctionTest={(address,fn,active)=>{try{send(functionCommand(address,fn,active));}catch(e){setError(String(e));}}} onSave={(locos,functionBindings)=>{setProject(p=>({...p,locos,functionBindings}));setLocoEditorOpen(false);}} onCancel={()=>setLocoEditorOpen(false)} onDrive={value=>{if(speed===0)setAddress(value);else setError('Stop before changing locomotive.');}}/>}
        </AppModal>
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
          <Box px={8} py={8} style={{height:'100dvh',minHeight:0,overflow:'hidden'}}>
            <BrowserLayoutPage
              locos={project.locos}
              elements={project.elements}
              stations={project.stations??[]}
              onSaveStations={(stations,blockId,stationId)=>{
                setProject(previous=>{
                  const ids=new Set(stations.map(station=>station.id));
                  return {...previous,stations,elements:previous.elements.map(element=>{
                    if(String(element.id)===blockId)return {...element,stationId};
                    return typeof element.stationId==='string'&&!ids.has(element.stationId)
                      ? {...element,stationId:null}:element;
                  })};
                });
              }}
              onElementsChange={elements=>setProject(previous=>({...previous,elements}))}
              activeAddress={Number(address)}
              locoStates={locoStates}
              onSelectLoco={value=>{
                const next=locoStates[value];
                currentAddress.current=value;
                active.current={address:value,speed:next?.known?next.speed:0,forward:next?.forward??true};
                setAddress(value);setSpeed(active.current.speed);setForward(active.current.forward);
                setLight(next?.known?(next.functionsMask&1)!==0:false);
              }}
              connected={ready}
              speed={speed}
              forward={forward}
              onSpeed={setSpeed}
              onDrive={drive}
              onDriveAddress={driveAddress}
              onStop={stop}
              onDirection={direction=>{if(speed===0)drive(0,direction);else setError('Stop before reversing.');}}
              onFunctionCommand={(locoAddress,number,enabled)=>{
                try{
                  if(send(functionCommand(locoAddress,number,enabled))){
                    setLocoStates(previous=>{
                      const existing=previous[locoAddress];
                      if(!existing)return previous; // no fake speed/direction before the station responds
                      const bit=1<<number;
                      return {...previous,[locoAddress]:{
                        ...existing,functionsMask:enabled?existing.functionsMask|bit:existing.functionsMask&~bit,
                      }};
                    });
                    if(locoAddress===currentAddress.current&&number===0)setLight(enabled);
                  }
                }catch(e){setError(String(e));}
              }}
              onEmergencyToggle={()=>{
                const nextPower=power===false;
                if(send(nextPower?'<1>':'<0>')){setPower(nextPower);if(!nextPower){active.current.speed=0;setSpeed(0);}}
              }}
              emergencyStop={power===false}
              light={light}
              onBack={()=>setPage('home')}
              onOpenLocoEditor={()=>setLocoEditorOpen(true)}
              onSave={()=>saveProject(project).catch(e=>setError('Save failed: '+String(e)))}
              onReload={()=>loadProject().then(p=>setProject(p)).catch(e=>setError('Reload failed: '+String(e)))}
              onExport={()=>exportProject(project).catch(e=>setError('Export failed: '+String(e)))}
              onImport={file=>{
                importProject(file).then(p=>{
                  if(window.confirm('Replace the current project with the imported project?'))setProject(p);
                }).catch(e=>setError('Import failed: '+String(e)));
              }}
              onTogglePower={()=>{
                const nextPower=power!==true;
                if(send(nextPower?'<1>':'<0>')){setPower(nextPower);if(!nextPower){active.current.speed=0;setSpeed(0);}}
              }}
              powerOn={power===true}
              elementCount={project.elements.length}
            />
          </Box>
        )}
        {error&&<Alert color="red" icon={<IconAlertTriangle size={17}/>} title="Error" withCloseButton onClose={()=>setError('')} mx="md" my="xs">{error}</Alert>}
      </AppShell.Main>
    </AppShell>
  );
}
