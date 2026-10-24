import { useMemo, useState } from 'react';
import { Button, Card, NumberInput, ScrollArea, SimpleGrid, Stack, Text, Paper, Box } from '@mantine/core';
import { IconSettings, IconTrafficLights } from '@tabler/icons-react';
import type { TrackElement } from './storage';
import type { IEditableProperty } from './preview-webui/models/editor/elements/PropertyDescriptor';
import { restoreBrowserElement } from './BrowserTrackCanvas';
import { getElementTypeName } from './preview-webui/domain/layout/elementTypeNames';
import type { ElementType } from './preview-webui/domain/layout/elementTypes';
import BasicPropertyEditor from './property-panel/BasicPropertyEditor';
import BlockTypeSelectPropertyEditor from './property-panel/BlockTypeSelectPropertyEditor';
import TurnoutBitPropertyEditor from './property-panel/TurnoutBitPropertyEditor';
import EditorShortcutsHelp from './property-panel/EditorShortcutsHelp';
import VisibilitySettings, { type BrowserVisibility } from './property-panel/VisibilitySettings';
import { originalText } from './property-panel/originalText';
import ElementPreview from './preview-webui/models/editor/rendering/ElementPreviewRenderer';
import type { BaseElement } from './preview-webui/models/editor/core/BaseElement';
import { TrackSignalElement } from './preview-webui/models/editor/elements/TrackSignalElement';
import { TrackLevelCrossingElement } from './preview-webui/models/editor/elements/TrackLevelCrossingElement';
import { cloneSignalOutputConfiguration } from './preview-webui/domain/layout/signalOutput';
import SignalOutputDialog from './property-panel/SignalOutputDialog';
import StationSelectPropertyEditor from './property-panel/StationSelectPropertyEditor';
import type { Station } from './storage';

type Props={
 selected:TrackElement|null;selectedCount:number;selectedElements:TrackElement[];
 onPatch:(patch:Partial<TrackElement>)=>void;
 settings:BrowserVisibility;onSettingsChange:(patch:Partial<BrowserVisibility>)=>void;
 stations:Station[];onSaveStations:(stations:Station[],stationId:string|null)=>void;
};
const english=(value:string)=>originalText(value);

function createStatePreview(signal:TrackSignalElement,index:number):TrackSignalElement{
 const preview=signal instanceof TrackLevelCrossingElement
  ? new TrackLevelCrossingElement(0,0):new TrackSignalElement(0,0);
 preview.signalOutput=cloneSignalOutputConfiguration(signal.signalOutput);
 preview.currentStateIndex=Math.max(0,Math.min(index,preview.signalOutput.states.length-1));
 if(preview instanceof TrackLevelCrossingElement&&signal instanceof TrackLevelCrossingElement){
  preview.barrierType=signal.barrierType;
  preview.roadColor=signal.roadColor;
  preview.lightsEnabled=signal.lightsEnabled;
  preview.blinkingEnabled=false;
  preview.rotation=signal.rotation;
 }else{
  preview.rotation=90;
 }
 return preview;
}
function SignalProperty({model,onPatch}:{model:BaseElement;onPatch:(patch:Partial<TrackElement>)=>void}){
 const signal=model as TrackSignalElement;
 const crossing=signal instanceof TrackLevelCrossingElement;
 const [opened,setOpened]=useState(false);
 const previews=useMemo(
  ()=>signal.signalOutput.states.map((_,index)=>createStatePreview(signal,index)),
  [signal]);
 return <>
  <Stack gap="sm">
   <Button variant="light" leftSection={<IconSettings size={17}/>} onClick={()=>setOpened(true)}>
    {english(crossing?'ui.levelCrossingConfiguration':'ui.signalConfiguration')}
   </Button>
   <Button variant="light" color="yellow" disabled
    title="Signal automation requires the Hub backend" leftSection={<IconTrafficLights size={17}/>}>
    {english(crossing?'ui.levelCrossingAutomation':'ui.signalAutomation')}
   </Button>
   <Text size="xs" c="dimmed">
    {signal.signalOutput.address>0?'Address '+signal.signalOutput.address:'Output not configured'}
    {' · '}{signal.signalOutput.lampCount}{' lamps · '}{signal.signalOutput.states.length}
    {' aspects · '}{signal.signalOutput.protocol==='dccext'?'DCC Extended':'DCC'}
   </Text>
   <Text size="xs" fw={700}>{english('ui.aspects')}</Text>
   <ScrollArea.Autosize mah={260} offsetScrollbars scrollbarSize={8}>
    <SimpleGrid cols={2} spacing="xs" verticalSpacing="xs">
     {signal.signalOutput.states.map((state,index)=>
      <Paper key={state.id} withBorder p={4} radius="sm"
       style={{borderColor:index===signal.currentStateIndex?'var(--mantine-color-blue-5)':undefined}}>
       <Stack gap={2} align="center">
        <Box w="100%" style={{display:'flex',justifyContent:'center'}}>
         <ElementPreview element={previews[index]!} label="" width={54} height={42} translateX={-8}/>
        </Box>
        <Text size="xs" fw={index===signal.currentStateIndex?700:500} ta="center" truncate w="100%">
         {state.label}
        </Text>
       </Stack>
      </Paper>)}
    </SimpleGrid>
   </ScrollArea.Autosize>
   {signal.signalOutput.states.length===0&&
    <Text size="xs" c="dimmed">{english(crossing?'ui.noLevelCrossingAspectsConfigured':'ui.noSignalAspectsConfigured')}</Text>}
  </Stack>
  <SignalOutputDialog opened={opened} value={cloneSignalOutputConfiguration(signal.signalOutput)}
   onClose={()=>setOpened(false)}
   onApply={value=>{onPatch({signalOutput:cloneSignalOutputConfiguration(value)});setOpened(false);}}/>
 </>;
}
export default function BrowserPropertyPanel({selected,selectedCount,selectedElements,onPatch,settings,onSettingsChange,stations,onSaveStations}:Props){
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
  if(selectedCount>1){
   const editable=selectedElements.filter(item=>restoreBrowserElement(item,0)?.hasOccupancySensor);
   const values=editable.map(item=>Number(item.address??0));
   const common=values.every(value=>value===values[0])?values[0]:undefined;
   return <Stack gap="xs">
    <Text fw={800}>{english('ui.properties')} · {selectedCount} selected</Text>
    {editable.length===selectedCount&&editable.length>0?<Card withBorder p="xs">
     <NumberInput key={editable.map(item=>item.id).join(',')+':'+String(common)} label="Occupancy sensor address"
      description="Apply a sensor address to all selected track elements."
      min={0} max={65535} allowDecimal={false} placeholder="Mixed values"
      defaultValue={common}
      onBlur={event=>{
       const raw=event.currentTarget.value.trim();
       if(raw==='')return;
       const value=Number(raw);
       if(!Number.isInteger(value)||value<0||value>65535)return;
       onPatch({address:value});
      }}/>
    </Card>:<Text size="sm" c="dimmed">{english('ui.noCommonEditableProperty')}</Text>}
   </Stack>;
  }
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
     <TurnoutBitPropertyEditor prop={translated} selectedElement={element} onChange={update}/>:
     prop.type==='blockTypeSelect'?
      <BlockTypeSelectPropertyEditor prop={translated} selectedElement={element} onChange={update}/>:
     prop.type==='signal2'?
      <SignalProperty key={String(selected.id)} model={element} onPatch={onPatch}/>:
     prop.type==='stationSelect'?
      <StationSelectPropertyEditor stationId={typeof selected.stationId==='string'?selected.stationId:null}
       stations={stations} onSave={onSaveStations}/>:
     prop.type==='turnoutSelection'?
      <Text size="sm" fw={500}>{translated.label}</Text>:
      <BasicPropertyEditor prop={translated} selectedElement={element} onChange={update}/>
    }
   </Card>;
  })}
 </Stack></ScrollArea>;
}
