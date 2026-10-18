import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { ActionIcon, Badge, Box, Button, Card, Divider, Group, Stack, Tabs, Text, Title, Tooltip } from '@mantine/core';
import {
 IconArrowLeft,IconChevronLeft,IconChevronRight,IconDeviceFloppy,IconDownload,IconEdit,
 IconFocusCentered,IconPlus,IconPointer,IconPower,IconRefresh,IconSettings,IconShieldCheck,
 IconTrafficLights,IconTrain,IconTrash,IconUpload,IconBrandGithub,IconBug,
 IconClipboardList,IconRobot,IconCalendarTime,IconInfoCircle,IconListDetails,
 IconVolume,IconUserShield,IconRoute,IconLockOpen
} from '@tabler/icons-react';
import type { Loco, TrackElement } from './storage';
import BrowserTrackCanvas from './BrowserTrackCanvas';
import LocoPanel from './loco-panel/LocoPanel';
import AppModal from './components/common/AppModal';
import BrowserElementPicker, { type BrowserPickerItem } from './BrowserElementPicker';
import './browser-layout.css';

type RuntimeTab='tasks'|'automation'|'timetable'|'info'|'log';
type Props={
 locos:Loco[];activeAddress:number;onSelectLoco:(address:number)=>void;connected:boolean;
 speed:number;forward:boolean;onSpeed:(v:number)=>void;onDrive:(v:number,forward?:boolean)=>void;
 onStop:()=>void;onDirection:(v:boolean)=>void;
 onFunctionCommand:(address:number,fn:number,active:boolean)=>void;
 onDriveAddress:(address:number,speed:number,forward:boolean)=>void;
 onEmergencyToggle:()=>void;emergencyStop:boolean;light:boolean;
 onBack:()=>void;onOpenLocoEditor:()=>void;onSave:()=>void;onReload:()=>void;
 onExport:()=>void;onImport:(file:File)=>void;onTogglePower:()=>void;
 powerOn:boolean;elementCount:number;
 elements:TrackElement[];onElementsChange:(elements:TrackElement[])=>void;
};
const keyPrefix='dcc-ex-ui.layout.';
function readNumber(key:string,fallback:number){
 try{const n=Number(localStorage.getItem(keyPrefix+key));return Number.isFinite(n)&&n>0?n:fallback;}catch{return fallback;}
}
function readFlag(key:string,fallback=false){
 try{const v=localStorage.getItem(keyPrefix+key);return v===null?fallback:v==='true';}catch{return fallback;}
}
function readText(key:string,fallback:string){
 try{return localStorage.getItem(keyPrefix+key)??fallback;}catch{return fallback;}
}
function store(key:string,value:string|number|boolean){
 try{localStorage.setItem(keyPrefix+key,String(value));}catch{/* local preferences optional */}
}

export function BrowserLayoutPage(props:Props){
 const [editMode,setEditMode]=useState(false);
 const [fitCounter,setFitCounter]=useState(0);
 const [deleteCounter,setDeleteCounter]=useState(0);
 const [selectedElement,setSelectedElement]=useState<TrackElement|null>(null);
 const [tool,setTool]=useState<'cursor'|'draw'>('cursor');
 const [leftWidth,setLeftWidth]=useState(()=>readNumber('left',380));
 const [rightWidth,setRightWidth]=useState(()=>readNumber('right',380));
 const [leftCollapsed,setLeftCollapsed]=useState(()=>readFlag('locoCollapsed'));
 const [rightCollapsed,setRightCollapsed]=useState(()=>readFlag('propertyCollapsed'));
 const [rightMode,setRightMode]=useState<'property'|'loco'>(()=>readText('rightMode','property')==='loco'?'loco':'property');
 const [runtimeTab,setRuntimeTab]=useState<RuntimeTab>(()=>{
  const tab=readText('runtimeTab','tasks');return ['tasks','automation','timetable','info','log'].includes(tab)?tab as RuntimeTab:'tasks';
 });
 const [pendingFeature,setPendingFeature]=useState<string|null>(null);
 const [pickerOpened,setPickerOpened]=useState(false);
 const [layoutElementPickerTab,setLayoutElementPickerTab]=useState<'railway'|'decorations'>(()=>
  readText('elementPickerTab','railway')==='decorations'?'decorations':'railway');
 const [drawingElement,setDrawingElement]=useState<BrowserPickerItem|null>(null);
 const fileRef=useRef<HTMLInputElement>(null);
 const drag=useRef<{side:'left'|'right';startX:number;startWidth:number}|null>(null);
 useEffect(()=>{
  const move=(event:globalThis.PointerEvent)=>{
   if(!drag.current)return;
   const {side,startX,startWidth}=drag.current;
   const delta=event.clientX-startX;
   const width=Math.max(245,Math.min(590,startWidth+(side==='left'?delta:-delta)));
   if(side==='left')setLeftWidth(width);else setRightWidth(width);
  };
  const release=()=>{
   drag.current=null;
   document.body.classList.remove('lite-panel-resizing');
  };
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',release);
  window.addEventListener('pointercancel',release);
  return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',release);release();};
 },[]);
 useEffect(()=>store('left',leftWidth),[leftWidth]);
 useEffect(()=>store('right',rightWidth),[rightWidth]);
 useEffect(()=>store('locoCollapsed',leftCollapsed),[leftCollapsed]);
 useEffect(()=>store('propertyCollapsed',rightCollapsed),[rightCollapsed]);
 useEffect(()=>store('rightMode',rightMode),[rightMode]);
 useEffect(()=>store('runtimeTab',runtimeTab),[runtimeTab]);
 useEffect(()=>store('elementPickerTab',layoutElementPickerTab),[layoutElementPickerTab]);
 const beginResize=(side:'left'|'right',event:PointerEvent<HTMLDivElement>)=>{
  if(event.button!==0)return;
  drag.current={side,startX:event.clientX,startWidth:side==='left'?leftWidth:rightWidth};
  document.body.classList.add('lite-panel-resizing');
 };
 const placeholder=(feature:string)=>setPendingFeature(feature);
 const workspaceStyle={
   '--lite-loco-width':leftCollapsed?'0px':leftWidth+'px',
   '--lite-property-width':rightCollapsed?'0px':rightWidth+'px',
 } as CSSProperties;
 const locoPanel=(extra?:string)=><LocoPanel key={extra??'left'} locos={props.locos}
  activeAddress={props.activeAddress} speed={props.speed} forward={props.forward}
  connected={props.connected} light={props.light}
  onSelectLoco={props.onSelectLoco} onSpeed={props.onSpeed} onDrive={props.onDrive}
  onDriveAddress={props.onDriveAddress} onStop={props.onStop}
  onDirection={props.onDirection} onFunctionCommand={props.onFunctionCommand}
  onEmergencyToggle={props.onEmergencyToggle} emergencyStop={props.emergencyStop}/>;
 const setTab=(value:string|null)=>{
   const next:RuntimeTab=value==='tasks'||value==='timetable'||value==='info'||value==='log'?value:'automation';
   setRuntimeTab(next);
 };

 return <Stack gap={6} className="lite-layout-page" style={{height:'100%',minHeight:0}}>
   <input ref={fileRef} type="file" accept=".json,application/json" hidden
     onChange={event=>{const file=event.currentTarget.files?.[0];if(file)props.onImport(file);event.currentTarget.value='';}}/>
   <Card withBorder px={6} py={3} radius="sm" className="lite-layout-toolbar">
    <Group justify="space-between" align="center" wrap="nowrap">
     <Group gap="xs" wrap="nowrap" style={{flexShrink:0}}>
      <ActionIcon variant="subtle" color="gray" onClick={props.onBack} aria-label="Back" title="Home"><IconArrowLeft size={20}/></ActionIcon>
      <Title order={3} lh={1}>Layout Panel</Title>
      <Badge size="sm" variant="light" color="violet">v0.1.0-alpha.7</Badge>
     </Group>
     <Group gap={6} wrap="nowrap" style={{flexShrink:0}}>
      <ActionIcon variant={editMode?'filled':'light'} color="violet" title="Edit mode" onClick={()=>{setEditMode(v=>!v);setTool('cursor');}}><IconEdit size={18}/></ActionIcon>
      {editMode&&<>
       <ActionIcon variant={tool==='cursor'?'filled':'light'} onClick={()=>{setTool('cursor');setDrawingElement(null);}} title="Select"><IconPointer size={18}/></ActionIcon>
       <ActionIcon variant={tool==='draw'?'filled':'light'} onClick={()=>setPickerOpened(true)} title="Add layout element"><IconPlus size={18}/></ActionIcon>
       <ActionIcon variant="light" color="red" disabled={!selectedElement} onClick={()=>setDeleteCounter(v=>v+1)} title="Delete selected"><IconTrash size={18}/></ActionIcon>
      </>}
      <Divider orientation="vertical" className="lite-toolbar-divider"/>
      <ActionIcon variant="light" onClick={()=>setFitCounter(v=>v+1)} title="Fit layout"><IconFocusCentered size={19}/></ActionIcon>
      <ActionIcon variant="light" onClick={props.onReload} title="Reload"><IconRefresh size={19}/></ActionIcon>
      <ActionIcon color="teal" variant="light" onClick={props.onSave} title="Save"><IconDeviceFloppy size={19}/></ActionIcon>
      <ActionIcon color="blue" variant="light" onClick={props.onExport} title="Export layout / project JSON"><IconDownload size={19}/></ActionIcon>
      <ActionIcon color="cyan" variant="light" onClick={()=>fileRef.current?.click()} title="Import project JSON"><IconUpload size={19}/></ActionIcon>
      <Divider orientation="vertical" className="lite-toolbar-divider"/>
      <Button size="xs" variant={props.powerOn?'filled':'light'} color={props.powerOn?'green':'red'}
       leftSection={<IconPower size={16}/>} disabled={!props.connected} onClick={props.onTogglePower}
       title={props.powerOn?'Turn track power off':'Turn track power on'}>
       Power {props.powerOn?'ON':'OFF'}
      </Button>
      <Divider orientation="vertical" className="lite-toolbar-divider"/>
      <Button size="xs" variant="light" color="violet" leftSection={<IconTrain size={16}/>}
       onClick={props.onOpenLocoEditor} title="Edit locomotives">Locos</Button>
      <Button data-signal-automation-button="true" size="xs" variant="light" color="yellow"
       leftSection={<IconTrafficLights size={16}/>} onClick={()=>placeholder('Signal Automation')}
       title="Automatic signal aspects">Signals <span data-signal-automation-state="true" style={{marginLeft:6,fontWeight:800,fontSize:10,opacity:.9}}>OFF</span></Button>
      <Button size="xs" variant="light" color="teal" leftSection={<IconShieldCheck size={16}/>}
       onClick={()=>placeholder('Integrity Check')} title="Check project references">Check</Button>
      <Button size="xs" variant="light" leftSection={<IconBug size={16}/>}
       onClick={()=>placeholder('Runtime Debug')}>Debug</Button>
      <Button component="a" href="https://github.com/DCCExpress/DCCExpressHub" target="_blank"
       rel="noopener noreferrer" size="xs" variant="light" color="blue"
       leftSection={<IconBrandGithub size={16}/>} title="GITHUB">GITHUB</Button>
      <ActionIcon variant={leftCollapsed?'light':'filled'} onClick={()=>setLeftCollapsed(v=>!v)} title="Toggle locomotive panel"><IconTrain size={19}/></ActionIcon>
      <ActionIcon variant={rightCollapsed?'light':'filled'} onClick={()=>setRightCollapsed(v=>!v)} title="Toggle property panel"><IconSettings size={18}/></ActionIcon>
     </Group>
    </Group>
   </Card>

   <div className="lite-layout-workspace" style={workspaceStyle}>
    {!leftCollapsed&&<div className="lite-loco-panel">{locoPanel()}</div>}
    <div className="lite-panel-resizer lite-panel-resizer-left" onPointerDown={e=>beginResize('left',e)}>
     <button type="button" onPointerDown={e=>e.stopPropagation()} onClick={()=>setLeftCollapsed(v=>!v)} title="Toggle locomotive panel">
      {leftCollapsed?<IconChevronRight size={16}/>:<IconChevronLeft size={16}/>}
     </button>
    </div>
    <Card withBorder p={4} className="lite-track-card">
     <BrowserTrackCanvas elements={props.elements} onElementsChange={props.onElementsChange}
       editMode={editMode} tool={tool} drawingElement={drawingElement}
       onToolChange={next=>{setTool(next);if(next==='cursor')setDrawingElement(null);}}
       onSelectionChange={setSelectedElement} fitCounter={fitCounter} deleteCounter={deleteCounter}/>
    </Card>
    <div className="lite-panel-resizer lite-panel-resizer-right" onPointerDown={e=>beginResize('right',e)}>
     <button type="button" onPointerDown={e=>e.stopPropagation()} onClick={()=>setRightCollapsed(v=>!v)} title="Toggle property panel">
      {rightCollapsed?<IconChevronLeft size={16}/>:<IconChevronRight size={16}/>}
     </button>
    </div>
    {!rightCollapsed&&(
     rightMode==='loco'
     ? <div className="lite-property-panel lite-right-loco-panel">{locoPanel('right')}</div>
     : <Card withBorder p="sm" className="lite-property-panel">
       {editMode?
        <><Title order={5} mb="sm">{selectedElement?'Properties':'Display'}</Title>
          {selectedElement
           ? <Stack gap={5}><Text size="sm" fw={600}>{selectedElement.type??selectedElement.kind}</Text>
              <Text size="xs" c="dimmed">ID: {selectedElement.id}</Text>
              <Text size="xs">X: {selectedElement.x} · Y: {selectedElement.y}</Text>
              <Text size="xs">Rotation: {selectedElement.rotation??selectedElement.angle??0}°</Text>
              <Text size="xs" c="dimmed">Drag to move · R to rotate · Del to delete</Text>
             </Stack>
           : <Text size="sm" c="dimmed">Select a layout element to edit its properties.</Text>}
        </>
       : <Tabs value={runtimeTab} onChange={setTab} className="lite-runtime-tabs">
          <Tabs.List grow mb="sm">
           <Tooltip label="TaskMan" withArrow><Tabs.Tab value="tasks" aria-label="TaskMan"><IconClipboardList size={20}/></Tabs.Tab></Tooltip>
           <Tooltip label="Automation" withArrow><Tabs.Tab value="automation" aria-label="Automation"><IconRobot size={20}/></Tabs.Tab></Tooltip>
           <Tooltip label="Timetable" withArrow><Tabs.Tab value="timetable" aria-label="Timetable"><IconCalendarTime size={20}/></Tabs.Tab></Tooltip>
           <Tooltip label="Info" withArrow><Tabs.Tab value="info" aria-label="Info"><IconInfoCircle size={20}/></Tabs.Tab></Tooltip>
           <Tooltip label="Log" withArrow><Tabs.Tab value="log" aria-label="Log"><IconListDetails size={20}/></Tabs.Tab></Tooltip>
          </Tabs.List>
          <Tabs.Panel value="tasks" className="lite-info-tab-panel"><Text size="sm" c="dimmed">TaskMan · dispatcher backend not available in Browser Edition.</Text></Tabs.Panel>
          <Tabs.Panel value="automation" className="lite-info-tab-panel">
           <Stack h="100%" gap="xs">
            <Group justify="flex-end" gap="xs" wrap="nowrap">
             <Button size="xs" variant="light" color="blue" leftSection={<IconRoute size={15}/>}
               onClick={()=>placeholder('Routes')}>Routes</Button>
             <Button size="xs" variant="light" color="red" leftSection={<IconLockOpen size={15}/>}
               onClick={()=>placeholder('Release turnout locks')}>Release all locks</Button>
            </Group>
            <Text size="sm" c="dimmed">Automation · backend functions are not available in Browser Edition.</Text>
           </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="timetable" className="lite-info-tab-panel"><Text size="sm" c="dimmed">Timetable · backend not available.</Text></Tabs.Panel>
          <Tabs.Panel value="info" className="lite-info-tab-panel">
           <Stack gap="xs"><Text size="sm" fw={600}>Command center</Text>
            <Badge color={props.connected?'green':'gray'} w="fit-content">{props.connected?'Connected':'Disconnected'}</Badge>
            <Text size="xs" c="dimmed">DCC-EX · direct WebSocket</Text>
           </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="log" className="lite-info-tab-panel"><Text size="sm" c="dimmed">Runtime log · not connected yet.</Text></Tabs.Panel>
         </Tabs>
       }
      </Card>
    )}
   </div>

   <Card withBorder p={5} radius="sm" className="lite-status-bar">
    <Group justify="flex-start" wrap="nowrap" gap="xs">
     <Group gap={6} wrap="nowrap">
      <Badge size="sm" data-command-center-status-role="layout-ws"
       variant={props.connected?'light':'filled'} color={props.connected?'green':'red'}
       className={props.connected?'':'lite-ws-alert'}
       title={props.connected?'WebSocket connected':'WebSocket disconnected'}>
       {props.connected?'WS':'WS LOST'}
      </Badge>
      <Badge size="sm" variant="light" color={props.emergencyStop?'red':'gray'}
       onClick={props.onEmergencyToggle} title="Track emergency stop / resume"
       className={'lite-status-action'+(props.emergencyStop?' blinkBadge':'')}>E-STOP</Badge>
      <Divider orientation="vertical"/>
      <Badge size="sm" variant="light" color="gray" title="Overload reporting is not available via this browser connection">Overload</Badge>
      <Divider orientation="vertical"/>
      <ActionIcon size="sm" variant="filled" color="dark" aria-label="Broadcast audio" title="Broadcast audio (not available)"
       onClick={()=>placeholder('Broadcast Audio')}><IconVolume size={15}/></ActionIcon>
      <Divider orientation="vertical"/>
      <ActionIcon size="sm" variant="light" color="gray" aria-label="SwitchMan" title="SwitchMan (backend not available)"
       onClick={()=>placeholder('SwitchMan')}><IconUserShield size={15}/></ActionIcon>
      <Divider orientation="vertical"/>
      <ActionIcon size="sm" variant={rightMode==='loco'?'filled':'light'}
       color={rightMode==='loco'?'green':'gray'}
       aria-label="Toggle right locomotive panel" title={rightMode==='loco'?'Right panel: locomotive control':'Right panel: properties'}
       onClick={()=>{setRightMode(v=>v==='property'?'loco':'property');setRightCollapsed(false);}}>
       <IconTrain size={15}/>
      </ActionIcon>
     </Group>
     <Text size="xs" c="dimmed" truncate style={{marginLeft:'auto'}}>
      {props.elementCount} elements · {props.locos.length} locos
     </Text>
    </Group>
   </Card>

   <BrowserElementPicker opened={pickerOpened} tab={layoutElementPickerTab}
      onTabChange={setLayoutElementPickerTab} onClose={()=>setPickerOpened(false)}
      onSelect={item=>{
        setTool('draw');
        setDrawingElement(item);
        setPickerOpened(false);
      }}/>
   <AppModal opened={pendingFeature!==null} onClose={()=>setPendingFeature(null)}
      title={pendingFeature??'Feature'} size="sm" centered draggable>
    <Stack gap="sm">
     <Text size="sm">This control is in the original web-ui layout. Its functionality has not yet been ported to the browser-only version.</Text>
     <Group justify="flex-end"><Button onClick={()=>setPendingFeature(null)}>OK</Button></Group>
    </Stack>
   </AppModal>
  </Stack>;
}
