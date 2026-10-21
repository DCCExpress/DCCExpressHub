import { ActionIcon, Button, Group, NumberInput, ScrollArea, Select,
  Stack, Switch, Table, Text, TextInput } from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from "@tabler/icons-react";
import AppModal from "@/components/common/AppModal";
import type { SequentialMovementDefinition, SequentialMovementStep, SequentialWaitMode } from "@/domain/movement";

type BlockOption = { value: string; label: string };
type Props = {
  draft: SequentialMovementDefinition | null;
  busy: boolean;
  error: string | null;
  routeTableReady: boolean;
  blocks: BlockOption[];
  availableBlocks: (index: number) => BlockOption[];
  onModify: (patch: Partial<SequentialMovementDefinition>) => void;
  onChangeStep: (index: number, patch: Partial<SequentialMovementStep>) => void;
  onMoveStep: (index: number, direction: -1 | 1) => void;
  onRemoveStep: (index: number) => void;
  onAddStep: () => void;
  onClose: () => void;
  onSave: () => void;
};

/** New/Edit editor opened by the Sequential Movement collection. */
export default function SequentialMovementEditorDialog({
  draft, busy, error, routeTableReady, blocks, availableBlocks,
  onModify, onChangeStep, onMoveStep, onRemoveStep, onAddStep, onClose, onSave,
}: Props) {
  return (
    <AppModal opened={draft !== null} onClose={() => { if (!busy) onClose(); }} title="Sequential Movement Editor"
      size="min(1050px, 96vw)" draggable centered
      styles={{
        content: {
          height: "min(720px, calc(100dvh - 32px))",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        },
        body: {
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        },
      }}>
      {draft && <Stack gap="sm" style={{ flex: 1, minHeight: 0, width: "100%" }}>
        <Group grow>
          <TextInput label="Name" value={draft.name} onChange={e => onModify({ name: e.currentTarget.value })}/>
          <NumberInput label="Travel speed (DCC)" min={1} max={126} value={draft.speed} onChange={v => onModify({ speed: Math.max(1, Math.min(126, Number(v) || 20)) })}/>
          <Switch label="Enabled" checked={draft.enabled} onChange={e => onModify({ enabled: e.currentTarget.checked })}/>
        </Group>
        <Text size="xs" c="dimmed">Direction = departure from this block. The next block list is filtered by the saved route graph. Reversing here requires a stop (Fixed 0 s is added automatically). Pass means no stop; the final block always stops.</Text>
        {!routeTableReady &&
          <Text size="xs" c="orange">Route topology is missing. Generate and save the route graph to enable block filtering.</Text>}
        {error && <Text size="xs" c="red">{error}</Text>}
        <ScrollArea type="always" style={{ flex: 1, minHeight: 0, width: "100%" }}>
          <Table striped withTableBorder stickyHeader stickyHeaderOffset={0} miw={820}>
            <Table.Thead><Table.Tr>
              <Table.Th>#</Table.Th><Table.Th>Block</Table.Th><Table.Th>Depart</Table.Th><Table.Th>Stop / wait</Table.Th><Table.Th>Fixed (s)</Table.Th><Table.Th>Min (s)</Table.Th><Table.Th>Max (s)</Table.Th><Table.Th/>
            </Table.Tr></Table.Thead>
            <Table.Tbody>
              {draft.steps.map((step, index) => <Table.Tr key={index}>
                <Table.Td>{index + 1}</Table.Td>
                <Table.Td><Select size="xs" searchable w={150}
                  placeholder={index === 0 ? "Start block" : "Reachable block"}
                  nothingFoundMessage="No reachable blocks in this direction"
                  data={index === 0 ? blocks : availableBlocks(index)}
                  value={step.blockId ? String(step.blockId) : null}
                  onChange={value => onChangeStep(index, { blockId: Number(value) || 0 })}/></Table.Td>
                <Table.Td><Select size="xs" w={108} allowDeselect={false} data={[{value:"forward",label:"Forward"},{value:"reverse",label:"Reverse"}]}
                  value={step.direction} onChange={v => onChangeStep(index,{ direction: v === "reverse" ? "reverse" : "forward" })}/></Table.Td>
                <Table.Td><Select size="xs" w={112} allowDeselect={false}
                  data={[{value:"pass",label:"Pass"},{value:"fixed",label:"Fixed wait"},{value:"random",label:"Random wait"}]}
                  value={step.waitMode} onChange={v => onChangeStep(index,{waitMode: (v ?? "pass") as SequentialWaitMode})}/></Table.Td>
                <Table.Td><NumberInput size="xs" w={75} min={0} max={86400} disabled={step.waitMode !== "fixed"}
                  value={step.waitSeconds} onChange={v => onChangeStep(index,{waitSeconds:Math.max(0,Math.min(86400,Number(v)||0))})}/></Table.Td>
                <Table.Td><NumberInput size="xs" w={75} min={0} max={86400} disabled={step.waitMode !== "random"}
                  value={step.minSeconds} onChange={v => onChangeStep(index,{minSeconds:Math.max(0,Math.min(86400,Number(v)||0))})}/></Table.Td>
                <Table.Td><NumberInput size="xs" w={75} min={0} max={86400} disabled={step.waitMode !== "random"}
                  value={step.maxSeconds} onChange={v => onChangeStep(index,{maxSeconds:Math.max(0,Math.min(86400,Number(v)||0))})}/></Table.Td>
                <Table.Td><Group gap={2} wrap="nowrap">
                  <ActionIcon size="sm" variant="subtle" disabled={index===0} onClick={() => onMoveStep(index, -1)}><IconArrowUp size={15}/></ActionIcon>
                  <ActionIcon size="sm" variant="subtle" disabled={index===draft.steps.length-1} onClick={() => onMoveStep(index, 1)}><IconArrowDown size={15}/></ActionIcon>
                  <ActionIcon size="sm" variant="subtle" color="red" disabled={draft.steps.length<=2}
                    onClick={() => onRemoveStep(index)}}><IconTrash size={15}/></ActionIcon>
                </Group></Table.Td>
              </Table.Tr>)}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Group justify="space-between" style={{ flexShrink: 0 }}>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14}/>}
            disabled={draft.steps.length >= 64}
            onClick={onAddStep}>Add block</Button>
          <Group><Button variant="default" onClick={onClose}>Cancel</Button>
            <Button loading={busy} onClick={onSave}>Save sequence</Button></Group>
        </Group>
      </Stack>}
    </AppModal>
  );
}
