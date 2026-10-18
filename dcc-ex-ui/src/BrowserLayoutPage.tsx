import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ActionIcon, Badge, Box, Button, Card, Group, SegmentedControl, Slider, Stack, Switch, Text, Title } from '@mantine/core';
import { IconChevronLeft, IconChevronRight, IconPlayerStop, IconSettings, IconTrain } from '@tabler/icons-react';
import type {Loco} from './storage';
type Props={locos:Loco[];activeAddress:number;onSelectLoco:(v:number)=>void;connected:boolean;speed:number;forward:boolean;onSpeed:(v:number)=>void;onDrive:(v:number,d?:boolean)=>void;onStop:()=>void;onDirection:(v:boolean)=>void;onFunction:(v:boolean)=>void;light:boolean};
function preference(key:string,defaultValue:number){try{return Number(localStorage.getItem(key))||defaultValue;}catch{return defaultValue;}}
export function BrowserLayoutPage(props:Props){
 const [leftWidth,setLeftWidth]=useState(()=>preference('dcc-ex-ui.layout.left',380));
 const [rightWidth,setRightWidth]=useState(()=>preference('dcc-ex-ui.layout.right',380));
 const [leftOpen,setLeftOpen]=useState(true); const [rightOpen,setRightOpen]=useState(true);
 const dragging=useRef<{side:'left'|'right';x:number;width:number}|null>(null);
 useEffect(()=>{const move=(e:globalThis.PointerEvent)=>{const d=dragging.current;if(!d)return;const width=Math.max(245,Math.min(570,d.width+(e.clientX-d.x)*(d.side==='left'?1:-1)));if(d.side==='left')setLeftWidth(width);else setRightWidth(width);};const up=()=>{dragging.current=null;document.body.style.cursor='';};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);};},[]);
 useEffect(()=>{localStorage.setItem('dcc-ex-ui.layout.left',String(leftWidth));},[leftWidth]);useEffect(()=>{localStorage.setItem('dcc-ex-ui.layout.right',String(rightWidth));},[rightWidth]);
 const resize=(side:'left'|'right',event:PointerEvent<HTMLDivElement>)=>{dragging.current={side,x:event.clientX,width:side==='left'?leftWidth:rightWidth};document.body.style.cursor='col-resize';};
 return <Stack gap={4} style={{flex:1,minHeight:0}}>
  <Box style={{display:'grid',gridTemplateColumns:(leftOpen?leftWidth+'px':'0px')+' 12px minmax(0,1fr) 12px '+(rightOpen?rightWidth+'px'),flex:1,minHeight:0}}>
   {leftOpen&&<Card withBorder p="sm" radius="sm" style={{minHeight:0,overflowY:'auto'}}>
     <Stack gap="sm"><Group justify="space-between"><Title order={5}>Locomotive</Title><IconTrain size={18}/></Group>
     <Text size="xs" c="dimmed">Manual throttle · DCC-EX</Text>
     <select style={{width:'100%',background:'var(--mantine-color-body)',color:'inherit',padding:9,border:'1px solid var(--mantine-color-default-border)',borderRadius:5}} disabled={props.speed>0} value={props.activeAddress} onChange={e=>props.onSelectLoco(Number(e.target.value))}>
       {!props.locos.some(l=>l.address===props.activeAddress)&&<option value={props.activeAddress}>DCC {props.activeAddress}</option>}
       {props.locos.map(l=><option key={l.id} value={l.address}>{l.name} · {l.address}</option>)}
     </select>
     <Group justify="space-between"><Text size="sm">Speed</Text><Title order={3}>{props.speed}</Title></Group>
     <Slider min={0} max={126} disabled={!props.connected} value={props.speed} onChange={props.onSpeed} onChangeEnd={v=>props.onDrive(v)} />
     <SegmentedControl fullWidth disabled={!props.connected} value={props.forward?'f':'r'} onChange={v=>props.onDirection(v==='f')} data={[{label:'Forward',value:'f'},{label:'Reverse',value:'r'}]}/>
     <Button color="red" disabled={!props.connected} leftSection={<IconPlayerStop size={17}/>} onClick={props.onStop}>STOP</Button>
     <Switch label="F0 · Headlight" checked={props.light} disabled={!props.connected} onChange={e=>props.onFunction(e.currentTarget.checked)}/>
     </Stack>
   </Card>}
   <Box onPointerDown={e=>resize('left',e)} style={{cursor:'col-resize',display:'grid',placeItems:'center',background:'var(--mantine-color-dark-6)'}}><ActionIcon size="xs" variant="subtle" onPointerDown={e=>e.stopPropagation()} onClick={()=>setLeftOpen(v=>!v)}>{leftOpen?<IconChevronLeft size={15}/>:<IconChevronRight size={15}/>}</ActionIcon></Box>
   <Card withBorder p={4} radius="sm" style={{minWidth:0,minHeight:0,display:'flex',flexDirection:'column'}}>
     <Group justify="space-between" px="sm" py={6}><Text size="sm" fw={600}>TrackCanvas</Text><Badge variant="outline" size="xs">Original editor port pending</Badge></Group>
     <Box style={{flex:1,minHeight:300,background:'var(--mantine-color-dark-8)',border:'1px solid var(--mantine-color-default-border)',display:'grid',placeItems:'center'}}>
       <Stack align="center" maw={390} px="md"><Title order={5} ta="center">Original TrackCanvas integration</Title><Text c="dimmed" size="sm" ta="center">The alpha6 canvas sources are imported, but still require their editor model and backend-free interaction adapters before mounting. No replacement canvas is rendered.</Text></Stack>
     </Box>
   </Card>
   <Box onPointerDown={e=>resize('right',e)} style={{cursor:'col-resize',display:'grid',placeItems:'center',background:'var(--mantine-color-dark-6)'}}><ActionIcon size="xs" variant="subtle" onPointerDown={e=>e.stopPropagation()} onClick={()=>setRightOpen(v=>!v)}>{rightOpen?<IconChevronRight size={15}/>:<IconChevronLeft size={15}/>}</ActionIcon></Box>
   {rightOpen&&<Card withBorder p="sm" radius="sm"><Group gap="xs"><IconSettings size={17}/><Title order={5}>Properties</Title></Group><Text mt="md" c="dimmed" size="sm">Select an element in the original canvas to edit its properties.</Text></Card>}
  </Box>
  <Card withBorder p={5} radius="sm"><Group justify="space-between" px="sm"><Text size="xs">DCCExpressHub Browser · Layout editor</Text><Group gap="md"><Text size="xs">{props.locos.length} locomotives</Text><Badge color={props.connected?'green':'gray'} size="xs">{props.connected?'Connected':'Disconnected'}</Badge></Group></Group></Card>
 </Stack>;
}
