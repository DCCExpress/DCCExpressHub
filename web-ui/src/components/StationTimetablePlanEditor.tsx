import { ActionIcon, Alert, Button, Group, Select, Stack, Text } from "@mantine/core";
import { IconPlus, IconTrash, IconArrowUp, IconArrowDown } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { SerializedLayoutDto } from "@/domain/layout/layoutDto";
import type { StationTimetablePlan, StationTimetableVia } from "@/services/automationApi";

type Option = { value: string; label: string };
type Props = { value: StationTimetablePlan; onChange: (next: StationTimetablePlan) => void };
export default function StationTimetablePlanEditor({ value, onChange }: Props) {
  const [stations, setStations] = useState<Option[]>([]);
  const [blocks, setBlocks] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/layout", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error(`Layout could not be loaded (${response.status}).`);
      return response.json() as Promise<SerializedLayoutDto>;
    }).then(layout => {
      if (!active) return;
      setStations((layout.stations ?? []).map(station => ({ value: station.id, label: station.name }))
        .sort((a,b) => a.label.localeCompare(b.label, undefined, { numeric: true })));
      setBlocks((layout.layers ?? []).flatMap(layer => layer.elements ?? [])
        .filter(element => element.type === "trackblock" && Number.isInteger(Number(element.id)) && Number(element.id) > 0)
        .map(element => ({ value: String(element.id), label: element.name?.trim() || `Block #${element.id}` }))
        .sort((a,b) => a.label.localeCompare(b.label, undefined, { numeric: true })));
      setError(null);
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, []);
  const updateVia = (index: number, via: StationTimetableVia) =>
    onChange({ ...value, via: value.via.map((item,i) => i === index ? via : item) });
  const stationOptions = stations;
  return (
    <Stack gap={6}>
      <Text size="xs" c="dimmed">Editor-only plan — does not start a train.</Text>
      {error && <Alert color="red" p="xs">{error}</Alert>}
      <Group gap="xs" grow>
        <Select size="xs" label="From station" searchable placeholder="Choose station" data={stationOptions}
          value={value.fromStationId || null} onChange={id => onChange({ ...value, fromStationId: id ?? "" })}/>
        <Select size="xs" label="To station" searchable placeholder="Choose station" data={stationOptions}
          value={value.toStationId || null} onChange={id => onChange({ ...value, toStationId: id ?? "" })}/>
      </Group>
      <Group justify="space-between" align="center">
        <Text size="xs" fw={600}>Via (in order)</Text>
        <Button size="compact-xs" variant="light" leftSection={<IconPlus size={13}/>}
          onClick={() => onChange({ ...value, via: [...value.via, { type: "station", id: "" }] })}>Add via</Button>
      </Group>
      {value.via.map((via,index) => (
        <Group gap={4} wrap="nowrap" key={index}>
          <Select size="xs" w={112} data={[{value:"station",label:"Station"},{value:"block",label:"Block"}]}
            value={via.type} allowDeselect={false}
            onChange={type => updateVia(index, { type: type === "block" ? "block" : "station", id: "" })}/>
          <Select size="xs" style={{ flex: 1 }} searchable placeholder={via.type === "station" ? "Choose station" : "Choose block"}
            data={via.type === "station" ? stationOptions : blocks} value={via.id || null}
            onChange={id => updateVia(index, { ...via, id: id ?? "" })}/>
          <ActionIcon size="sm" variant="subtle" aria-label="Move via up" disabled={index === 0} onClick={() => {
            const next = [...value.via]; [next[index-1],next[index]] = [next[index]!,next[index-1]!]; onChange({...value,via:next});
          }}><IconArrowUp size={14}/></ActionIcon>
          <ActionIcon size="sm" variant="subtle" aria-label="Move via down" disabled={index === value.via.length-1} onClick={() => {
            const next = [...value.via]; [next[index+1],next[index]] = [next[index]!,next[index+1]!]; onChange({...value,via:next});
          }}><IconArrowDown size={14}/></ActionIcon>
          <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove via" onClick={() => onChange({...value,via:value.via.filter((_,i)=>i!==index)})}><IconTrash size={14}/></ActionIcon>
        </Group>
      ))}
      <Text size="xs" c="dimmed">Station groups come from the layout. Via may refer to a whole station or one specific block.</Text>
    </Stack>
  );
}
