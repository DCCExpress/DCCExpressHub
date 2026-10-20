import React, {useCallback, useEffect, useRef, useState} from 'react';
import ReactDOM from 'react-dom/client';
import '@mantine/core/styles.css';
import {MantineProvider, AppShell, Container, Title, Text, TextInput, Button, Group, Paper, Table, Badge, Stack, Switch, NumberInput, Alert, Select, PasswordInput} from '@mantine/core';

type State='on'|'off'|'unknown';
type Accessory={address:number;inverted:boolean;state:State};
type Message=
  |{type:'snapshot';accessories:Accessory[];sequence:number;overflow:boolean;commandCenter?:string;ccConnected?:boolean}
  |{type:'accessory.changed';address:number;value:State;sequence:number}
  |{type:'resync.required'}
  |{type:'error';reason:string}
  |{type:'accepted'}
  |{type:'cc.config';driver:string;host:string;port:number;wifiSsid:string;wifiConnected:boolean;ccConnected:boolean};

function App(){
  const [host,setHost]=useState('ws://192.168.4.1/ws');
  const [rows,setRows]=useState<Accessory[]>([]);
  const [connected,setConnected]=useState(false);
  const [ccName,setCcName]=useState('—');
  const [ccConnected,setCcConnected]=useState(false);
  const [seq,setSeq]=useState<number|null>(null);
  const [error,setError]=useState('');
  const [driver,setDriver]=useState('mock');
  const [tcpHost,setTcpHost]=useState('');
  const [tcpPort,setTcpPort]=useState<number|string>(2560);
  const [wifiSsid,setWifiSsid]=useState('');
  const [wifiPassword,setWifiPassword]=useState('');
  const [wifiOnline,setWifiOnline]=useState(false);
  const [address,setAddress]=useState<number|string>(22);
  const [inverted,setInverted]=useState(false);
  const wsRef=useRef<WebSocket|null>(null);
  const seqRef=useRef<number|null>(null);

  const send=useCallback((message:Record<string,unknown>)=>{
    if(wsRef.current?.readyState!==WebSocket.OPEN){setError('WebSocket disconnected');return;}
    wsRef.current.send(JSON.stringify(message));
  },[]);

  useEffect(()=>{
    let closed=false;
    let socket:WebSocket|null=null;
    let reconnect:ReturnType<typeof setTimeout>|undefined;
    function connect(){
      if(closed)return;
      try{socket=new WebSocket(host);wsRef.current=socket;}catch(e){setError(String(e));reconnect=setTimeout(connect,2000);return;}
      socket.onopen=()=>{setConnected(true);setError('');socket?.send(JSON.stringify({type:'snapshot.get'}));socket?.send(JSON.stringify({type:'cc.config.get'}));};
      socket.onmessage=e=>{
        try{
          const msg=JSON.parse(e.data as string) as Message;
          if(msg.type==='cc.config'){
            setDriver(msg.driver);setTcpHost(msg.host);setTcpPort(msg.port);setWifiSsid(msg.wifiSsid);setWifiOnline(msg.wifiConnected);setCcConnected(msg.ccConnected);
          }else if(msg.type==='snapshot'){
            setRows(msg.accessories);seqRef.current=msg.sequence;setSeq(msg.sequence);
            setCcName(msg.commandCenter??'Unknown');setCcConnected(msg.ccConnected??false);
            if(msg.overflow)setError('Event overflow: firmware requires resync/safe recovery.');
          }else if(msg.type==='accessory.changed'){
            if(seqRef.current!==null && msg.sequence!==seqRef.current+1){
              setError('Missed event; requesting full snapshot');
              socket?.send(JSON.stringify({type:'snapshot.get'}));
            }
            seqRef.current=msg.sequence;setSeq(msg.sequence);
            setRows(old=>old.map(a=>a.address===msg.address?{...a,state:msg.value}:a));
          }else if(msg.type==='resync.required'){
            setError('Event overflow: manual safe resync required');
          }else if(msg.type==='error'){setError(msg.reason);}
        }catch(e){setError(String(e));}
      };
      socket.onclose=()=>{setConnected(false);if(!closed)reconnect=setTimeout(connect,2000);};
      socket.onerror=()=>setError('WebSocket network error');
    }
    connect();
    return()=>{closed=true;if(reconnect)clearTimeout(reconnect);socket?.close();if(wsRef.current===socket)wsRef.current=null;};
  },[host]);

  return <AppShell header={{height:60}} padding="md">
    <AppShell.Header><Group px="lg" h="100%"><Title order={3}>Hub ESP32 Test</Title><Badge color={connected?'green':'red'}>{connected?'WS online':'WS offline'}</Badge></Group></AppShell.Header>
    <AppShell.Main><Container size="lg"><Stack>
      <Paper withBorder p="md"><Group align="end"><TextInput style={{flex:1}} label="WebSocket URL" value={host} onChange={e=>setHost(e.currentTarget.value)}/><Button disabled={!connected} onClick={()=>send({type:'snapshot.get'})}>Snapshot</Button></Group><Text size="xs" c="dimmed">Test AP: Hub-ESP32-Test / hub-test-1234. Select Mock or DCC-EX TCP below.</Text></Paper>
      <Paper withBorder p="md"><Stack gap="sm">
        <Title order={4}>Command Center connection</Title>
        <Group grow><Select label="Driver" data={[{label:'Mock',value:'mock'},{label:'DCC-EX TCP',value:'dcc-ex-tcp'}]} value={driver} onChange={v=>setDriver(v??'mock')}/><TextInput label="TCP host / IP" value={tcpHost} disabled={driver!=='dcc-ex-tcp'} onChange={e=>setTcpHost(e.currentTarget.value)}/><NumberInput label="TCP port" min={1} max={65535} value={tcpPort} disabled={driver!=='dcc-ex-tcp'} onChange={setTcpPort}/></Group>
        <Group grow><TextInput label="Wi-Fi network (SSID)" value={wifiSsid} onChange={e=>setWifiSsid(e.currentTarget.value)}/><PasswordInput label="Wi-Fi password (leave blank to retain)" value={wifiPassword} onChange={e=>setWifiPassword(e.currentTarget.value)}/></Group>
        <Group justify="space-between"><Text size="sm">Wi-Fi STA: {wifiOnline?'Connected':'Disconnected'} · CC: {ccConnected?'Connected':'Disconnected'}</Text><Button disabled={!connected||tcpPort===''||(driver==='dcc-ex-tcp'&&!tcpHost.trim())} onClick={()=>{send({type:'cc.config.set',driver,host:tcpHost,port:Number(tcpPort),wifiSsid,wifiPassword});setWifiPassword('');}}>Save & reconnect</Button></Group>
        <Text size="xs" c="dimmed">The ESP32 test AP stays active. For a remote command station, enter Wi-Fi credentials for a network that can reach its IP. No TLS/authentication in this bench prototype.</Text>
      </Stack></Paper>
      {!!error&&<Alert color="red" title="Communication">{error}</Alert>}
      <Paper withBorder p="md"><Group justify="space-between"><Title order={4}>Accessories</Title><Badge color={ccConnected?'green':'orange'}>CC: {ccName} · {ccConnected?'Connected':'Disconnected'}</Badge><Text size="sm">Sequence {seq??'—'}</Text></Group>
        <Table striped><Table.Thead><Table.Tr><Table.Th>Address</Table.Th><Table.Th>Inverted</Table.Th><Table.Th>State</Table.Th><Table.Th>Logical command</Table.Th><Table.Th>Mock raw feedback</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{rows.map(a=><Table.Tr key={a.address}>
          <Table.Td>{a.address}</Table.Td><Table.Td>{String(a.inverted)}</Table.Td>
          <Table.Td><Badge color={a.state==='on'?'green':a.state==='off'?'gray':'orange'}>{a.state.toUpperCase()}</Badge></Table.Td>
          <Table.Td><Group gap="xs"><Button disabled={!connected} size="compact-sm" onClick={()=>send({type:'accessory.set',address:a.address,value:true})}>ON</Button><Button disabled={!connected} variant="default" size="compact-sm" onClick={()=>send({type:'accessory.set',address:a.address,value:false})}>OFF</Button></Group></Table.Td>
          <Table.Td><Group gap="xs"><Button disabled={!connected} size="compact-sm" variant="light" onClick={()=>send({type:'accessory.feedback',address:a.address,raw:true})}>Raw 1</Button><Button disabled={!connected} size="compact-sm" variant="light" onClick={()=>send({type:'accessory.feedback',address:a.address,raw:false})}>Raw 0</Button></Group></Table.Td>
        </Table.Tr>)}</Table.Tbody></Table>
      </Paper>
      <Paper withBorder p="md"><Title order={4}>SetConfig</Title><Group align="end"><NumberInput label="Address" min={0} max={65535} value={address} onChange={setAddress}/><Switch label="Inverted" checked={inverted} onChange={e=>setInverted(e.currentTarget.checked)}/><Button disabled={!connected||address===''} onClick={()=>send({type:'accessory.config',address:Number(address),inverted})}>Save</Button></Group></Paper>
      <Text size="sm" c="dimmed">Snapshot on connect, subsequent state changes pushed via WebSocket. No polling.</Text>
    </Stack></Container></AppShell.Main>
  </AppShell>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><MantineProvider defaultColorScheme="dark"><App/></MantineProvider></React.StrictMode>);
