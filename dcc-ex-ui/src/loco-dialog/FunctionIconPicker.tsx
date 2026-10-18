import { useEffect,useState } from 'react';
import { ActionIcon, Button, ColorInput, Group, Modal, ScrollArea, SegmentedControl, SimpleGrid, Stack, Text } from '@mantine/core';
import { BUILTIN_FUNCTION_ICONS, getBuiltinFunctionIcon } from './FunctionIconRegistry';
import type { LocoFunction } from '../storage';
type Mode=NonNullable<LocoFunction['iconTintMode']>;
export default function FunctionIconPicker({opened,value,onClose,onSelect}:{opened:boolean;value:string;onClose:()=>void;onSelect:(value:string,mode:Mode,color:string)=>void}){
 const [selected,setSelected]=useState(value);
 const [mode,setMode]=useState<Mode>('original');
 const [color,setColor]=useState('#ffffff');
 useEffect(()=>{if(opened)setSelected(value);},[opened,value]);
 return <Modal opened={opened} onClose={onClose} title="Function icon" size="lg" centered>
  <Stack>
   <ScrollArea h={320}><SimpleGrid cols={5} spacing="xs">{BUILTIN_FUNCTION_ICONS.map(([id,label])=>{
    const Icon=getBuiltinFunctionIcon(id);
    return <Button key={id} size="compact-md" h={68} variant={selected===id?'filled':'light'} onClick={()=>setSelected(id)}>
      <Stack gap={3} align="center">{Icon&&<Icon size={23}/>}<Text size="xs">{label}</Text></Stack>
    </Button>;
   })}</SimpleGrid></ScrollArea>
   <Group><SegmentedControl value={mode} onChange={v=>setMode(v as Mode)} data={[{value:'original',label:'Original'},{value:'tint',label:'Tint'}]}/><ColorInput label="Tint color" size="xs" value={color} onChange={setColor}/></Group>
   <Group justify="flex-end"><Button variant="light" onClick={()=>{setSelected('');onSelect('','original','#ffffff');onClose();}}>Clear</Button><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={()=>{onSelect(selected,mode,color);onClose();}}>OK</Button></Group>
  </Stack>
 </Modal>;
}
