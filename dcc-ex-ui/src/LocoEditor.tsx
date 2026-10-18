import { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Avatar, Button, Card, Checkbox, Divider, FileButton, Group, NumberInput, ScrollArea, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { IconPlus, IconTrash, IconTrain } from '@tabler/icons-react';
import type { Loco, LocoAction, LocoActionHook, LocoFunction } from './storage';

const hooks: {value:LocoActionHook;label:string}[]=[
 {value:'beforeStart',label:'Before start'},{value:'afterStart',label:'After start'},
 {value:'beforeStop',label:'Before stop'},{value:'afterStop',label:'After stop'}
];
const n=(v:number|string|undefined,otherwise=0)=>Number.isFinite(Number(v))?Number(v):otherwise;
function Picture({blob,size=56}:{blob?:Blob;size?:number}) {
 const [url,setUrl]=useState<string>();
 useEffect(()=>{if(!blob){setUrl(undefined);return;}const value=URL.createObjectURL(blob);setUrl(value);return()=>URL.revokeObjectURL(value);},[blob]);
 return <Avatar size={size} radius="sm" src={url}><IconTrain size={24}/></Avatar>;
}
const makeLoco=():Loco=>({id:crypto.randomUUID(),name:'New locomotive',address:3,manufacturer:'',notes:'',active:true,maxSpeed:126,cruisingSpeed:20,invert:false,length:200,locomotiveLengthMm:200,wagonsLengthMm:0,trainType:'passenger',functions:Array.from({length:29},(_,number)=>({id:crypto.randomUUID(),number,name:number===0?'Headlight':`F${number}`,icon:'',momentary:false,showOnLocoCard:number<5,startupActive:false}))});
export function LocoEditor({locos:originalLocos,onSave,onCancel,onDrive}:{locos:Loco[];onSave:(value:Loco[])=>void;onCancel:()=>void;onDrive:(address:number)=>void}) {
 const [locos,setLocos]=useState<Loco[]>(()=>structuredClone(originalLocos));
 const onChange=setLocos;
 const [saveError,setSaveError]=useState('');
 const save=()=>{
   const addresses=new Set<number>();
   for(const loco of locos){
     if(!loco.name.trim()){setSaveError('Every locomotive needs a name.');return;}
     if(!Number.isInteger(loco.address)||loco.address<1||loco.address>10239){setSaveError('Invalid DCC address.');return;}
     if(addresses.has(loco.address)){setSaveError('Duplicate DCC address: '+loco.address);return;}
     addresses.add(loco.address);
     const used=new Set<number>();
     for(const fn of loco.functions??[]){
       if(!Number.isInteger(fn.number)||fn.number<0||fn.number>28||used.has(fn.number)){setSaveError('Invalid or duplicate function for '+loco.name);return;}
       used.add(fn.number);
     }
   }
   onSave(locos);
 };
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const selected=locos.find(l=>l.id===selectedId)??locos[0]??null;
 const [hook,setHook]=useState<LocoActionHook>('beforeStart');
 const [message,setMessage]=useState('');
 const update=(patch:Partial<Loco>)=>{if(!selected)return;onChange(locos.map(l=>l.id===selected.id?{...l,...patch}:l));};
 const add=()=>{const loco=makeLoco();onChange([...locos,loco]);setSelectedId(loco.id);setMessage('New locomotive added; press Save to keep it.');};
 const remove=()=>{if(!selected||!window.confirm(`Delete ${selected.name}?`))return;onChange(locos.filter(l=>l.id!==selected.id));setSelectedId(null);};
 const functions=useMemo(()=>[...(selected?.functions??[])].sort((a,b)=>a.number-b.number),[selected?.functions]);
 const updateFunction=(id:string,patch:Partial<LocoFunction>)=>update({functions:functions.map(fn=>fn.id===id?{...fn,...patch}:fn)});
 const actions=selected?.actions?.[hook]??[];
 const changeActions=(next:LocoAction[])=>update({actions:{...selected?.actions,[hook]:next}});
 const updateAction=(id:string,patch:Partial<LocoAction>)=>changeActions(actions.map(action=>action.id===id?{...action,...patch}:action));
 return <Group wrap="nowrap" gap="md" align="stretch" style={{height:'min(710px, calc(100dvh - 190px))',minHeight:450}}>
   <Card withBorder p="sm" style={{width:320,flexShrink:0,display:'flex',flexDirection:'column',minHeight:0}}>
    <Group justify="space-between" mb="sm"><Title order={5}>Locomotives</Title><Button size="xs" leftSection={<IconPlus size={15}/>} onClick={add}>Add</Button></Group>
    <ScrollArea style={{flex:1,minHeight:0}}>
     <Stack gap={5}>{locos.map(loco=><Card withBorder p="xs" key={loco.id} bg={selected?.id===loco.id?'var(--mantine-color-dark-5)':undefined} style={{cursor:'pointer'}} onClick={()=>setSelectedId(loco.id)}><Group gap="xs" wrap="nowrap"><Picture blob={loco.image}/><Stack gap={2} style={{flex:1,minWidth:0}}><Text fw={600} size="sm" truncate>{loco.name}</Text><Group gap={5}><Text size="xs" c="dimmed">DCC {loco.address} · Max {loco.maxSpeed??126}</Text>{loco.active===false&&<Badge color="gray" size="xs">Inactive</Badge>}</Group></Stack></Group></Card>)}</Stack>
    </ScrollArea>
    <Divider my="sm"/>
    <Group justify="space-between"><Button disabled={!selected} variant="light" size="xs" onClick={()=>selected&&onDrive(selected.address)}>Select throttle</Button><ActionIcon disabled={!selected} color="red" variant="light" onClick={remove}><IconTrash size={17}/></ActionIcon></Group>
   </Card>
   <Card withBorder p="md" style={{flex:1,minWidth:0,minHeight:0,display:'flex',flexDirection:'column'}}>
    {!selected?<Stack justify="center" align="center" h="100%"><Text c="dimmed">Add a locomotive to begin.</Text></Stack>:
     <Tabs key={selected.id} defaultValue="general" style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
      <Tabs.List>
       <Tabs.Tab value="general">General</Tabs.Tab><Tabs.Tab value="functions">Functions</Tabs.Tab><Tabs.Tab value="actions">Actions</Tabs.Tab>
       <Tabs.Tab value="extended">Extended</Tabs.Tab><Tabs.Tab value="counters">Counters</Tabs.Tab><Tabs.Tab value="decoder">Decoder CV</Tabs.Tab>
       <Tabs.Tab value="statistics" ml="auto">Statistics</Tabs.Tab>
      </Tabs.List>
      <ScrollArea type="auto" style={{flex:1,minHeight:0}} mt="sm">
       <Tabs.Panel value="general"><SimpleGrid cols={{base:1,md:2}} spacing="md">
        <Stack gap="md">
         <TextInput label="Name" value={selected.name} onChange={e=>update({name:e.currentTarget.value})}/>
         <NumberInput label="DCC address" min={1} max={10239} value={selected.address} onChange={v=>update({address:Math.max(1,Math.min(10239,n(v,3)))})}/>
         <TextInput label="Manufacturer" value={selected.manufacturer} onChange={e=>update({manufacturer:e.currentTarget.value})}/>
         <NumberInput label="Maximum speed step" min={1} max={126} value={selected.maxSpeed??126} onChange={v=>update({maxSpeed:n(v,126)})}/>
         <NumberInput label="Cruising speed step" min={0} max={126} value={selected.cruisingSpeed??20} onChange={v=>update({cruisingSpeed:n(v,20)})}/>
         <Switch label="Active on layout" checked={selected.active!==false} onChange={e=>update({active:e.currentTarget.checked})}/>
         <Switch label="Invert direction" checked={selected.invert??false} onChange={e=>update({invert:e.currentTarget.checked})}/>
         <TextInput label="Notes" value={selected.notes} onChange={e=>update({notes:e.currentTarget.value})}/>
        </Stack>
        <Stack align="start"><Text fw={500} size="sm">Locomotive image</Text><Picture blob={selected.image} size={180}/>
         <FileButton accept="image/png,image/jpeg,image/webp" onChange={file=>{if(file){if(file.size>6*1024*1024){setMessage('Image must be smaller than 6 MB.');return;}update({image:file});}}}>{props=><Button variant="light" {...props}>Choose image</Button>}</FileButton>
         <Text size="xs" c="dimmed">Changes are saved to IndexedDB when you press Save.</Text>
        </Stack>
       </SimpleGrid></Tabs.Panel>
       <Tabs.Panel value="functions"><Stack gap="sm">
        <Group justify="space-between"><Text size="sm" c="dimmed">F0–F28 labels and behaviour, as in the original locomotive editor.</Text><Button size="xs" onClick={()=>{const available=Array.from({length:29},(_,i)=>i).find(i=>!functions.some(fn=>fn.number===i));if(available===undefined)return;update({functions:[...functions,{id:crypto.randomUUID(),number:available,name:`F${available}`,icon:'',momentary:false,showOnLocoCard:true,startupActive:false}]});}}>Add function</Button></Group>
        <Table striped highlightOnHover><Table.Thead><Table.Tr><Table.Th>F</Table.Th><Table.Th>Name</Table.Th><Table.Th>Icon</Table.Th><Table.Th>Momentary</Table.Th><Table.Th>Show</Table.Th><Table.Th>On connect</Table.Th><Table.Th/></Table.Tr></Table.Thead><Table.Tbody>{functions.map(fn=><Table.Tr key={fn.id}>
         <Table.Td><NumberInput size="xs" w={68} min={0} max={28} value={fn.number} onChange={v=>updateFunction(fn.id,{number:n(v)})}/></Table.Td>
         <Table.Td><TextInput size="xs" value={fn.name} onChange={e=>updateFunction(fn.id,{name:e.currentTarget.value})}/></Table.Td>
         <Table.Td><TextInput size="xs" w={70} value={fn.icon} onChange={e=>updateFunction(fn.id,{icon:e.currentTarget.value})}/></Table.Td>
         <Table.Td><Checkbox checked={fn.momentary} onChange={e=>updateFunction(fn.id,{momentary:e.currentTarget.checked})}/></Table.Td>
         <Table.Td><Checkbox checked={fn.showOnLocoCard} onChange={e=>updateFunction(fn.id,{showOnLocoCard:e.currentTarget.checked})}/></Table.Td>
         <Table.Td><Checkbox checked={fn.startupActive} onChange={e=>updateFunction(fn.id,{startupActive:e.currentTarget.checked})}/></Table.Td>
         <Table.Td><ActionIcon color="red" variant="subtle" onClick={()=>update({functions:functions.filter(item=>item.id!==fn.id)})}><IconTrash size={15}/></ActionIcon></Table.Td>
        </Table.Tr>)}</Table.Tbody></Table>
       </Stack></Tabs.Panel>
       <Tabs.Panel value="actions"><Stack gap="sm">
        <Select label="Action hook" data={hooks} value={hook} onChange={v=>setHook((v??'beforeStart') as LocoActionHook)} />
        <Text size="sm" c="dimmed">Action definitions are stored locally. No automation engine runs in Browser Edition.</Text>
        {actions.map(action=><Group key={action.id} align="end" wrap="wrap">
         <Select label="Action" w={190} data={[{value:'setFunction',label:'Set function'},{value:'momentaryFunction',label:'Momentary function'},{value:'wait',label:'Wait'}]} value={action.type} onChange={v=>updateAction(action.id,{type:(v??'setFunction') as LocoAction['type']})}/>
         {action.type!=='wait'&&<NumberInput label="Function number" w={125} min={0} max={28} value={action.functionNumber} onChange={v=>updateAction(action.id,{functionNumber:n(v)})}/>}
         {action.type==='setFunction'&&<Checkbox label="Active" checked={action.active} onChange={e=>updateAction(action.id,{active:e.currentTarget.checked})}/>}
         {action.type!=='setFunction'&&<NumberInput label="Duration (ms)" w={125} min={0} value={action.ms} onChange={v=>updateAction(action.id,{ms:n(v)})}/>}
         <ActionIcon color="red" onClick={()=>changeActions(actions.filter(a=>a.id!==action.id))}><IconTrash size={16}/></ActionIcon>
        </Group>)}
        <Button variant="light" size="xs" w="fit-content" onClick={()=>changeActions([...actions,{id:crypto.randomUUID(),type:'setFunction',functionNumber:0,active:true,ms:250}])}>Add action</Button>
       </Stack></Tabs.Panel>
       <Tabs.Panel value="extended"><SimpleGrid cols={{base:1,md:2}}><Stack>
        <Select label="Train type" value={selected.trainType??'passenger'} onChange={v=>update({trainType:(v??'passenger') as Loco['trainType']})} data={['passenger','freight','mixed','maintenance','other']}/>
        <NumberInput label="Locomotive length (mm)" value={selected.locomotiveLengthMm??selected.length??200} min={1} onChange={v=>{const length=n(v,1);update({locomotiveLengthMm:length,length:length+(selected.wagonsLengthMm??0)});}}/>
        <NumberInput label="Wagons length (mm)" value={selected.wagonsLengthMm??0} min={0} onChange={v=>{const length=n(v);update({wagonsLengthMm:length,length:length+(selected.locomotiveLengthMm??200)});}}/>
        <Text size="xs">Total train length: {selected.length??200} mm</Text>
        <Select label="Consist mode" data={[{value:'pull',label:'Pull'},{value:'push',label:'Push'}]} value={selected.trainConsistMode??'pull'} onChange={v=>update({trainConsistMode:(v??'pull') as 'pull'|'push'})}/>
       </Stack><Stack>
        <Select label="Detection position" data={['forward','reverse','both']} value={selected.occupancyDetectionPosition??'both'} onChange={v=>update({occupancyDetectionPosition:(v??'both') as Loco['occupancyDetectionPosition']})}/>
        <NumberInput label="Detector offset (mm)" value={selected.trainDetectionOffsetMm??0} onChange={v=>update({trainDetectionOffsetMm:n(v)})}/>
        <Checkbox label="Entire train electrically detectable" checked={selected.entireTrainDetectable??false} onChange={e=>update({entireTrainDetectable:e.currentTarget.checked})}/>
        <NumberInput label="Train clearance margin (mm)" value={selected.trainClearanceMarginMm??30} min={0} onChange={v=>update({trainClearanceMarginMm:n(v)})}/>
       </Stack></SimpleGrid></Tabs.Panel>
       <Tabs.Panel value="counters"><Stack maw={500}>
        <TextInput label="Last run" value={selected.lastRunAt??''} disabled/>
        <NumberInput label="Odometer (km)" value={selected.odometerKm??0} min={0} onChange={v=>update({odometerKm:n(v)})}/>
        <NumberInput label="Operating hours" value={selected.operatingHours??0} min={0} onChange={v=>update({operatingHours:n(v)})}/>
        <NumberInput label="Max scale speed (km/h)" value={selected.counterSettings?.maxScaleSpeedKmh??120} min={1} onChange={v=>update({counterSettings:{maxScaleSpeedKmh:n(v,120)}})}/>
        <Text size="xs" c="dimmed">Automatic runtime counter updates are not available yet.</Text>
       </Stack></Tabs.Panel>
       <Tabs.Panel value="decoder"><Stack>
        <Text fw={600}>Decoder CV</Text><Text c="dimmed" size="sm">Saved decoder profile values only. Service-track CV read/write is not connected to the direct WebSocket yet.</Text>
        <Text size="sm">Stored CV values: {Object.keys(selected.decoderProfile?.cvValues??{}).length}</Text>
        <Table><Table.Thead><Table.Tr><Table.Th>CV</Table.Th><Table.Th>Value</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{Object.entries(selected.decoderProfile?.cvValues??{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([cv,value])=><Table.Tr key={cv}><Table.Td>{cv}</Table.Td><Table.Td>{value}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
       </Stack></Tabs.Panel>
       <Tabs.Panel value="statistics"><Stack maw={500}><Title order={5}>Locomotive statistics</Title><Text>Odometer: {selected.odometerKm??0} km</Text><Text>Operating hours: {selected.operatingHours??0}</Text><Text>Last run: {selected.lastRunAt??'Never'}</Text><Text>Function mappings: {functions.length}</Text><Text c="dimmed" size="xs">Live statistics require runtime integration.</Text></Stack></Tabs.Panel>
      </ScrollArea>
     </Tabs>}
    <Divider my="xs"/><Group justify="space-between"><Text size="xs" c={saveError?'red':'dimmed'}>{saveError||message||'Changes are not applied until Save.'}</Text><Group gap="xs"><Button onClick={save}>Save</Button><Button variant="light" onClick={onCancel}>Cancel</Button></Group></Group>
   </Card>
 </Group>;
}
