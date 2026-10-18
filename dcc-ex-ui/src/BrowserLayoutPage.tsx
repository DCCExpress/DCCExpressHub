import { Badge, Box, Card, Group, Stack, Text, Title, Button } from '@mantine/core';
import type { Loco } from './storage';

export function BrowserLayoutPage({locos,activeAddress,onSelectLoco,connected}:{locos:Loco[];activeAddress:number;onSelectLoco:(address:number)=>void;connected:boolean}) {
  return <Stack gap="sm">
    <Group justify="space-between"><Title order={4}>Layout</Title><Group><Button disabled>Save layout</Button><Badge color={connected?'green':'gray'}>{connected?'Connected':'Offline'}</Badge></Group></Group>
    <Box style={{display:'grid',gridTemplateColumns:'230px minmax(0,1fr) 250px',gap:10,minHeight:'min(72vh,800px)'}}>
      <Card withBorder p="sm"><Stack gap="sm"><Title order={5}>LocoPanel</Title>{locos.map(l=><Button key={l.id} fullWidth variant={activeAddress===l.address?'filled':'light'} onClick={()=>onSelectLoco(l.address)}>{l.name} · {l.address}</Button>)}<Text size="xs" c="dimmed">Manual throttle controls are currently on Home.</Text></Stack></Card>
      <Card withBorder p="sm"><Group justify="space-between"><Title order={5}>TrackCanvas</Title><Badge variant="outline">Port in progress</Badge></Group><Box style={{height:'90%',minHeight:410,display:'grid',placeItems:'center',border:'1px dashed var(--mantine-color-gray-6)',marginTop:12}}><Stack align="center" gap="xs"><Text fw={600}>Original web-ui TrackCanvas</Text><Text size="sm" c="dimmed" maw={430} ta="center">The original canvas and LiteLayoutPage are in upstream-web-ui. Runtime services and editor context must be disconnected from the backend before mounting them here.</Text></Stack></Box></Card>
      <Card withBorder p="sm"><Stack><Title order={5}>PropertyPanel</Title><Text size="sm" c="dimmed">Original element properties will appear when the TrackCanvas is connected.</Text></Stack></Card>
    </Box>
    <Card withBorder py={6} px="md"><Group justify="space-between"><Text size="xs">DCCExpressHub Browser · Manual control</Text><Text size="xs">{locos.length} locomotives · {connected?'WebSocket online':'WebSocket offline'}</Text></Group></Card>
  </Stack>;
}
