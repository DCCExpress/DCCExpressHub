import { useEffect, useState } from 'react';
import { ActionIcon, Card, Text, Tooltip } from '@mantine/core';
import { IconLayoutGrid, IconSettings, IconAdjustmentsHorizontal } from '@tabler/icons-react';
import type { Loco } from '../storage';
import type { LocoLiveState } from '../dccex';
import LocoPicker from './LocoPicker';
import LocoControlCard from './LocoControlCard';
import LocoCardsView from './LocoCardsView';
import LocoFunctionGrid from './LocoFunctionGrid';
import LocoPanelSettingsDialog from './LocoPanelSettingsDialog';
import { getLocoPanelCounterDisplaySettings, setLocoPanelCounterDisplaySettings, subscribeLocoPanelCounterDisplaySettings } from './locoPanelCounterDisplaySettings';
import './loco-panel.css';

type Props = {
 locos:Loco[]; activeAddress:number; speed:number; forward:boolean; connected:boolean;
 locoStates:Record<number,LocoLiveState>;
 light:boolean;emergencyStop:boolean;
 onSelectLoco:(address:number)=>void;
 onSpeed:(value:number)=>void;onDrive:(value:number,forward?:boolean)=>void;
 onDriveAddress:(address:number,speed:number,forward:boolean)=>void;
 onStop:()=>void;onDirection:(forward:boolean)=>void;
 onFunctionCommand:(address:number,fn:number,active:boolean)=>void;
 onEmergencyToggle:()=>void;
};
const t=(key:string)=>({
 'locopanel.counter_settings_title':'Mechanical counter settings',
 'locopanel.counter_visibility':'Visibility','locopanel.show_km':'Show distance',
 'locopanel.show_worktime':'Show operating hours',
 'locopanel.counter_daily_mode':'Daily counters',
 'locopanel.counter_daily_mode_description':'Display daily values instead of the total',
 'locopanel.counter_display':'Counter display',
 'locopanel.counter_digits':'Digits','locopanel.counter_digit_height':'Digit height',
 'locopanel.counter_km_decimals':'Distance decimals',
 'locopanel.counter_worktime_decimals':'Operating hours decimals',
 'locopanel.counter_accent_fraction':'Highlight decimal places',
} as Record<string,string>)[key]??key;

export default function LocoPanel(p:Props) {
 const [view,setView]=useState<'control'|'cards'>(()=>{
   try{return localStorage.getItem('dccexpresshub.loco-panel.view')==='cards'?'cards':'control';}catch{return 'control';}
 });
 const toggleView=()=>setView(previous=>{
   const next=previous==='control'?'cards':'control';
   try{localStorage.setItem('dccexpresshub.loco-panel.view',next);}catch{/* optional */}
   return next;
 });
 const [pickerOpen,setPickerOpen]=useState(false);
 const [settingsOpen,setSettingsOpen]=useState(false);
 const [counterSettings,setCounterSettings]=useState(getLocoPanelCounterDisplaySettings);
 // Both left and right LocoPanels share the same command station state from App.
 const functionStates:Record<number,Record<number,boolean>>={};
 for(const [key,value] of Object.entries(p.locoStates)){
   if(!value.known)continue;
   const address=Number(key),functions:Record<number,boolean>={};
   for(let fn=0;fn<=28;fn++)functions[fn]=(value.functionsMask&(1<<fn))!==0;
   functionStates[address]=functions;
 }
 useEffect(()=>subscribeLocoPanelCounterDisplaySettings(setCounterSettings),[]);
 const currentLoco=p.locos.find(l=>l.address===p.activeAddress)??p.locos[0]??null;
 const selectedId=currentLoco?.id??'';
 const fns=functionStates[currentLoco?.address??0]??{};
 const commandFunction=(address:number,fn:number,active:boolean)=>{
   if(!p.connected)return;
   p.onFunctionCommand(address,fn,active);
   // App owns the function state; the acknowledgement will update both views.
 };
 const select=(loco:Loco)=>{
   if(loco.address!==p.activeAddress)p.onSelectLoco(loco.address);
   setPickerOpen(false);
 };
 return <Card withBorder radius="sm" p="xs" h="100%" opacity={p.connected?1:0.75}
  style={{minHeight:0,minWidth:0,display:'flex',flexDirection:'column'}}>
   <div style={{position:'relative',height:'100%',minHeight:0,display:'flex',flexDirection:'column'}}>
    <LocoPicker opened={pickerOpen} locos={p.locos.filter(l=>l.active!==false)} selectedLocoId={selectedId} onClose={()=>setPickerOpen(false)} onSelect={select}/>
    <LocoPanelSettingsDialog opened={settingsOpen} settings={counterSettings}
      onClose={()=>setSettingsOpen(false)} onChange={setLocoPanelCounterDisplaySettings} t={t}/>
    <Tooltip label={t('locopanel.counter_settings_title')}>
     <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Counter settings"
      onClick={()=>setSettingsOpen(true)}
      style={{position:'absolute',left:2,top:2,zIndex:20}}><IconSettings size={15}/></ActionIcon>
    </Tooltip>
    <Tooltip label={view==='control'?'Cards view':'Control view'}>
     <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Toggle locomotive panel view"
      onClick={toggleView} style={{position:'absolute',right:2,top:2,zIndex:20}}>
      {view==='control'?<IconLayoutGrid size={15}/>:<IconAdjustmentsHorizontal size={15}/>}
     </ActionIcon>
    </Tooltip>
    {view==='cards'?
     <LocoCardsView locos={p.locos} selectedLocoId={selectedId} onSelect={select}
       disabled={!p.connected} emergencyStop={p.emergencyStop} onEmergencyToggle={p.onEmergencyToggle}
       activeAddress={p.activeAddress} speed={p.speed} forward={p.forward}
       functionStates={functionStates} locoStates={p.locoStates} onCommand={p.onDriveAddress} onSpeed={p.onSpeed} onFunctionCommand={commandFunction}/>
     :
     <div className="browser-loco-panel-fit">
      {!currentLoco?<Text size="sm" c="dimmed" ta="center" mt="xl">No locomotives. Add a locomotive on the Home page.</Text>:
      <div className="browser-loco-panel-layout">
       <div className="browser-loco-panel-controls">
        <LocoControlCard loco={currentLoco} statusKnown={p.locoStates[currentLoco.address]?.known??false} speed={p.speed}
          direction={p.forward?'forward':'reverse'} alive={p.connected} emergencyStop={p.emergencyStop}
          onOpenPicker={()=>setPickerOpen(true)} onSpeedChange={p.onSpeed}
          onSpeedChangeEnd={value=>p.onDrive(value)} onSpeedPercentChange={percent=>p.onDrive(Math.round((currentLoco.maxSpeed??126)*percent/100))}
          onForward={()=>p.onDirection(true)} onReverse={()=>p.onDirection(false)} onStop={p.onStop}
          onEmergencyToggle={p.onEmergencyToggle} counterDisplaySettings={counterSettings}/>
       </div>
       <div className="browser-loco-panel-functions">
        <LocoFunctionGrid key={currentLoco.id} loco={currentLoco}
          activeFunctions={{...fns,0:fns[0]??p.light}}
          disabled={!p.connected||p.emergencyStop}
          // LocoFunctionButton already sends through onFunctionCommand.
          // App updates the shared authoritative state; do not transmit twice.
          onActiveFunctionsChange={()=>{}}
          onFunctionCommand={commandFunction}/>
       </div>
      </div>}
     </div>
    }
   </div>
  </Card>;
}
