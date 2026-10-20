import React, {useEffect,useState} from 'react';
import ReactDOM from 'react-dom/client';
import '@mantine/core/styles.css';
import {MantineProvider,AppShell,Container,Title,Text,TextInput,Button,Group,Paper,Table,Badge,Stack,Switch,NumberInput,Alert} from '@mantine/core';

type Accessory={address:number;inverted:boolean;state:'on'|'off'|'unknown'};
type Snapshot={accessories:Accessory[];sequence:number;overflow:boolean};
function App(){
  const [host,setHost]=useState('http://192.168.4.1');
  const [rows,setRows]=useState<Accessory[]>([]);
  const [seq,setSeq]=useState(0);
  const [overflow,setOverflow]=useState(false);
  const [error,setError]=useState('');
  const [address,setAddress]=useState<number|string>(22);
  const [inverted,setInverted]=useState(false);
  const root=host.replace(/\/$/,'');
  const refresh=async()=>{
    try{
      const res=await fetch(root+'/api/accessories');
      if(!res.ok)throw new Error('HTTP '+res.status);
      const data=await res.json() as Snapshot;
      setRows(data.accessories);setSeq(data.sequence);setOverflow(data.overflow);setError('');
    }catch(e){setError(String(e));}
  };
  const post=async(path:string,params:Record<string,string>)=>{
    try{
      const res=await fetch(root+path+'?'+new URLSearchParams(params),{method:'POST'});
      if(!res.ok)throw new Error(res.status+': '+await res.text());
      await refresh();
    }catch(e){setError(String(e));}
  };
  useEffect(()=>{void refresh();const timer=setInterval(()=>{void refresh();},1000);return()=>clearInterval(timer);},[root]);
  return <AppShell header={{height:60}} padding="md">
    <AppShell.Header><Group px="lg" h="100%"><Title order={3}>Hub ESP32 Test</Title><Badge>Prototype</Badge></Group></AppShell.Header>
    <AppShell.Main><Container size="lg"><Stack>
      <Paper withBorder p="md"><Group align="end"><TextInput style={{flex:1}} label="ESP32 URL" value={host} onChange={e=>setHost(e.currentTarget.value)}/><Button onClick={()=>void refresh()}>Refresh</Button></Group><Text size="xs" c="dimmed">Wi-Fi Hub-ESP32-Test / hub-test-1234. Simulated CC only.</Text></Paper>
      {error&&<Alert color="red" title="Error">{error}</Alert>}
      {overflow&&<Alert color="red" title="Event overflow">Resynchronization required.</Alert>}
      <Paper withBorder p="md"><Group justify="space-between"><Title order={4}>Accessories</Title><Text size="sm">Sequence {seq}</Text></Group>
        <Table striped><Table.Thead><Table.Tr><Table.Th>Address</Table.Th><Table.Th>Inverted</Table.Th><Table.Th>State</Table.Th><Table.Th>Logical command</Table.Th><Table.Th>Mock raw feedback</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{rows.map(a=><Table.Tr key={a.address}>
          <Table.Td>{a.address}</Table.Td><Table.Td>{String(a.inverted)}</Table.Td>
          <Table.Td><Badge color={a.state==='on'?'green':a.state==='off'?'gray':'orange'}>{a.state.toUpperCase()}</Badge></Table.Td>
          <Table.Td><Group gap="xs"><Button size="compact-sm" onClick={()=>void post('/api/accessory/set',{address:String(a.address),value:'true'})}>ON</Button><Button variant="default" size="compact-sm" onClick={()=>void post('/api/accessory/set',{address:String(a.address),value:'false'})}>OFF</Button></Group></Table.Td>
          <Table.Td><Group gap="xs"><Button size="compact-sm" variant="light" onClick={()=>void post('/api/accessory/feedback',{address:String(a.address),raw:'true'})}>Raw 1</Button><Button size="compact-sm" variant="light" onClick={()=>void post('/api/accessory/feedback',{address:String(a.address),raw:'false'})}>Raw 0</Button></Group></Table.Td>
        </Table.Tr>)}</Table.Tbody></Table>
      </Paper>
      <Paper withBorder p="md"><Title order={4}>SetConfig</Title><Group align="end"><NumberInput label="Address" min={0} max={65535} value={address} onChange={setAddress}/><Switch label="Inverted" checked={inverted} onChange={e=>setInverted(e.currentTarget.checked)}/><Button onClick={()=>void post('/api/accessory/config',{address:String(address),inverted:String(inverted)})}>Save</Button></Group></Paper>
      <Text size="sm" c="dimmed">HTTP snapshot polling every second; events are printed to ESP32 Serial. No physical command station connected.</Text>
    </Stack></Container></AppShell.Main>
  </AppShell>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><MantineProvider defaultColorScheme="dark"><App/></MantineProvider></React.StrictMode>);
