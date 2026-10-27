import { useState } from "react";
import { ActionIcon, Badge, Button, Card, ColorInput, Divider, Group, NumberInput, Select, Stack, Switch, Table, Text, TextInput, Title } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import AppWindow from "./AppWindow";
import type { Profile } from "./HardwareProfilesPage";

type Aspect = { id: string; name: string; color: string };
type OutputAction = { id: string; targetId: string; value: number };
type ProfileMapping = { mode: "extended" | "outputs"; extendedId: string; values: Record<string, number>; actions: Record<string, OutputAction[]> };
export type Signal = { id: string; name: string; aspects: Aspect[]; mappings: Record<string, ProfileMapping> };
export type SignalOutput = { id: string; name: string; category: string };
const id = () => "id-" + Math.random().toString(36).slice(2, 10);
const defaultAspects: Aspect[] = [{ id: id(), name: "Stop", color: "#fa5252" }, { id: id(), name: "Proceed", color: "#40c057" }];
export const initialSignals: Signal[] = [];
const defaultMapping = (): ProfileMapping => ({ mode: "extended", extendedId: "", values: {}, actions: {} });

export default function SignalsPage({ profiles, outputs, signals, setSignals }: {
  profiles: Profile[]; outputs: SignalOutput[]; signals: Signal[]; setSignals: React.Dispatch<React.SetStateAction<Signal[]>>;
}) {
  const [editing, setEditing] = useState<Signal | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(profiles[0]?.id ?? "");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const profile = profiles.find(p => p.id === selectedProfile);
  const editableOutputs = outputs.filter(o => ["Basic accessories", "Extended accessories", "Outputs"].includes(o.category));
  const usable = (category: string) => editableOutputs.filter(o => o.category === category && !!profile?.mappings[o.id]?.connectionId);
  const extendedOptions = usable("Extended accessories").map(o => ({ value: o.id, label: o.name }));
  const outputOptions = [...usable("Basic accessories"), ...usable("Outputs")].map(o => ({ value: o.id, label: o.name + " · " + o.category }));
  const mapping = editing?.mappings[selectedProfile] ?? defaultMapping();
  const popover = { withinPortal: false, zIndex: 1200 };
  function changeMapping(update: (value: ProfileMapping) => ProfileMapping) {
    setEditing(current => {
      if (!current) return null;
      const previous = current.mappings[selectedProfile] ?? defaultMapping();
      return { ...current, mappings: { ...current.mappings, [selectedProfile]: update(previous) } };
    });
  }
  function addAspect() {
    setEditing(current => current ? { ...current, aspects: [...current.aspects, { id:id(), name:"New aspect", color:"#fab005" }] } : null);
  }
  function changeAspect(aspectId: string, patch: Partial<Aspect>) {
    setEditing(current => current ? { ...current, aspects:current.aspects.map(a => a.id === aspectId ? { ...a, ...patch } : a) } : null);
  }
  function removeAspect(aspectId: string) {
    setEditing(current => {
      if (!current) return null;
      const mappings: Record<string, ProfileMapping> = {};
      for (const [key, value] of Object.entries(current.mappings)) {
        const values = { ...value.values }; delete values[aspectId];
        const actions = { ...value.actions }; delete actions[aspectId];
        mappings[key] = { ...value, values, actions };
      }
      return { ...current, aspects:current.aspects.filter(a => a.id !== aspectId), mappings };
    });
  }
  function changeActions(aspectId: string, fn: (actions: OutputAction[]) => OutputAction[]) {
    changeMapping(m => ({ ...m, actions: { ...m.actions, [aspectId]: fn(m.actions[aspectId] ?? []) } }));
  }
  function edit(signal: Signal) { setEditing(structuredClone(signal)); setIsNew(false); }
  function create() {
    setEditing({ id:id(), name:"", aspects:defaultAspects.map(a => ({ ...a, id:id() })), mappings:{} });
    setIsNew(true);
  }
  function save() {
    if (!editing?.name.trim() || !editing.aspects.length || editing.aspects.some(a => !a.name.trim())) return;
    setSignals(items => isNew ? [...items, editing] : items.map(item => item.id === editing.id ? editing : item));
    setEditing(null);
  }
  return <Stack gap="md">
    <Group justify="space-between">
      <div><Title order={3}>Signals</Title><Text size="sm" c="dimmed">Signal aspects and existing hardware output bindings</Text></div>
      <Button leftSection={<IconPlus size={16}/>} onClick={create}>New signal</Button>
    </Group>
    <Card withBorder>
      <Table striped highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>Aspects</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{signals.map(s => <Table.Tr key={s.id}>
          <Table.Td><Text fw={600}>{s.name}</Text><Text c="dimmed" size="xs">{s.id}</Text></Table.Td>
          <Table.Td><Group gap={5}>{s.aspects.map(a => <Badge key={a.id} variant="light" color="gray" leftSection={<span style={{ display:"inline-block", background:a.color, width:9, height:9, borderRadius:"50%" }}/>} >{a.name}</Badge>)}</Group></Table.Td>
          <Table.Td><Group gap="xs"><Button variant="light" size="compact-xs" onClick={() => edit(s)}>Edit</Button>
            <ActionIcon color="red" variant="subtle" onClick={() => setConfirmId(s.id)} aria-label={"Delete " + s.name}><IconTrash size={16}/></ActionIcon></Group></Table.Td>
        </Table.Tr>)}</Table.Tbody>
      </Table>
      {!signals.length && <Text c="dimmed" ta="center" py="lg" size="sm">No signals yet.</Text>}
    </Card>
    <Text c="dimmed" size="xs">Configuration prototype: outputs are referenced by logical IDs; no hardware command is sent.</Text>
    <AppWindow opened={!!editing} onClose={() => setEditing(null)} title={isNew ? "New signal" : "Edit signal"} width={750}
      footer={<><Button variant="default" onClick={() => setEditing(null)}>Cancel</Button>
        <Button disabled={!editing?.name.trim() || !editing.aspects.length || editing.aspects.some(a => !a.name.trim())} onClick={save}>Apply</Button></>}>
      {editing && <Stack gap="md">
        <TextInput label="Signal name" value={editing.name} onChange={e => setEditing({ ...editing, name:e.currentTarget.value })}/>
        <Group justify="space-between"><Text fw={600}>Aspects</Text><Button size="xs" variant="light" leftSection={<IconPlus size={14}/>} onClick={addAspect}>Add aspect</Button></Group>
        {editing.aspects.map(a => <Group key={a.id} grow={false} wrap="nowrap">
          <TextInput aria-label="Aspect name" placeholder="Aspect name" value={a.name} style={{ flex:1 }}
            onChange={e => changeAspect(a.id, { name:e.currentTarget.value })}/>
          <ColorInput aria-label={"Color for " + a.name} format="hex" w={135} value={a.color}
            onChange={color => changeAspect(a.id,{color})} popoverProps={{ withinPortal:false, zIndex:1200 }}/>
          <ActionIcon color="red" variant="subtle" aria-label={"Remove " + a.name} onClick={() => removeAspect(a.id)}><IconTrash size={16}/></ActionIcon>
        </Group>)}
        <Divider/>
        <Select label="Hardware profile" value={selectedProfile || null} allowDeselect={false} comboboxProps={popover}
          data={profiles.map(p => ({ value:p.id, label:p.name }))} onChange={v => v && setSelectedProfile(v)}/>
        <Select label="Signal control mode" value={mapping.mode} allowDeselect={false} comboboxProps={popover}
          data={[{value:"extended",label:"One existing Extended accessory (aspect value)"},{value:"outputs",label:"Existing Basic accessories / outputs (multiple actions)"}]}
          onChange={v => v && changeMapping(m => ({ ...m, mode:v as ProfileMapping["mode"] }))}/>
        {mapping.mode === "extended" ? <Stack gap="sm">
          <Select label="Extended accessory" placeholder="Choose an existing logical extended accessory" searchable clearable
            comboboxProps={popover} data={extendedOptions} value={mapping.extendedId || null}
            onChange={v => changeMapping(m => ({ ...m, extendedId:v ?? "" }))}/>
          {!extendedOptions.length && <Text size="xs" c="orange">First create and map an Extended accessory in Hardware Profiles.</Text>}
          {editing.aspects.map(a => <Group key={a.id} justify="space-between" wrap="nowrap">
            <Group gap="xs"><span style={{width:12,height:12,borderRadius:"50%",background:a.color}}/><Text size="sm">{a.name}</Text></Group>
            <NumberInput w={125} label="Value (0–255)" min={0} max={255} clampBehavior="strict" allowDecimal={false}
              value={mapping.values[a.id] ?? 0} onChange={v => typeof v === "number" && changeMapping(m => ({
                ...m, values:{...m.values,[a.id]:v}
              }))}/>
          </Group>)}
        </Stack> : <Stack gap="md">
          {!outputOptions.length && <Text size="xs" c="orange">First create and map Basic accessories or Outputs in Hardware Profiles.</Text>}
          {editing.aspects.map(a => <Card withBorder p="sm" key={a.id}>
            <Group justify="space-between" mb="xs">
              <Group gap="xs"><span style={{width:12,height:12,borderRadius:"50%",background:a.color}}/><Text fw={600} size="sm">{a.name}</Text></Group>
              <Button size="compact-xs" leftSection={<IconPlus size={12}/>} variant="light"
                onClick={() => changeActions(a.id, items => [...items,{id:id(),targetId:"",value:1}])}>Add output</Button>
            </Group>
            {(mapping.actions[a.id] ?? []).map(action => <Group key={action.id} wrap="nowrap" gap="xs" mb={6}>
              <Select flex={1} size="xs" placeholder="Existing accessory / output" searchable clearable
                comboboxProps={popover} data={outputOptions} value={action.targetId || null}
                onChange={v => changeActions(a.id, items => items.map(x => x.id===action.id ? {...x,targetId:v ?? ""}:x))}/>
              <Select size="xs" w={88} comboboxProps={popover} aria-label="Output state" value={String(action.value)}
                data={[{value:"0",label:"OFF / 0"},{value:"1",label:"ON / 1"}]}
                onChange={v => v!==null && changeActions(a.id, items => items.map(x => x.id===action.id ? {...x,value:Number(v)}:x))}/>
              <ActionIcon size="sm" color="red" variant="subtle" aria-label="Remove output"
                onClick={() => changeActions(a.id, items => items.filter(x => x.id !== action.id))}><IconTrash size={15}/></ActionIcon>
            </Group>)}
          </Card>)}
        </Stack>}
        <Text size="xs" c="dimmed">Aspects and colors belong to the logical signal. Hardware output assignments belong to the selected profile. Multiple output actions can be assigned to each aspect.</Text>
      </Stack>}
    </AppWindow>
    <AppWindow opened={!!confirmId} onClose={() => setConfirmId(null)} title="Delete signal" tone="red"
      footer={<><Button variant="default" onClick={() => setConfirmId(null)}>Cancel</Button>
        <Button color="red" onClick={() => { setSignals(items => items.filter(s => s.id !== confirmId)); setConfirmId(null); }}>Delete</Button></>}>
      <Text size="sm">Delete {signals.find(s => s.id === confirmId)?.name} and its aspect mappings?</Text>
    </AppWindow>
  </Stack>;
}
