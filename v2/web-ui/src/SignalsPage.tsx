import { useState } from "react";
import { ActionIcon, Badge, Button, Card, Group, NumberInput, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import AppWindow from "./AppWindow";
import type { Profile } from "./HardwareProfilesPage";

type Aspect = { id: string; name: string; color: string };
type Command = { targetId: string; value: number };
export type Signal = { id: string; name: string; aspects: Aspect[]; mappings: Record<string, Record<string, Command>> };
export type SignalOutput = { id: string; name: string; category: string };
const aspects: Aspect[] = [
  { id: "stop", name: "Stop", color: "red" },
  { id: "approach", name: "Approach", color: "yellow" },
  { id: "proceed", name: "Proceed", color: "green" },
];
const newId = () => "signal-" + Math.random().toString(36).slice(2, 9);
export const initialSignals: Signal[] = [];
export default function SignalsPage({ profiles, outputs, signals, setSignals }: { profiles: Profile[]; outputs: SignalOutput[]; signals: Signal[]; setSignals: React.Dispatch<React.SetStateAction<Signal[]>> }) {
  const [editing, setEditing] = useState<Signal | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(profiles[0]?.id ?? "");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const editableOutputs = outputs.filter(x => ["Basic accessories", "Extended accessories", "Outputs"].includes(x.category));
  const profile = profiles.find(p => p.id === selectedProfile);
  const options = editableOutputs.map(o => ({
    value: o.id, label: o.name + " · " + o.category,
    disabled: !profile?.mappings[o.id]?.connectionId,
  }));
  const create = () => { setEditing({ id:newId(), name:"", aspects:aspects.map(a => ({ ...a })), mappings:{} }); setIsNew(true); };
  const edit = (s: Signal) => { setEditing(structuredClone(s)); setIsNew(false); };
  function updateCommand(aspectId: string, patch: Partial<Command>) {
    setEditing(current => {
      if (!current) return null;
      const all = { ...current.mappings };
      const forProfile = { ...all[selectedProfile] };
      forProfile[aspectId] = { targetId:"", value:0, ...forProfile[aspectId], ...patch };
      all[selectedProfile] = forProfile;
      return { ...current, mappings:all };
    });
  }
  const save = () => {
    if (!editing?.name.trim()) return;
    setSignals(items => isNew ? [...items, editing] : items.map(item => item.id === editing.id ? editing : item));
    setEditing(null);
  };
  return <Stack gap="md">
    <Group justify="space-between">
      <div><Title order={3}>Signals</Title><Text size="sm" c="dimmed">Logical signal aspects and per-profile output actions</Text></div>
      <Button leftSection={<IconPlus size={16}/>} onClick={create}>New signal</Button>
    </Group>
    <Card withBorder>
      <Table striped highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>Aspects</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{signals.map(s => <Table.Tr key={s.id}>
          <Table.Td><Text fw={600}>{s.name}</Text><Text size="xs" c="dimmed">{s.id}</Text></Table.Td>
          <Table.Td><Group gap={5}>{s.aspects.map(a => <Badge key={a.id} color={a.color} variant="light">{a.name}</Badge>)}</Group></Table.Td>
          <Table.Td><Group gap="xs"><Button variant="light" size="compact-xs" onClick={() => edit(s)}>Edit</Button>
            <ActionIcon variant="subtle" color="red" onClick={() => setConfirmId(s.id)} aria-label={"Delete " + s.name}><IconTrash size={16}/></ActionIcon></Group></Table.Td>
        </Table.Tr>)}</Table.Tbody>
      </Table>
      {!signals.length && <Text c="dimmed" ta="center" py="md" size="sm">No signals yet. Create a logical signal to configure its aspects.</Text>}
    </Card>
    <Text size="xs" c="dimmed">Signals reference logical accessories/outputs; they do not store physical Connection addresses. This editor is a frontend prototype.</Text>
    <AppWindow opened={!!editing} onClose={() => setEditing(null)} title={isNew ? "New signal" : "Edit signal"} width={650}
      footer={<><Button variant="default" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={!editing?.name.trim()} onClick={save}>Apply</Button></>}>
      {editing && <Stack gap="md">
        <TextInput label="Signal name" value={editing.name} onChange={e => setEditing({ ...editing, name:e.currentTarget.value })}/>
        <Group grow>
          <Select label="Hardware profile" data={profiles.map(p => ({ value:p.id, label:p.name }))}
            comboboxProps={{ withinPortal:false, zIndex:1200 }} value={selectedProfile || null}
            onChange={v => v && setSelectedProfile(v)}/>
        </Group>
        <Text size="sm" fw={600}>Aspect → output mapping</Text>
        {editing.aspects.map(a => {
          const cmd = editing.mappings[selectedProfile]?.[a.id];
          return <Card withBorder key={a.id} p="sm">
            <Group justify="space-between" mb="xs"><Badge color={a.color}>{a.name}</Badge><Text size="xs" c="dimmed">{a.id}</Text></Group>
            <Group grow align="start">
              <Select label="Existing output" placeholder="Unmapped" clearable searchable
                comboboxProps={{ withinPortal:false, zIndex:1200 }} data={options}
                value={cmd?.targetId || null} onChange={v => updateCommand(a.id,{ targetId:v ?? "" })}/>
              <NumberInput label="Value" min={0} max={255} allowDecimal={false} clampBehavior="strict"
                value={cmd?.value ?? 0} onChange={v => typeof v === "number" && updateCommand(a.id,{ value:v })}/>
            </Group>
          </Card>;
        })}
        <Text size="xs" c="dimmed">Each aspect currently sends one action to a mapped logical device. Multi-output sequences, blinking and actual commands will follow in the Runtime.</Text>
      </Stack>}
    </AppWindow>
    <AppWindow opened={!!confirmId} onClose={() => setConfirmId(null)} title="Delete signal" tone="red"
      footer={<><Button variant="default" onClick={() => setConfirmId(null)}>Cancel</Button>
        <Button color="red" onClick={() => { setSignals(items => items.filter(s => s.id !== confirmId)); setConfirmId(null); }}>Delete</Button></>}>
      <Text size="sm">Delete {signals.find(s => s.id === confirmId)?.name}? Its profile-specific aspect mappings will also be removed.</Text>
    </AppWindow>
  </Stack>;
}
