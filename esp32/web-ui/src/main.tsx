import React, {useCallback, useEffect, useRef, useState} from 'react';
import ReactDOM from 'react-dom/client';
import '@mantine/core/styles.css';
import {MantineProvider, AppShell, Container, Title, Text, TextInput, Button, Group, Paper, Table, Badge, Stack, Switch, NumberInput, Alert} from '@mantine/core';

type State='on'|'off'|'unknown';
type Accessory={address:number;inverted:boolean;state:State};
type Message=
  |{type:'snapshot';accessories:Accessory[];sequence:number;overflow:boolean}
  |{type:'accessory.changed';address:number;value:State;sequence:number}
  |{type:'resync.required'}
  |{type:'error';reason:string}
  |{type:'accepted'};

function App(){
  const [host,setHost]=useState('ws://192.168.4.1/ws');
  const [rows,setRows]=useState<Accessory[]>([]);
  const [connected,setConnected]=useState(false);
  const [seq,setSeq]=useState<number|null>(null);
  const [error,setError]=useState('');
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
      socket.onopen=()=>{setConnected(true);setError('');socket?.send(JSON.stringify({type:'snapshot.get'}));};
      socket.onmessage=e=>{
        try{
          const msg=JSON.parse(e.data as string) as Message;
          if(msg.type==='snapshot'){
            setRows(msg.accessories);seqRef.current=msg.sequence;setSeq(msg.sequence);
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
      <Paper withBorder p="md"><Group align="end"><TextInput style={{flex:1}} label="WebSocket URL" value={host} onChange={e=>setHost(e.currentTarget.value)}/><Button disabled={!connected} onClick={()=>send({type:'snapshot.get'})}>Snapshot</Button></Group><Text size="xs" c="dimmed">Test AP: Hub-ESP32-Test / hub-test-1234. Mock command station only.</Text></Paper>
      {!!error&&<Alert color="red" title="Communication">{error}</Alert>}
      <Paper withBorder p="md"><Group justify="space-between"><Title order={4}>Accessories</Title><Text size="sm">Sequence {seq??'—'}</Text></Group>
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
