import { useState } from "react";
import { ActionIcon, Badge, Button, Card, Checkbox, Group, NumberInput, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { IconPlayerPlay, IconPlus, IconTrash } from "@tabler/icons-react";
import AppWindow from "./AppWindow";
import type { Profile } from "./HardwareProfilesPage";

type Lamp = { id: string; color: string };
type Aspect = { id: string; name: string; lamps: Record<string, boolean> };
type ProfileMapping = { mode: "extended" | "outputs"; extendedId: string; outputIds: string[]; values: Record<string, number>; states: Record<string, Record<string, boolean>> };
export type Signal = { id: string; name: string; lamps: Lamp[]; aspects: Aspect[]; mappings: Record<string, ProfileMapping> };
export type SignalOutput = { id: string; name: string; category: string };
const uid = () => "id-" + Math.random().toString(36).slice(2, 10);
const colors = [{value:"#fa5252",label:"Red"},{value:"#40c057",label:"Green"},{value:"#fab005",label:"Yellow"},{value:"#228be6",label:"Blue"},{value:"#ffffff",label:"White"}];
const newMapping = (): ProfileMapping => ({ mode:"extended", extendedId:"", outputIds:[], values:{}, states:{} });
export const initialSignals: Signal[] = [];
export default function SignalsPage({ profiles, outputs, signals, setSignals }: {
  profiles: Profile[]; outputs: SignalOutput[]; signals: Signal[]; setSignals: React.Dispatch<React.SetStateAction<Signal[]>>;
}) {
  const [editing,setEditing] = useState<Signal | null>(null);
  const [isNew,setIsNew] = useState(false);
  const [selectedProfile,setSelectedProfile] = useState(profiles[0]?.id ?? "");
  const [confirmId,setConfirmId] = useState<string | null>(null);
  const popover = { withinPortal:true, zIndex:1300 };
  const profile = profiles.find(p => p.id === selectedProfile);
  const mappedOutputs = outputs.filter(o => !!profile?.mappings[o.id]?.connectionId);
  const extOptions = mappedOutputs.filter(o => o.category === "Extended accessories").map(o => ({value:o.id,label:o.name}));
  const outOptions = mappedOutputs.filter(o => ["Basic accessories","Outputs"].includes(o.category)).map(o => ({value:o.id,label:o.name+" · "+o.category}));
  const mapping = editing?.mappings[selectedProfile] ?? newMapping();
  function changeMapping(fn:(m:ProfileMapping)=>ProfileMapping) {
    setEditing(current => current ? {...current,mappings:{...current.mappings,[selectedProfile]:fn(current.mappings[selectedProfile] ?? newMapping())}} : null);
  }
  function create() {
    const red=uid(),green=uid();
    setEditing({id:uid(),name:"",lamps:[{id:red,color:"#fa5252"},{id:green,color:"#40c057"}],
      aspects:[{id:uid(),name:"Stop",lamps:{[red]:true}},{id:uid(),name:"Proceed",lamps:{[green]:true}}],mappings:{}});
    setIsNew(true);
  }
  function removeLamp(lampId:string) {
    setEditing(current=>current ? {...current,lamps:current.lamps.filter(l=>l.id!==lampId),
      aspects:current.aspects.map(a=>{const lamps={...a.lamps};delete lamps[lampId];return {...a,lamps};})}:null);
  }
  function removeAspect(aspectId:string) {
    setEditing(current=>{
      if(!current)return null;
      const mappings:Record<string,ProfileMapping>={};
      for(const [key,m] of Object.entries(current.mappings)){
        const values={...m.values},states={...m.states};delete values[aspectId];delete states[aspectId];
        mappings[key]={...m,values,states};
      }
      return {...current,aspects:current.aspects.filter(a=>a.id!==aspectId),mappings};
    });
  }
  function save(){
    if(!editing?.name.trim() || !editing.aspects.length || editing.aspects.some(a=>!a.name.trim()))return;
    setSignals(items=>isNew?[...items,editing]:items.map(item=>item.id===editing.id?editing:item));
    setEditing(null);
  }
  return <Stack gap="md">
    <Group justify="space-between">
      <div><Title order={3}>Signals</Title><Text c="dimmed" size="sm">Physical lamps, aspects and per-profile output matrix</Text></div>
      <Button leftSection={<IconPlus size={16}/>} onClick={create}>New signal</Button>
    </Group>
    <Card withBorder><Table striped highlightOnHover>
      <Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>Lamps</Table.Th><Table.Th>Aspects</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{signals.map(sig=><Table.Tr key={sig.id}>
        <Table.Td><Text fw={600}>{sig.name}</Text><Text c="dimmed" size="xs">{sig.id}</Text></Table.Td>
        <Table.Td><Group gap={5}>{sig.lamps.map(l=><span key={l.id} style={{background:l.color,width:15,height:15,borderRadius:"50%",border:"1px solid #888"}}/>)}</Group></Table.Td>
        <Table.Td>{sig.aspects.length}</Table.Td>
        <Table.Td><Group gap="xs"><Button size="compact-xs" variant="light" onClick={()=>{setEditing(structuredClone(sig));setIsNew(false);}}>Edit</Button>
          <ActionIcon color="red" variant="subtle" aria-label={"Delete "+sig.name} onClick={()=>setConfirmId(sig.id)}><IconTrash size={16}/></ActionIcon></Group></Table.Td>
      </Table.Tr>)}</Table.Tbody>
    </Table>{!signals.length&&<Text ta="center" c="dimmed" py="lg" size="sm">No signals yet.</Text>}</Card>
    <Text size="xs" c="dimmed">UI prototype. No live device test or backend persistence yet.</Text>
    <AppWindow opened={!!editing} onClose={()=>setEditing(null)} title={isNew?"New signal":"Edit signal"} width={940} fixedHeight
      footer={<><Button variant="default" onClick={()=>setEditing(null)}>Cancel</Button>
        <Button disabled={!editing?.name.trim()||!editing.aspects.length||editing.aspects.some(a=>!a.name.trim())} onClick={save}>Apply</Button></>}>
      {editing&&<Stack gap="md">
        <TextInput label="Signal name" value={editing.name} onChange={e=>setEditing({...editing,name:e.currentTarget.value})}/>
        <Group grow align="start">
          <Select label="Hardware profile" data={profiles.map(p=>({value:p.id,label:p.name}))} comboboxProps={popover}
            value={selectedProfile||null} allowDeselect={false} onChange={v=>v&&setSelectedProfile(v)}/>
          <Select label="Control mode" value={mapping.mode} comboboxProps={popover} allowDeselect={false}
            data={[{value:"extended",label:"Extended accessory"},{value:"outputs",label:"Basic accessories / VPIN outputs"}]}
            onChange={v=>v&&changeMapping(m=>({...m,mode:v as ProfileMapping["mode"]}))}/>
        </Group>
        {mapping.mode==="extended"?<Select label="Existing Extended accessory" data={extOptions} placeholder="Select accessory"
          comboboxProps={popover} value={mapping.extendedId||null} clearable searchable
          onChange={v=>changeMapping(m=>({...m,extendedId:v??""}))}/>:
          <Stack gap="xs">
            <Group justify="space-between"><Text fw={600} size="sm">Physical outputs ({mapping.outputIds.length})</Text>
              <Button size="xs" variant="light" leftSection={<IconPlus size={13}/>}
                onClick={()=>changeMapping(m=>({...m,outputIds:[...m.outputIds,""]}))}>Add output</Button></Group>
            {mapping.outputIds.map((outputId,i)=><Group key={i} wrap="nowrap">
              <Text size="sm" w={72}>Output {i+1}</Text>
              <Select flex={1} size="sm" data={outOptions} comboboxProps={popover} placeholder="Select existing device"
                searchable clearable value={outputId||null} onChange={v=>changeMapping(m=>({...m,outputIds:m.outputIds.map((x,j)=>j===i?v??"":x)}))}/>
              <ActionIcon color="red" variant="subtle" aria-label={"Remove output "+(i+1)}
                onClick={()=>changeMapping(m=>({...m,outputIds:m.outputIds.filter((_,j)=>j!==i)}))}><IconTrash size={16}/></ActionIcon>
            </Group>)}
          </Stack>}
        <Group justify="space-between"><Text fw={600}>Physical lamps ({editing.lamps.length})</Text>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14}/>}
            onClick={()=>setEditing(cur=>cur?{...cur,lamps:[...cur.lamps,{id:uid(),color:"#fab005"}]}:null)}>Add lamp</Button></Group>
        <Group gap="sm" wrap="wrap">{editing.lamps.map((lamp,i)=><Card withBorder p="xs" key={lamp.id}>
          <Group gap={6} wrap="nowrap"><Text size="xs">Lamp {i+1}</Text>
            {colors.map(c=><ActionIcon key={c.value} size={23} variant="transparent" title={c.label}
              aria-label={"Lamp "+(i+1)+" "+c.label} aria-pressed={lamp.color===c.value}
              onClick={()=>setEditing(cur=>cur?{...cur,lamps:cur.lamps.map(l=>l.id===lamp.id?{...l,color:c.value}:l)}:null)}
              style={{borderRadius:"50%",border:lamp.color===c.value?"2px solid var(--mantine-primary-color-filled)":"2px solid transparent"}}>
              <span style={{width:15,height:15,borderRadius:"50%",background:c.value,border:"1px solid #888"}}/>
            </ActionIcon>)}
            <ActionIcon size="sm" color="red" variant="subtle" aria-label={"Remove lamp "+(i+1)}
              onClick={()=>removeLamp(lamp.id)}><IconTrash size={14}/></ActionIcon>
          </Group>
        </Card>)}</Group>
        <Group justify="space-between"><Text fw={600}>Signal aspects – lamp & output matrix</Text>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14}/>}
            onClick={()=>setEditing(cur=>cur?{...cur,aspects:[...cur.aspects,{id:uid(),name:"New aspect",lamps:{}}]}:null)}>Add aspect</Button></Group>
        <Table.ScrollContainer minWidth={Math.max(620,320+editing.lamps.length*74+(mapping.mode==="outputs"?mapping.outputIds.length*116:115))}>
          <Table striped withTableBorder withColumnBorders verticalSpacing="sm">
            <Table.Thead><Table.Tr><Table.Th>Aspect</Table.Th><Table.Th>Preview</Table.Th>
              {editing.lamps.map((l,i)=><Table.Th key={l.id} ta="center">Lamp {i+1}</Table.Th>)}
              {mapping.mode==="extended"?<Table.Th>Value</Table.Th>:mapping.outputIds.map((o,i)=><Table.Th key={i}>Output {i+1}</Table.Th>)}
              <Table.Th>Test</Table.Th><Table.Th/></Table.Tr></Table.Thead>
            <Table.Tbody>{editing.aspects.map(a=><Table.Tr key={a.id}>
              <Table.Td><TextInput size="xs" w={145} value={a.name}
                onChange={e=>setEditing(cur=>cur?{...cur,aspects:cur.aspects.map(x=>x.id===a.id?{...x,name:e.currentTarget.value}:x)}:null)}/></Table.Td>
              <Table.Td><Group gap={4} wrap="nowrap">{editing.lamps.map(l=><span key={l.id}
                style={{width:16,height:16,borderRadius:"50%",background:a.lamps[l.id]?l.color:"var(--mantine-color-dark-5)",border:"1px solid #777"}}/>)}</Group></Table.Td>
              {editing.lamps.map(l=><Table.Td key={l.id} ta="center"><Checkbox aria-label={a.name+" lamp"} checked={!!a.lamps[l.id]}
                onChange={e=>{const active=e.currentTarget.checked;setEditing(cur=>cur?{...cur,aspects:cur.aspects.map(x=>x.id===a.id?{...x,lamps:{...x.lamps,[l.id]:active}}:x)}:null);}}/></Table.Td>)}
              {mapping.mode==="extended"?<Table.Td><NumberInput size="xs" w={95} min={0} max={255} allowDecimal={false}
                clampBehavior="strict" value={mapping.values[a.id]??0}
                onChange={v=>typeof v==="number"&&changeMapping(m=>({...m,values:{...m.values,[a.id]:v}}))}/></Table.Td>:
                mapping.outputIds.map((outputId,i)=><Table.Td key={i}><Select w={100} size="xs" comboboxProps={popover}
                  disabled={!outputId} value={(mapping.states[a.id]?.[String(i)]??false)?"1":"0"}
                  data={[{value:"0",label:"OFF"},{value:"1",label:"ON"}]}
                  onChange={v=>changeMapping(m=>({...m,states:{...m.states,[a.id]:{...m.states[a.id],[String(i)]:v==="1"}}}))}/></Table.Td>)}
              <Table.Td><Button size="compact-xs" variant="light" disabled leftSection={<IconPlayerPlay size={13}/>}
                title="V2 Runtime test API not implemented">Test</Button></Table.Td>
              <Table.Td><ActionIcon color="red" variant="subtle" aria-label={"Delete aspect "+a.name}
                onClick={()=>removeAspect(a.id)}><IconTrash size={15}/></ActionIcon></Table.Td>
            </Table.Tr>)}</Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Text size="xs" c="dimmed">Define lamps and physical outputs once. Each aspect row sets the lamp preview and the output values. The selected hardware profile determines which existing devices are used.</Text>
      </Stack>}
    </AppWindow>
    <AppWindow opened={!!confirmId} onClose={()=>setConfirmId(null)} title="Delete signal" tone="red"
      footer={<><Button variant="default" onClick={()=>setConfirmId(null)}>Cancel</Button>
        <Button color="red" onClick={()=>{setSignals(items=>items.filter(s=>s.id!==confirmId));setConfirmId(null);}}>Delete</Button></>}>
      <Text size="sm">Delete {signals.find(s=>s.id===confirmId)?.name}?</Text>
    </AppWindow>
  </Stack>;
}
