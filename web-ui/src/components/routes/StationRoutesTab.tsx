import { ActionIcon, Button, Group, Select, Stack, Table, Text, TextInput, Badge, ScrollArea, Switch } from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import type { StationRouteDefinition, StationRouteVia } from "@/domain/layout/stationRoutes";

type Props = { layout: LayoutView; onSave: () => Promise<void>; onChanged: () => void };
const blank = (): StationRouteDefinition => ({
  id: `station-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: "", fromStationId: "", toStationId: "", via: [], enabled: true,
});

export default function StationRoutesTab({ layout, onSave, onChanged }: Props) {
  const [draft, setDraft] = useState<StationRouteDefinition | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stations = layout.stations.map(s => ({ value: s.id, label: s.name }));
  const blocks = layout.blocks.elements.filter(e => e.type === "trackblock")
    .map(e => ({ value: String(e.id), label: e.name || `Block #${e.id}` }));
  const nameFor = (id: string) => stations.find(s => s.value === id)?.label ?? id;
  const viaName = (via: StationRouteVia) => (via.type === "station" ? stations : blocks)
    .find(option => option.value === via.targetId)?.label ?? via.targetId;
  const update = (patch: Partial<StationRouteDefinition>) =>
    setDraft(current => current ? { ...current, ...patch } : current);
  const changeVia = (index: number, patch: Partial<StationRouteVia>) =>
    draft && update({ via: draft.via.map((via, i) => i === index ? { ...via, ...patch } : via) });
  const valid = !!draft?.name.trim() && !!draft.fromStationId && !!draft.toStationId &&
    draft.fromStationId !== draft.toStationId && draft.via.every(v => !!v.targetId) &&
    stations.some(s => s.value === draft.fromStationId) &&
    stations.some(s => s.value === draft.toStationId) &&
    draft.via.every(v => (v.type === "station" ? stations : blocks).some(option => option.value === v.targetId));
  const persist = async (next: StationRouteDefinition[]) => {
    setSaving(true);
    setError(null);
    const previous = layout.stationRoutes;
    layout.stationRoutes = next;
    try {
      await onSave();
      onChanged();
      setDraft(null);
    } catch (e) {
      layout.stationRoutes = previous;
      setError(String(e));
    } finally { setSaving(false); }
  };
  return (
    <Stack gap="sm" pt="sm" style={{ flex: 1, minHeight: 0 }}>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">Define station-to-station routes for later dispatcher use. No trains are started here.</Text>
        <Button size="xs" leftSection={<IconPlus size={14}/>} onClick={() => setDraft(blank())}>New route</Button>
      </Group>
      {error && <Text c="red" size="sm">{error}</Text>}
      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <Table withTableBorder striped highlightOnHover>
          <Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>From → To</Table.Th><Table.Th>Via (ordered)</Table.Th><Table.Th>Enabled</Table.Th><Table.Th w={150}>Actions</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {layout.stationRoutes.map(route => <Table.Tr key={route.id}>
              <Table.Td>{route.name}</Table.Td>
              <Table.Td>{nameFor(route.fromStationId)} → {nameFor(route.toStationId)}</Table.Td>
              <Table.Td>{route.via.length ? route.via.map(v => viaName(v)).join(" → ") : "Direct"}</Table.Td>
              <Table.Td><Badge color={route.enabled ? "teal" : "gray"}>{route.enabled ? "Yes" : "No"}</Badge></Table.Td>
              <Table.Td><Group gap={4} wrap="nowrap">
                <Button size="compact-xs" variant="light" onClick={() => setDraft({ ...route, via: route.via.map(v => ({...v})) })}>Edit</Button>
                <ActionIcon color="red" variant="light" aria-label="Delete route" disabled={saving}
                  onClick={() => { if (window.confirm(`Delete station route "${route.name}"?`)) void persist(layout.stationRoutes.filter(r => r.id !== route.id)); }}><IconTrash size={15}/></ActionIcon>
              </Group></Table.Td>
            </Table.Tr>)}
            {!layout.stationRoutes.length && <Table.Tr><Table.Td colSpan={5}><Text ta="center" c="dimmed">No station routes defined yet.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
        {draft && <Stack gap="sm" mt="md" p="sm" style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8 }}>
          <Text fw={700}>Station route editor</Text>
          <TextInput label="Name" value={draft.name} onChange={e => update({ name: e.currentTarget.value })}/>
          <Group grow align="start">
            <Select label="From station" searchable data={stations} value={draft.fromStationId || null}
              onChange={fromStationId => update({ fromStationId: fromStationId ?? "" })}/>
            <Select label="To station" searchable data={stations} value={draft.toStationId || null}
              onChange={toStationId => update({ toStationId: toStationId ?? "" })}/>
          </Group>
          <Group justify="space-between">
            <Text fw={600} size="sm">Via points (in order)</Text>
            <Button size="compact-xs" variant="light" leftSection={<IconPlus size={14}/>}
              onClick={() => update({ via: [...draft.via, { type: "station", targetId: "", behavior: "pass" }] })}>Add Via</Button>
          </Group>
          {draft.via.map((via, i) => <Group key={i} gap={5} wrap="nowrap">
            <Text size="xs" w={20}>{i + 1}.</Text>
            <Select size="xs" w={110} allowDeselect={false} data={[{value:"station",label:"Station"},{value:"block",label:"Block"}]}
              value={via.type} onChange={type => changeVia(i, { type: type === "block" ? "block" : "station", targetId: "" })}/>
            <Select size="xs" searchable style={{ flex: 1 }} data={via.type === "station" ? stations : blocks}
              value={via.targetId || null} onChange={targetId => changeVia(i, { targetId: targetId ?? "" })}/>
            <Select size="xs" w={92} allowDeselect={false} data={[{value:"pass",label:"Pass"},{value:"stop",label:"Stop"}]}
              value={via.behavior} onChange={behavior => changeVia(i, { behavior: behavior === "stop" ? "stop" : "pass" })}/>
            <ActionIcon variant="subtle" disabled={i === 0} onClick={() => { const viaList=[...draft.via]; [viaList[i-1],viaList[i]]=[viaList[i]!,viaList[i-1]!];update({via:viaList}); }}><IconArrowUp size={15}/></ActionIcon>
            <ActionIcon variant="subtle" disabled={i === draft.via.length-1} onClick={() => {const viaList=[...draft.via]; [viaList[i+1],viaList[i]]=[viaList[i]!,viaList[i+1]!];update({via:viaList});}}><IconArrowDown size={15}/></ActionIcon>
            <ActionIcon variant="subtle" color="red" onClick={() => update({via:draft.via.filter((_,j)=>i!==j)})}><IconTrash size={15}/></ActionIcon>
          </Group>)}
          <Switch label="Enabled" checked={draft.enabled} onChange={e => update({enabled:e.currentTarget.checked})}/>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDraft(null)}>Cancel</Button>
            <Button loading={saving} disabled={!valid} onClick={() => void persist([...layout.stationRoutes.filter(r => r.id !== draft.id), draft])}>Save route</Button>
          </Group>
        </Stack>}
      </ScrollArea>
    </Stack>
  );
}
