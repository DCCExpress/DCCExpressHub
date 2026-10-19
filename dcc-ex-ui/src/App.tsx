import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppShell, Badge, Box, Button, Card, Container, Group, FileButton, Modal, NumberInput, SimpleGrid, Stack, Text, TextInput, Title, ThemeIcon } from '@mantine/core';
import { IconAlertTriangle, IconPlugConnected, IconTrain, IconWifiOff, IconMap, IconSettings, IconDownload, IconUpload, IconTrash } from '@tabler/icons-react';
import { emergencyStopCommand, emergencyResumeCommand, trackPowerCommand, functionCommand, locoStatusQuery, parseFrames, parseLocoStatus, throttleCommand, type LocoLiveState } from './dccex';
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
  const [commandIntervalMs,setCommandIntervalMs]=useState(()=>{
    const value=Number(saved('dcc-ex-ui.commandIntervalMs','25'));
    return Number.isInteger(value)&&value>=0&&value<=1000?value:25;
  });
  const [sensorOffDelayMs,setSensorOffDelayMs]=useState(()=>{
    const value=Number(saved('dcc-ex-ui.sensorOffDelayMs','250'));
    return Number.isInteger(value)&&value>=100&&value<=1000?value:250;
  });
  const sensorOffDelayRef=useRef(sensorOffDelayMs);
  sensorOffDelayRef.current=sensorOffDelayMs;
  const sensorOffTimers=useRef(new Map<number,ReturnType<typeof setTimeout>>());
  const [turnoutSettlingMs,setTurnoutSettlingMs]=useState(()=>{
    const value=Number(saved('dcc-ex-ui.turnoutSettlingMs','100'));
    return Number.isInteger(value)&&value>=0&&value<=30000?value:100;
  });

  const clearSensorOffTimers=useCallback(()=>{
    for(const timer of sensorOffTimers.current.values())clearTimeout(timer);
    sensorOffTimers.current.clear();
  },[]);
  useEffect(()=>()=>clearSensorOffTimers(),[clearSensorOffTimers]);
  const commandIntervalRef=useRef(commandIntervalMs);
  commandIntervalRef.current=commandIntervalMs;
  const normalQueue=useRef<string[]>([]);
  const normalTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const lastNormalSent=useRef(0);
  const clearNormalQueue=useCallback(()=>{
    normalQueue.current=[];
    if(normalTimer.current!==null){clearTimeout(normalTimer.current);normalTimer.current=null;}
    lastNormalSent.current=0;
  },[]);
  const flushNormalQueue=useCallback(function flushNormalQueue(){
    normalTimer.current=null;
    const ws=socket.current;
    if(!ws||ws.readyState!==WebSocket.OPEN){normalQueue.current=[];return;}
    const command=normalQueue.current.shift();
    if(!command)return;
    ws.send(command);
    lastNormalSent.current=Date.now();
    if(normalQueue.current.length){
      normalTimer.current=setTimeout(flushNormalQueue,commandIntervalRef.current);
    }
  },[]);
  const saveTimingSettings=(values:{sensorOffDelayMs:number;turnoutCommandIntervalMs:number;turnoutSettlingMs:number}):boolean=>{
    const {sensorOffDelayMs:off,turnoutCommandIntervalMs:interval,turnoutSettlingMs:settling}=values;
    if(!Number.isInteger(off)||off<100||off>1000||
       !Number.isInteger(interval)||interval<0||interval>1000||
       !Number.isInteger(settling)||settling<0||settling>30000)return false;
    const keys=['dcc-ex-ui.sensorOffDelayMs','dcc-ex-ui.commandIntervalMs','dcc-ex-ui.turnoutSettlingMs'];
    const next=[String(off),String(interval),String(settling)];
    try{
      const previous=keys.map(key=>localStorage.getItem(key));
      try{keys.forEach((key,i)=>localStorage.setItem(key,next[i]));}
      catch(error){
        keys.forEach((key,i)=>{try{if(previous[i]===null)localStorage.removeItem(key);else localStorage.setItem(key,previous[i]!);}catch{/* best effort rollback */}});
        throw error;
      }
    }catch{return false;}
    setSensorOffDelayMs(off);
    setCommandIntervalMs(interval);
    setTurnoutSettlingMs(settling);
    return true;
  };
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
  const lastReportedPower=useRef<boolean|null>(null);
  const [emergencyStop,setEmergencyStop] = useState(false);
  const [, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const active = useRef({ address: Number(address), speed: 0, forward: true });
  const append = useCallback((line: string) => setLog(lines => [line, ...lines].slice(0, 30)), []);
  const send = useCallback((command: string): boolean => {
    const ws=socket.current;
    if(ws?.readyState!==WebSocket.OPEN){setError('Not connected to a WebSocket endpoint.');return false;}
    // Priority safety commands bypass the normal command interval and discard stale movements.
    if(command.startsWith('<!')||command==='<0>'){
      clearNormalQueue();
      ws.send(command);
      append('TX '+command);
      return true;
    }
    // Send normal commands in order, respecting the minimum command interval.
    normalQueue.current.push(command);
    if(normalTimer.current===null){
      const elapsed=Date.now()-lastNormalSent.current;
      const delay=lastNormalSent.current===0?0:Math.max(0,commandIntervalRef.current-elapsed);
      normalTimer.current=setTimeout(flushNormalQueue,delay);
    }
    append('TX queued '+command);
    return true;
  },[append,clearNormalQueue,flushNormalQueue]);
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
    clearNormalQueue(); clearSensorOffTimers(); socket.current?.close(); socket.current = null; lastReportedPower.current=null; setStatus('disconnected'); setPower(null); setSpeed(0);
    setLocoStates({});
    publishConnectionStatus('disconnected');
  }, [clearNormalQueue,clearSensorOffTimers]);
  useEffect(() => () => { clearNormalQueue(); clearSensorOffTimers(); socket.current?.close(); }, [clearNormalQueue,clearSensorOffTimers]);
  const connect = () => {
    setError('');
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') throw new Error('URL must start with ws:// or wss://');
      // DCC-EX replies with Sec-WebSocket-Protocol: DCCEX. Browsers require us to request it.
      const ws = new WebSocket(parsed.href, 'DCCEX');
      queriedLocos.current.clear();
      clearNormalQueue();
      clearSensorOffTimers();
      lastReportedPower.current=null;
      setPower(null);
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
        ws.send('<s><Q>'); // Fetch power and current sensor states at connection
      };
      ws.onmessage = event => {
        if (socket.current !== ws) return;
        if (typeof event.data !== 'string') return;
        const frames = parseFrames(event.data);
        for (const frame of frames.length ? frames : [event.data]) {
          append('RX ' + frame);
          if(frame.trim()==='<!PAUSED>')setEmergencyStop(true);
          else if(frame.trim()==='<!RESUMED>')setEmergencyStop(false);
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
            const pending=sensorOffTimers.current.get(sensorAddress);
            if(pending!==undefined){clearTimeout(pending);sensorOffTimers.current.delete(sensorAddress);}
            if(sensor[1]==='Q')publishSensorFeedback(sensorAddress,true);
            else {
              const timer=setTimeout(()=>{
                sensorOffTimers.current.delete(sensorAddress);
                if(socket.current===ws)publishSensorFeedback(sensorAddress,false);
              },sensorOffDelayRef.current);
              sensorOffTimers.current.set(sensorAddress,timer);
            }
          }
          const powerFeedback=/^<p([01])(?:\s+(MAIN|ALL))?>$/.exec(frame.trim());
          if(powerFeedback){
            const isOn=powerFeedback[1]==='1';
            const wasOn=lastReportedPower.current===true;
            lastReportedPower.current=isOn;
            setPower(isOn);
            // Re-fetch the full DCC-EX sensor state after track power becomes ON.
            // Avoid repeated queries when the station broadcasts the same power state.
            if(isOn&&!wasOn){
              clearSensorOffTimers();
              publishSensorSnapshot([]);
              ws.send('<Q>');
              append('TX <Q> (power on sensor refresh)');
            }
          }
        }
      };
      ws.onerror = () => { if (socket.current === ws) setError('WebSocket connection failed. Verify that the station or bridge supports WebSocket, not just TCP.'); };
      ws.onclose = () => { if (socket.current === ws) { clearNormalQueue(); clearSensorOffTimers(); lastReportedPower.current=null; socket.current = null; setStatus('disconnected'); setPower(null); publishConnectionStatus('disconnected'); setSpeed(0); setLocoStates({}); append('Disconnected'); } };
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
  const engageEmergencyStop=()=>{
    // DCC-EX sends emergency stop to all throttle reminder slots, not power off.
    if(!send(emergencyStopCommand()))return;
    setEmergencyStop(true);
    active.current.speed=0;
    setSpeed(0);
    setLocoStates(previous=>{
      const next:Record<number,LocoLiveState>={};
      for(const [key,state] of Object.entries(previous)){
        next[Number(key)]=state.known?{...state,speed:0,emergencyStop:true}:state;
      }
      return next;
    });
  };
  const releaseEmergencyStop=()=>{
    // Exact DCC-EX sequence from the original .NET wrapper:
    // ESTOPALL clears remembered speeds, then RESUME releases the pause.
    // Do not send speed commands in between, and do not change track power.
    if(!send(emergencyResumeCommand()))return;
    setEmergencyStop(false);
    active.current.speed=0;
    setSpeed(0);
    setLocoStates(previous=>{
      const next:Record<number,LocoLiveState>={};
      for(const [key,state] of Object.entries(previous)){
        next[Number(key)]=state.known?{...state,speed:0,emergencyStop:false}:state;
      }
      return next;
    });
  };
  const toggleTrackPower=()=>{
    if(!send(trackPowerCommand(power!==true)))return;
    // Only station <p0>/<p1> feedback confirms track power.
  };
  const drive=(nextSpeed:number,nextForward=forward)=>driveAddress(Number(address),nextSpeed,nextForward);
  const ready = status === 'connected';
  const [connectSettingsOpen,setConnectSettingsOpen] = useState(false);
  const [locoEditorOpen,setLocoEditorOpen] = useState(false);
  const [deleteLayoutOpen,setDeleteLayoutOpen]=useState(false);
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
        <Modal opened={deleteLayoutOpen} onClose={()=>setDeleteLayoutOpen(false)}
          title="Delete layout data" centered>
          <Stack gap="md">
            <Alert color="red" icon={<IconAlertTriangle size={18}/>}>
              This will permanently delete all {project.elements.length} layout elements and
              {project.stations?.length??0} stations from the current browser project.
              Locomotives, functions and connection settings will be kept.
            </Alert>
            <Text size="sm">Export your project first if you might need the layout later.</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={()=>setDeleteLayoutOpen(false)}>Cancel</Button>
              <Button color="red" leftSection={<IconTrash size={16}/>}
                disabled={!loaded || (project.elements.length===0 && (project.stations?.length??0)===0)}
                onClick={()=>{
                  setProject(previous=>({...previous,elements:[],stations:[]}));
                  setDeleteLayoutOpen(false);
                }}>Delete layout</Button>
            </Group>
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
              <Card withBorder p="md" radius="sm">
                <Group justify="space-between" align="center" wrap="wrap">
                  <Stack gap={2}>
                    <Text fw={600}>Data management</Text>
                    <Text size="sm" c="dimmed">Remove layout data from the browser project without deleting locomotives.</Text>
                  </Stack>
                  <Button variant="light" color="red" leftSection={<IconTrash size={16}/>}
                    disabled={!loaded || (project.elements.length===0 && (project.stations?.length??0)===0)}
                    onClick={()=>setDeleteLayoutOpen(true)}>Delete layout data</Button>
                </Group>
              </Card>
            </Stack>
          </Container>
        ) : (
          <Box px={8} py={8} style={{height:'100dvh',minHeight:0,overflow:'hidden'}}>
            <BrowserLayoutPage
              sensorOffDelayMs={sensorOffDelayMs}
              turnoutCommandIntervalMs={commandIntervalMs}
              turnoutSettlingMs={turnoutSettlingMs}
              onSaveTimingSettings={saveTimingSettings}
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
              onEmergencyToggle={emergencyStop?releaseEmergencyStop:engageEmergencyStop}
              onEmergencyStop={emergencyStop?releaseEmergencyStop:engageEmergencyStop}
              emergencyStop={emergencyStop}
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
              onTogglePower={toggleTrackPower}
              powerOn={power===true}
              powerKnown={power!==null}
              elementCount={project.elements.length}
            />
          </Box>
        )}
        {error&&<Alert color="red" icon={<IconAlertTriangle size={17}/>} title="Error" withCloseButton onClose={()=>setError('')} mx="md" my="xs">{error}</Alert>}
      </AppShell.Main>
    </AppShell>
  );
}
