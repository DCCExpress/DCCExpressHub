import { useMemo, useState } from 'react';
import { ActionIcon, Button, Card, Checkbox, Divider, Group, NumberInput, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import type { Loco, LocoAction, LocoActionHook, LocoFunction, FunctionBinding } from './storage';
import LocoListPanel from './loco-dialog/LocoListPanel';
import LocoGeneralTab from './loco-dialog/LocoGeneralTab';
import TrainGeometryPreview from './loco-dialog/TrainGeometryPreview';
import LocoCounterSettingsPanel from './loco-dialog/LocoCounterSettingsPanel';
import LocoFunctionsTab from './loco-dialog/LocoFunctionsTab';

const label=(key:string):string=>({
 'locodialog.mozdonylista':'Locomotives','locodialog.newloco':'New locomotive',
 'locodialog.unknownloco':'Unknown locomotive','locodialog.locoaddress':'DCC address',
 'locodialog.loco_speed_max':'Max speed','locodialog.delete':'Delete',
 'locodialog.selectimage':'Select image','locodialog.loconame':'Locomotive name',
 'locodialog.loco_max_speed':'Maximum speed','locodialog.loco_cruising_speed':'Cruising speed',
 'locodialog.loco_cruising_speed_description':'Default step for locomotive movement',
 'locodialog.loco_direction_invert':'Invert direction',
 'locodialog.counters_title':'Mechanical counters',
 'locodialog.odometer_km':'Odometer (km)',
 'locodialog.operating_hours':'Operating hours',
 'locodialog.counter_max_scale_speed':'Maximum scale speed',
 'locodialog.counter_display_global_hint':'Counter display settings can be configured for each locomotive.',
 } as Record<string,string>)[key] ?? key;

const hooks: {value:LocoActionHook;label:string}[]=[
 {value:'beforeStart',label:'Before start'},{value:'afterStart',label:'After start'},
 {value:'beforeStop',label:'Before stop'},{value:'afterStop',label:'After stop'}
];
const n=(v:number|string|undefined,otherwise=0)=>Number.isFinite(Number(v))?Number(v):otherwise;
const ensureBrowserFunctions=(loco:Loco):Loco=>{
 const existing=loco.functions??[];
 const functions:Array<LocoFunction>=Array.from({length:29},(_,number)=>{
   const found=existing.find(fn=>fn.number===number);
   return found??{
     id:crypto.randomUUID(),number,name:number===0?'Headlight':`F${number}`,
     icon:'',momentary:false,showOnLocoCard:number<5,startupActive:false
   };
 });
 return {...loco,functions};
};
const makeLoco=():Loco=>({id:crypto.randomUUID(),name:'New locomotive',address:3,manufacturer:'',notes:'',active:true,maxSpeed:126,cruisingSpeed:20,invert:false,length:200,locomotiveLengthMm:200,wagonsLengthMm:0,trainType:'passenger',functions:Array.from({length:29},(_,number)=>({id:crypto.randomUUID(),number,name:number===0?'Headlight':`F${number}`,icon:'',momentary:false,showOnLocoCard:number<5,startupActive:false}))});
export function LocoEditor({locos:originalLocos,functionBindings:originalBindings=[],onSave,onCancel,onDrive,onFunctionTest}:{locos:Loco[];functionBindings?:FunctionBinding[];onSave:(value:Loco[],bindings:FunctionBinding[])=>void;onCancel:()=>void;onDrive:(address:number)=>void;onFunctionTest:(address:number,fn:number,active:boolean)=>void}) {
 const [functionBindings,setFunctionBindings]=useState<FunctionBinding[]>(()=>structuredClone(originalBindings));
 const [locos,setLocos]=useState<Loco[]>(()=>structuredClone(originalLocos).map(ensureBrowserFunctions));
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
   onSave(locos,functionBindings);
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
 return <Stack gap="md" style={{height:'min(740px, calc(100dvh - 120px))',minHeight:0}}>
  <Group className="loco-dialog-content" wrap="nowrap" gap="md" align="stretch" style={{flex:1,minHeight:0}}>
   <LocoListPanel
     locos={locos} selectedId={selected?.id??''} onSelect={setSelectedId}
     onActiveChange={(id,active)=>onChange(previous=>previous.map(loco=>loco.id===id?{...loco,active}:loco))}
     onAdd={add} onDeleteSelected={remove} hasSelectedLoco={!!selected} t={label}
   />
   <Card withBorder p="md" style={{flex:1,minWidth:0,minHeight:0,display:'flex',flexDirection:'column'}}>
    {!selected?<Stack justify="center" align="center" h="100%"><Text c="dimmed">Add a locomotive to begin.</Text></Stack>:
     <Tabs key={selected.id} defaultValue="general" style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
      <Tabs.List>
       <Tabs.Tab value="general">General</Tabs.Tab><Tabs.Tab value="functions">Functions</Tabs.Tab><Tabs.Tab value="actions">Actions</Tabs.Tab>
       <Tabs.Tab value="extended">Extended</Tabs.Tab><Tabs.Tab value="counters">Counters</Tabs.Tab><Tabs.Tab value="decoder">Decoder CV</Tabs.Tab>
       <Tabs.Tab value="statistics" ml="auto">Statistics</Tabs.Tab>
      </Tabs.List>
      <ScrollArea type="auto" style={{flex:1,minHeight:0}} mt="sm">
       <Tabs.Panel value="general" style={{height:'100%'}}>
        <LocoGeneralTab key={selected.id} loco={selected} onPatch={update}
          onImageFile={file=>{
            if(!file)return;
            if(file.size>6*1024*1024){setMessage('Image must be smaller than 6 MB.');return;}
            update({image:file});
          }}
          t={label}
        />
       </Tabs.Panel>
       <Tabs.Panel value="functions" pt="md" style={{flex:1,minHeight:0}}>
         <LocoFunctionsTab functions={functions} functionBindings={functionBindings}
           onFunctionBindingsChange={setFunctionBindings} onUpdateFunction={updateFunction}
           onFunctionTest={(fn,active)=>onFunctionTest(selected.address,fn.number,active)}
           t={label}
         />
       </Tabs.Panel>
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
       <Tabs.Panel value="extended" pt="md">
        <SimpleGrid cols={{base:1,lg:2}} spacing="md" style={{alignItems:'start',gridTemplateColumns:'minmax(220px,3fr) minmax(0,7fr)'}}>
         <Stack gap="md">
          <Select label="Train type" data={['passenger','freight','mixed','maintenance','other']}
            value={selected.trainType??'passenger'}
            onChange={value=>update({trainType:(value??'passenger') as Loco['trainType']})}/>
          <NumberInput label="Locomotive length (mm)" value={selected.locomotiveLengthMm??selected.length??200} min={1}
            onChange={value=>{const locomotiveLengthMm=Math.max(1,n(value,1));const wagonsLengthMm=selected.wagonsLengthMm??0;update({locomotiveLengthMm,wagonsLengthMm,length:locomotiveLengthMm+wagonsLengthMm});}}/>
          <NumberInput label="Total wagon length (mm)" value={selected.wagonsLengthMm??0} min={0}
            onChange={value=>{const wagonsLengthMm=Math.max(0,n(value));const locomotiveLengthMm=selected.locomotiveLengthMm??selected.length??200;update({locomotiveLengthMm,wagonsLengthMm,length:locomotiveLengthMm+wagonsLengthMm});}}/>
          <Text size="xs" c="dimmed">Total train length: {selected.length??200} mm</Text>
          <Checkbox label="Entire train electrically detectable"
            description="Enable only when the last vehicle also reliably maintains block occupancy."
            checked={selected.entireTrainDetectable??false}
            onChange={e=>update({entireTrainDetectable:e.currentTarget.checked})}/>
          <NumberInput label="Train clearance margin (mm)" value={selected.trainClearanceMarginMm??30} min={0} max={2000}
            onChange={value=>update({trainClearanceMarginMm:Math.max(0,n(value))})}/>
          <Text size="xs" c="dimmed">If only the locomotive is detectable, cars may still occupy a block after its occupancy signal goes OFF.</Text>
         </Stack>
         <TrainGeometryPreview trainLengthMm={selected.length??200}
           locomotiveLengthMm={selected.locomotiveLengthMm??selected.length??200}
           wagonsLengthMm={selected.wagonsLengthMm??0}
           entireTrainDetectable={selected.entireTrainDetectable??false}
           clearanceMarginMm={selected.trainClearanceMarginMm??30}
           mode={selected.trainConsistMode??'pull'}
           onModeChange={trainConsistMode=>update({trainConsistMode})}/>
        </SimpleGrid>
       </Tabs.Panel>
       <Tabs.Panel value="counters" pt="md">
        <Stack gap="md" maw={620}>
         <TextInput label="Last run" value={selected.lastRunAt??''} readOnly disabled/>
         <LocoCounterSettingsPanel loco={selected} onPatch={update} t={label}/>
         <Text size="xs" c="dimmed">Automatic runtime updates are not yet available in the browser edition.</Text>
        </Stack>
       </Tabs.Panel>
       <Tabs.Panel value="decoder"><Stack>
        <Text fw={600}>Decoder CV</Text><Text c="dimmed" size="sm">Saved decoder profile values only. Service-track CV read/write is not connected to the direct WebSocket yet.</Text>
        <Text size="sm">Stored CV values: {Object.keys(selected.decoderProfile?.cvValues??{}).length}</Text>
        <Table><Table.Thead><Table.Tr><Table.Th>CV</Table.Th><Table.Th>Value</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{Object.entries(selected.decoderProfile?.cvValues??{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([cv,value])=><Table.Tr key={cv}><Table.Td>{cv}</Table.Td><Table.Td>{value}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
       </Stack></Tabs.Panel>
       <Tabs.Panel value="statistics"><Stack maw={500}><Title order={5}>Locomotive statistics</Title><Text>Odometer: {selected.odometerKm??0} km</Text><Text>Operating hours: {selected.operatingHours??0}</Text><Text>Last run: {selected.lastRunAt??'Never'}</Text><Text>Function mappings: {functions.length}</Text><Text c="dimmed" size="xs">Live statistics require runtime integration.</Text></Stack></Tabs.Panel>
      </ScrollArea>
     </Tabs>}
   </Card>
  </Group>
  <Divider/>
  <Group justify="space-between">
    <Text size="sm" c={saveError?'red':'dimmed'}>{saveError||message||''}</Text>
    <Group><Button onClick={save}>Save</Button><Button variant="light" onClick={onCancel}>Cancel</Button></Group>
  </Group>
 </Stack>;
}
