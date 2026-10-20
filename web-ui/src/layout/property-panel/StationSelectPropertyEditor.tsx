import { ActionIcon, Button, Group, Stack, Table, Text, TextInput } from "@mantine/core";
import { IconDots, IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import AppModal from "@/components/common/AppModal";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import { BlockElement } from "@/models/editor/elements/BlockElement";

type Station = { id: string; name: string };
type Props = { block: BlockElement; layout: LayoutView; onChange: () => void; onBeforeLayoutChange?: () => void };

export default function StationSelectPropertyEditor({ block, layout, onChange, onBeforeLayoutChange }: Props) {
  const [opened, setOpened] = useState(false);
  const [draft, setDraft] = useState<Station[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (opened) {
      setDraft(layout.stations.map(station => ({ ...station })));
      setSelectedId(block.stationId);
    }
  }, [opened, layout]);

  const add = () => {
    const occupied = new Set(draft.map(station => station.id));
    let number = 1;
    while (occupied.has(`station-${number}`)) number++;
    const id = `station-${number}`;
    setDraft(current => [...current, { id, name: `Station ${number}` }]);
    setSelectedId(id);
  };
  const save = () => {
    const cleaned = draft.map(station => ({ id: station.id, name: station.name.trim() }));
    if (cleaned.some(station => !station.name) ||
        new Set(cleaned.map(station => station.name.toLowerCase())).size !== cleaned.length) return;
    const ids = new Set(cleaned.map(station => station.id));
    onBeforeLayoutChange?.();
    layout.stations = cleaned;
    block.stationId = selectedId && ids.has(selectedId) ? selectedId : null;
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
      <TextInput
        size="sm"
        readOnly
        placeholder="No station"
        aria-label="Block station"
        value={layout.stations.find(station => station.id === block.stationId)?.name ?? ""}
        rightSection={
          <ActionIcon
            size="sm"
            variant="subtle"
            aria-label="Edit station list"
            title="Edit station list"
            onClick={() => setOpened(true)}
          >
            <IconDots size={16}/>
          </ActionIcon>
        }
      />
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
                <Table.Tr
                  key={station.id}
                  onClick={() => setSelectedId(station.id)}
                  style={{ cursor: "pointer", outline: selectedId === station.id ? "2px solid var(--mantine-color-blue-6)" : undefined, outlineOffset: -2 }}
                >
                  <Table.Td><TextInput size="sm" value={station.name} onChange={event => {
                    const name = event.currentTarget.value;
                    setDraft(current => current.map(item => item.id === station.id ? { ...item, name } : item));
                  }}/></Table.Td>
                  <Table.Td><ActionIcon variant="light" color="red" aria-label={`Delete ${station.name}`} onClick={event => { event.stopPropagation(); setDraft(current => current.filter(item => item.id !== station.id)); if (selectedId === station.id) setSelectedId(null); }}><IconTrash size={15}/></ActionIcon></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {invalid && <Text size="xs" c="red">Station names must be non-empty and unique.</Text>}
          <Group justify="space-between">
            <Button variant="subtle" color="gray" onClick={() => setSelectedId(null)}>No station</Button>
            <Group gap="xs">
            <Button variant="default" onClick={() => setOpened(false)}>Cancel</Button>
            <Button onClick={save} disabled={invalid}>Save</Button>
            </Group>
          </Group>
        </Stack>
      </AppModal>
    </>
  );
}
