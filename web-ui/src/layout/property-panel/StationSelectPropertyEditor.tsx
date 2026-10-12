import { ActionIcon, Button, Group, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { IconDots, IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import AppModal from "@/components/common/AppModal";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import { BlockElement } from "@/models/editor/elements/BlockElement";

type Station = { id: string; name: string };
type Props = { block: BlockElement; layout: LayoutView; onChange: () => void };

export default function StationSelectPropertyEditor({ block, layout, onChange }: Props) {
  const [opened, setOpened] = useState(false);
  const [draft, setDraft] = useState<Station[]>([]);
  useEffect(() => {
    if (opened) setDraft(layout.stations.map(station => ({ ...station })));
  }, [opened, layout]);

  const add = () => {
    const occupied = new Set(draft.map(station => station.id));
    let number = 1;
    while (occupied.has(`station-${number}`)) number++;
    setDraft(current => [...current, { id: `station-${number}`, name: `Station ${number}` }]);
  };
  const save = () => {
    const cleaned = draft.map(station => ({ id: station.id, name: station.name.trim() }));
    if (cleaned.some(station => !station.name) ||
        new Set(cleaned.map(station => station.name.toLowerCase())).size !== cleaned.length) return;
    const ids = new Set(cleaned.map(station => station.id));
    layout.stations = cleaned;
    for (const element of layout.blocks.elements) {
      if (element instanceof BlockElement && element.stationId && !ids.has(element.stationId)) {
        element.stationId = null;
      }
    }
    onChange();
    setOpened(false);
  };
  const invalid = draft.some(station => !station.name.trim()) ||
    new Set(draft.map(station => station.name.trim().toLowerCase())).size !== draft.length;

  return (
    <>
      <Text size="xs" fw={600} mb={5}>Station</Text>
      <Group gap="xs" wrap="nowrap">
        <Select
          style={{ flex: 1 }}
          size="sm"
          clearable
          searchable
          placeholder="No station"
          aria-label="Block station"
          value={block.stationId}
          data={layout.stations.map(station => ({ value: station.id, label: station.name }))}
          onChange={value => { block.stationId = value; onChange(); }}
        />
        <ActionIcon size="lg" variant="light" aria-label="Edit station list" title="Edit station list" onClick={() => setOpened(true)}>
          <IconDots size={18}/>
        </ActionIcon>
      </Group>
      <AppModal opened={opened} onClose={() => setOpened(false)} title="Stations" size="lg" centered draggable>
        <Stack gap="sm">
          <Group justify="space-between">
            <Text size="sm" c="dimmed">Station names are shared by all blocks in this layout.</Text>
            <Button size="xs" leftSection={<IconPlus size={14}/>} onClick={add}>Add station</Button>
          </Group>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>Station name</Table.Th><Table.Th w={52}/></Table.Tr></Table.Thead>
            <Table.Tbody>
              {draft.map(station => (
                <Table.Tr key={station.id}>
                  <Table.Td><TextInput size="sm" value={station.name} onChange={event => {
                    const name = event.currentTarget.value;
                    setDraft(current => current.map(item => item.id === station.id ? { ...item, name } : item));
                  }}/></Table.Td>
                  <Table.Td><ActionIcon variant="light" color="red" aria-label={`Delete ${station.name}`} onClick={() => setDraft(current => current.filter(item => item.id !== station.id))}><IconTrash size={15}/></ActionIcon></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {invalid && <Text size="xs" c="red">Station names must be non-empty and unique.</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpened(false)}>Cancel</Button>
            <Button onClick={save} disabled={invalid}>Save</Button>
          </Group>
        </Stack>
      </AppModal>
    </>
  );
}
