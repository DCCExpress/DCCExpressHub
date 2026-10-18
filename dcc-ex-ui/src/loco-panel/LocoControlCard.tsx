import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Card, Group, Stack, Text } from '@mantine/core';
import type { Loco } from '../storage';
import LocoImage from '../loco-dialog/LocoImage';
import MechanicalCounter from './MechanicalCounter';
import LocoSpeedControls from './LocoSpeedControls';
import LocoDirectionControls from './LocoDirectionControls';
import LocoEmergencyButton from './LocoEmergencyButton';
import type { LocoPanelCounterDisplaySettings } from './locoPanelCounterDisplaySettings';

type Props = {
 loco:Loco; speed:number; direction:'forward'|'reverse'; alive:boolean; emergencyStop:boolean;statusKnown:boolean;
 onOpenPicker:()=>void; onSpeedChange:(value:number)=>void; onSpeedChangeEnd:(value:number)=>void;
 onSpeedPercentChange:(percent:number)=>void; onForward:()=>void; onReverse:()=>void; onStop:()=>void;
 onEmergencyToggle:()=>void; counterDisplaySettings:LocoPanelCounterDisplaySettings;
};
export default function LocoControlCard(p:Props) {
 const maxScale=p.loco.counterSettings?.maxScaleSpeedKmh??120;
 const target=useMemo(()=>Math.round(Math.max(0,Math.min(1,p.speed/Math.max(1,p.loco.maxSpeed??126)))*maxScale),[p.speed,p.loco.maxSpeed,maxScale]);
 const [display,setDisplay]=useState(target);const last=useRef(target);
 useEffect(()=>{
   const start=last.current;if(start===target)return;
   const begun=performance.now();const duration=Math.min(650,220+Math.abs(target-start)*3.5);let frame=0;
   const tick=(now:number)=>{const x=Math.max(0,Math.min(1,(now-begun)/duration));const easing=1-Math.pow(1-x,3);const next=Math.round(start+(target-start)*easing);last.current=next;setDisplay(next);if(x<1)frame=requestAnimationFrame(tick);};
   frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[target]);
 const settings=p.counterDisplaySettings;
 return <Card withBorder radius="sm" p={8}>
  <Stack align="center" gap={0}>
   <LocoImage locoId={p.loco.id} image={p.loco.image} name={p.loco.name} width={400} height={60} clickable onClick={p.onOpenPicker}/>
  </Stack>
  <Stack gap="xs" align="center">
   <Text fw={700} ta="center">#{p.loco.address} {p.loco.name||'Unnamed locomotive'}</Text>
   <div style={{minHeight:44,display:'flex',alignItems:'center',justifyContent:'center'}}>
    <MechanicalCounter value={display} digits={3} decimals={0} digitHeight={30} unit="km/h" accentFraction={false}/>
   </div>
   {(settings.showKm||settings.showWorktime)&&<Group gap={6} justify="center" wrap="wrap" w="100%" className="loco-mechanical-counters">
    {settings.showKm&&<MechanicalCounter value={settings.daily?0:p.loco.odometerKm??0} digits={settings.digits} decimals={settings.distanceDecimals} digitHeight={settings.digitHeight} unit="km" accentFraction={settings.accentFraction}/>}
    {settings.showWorktime&&<MechanicalCounter value={settings.daily?0:p.loco.operatingHours??0} digits={settings.digits} decimals={settings.operatingHoursDecimals} digitHeight={settings.digitHeight} unit="h" accentFraction={settings.accentFraction}/>}
   </Group>}
   {!p.alive&&<Badge color="red" variant="light">Offline</Badge>}
   {p.alive&&!p.statusKnown&&<Badge color="gray" variant="light" size="sm">No command-station state</Badge>}
   <LocoSpeedControls speed={p.speed} maxSpeed={Math.max(1,Math.min(126,p.loco.maxSpeed??126))}
     disabled={!p.alive||p.emergencyStop} onSpeedChange={p.onSpeedChange} onSpeedChangeEnd={p.onSpeedChangeEnd} onSpeedPercentChange={p.onSpeedPercentChange}/>
   <LocoDirectionControls speed={p.speed} direction={p.direction} disabled={!p.alive||p.emergencyStop}
     onForward={p.onForward} onReverse={p.onReverse} onStop={p.onStop}/>
   <LocoEmergencyButton emergencyStop={p.emergencyStop} onToggle={p.onEmergencyToggle}/>
  </Stack>
 </Card>;
}
