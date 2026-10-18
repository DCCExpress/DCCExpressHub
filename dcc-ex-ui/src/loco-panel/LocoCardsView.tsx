import { useState } from 'react';
import { ActionIcon, Badge, Card, Group, ScrollArea, Slider, Stack, Text, Tooltip } from '@mantine/core';
import { IconArrowBigLeft, IconArrowBigRight, IconPlayerStopFilled } from '@tabler/icons-react';
import type { Loco } from '../storage';
import LocoImage from '../loco-dialog/LocoImage';
import FunctionIconAsset from '../loco-dialog/FunctionIconAsset';
import LocoEmergencyButton from './LocoEmergencyButton';

type Live={speed:number;direction:'forward'|'reverse';functionsMask:number};
type Props={
 locos:Loco[];selectedLocoId:string;onSelect:(loco:Loco)=>void;disabled:boolean;
 emergencyStop:boolean;onEmergencyToggle:()=>void;activeAddress:number;speed:number;forward:boolean;
 functionStates:Record<number,Record<number,boolean>>;
 onCommand:(address:number,speed:number,forward:boolean)=>void;
 onFunctionCommand:(address:number,number:number,active:boolean)=>void;
};
export default function LocoCardsView(p:Props){
 const [local,setLocal]=useState<Record<number,Live>>({});
 const live=(loco:Loco):Live=>{
   const cached=local[loco.address]??{speed:0,direction:'forward' as const,functionsMask:0};
   const fns=p.functionStates[loco.address]??{};
   let mask=cached.functionsMask;
   if(Object.keys(fns).length>0){mask=0;for(const [key,on] of Object.entries(fns))if(on)mask|=1<<Number(key);}
   return {...cached,speed:p.activeAddress===loco.address?p.speed:cached.speed,
     direction:p.activeAddress===loco.address?(p.forward?'forward':'reverse'):cached.direction,functionsMask:mask};
 };
 const command=(loco:Loco,speed:number,direction:'forward'|'reverse')=>{
   const value=Math.max(0,Math.min(126,loco.maxSpeed??126,Math.round(speed)));
   setLocal(old=>({...old,[loco.address]:{...live(loco),speed:value,direction}}));
   p.onCommand(loco.address,value,direction==='forward');
 };
 const toggleFunction=(loco:Loco,number:number,active:boolean)=>{
   p.onFunctionCommand(loco.address,number,active);
   setLocal(old=>{
     const state=old[loco.address]??{speed:0,direction:'forward' as const,functionsMask:0};
     return {...old,[loco.address]:{...state,functionsMask:active?(state.functionsMask|(1<<number)):(state.functionsMask&~(1<<number))}};
   });
 };
 return <Stack h="100%" gap={0} style={{minHeight:0}}>
  <div style={{padding:8,flexShrink:0}}><LocoEmergencyButton emergencyStop={p.emergencyStop} onToggle={p.onEmergencyToggle}/></div>
  <ScrollArea style={{flex:1,minHeight:0}} type="auto" offsetScrollbars>
   <Stack gap="xs" p="xs">{p.locos.filter(l=>l.active!==false).map(loco=>{
    const state=live(loco);
    const cardFunctions=(loco.functions??[]).filter(fn=>fn.showOnLocoCard??fn.number<5).sort((a,b)=>a.number-b.number).slice(0,5);
    return <Card key={loco.id} withBorder radius="sm" padding="xs" style={{borderColor:p.selectedLocoId===loco.id?'var(--mantine-color-lime-6)':undefined}}>
      <Group gap="xs" wrap="nowrap" onClick={()=>p.onSelect(loco)} style={{cursor:'pointer'}}>
       <LocoImage locoId={loco.id} image={loco.image} name={loco.name} width={94} height={48}/>
       <Stack gap={0} style={{minWidth:0,flex:1}}>
        <Text size="sm" fw={600} truncate>{loco.name||'#'+loco.address}</Text>
        <Text size="xs" c="dimmed">#{loco.address}</Text>
        <Group gap={3} wrap="nowrap" mt={3} onClick={e=>e.stopPropagation()}>
         {cardFunctions.map(fn=>{
           const active=(state.functionsMask&(1<<fn.number))!==0;
           return <Tooltip key={fn.number} label={'F'+fn.number+' · '+fn.name}>
            <ActionIcon size={30} radius="sm" variant={active?'filled':'light'} color={active?'blue':'gray'}
             disabled={p.disabled||p.emergencyStop} aria-label={'Function F'+fn.number}
             onPointerDown={e=>{e.stopPropagation();if(fn.momentary){e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);toggleFunction(loco,fn.number,true);}}}
             onPointerUp={e=>{if(fn.momentary){e.stopPropagation();toggleFunction(loco,fn.number,false);}}}
             onPointerCancel={()=>{if(fn.momentary)toggleFunction(loco,fn.number,false);}}
             onClick={e=>{e.stopPropagation();if(!fn.momentary)toggleFunction(loco,fn.number,!active);}}>
              {fn.icon?<FunctionIconAsset fn={fn} size={20}/>:<Text size="10px" fw={700}>F{fn.number}</Text>}
            </ActionIcon>
           </Tooltip>;
         })}
        </Group>
       </Stack>
       <Badge color="dark" variant="filled" radius="sm" size="lg" styles={{root:{backgroundColor:'#111',minWidth:40,transform:'translateY(-15px)'},label:{fontVariantNumeric:'tabular-nums'}}}>{state.speed}</Badge>
      </Group>
      <Group wrap="nowrap" gap={5} mt={5} onClick={e=>e.stopPropagation()}>
       <Tooltip label="Reverse"><ActionIcon size="sm" variant={state.direction==='reverse'?'filled':'light'} disabled={p.disabled||p.emergencyStop} onClick={()=>command(loco,state.speed,'reverse')} aria-label="Reverse"><IconArrowBigLeft size={14}/></ActionIcon></Tooltip>
       <Tooltip label="Stop"><ActionIcon size="sm" color="red" variant="light" disabled={p.disabled} onClick={()=>command(loco,0,state.direction)} aria-label="Stop"><IconPlayerStopFilled size={14}/></ActionIcon></Tooltip>
       <Tooltip label="Forward"><ActionIcon size="sm" variant={state.direction==='forward'?'filled':'light'} disabled={p.disabled||p.emergencyStop} onClick={()=>command(loco,state.speed,'forward')} aria-label="Forward"><IconArrowBigRight size={14}/></ActionIcon></Tooltip>
       <Slider style={{flex:1,minWidth:35}} size="xs" min={0} max={Math.max(1,Math.min(126,loco.maxSpeed??126))}
        value={Math.min(state.speed,Math.max(1,Math.min(126,loco.maxSpeed??126)))} disabled={p.disabled||p.emergencyStop}
        onChange={value=>setLocal(old=>({...old,[loco.address]:{...state,speed:value}}))}
        onChangeEnd={value=>command(loco,value,state.direction)} aria-label={'Speed '+loco.name}/>
      </Group>
      <Text size="xs" c="dimmed" truncate="end" style={{height:18,lineHeight:'18px'}}>Manual</Text>
    </Card>;
   })}</Stack>
  </ScrollArea>
 </Stack>;
}
