import { useMemo } from 'react';
import { Badge, Card, Checkbox, ColorInput, Divider, Group, Kbd, NumberInput, ScrollArea, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import type { TrackElement } from './storage';
import type { IEditableProperty } from './preview-webui/models/editor/elements/PropertyDescriptor';
import { restoreBrowserElement } from './BrowserTrackCanvas';

const textByKey:Record<string,string>={
 'ui.name':'Name','ui.length':'Length','ui.occupancySensorAddress':'Occupancy sensor',
 'ui.sensorAddress':'Sensor address','ui.accessoryAddress':'Accessory address',
 'ui.outputType':'Output type','ui.address':'Address','ui.activeColor':'Active color',
 'ui.signal2':'Signal','ui.turnoutPositions':'Turnout positions','ui.variant':'Variant',
 'ui.label':'Label','ui.audioFile':'Audio file',
 'ui.blockType':'Block type','ui.trackColor':'Track color'
};
const caption=(key:string)=>textByKey[key]??(key.startsWith('ui.')?key.slice(3):key);
const asNumeric=(value:unknown,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?value:Number(value)||fallback;

type Props={
 selected:TrackElement|null;
 onPatch:(patch:Partial<TrackElement>)=>void;
};
export default function BrowserPropertyPanel({selected,onPatch}:Props){
 const descriptors=useMemo(()=>{
  if(!selected)return [];
  try{
   const model=restoreBrowserElement(selected,0);
   return model?.getEditableProperties()??[];
  }catch(error){console.warn('Could not load upstream element properties',error);return [];}
 },[selected]);
 const current=selected as (TrackElement&Record<string,unknown>)|null;
 const change=(prop:IEditableProperty,value:unknown)=>{
  if(prop.readonly)return;
  if(prop.validate&&!prop.validate(value))return;
  onPatch({[prop.key]:value} as Partial<TrackElement>);
 };
 const render=(prop:IEditableProperty)=>{
  const value=current?.[prop.key];
  const label=caption(prop.label);
  switch(prop.type){
   case 'string':
    return <TextInput key={prop.key} size="xs" label={label} readOnly={prop.readonly}
     value={String(value??'')} onChange={e=>change(prop,e.currentTarget.value)}/>;
   case 'number':
    return <NumberInput key={prop.key} size="xs" label={label} min={prop.min} max={prop.max}
     disabled={prop.readonly} value={asNumeric(value)}
     onChange={v=>{const number=Number(v);if(Number.isFinite(number))change(prop,number);}}/>;
   case 'checkbox':case 'boolean':
    return <Checkbox key={prop.key} size="sm" label={label} disabled={prop.readonly}
      checked={Boolean(value)} onChange={e=>change(prop,e.currentTarget.checked)}/>;
   case 'select':
    return <Select key={prop.key} size="xs" label={label} disabled={prop.readonly}
      data={(prop.options??[]).map(option=>({value:option.value,label:caption(option.label)}))}
      value={String(value??'')} onChange={v=>{if(v!==null)change(prop,v);}}/>;
   case 'colorpicker':
    return <ColorInput key={prop.key} label={label} size="xs" disabled={prop.readonly}
     value={String(value??'#ffffff')} onChange={v=>change(prop,v)}/>;
   default:
    return <Group key={prop.key} justify="space-between" gap="xs">
      <Text size="xs" c="dimmed">{label}</Text>
      <Badge size="xs" variant="light" color="gray">Advanced editor pending</Badge>
    </Group>;
  }
 };
 if(!selected)return <Stack gap="sm"><Title order={5}>Display</Title>
  <Text size="sm" c="dimmed">Select a layout element to edit its properties.</Text>
  <Divider/>
  <Text size="xs" fw={600}>Editor shortcuts</Text>
  <Group gap={5}><Kbd size="xs">R</Kbd><Text size="xs">Rotate</Text></Group>
  <Group gap={5}><Kbd size="xs">Ctrl+C</Kbd><Text size="xs">Copy for placement</Text></Group>
  <Group gap={5}><Kbd size="xs">Ctrl+V</Kbd><Text size="xs">Place copied element</Text></Group>
  <Group gap={5}><Kbd size="xs">Del</Kbd><Text size="xs">Delete</Text></Group>
  <Group gap={5}><Kbd size="xs">F</Kbd><Text size="xs">Fit view</Text></Group>
  <Group gap={5}><Kbd size="xs">Ctrl+Z</Kbd><Text size="xs">Undo</Text></Group>
  <Text size="xs" c="dimmed">Shortcuts are active when the Canvas has keyboard focus.</Text>
 </Stack>;
 return <ScrollArea h="100%" type="auto" offsetScrollbars>
  <Stack gap="sm" pb="md">
   <Group gap="xs"><Title order={5}>Properties</Title><Badge size="sm" color="gray" variant="light">{String(selected.type??selected.kind)}</Badge></Group>
   <Card p="xs" withBorder>
    <Stack gap={7}>
     <Text size="xs" c="dimmed">Element #{selected.id}</Text>
     <Group grow align="start">
      <NumberInput size="xs" label="X" value={asNumeric(selected.x)}
       onChange={v=>{if(Number.isFinite(Number(v)))onPatch({x:Math.trunc(Number(v))});}}/>
      <NumberInput size="xs" label="Y" value={asNumeric(selected.y)}
       onChange={v=>{if(Number.isFinite(Number(v)))onPatch({y:Math.trunc(Number(v))});}}/>
     </Group>
     <NumberInput size="xs" label="Rotation (°)" value={asNumeric(selected.rotation??selected.angle)}
      min={0} max={359} step={45}
      onChange={v=>{if(Number.isFinite(Number(v)))onPatch({rotation:((Number(v)%360)+360)%360});}}/>
    </Stack>
   </Card>
   {descriptors.length>0&&<>
    <Divider label="Element settings" labelPosition="center"/>
    <Stack gap="sm">{descriptors.map(render)}</Stack>
   </>}
   <Text size="xs" c="dimmed">Original web-ui element fields. Specialized backend editors will be added separately.</Text>
  </Stack>
 </ScrollArea>;
}
