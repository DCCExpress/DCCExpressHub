import { useMemo, useState } from 'react';
import { Button, Card, Group, NumberInput, ScrollArea, SimpleGrid, Stack, Text } from '@mantine/core';
import type { TrackElement } from './storage';
import type { IEditableProperty } from './preview-webui/models/editor/elements/PropertyDescriptor';
import { restoreBrowserElement } from './BrowserTrackCanvas';
import { getElementTypeName } from './preview-webui/domain/layout/elementTypeNames';
import type { ElementType } from './preview-webui/domain/layout/elementTypes';
import BasicPropertyEditor from './property-panel/BasicPropertyEditor';
import BlockTypeSelectPropertyEditor from './property-panel/BlockTypeSelectPropertyEditor';
import BitToggleElement from './property-panel/BitToggleElement';
import EditorShortcutsHelp from './property-panel/EditorShortcutsHelp';
import VisibilitySettings, { type BrowserVisibility } from './property-panel/VisibilitySettings';
import { originalText } from './property-panel/originalText';
import ElementPreview from './preview-webui/models/editor/rendering/ElementPreviewRenderer';
import type { BaseElement } from './preview-webui/models/editor/core/BaseElement';

type Props={
 selected:TrackElement|null;selectedCount:number;
 onPatch:(patch:Partial<TrackElement>)=>void;
 settings:BrowserVisibility;onSettingsChange:(patch:Partial<BrowserVisibility>)=>void;
};
const english=(value:string)=>originalText(value);
const numeric=(v:unknown,fallback=0)=>typeof v==='number'&&Number.isFinite(v)?v:Number(v)||fallback;

function ToggleProperty({prop,model,onChange}:{prop:IEditableProperty;model:BaseElement;onChange:(prop:IEditableProperty,value:unknown)=>void}){
 const data=model as unknown as Record<string,unknown>;
 const extended=data.outputMode==='extended',key=prop.key;
 const update=(name:string,value:boolean|number)=>onChange({...prop,key:name,type:typeof value==='number'?'number':'bittoggle'},value);
 if(key==='turnout2ClosedValue'&&'turnout1ClosedValue' in data)return null;
 if(key==='turnout1ClosedValue')return <Stack gap="xs">
  <Text fw={500} size="sm">{prop.label}</Text>
  {(['turnout1ClosedValue','turnout2ClosedValue'] as const).map((k,i)=>
   <Group key={k} justify="space-between" wrap="nowrap">
    <Text size="sm">{i===0?'Turnout 1':'Turnout 2'}</Text>
    <BitToggleElement value={Boolean(data[k])} onChange={value=>update(k,value)}/>
   </Group>)}
 </Stack>;
 if(key==='activeValue'&&'offValue' in data)return <Stack gap="xs">
  <Text size="sm" fw={500}>{prop.label}</Text>
  {([true,false] as const).map(on=>{
   const name=extended?(on?'onAspect':'offAspect'):(on?'activeValue':'offValue');
   return <Group key={name} justify="space-between" align="center" wrap="nowrap">
    <Text size="sm" fw={600} w={44}>{on?'ON':'OFF'}</Text>
    {extended?
     <NumberInput w={110} min={0} max={255} allowDecimal={false} allowNegative={false}
      value={numeric(data[name])} onChange={v=>update(name,Number(v)||0)}/>:
     <BitToggleElement value={Boolean(data[name])} onChange={value=>{
      update(name,value);
      const opposite=on?'offValue':'activeValue';
      if(Boolean(data[opposite])===value)update(opposite,!value);
     }}/>}
   </Group>;
  })}
 </Stack>;
 if(key==='turnoutClosedValue')return <Stack gap="xs">
  <Text size="sm" fw={500}>{prop.label}</Text>
  {extended?
   (['turnoutClosedAspect','turnoutOpenedAspect'] as const).map((name,i)=>
    <NumberInput key={name} label={i===0?'Closed':'Opened'} min={0} max={255}
     value={numeric(data[name],i)} onChange={v=>update(name,Number(v)||0)}/>)
   :<Group justify="space-between"><Text size="sm">Closed</Text>
     <BitToggleElement value={Boolean(data[key])} onChange={value=>onChange(prop,value)}/>
    </Group>}
 </Stack>;
 return <Group justify="space-between" align="center" wrap="nowrap">
  <Text size="sm" fw={500}>{prop.label}</Text>
  <BitToggleElement value={Boolean(data[key])} onChange={value=>onChange(prop,value)}/>
 </Group>;
}
type SignalData={address?:number;protocol?:string;lampCount?:number;states?:Array<{id?:string;name?:string;label?:string;aspect?:number}>};
function SignalProperty({model,onPatch}:{model:BaseElement;onPatch:(patch:Partial<TrackElement>)=>void}){
 const source=(model as unknown as Record<string,unknown>).signalOutput as SignalData|undefined;
 const [opened,setOpened]=useState(false);
 const [address,setAddress]=useState(source?.address??0);
 const states=source?.states??[];
 return <Stack gap="sm">
  <Button size="sm" variant="light" onClick={()=>{setAddress(source?.address??0);setOpened(v=>!v);}}>
   {english('ui.signalConfiguration')}
  </Button>
  {opened&&<Card withBorder p="xs"><Stack gap="xs">
   <NumberInput min={0} max={2048} label={english('ui.accessoryAddress')} value={address}
     onChange={v=>setAddress(Number(v)||0)}/>
   <Group justify="flex-end"><Button size="xs" onClick={()=>{
    onPatch({signalOutput:{...source,address}} as Partial<TrackElement>);
    setOpened(false);
   }}>Apply</Button></Group>
  </Stack></Card>}
  <Text size="xs" c="dimmed">
   {source?.address?'Address '+source.address:'Output not configured'} · {source?.lampCount??0} lamps · {states.length} aspects ·
   {source?.protocol==='dccext'?' DCC Extended':' DCC'}
  </Text>
  <Text size="xs" fw={700}>{english('ui.aspects')}</Text>
  <SimpleGrid cols={2} spacing="xs">
   {states.map((state,index)=><Card withBorder p="xs" key={state.id??index}>
    <Stack gap={3}>
     <Text size="xs" fw={600}>{state.name??state.label??('Aspect '+(index+1))}</Text>
     <Text size="xs" c="dimmed">{state.aspect??index}</Text>
     <ElementPreview element={model} label="" width={52} height={52}/>
    </Stack>
   </Card>)}
  </SimpleGrid>
 </Stack>;
}
export default function BrowserPropertyPanel({selected,selectedCount,onPatch,settings,onSettingsChange}:Props){
 const element=useMemo(()=>selected?restoreBrowserElement(selected,0):null,[selected]);
 const props=useMemo(()=>element?.getEditableProperties()??[],[element]);
 const update=(prop:IEditableProperty,value:unknown)=>{
  if(!selected||prop.readonly)return;
  const actual=prop.type==='number'?Number(value):value;
  if(prop.type==='number'&&!Number.isFinite(actual))return;
  if(prop.validate&&!prop.validate(actual))return;
  onPatch({[prop.key]:actual} as Partial<TrackElement>);
 };
 if(!selected||!element){
  if(selectedCount>1)return <Stack gap="xs"><Text fw={800}>{english('ui.properties')}</Text>
   <Text size="sm" c="dimmed">{english('ui.noCommonEditableProperty')}</Text></Stack>;
  return <ScrollArea h="100%"><Stack gap="xs">
   <VisibilitySettings title={english('ui.layoutVisibility')} settings={settings} updateSettings={onSettingsChange}/>
   <EditorShortcutsHelp/>
  </Stack></ScrollArea>;
 }
 return <ScrollArea h="100%" type="auto" offsetScrollbars><Stack gap="xs">
  <Text fw={800} truncate>{getElementTypeName(element.type as ElementType)}</Text>
  {props.map(prop=>{
   if(prop.key==='turnout2ClosedValue'&&props.some(p=>p.key==='turnout1ClosedValue'))return null;
   const translated={...prop,label:english(prop.label),
    options:prop.options?.map(option=>({...option,label:english(option.label)}))};
   return <Card key={prop.key} withBorder p="xs">
    {prop.type==='bittoggle'?
     <ToggleProperty prop={translated} model={element} onChange={update}/>:
     prop.type==='blockTypeSelect'?
      <BlockTypeSelectPropertyEditor prop={translated} selectedElement={element} onChange={update}/>:
     prop.type==='signal2'?
      <SignalProperty key={String(selected.id)} model={element} onPatch={onPatch}/>:
     prop.type==='stationSelect'||prop.type==='turnoutSelection'?
      <Text size="sm" fw={500}>{translated.label}</Text>:
      <BasicPropertyEditor prop={translated} selectedElement={element} onChange={update}/>
    }
   </Card>;
  })}
 </Stack></ScrollArea>;
}
