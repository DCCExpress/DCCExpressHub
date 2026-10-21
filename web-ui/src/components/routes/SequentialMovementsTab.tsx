import { useEffect, useState } from "react";
import {
  ActionIcon, Badge, Button, Collapse, Group, NumberInput, ScrollArea, Select,
  Paper, Stack, Switch, Table, Text, TextInput, Tooltip,
} from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconChevronDown, IconChevronUp, IconEdit, IconPlayerPlay, IconPlayerStop, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import { BlockElement } from "@/models/editor/elements/BlockElement";
import { createCurrentClientLayoutSnapshot } from "@/services/clientRouteGraphCache";
import type { PersistedClientRouteTopology } from "@/services/clientRouteGraphCache";
import { saveAutomationMovement } from "@/services/automationApi";
import { wsApi } from "@/services/wsApi";
import { wsClient } from "@/services/wsClient";
import type {
  MovementDocument, SequentialMovementDefinition, SequentialMovementStep,
  SequentialMovementSegment, SequentialWaitMode,
} from "@/domain/movement";
import type { SequentialMovementStatePayload } from "@/domain/wsTypes";
import AppModal from "@/components/common/AppModal";

type Props = {
  layout: LayoutView;
  movements: MovementDocument;
  onMovementsChange: (next: MovementDocument) => void;
  onPersistRouteTopology?: (() => Promise<void>) | undefined;
  presentation?: "cards" | "table" | undefined;
};

const createStep = (blockId: number, direction: "forward" | "reverse" = "forward"): SequentialMovementStep =>
  ({ blockId, direction, waitMode: "pass", waitSeconds: 10, minSeconds: 5, maxSeconds: 20 });

function compileSegments(
  layout: LayoutView,
  steps: SequentialMovementStep[],
  blockName: (id: number) => string,
): SequentialMovementSegment[] {
  if (steps.length < 2 || steps.length > 64 || steps.some(s => !s.blockId))
    throw new Error("Choose at least two valid blocks (maximum 64).");
  if (steps[0]?.direction !== steps[1]?.direction)
    throw new Error("The first row direction must match the direction into the second block.");
  if (steps.some((s, i) => i > 0 && s.blockId === steps[i - 1]?.blockId))
    throw new Error("Adjacent steps cannot refer to the same block.");
  if (steps.some(s => s.minSeconds > s.maxSeconds))
    throw new Error("Random wait minimum must not exceed maximum.");
  const topology = createCurrentClientLayoutSnapshot(layout).routeTopology as PersistedClientRouteTopology | undefined;
  if (!topology?.routeTable?.length)
    throw new Error("No saved route topology. Regenerate and save the route graph first.");

  const segments: SequentialMovementSegment[] = [];
  let start = 0;
  while (start < steps.length - 1) {
    const direction = steps[start + 1]!.direction;
    let end = start + 1;
    for (; end < steps.length - 1; end++) {
      if (steps[end]!.direction !== direction)
        throw new Error("A direction change requires a stop at the preceding block.");
      if (steps[end]!.waitMode !== "pass") break;
      if (steps[end + 1]!.direction !== direction) {
        throw new Error("Set the last block before a direction change to Fixed (0 s or more) or Random wait.");
      }
    }
    if (steps[end]!.direction !== direction)
      throw new Error("Invalid direction within route.");

    const checkpoints = steps.slice(start, end + 1).map(step => step.blockId);
    const matching = topology.routeTable.filter(route => {
      if (route.fromBlockId !== checkpoints[0] ||
          route.toBlockId !== checkpoints[checkpoints.length - 1] ||
          route.locoDirection !== direction) return false;
      const ids = route.blockPath.map(block => block.id);
      let pos = 0;
      for (const id of ids) if (id === checkpoints[pos]) pos++;
      return pos === checkpoints.length;
    });
    if (matching.length !== 1) {
      throw new Error(matching.length === 0
        ? `No ${direction} route from ${blockName(checkpoints[0]!)} to ${blockName(checkpoints[checkpoints.length - 1]!)} through the selected blocks.`
        : `Ambiguous route ${blockName(checkpoints[0]!)} → ${blockName(checkpoints[checkpoints.length - 1]!)}: add checkpoints to distinguish physical paths.`);
    }
    const selected = matching[0]!;
    segments.push({
      routeRef: {
        fromBlockId: selected.fromBlockId,
        toBlockId: selected.toBlockId,
        direction,
        viaBlockIds: selected.blockPath.slice(1, -1).map(block => block.id),
      },
      endStepIndex: end,
    });
    start = end;
  }
  return segments;
}

export default function SequentialMovementsTab({ layout, movements, onMovementsChange, onPersistRouteTopology, presentation = "table" }: Props) {
  // Read the live layout on each render; its block names can be edited in place
  // without replacing the LayoutView instance.
  const blocks = layout.blocks.elements
    .filter((e): e is BlockElement => e instanceof BlockElement)
    .map(e => ({ value: String(e.id), label: e.name?.trim() || `Block #${e.id}` }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const names = new Map(blocks.map(block => [Number(block.value), block.label]));
  const blockName = (id: number): string => names.get(id) ?? `Block #${id}`;
  // Runtime messages originate on the server with numeric block IDs.
  // Resolve every block reference against the current layout for display.
  const formatRuntimeMessage = (message: string | null | undefined): string =>
    (message ?? "").replace(/\bblock\s+#(\d+)\b/gi, (_match, id: string) => blockName(Number(id)));
  // Each card's secondary details can be expanded independently.
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const toggleCardDetails = (id: string) =>
    setExpandedCards(current => ({ ...current, [id]: !current[id] }));
  const [draft, setDraft] = useState<SequentialMovementDefinition | null>(null);
  const [states, setStates] = useState<Record<string, SequentialMovementStatePayload>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = wsClient.on("sequentialMovementStateChanged", state =>
      setStates(current => ({ ...current, [state.sequenceId]: state })));
    void wsApi.request("movementCommand",
      { requestId: `sequence-snapshot-${Date.now()}`, action: "sequenceSnapshot" },
      "movementResponse", response => response.action === "sequenceSnapshot", 10000)
      .then(response => {
        const extra = response.extra as unknown as { states?: SequentialMovementStatePayload[] } | undefined;
        if (extra?.states) setStates(current => ({
          ...current,
          ...Object.fromEntries(extra.states!.map(state => [state.sequenceId, state])),
        }));
      })
      .catch(() => { /* Disconnected; the live subscription remains active. */ });
    return unsubscribe;
  }, []);

  const blank = (): SequentialMovementDefinition => ({
    id: `sequential-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "Sequential Movement", enabled: true, speed: 20,
    steps: [createStep(Number(blocks[0]?.value ?? 0)), createStep(Number(blocks[1]?.value ?? 0))],
    segments: [],
  });
  const modify = (patch: Partial<SequentialMovementDefinition>) =>
    setDraft(current => current ? { ...current, ...patch } : current);
  const changeStep = (index: number, patch: Partial<SequentialMovementStep>) =>
    setDraft(current => current
      ? { ...current, steps: current.steps.map((step, i) => i === index ? { ...step, ...patch } : step) }
      : current);
  const status = (id: string) => states[id];
  const active = (id: string) => ["running", "waiting"].includes(status(id)?.status ?? "");

  const persist = async (next: MovementDocument) => {
    setBusy(true);
    setError(null);
    try {
      await saveAutomationMovement(next);
      onMovementsChange(next);
      setDraft(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setError("Enter a sequence name."); return; }
    try {
      const segments = compileSegments(layout, draft.steps, blockName);
      const saved: SequentialMovementDefinition = { ...draft, name: draft.name.trim(), segments };
      await onPersistRouteTopology?.();
      await persist({
        ...movements,
        sequences: [...movements.sequences.filter(sequence => sequence.id !== saved.id), saved],
      });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const command = async (action: "sequenceStart" | "sequenceStop" | "sequenceAbort", sequenceId: string) => {
    setBusy(true); setError(null);
    try {
      const requestId = `seq-${Date.now()}-${Math.random()}`;
      const response = await wsApi.request("movementCommand",
        { requestId, action, sequenceId }, "movementResponse",
        item => item.requestId === requestId, 15000);
      if (!response.ok) throw new Error(response.message ?? "Sequence command rejected.");
      const extra = response.extra as unknown as { state?: SequentialMovementStatePayload } | undefined;
      if (extra?.state) setStates(current => ({ ...current, [sequenceId]: extra.state! }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const stepsText = (sequence: SequentialMovementDefinition) =>
    sequence.steps.map(step => blockName(step.blockId)).join(" → ");

  const sequenceControls = (sequence: SequentialMovementDefinition) => (
    <Group gap={4} wrap="nowrap">
      <Tooltip label="Start"><ActionIcon aria-label="Start sequence" color="green" variant="light"
        disabled={busy || !sequence.enabled || active(sequence.id)}
        onClick={() => void command("sequenceStart", sequence.id)}><IconPlayerPlay size={16}/></ActionIcon></Tooltip>
      <Tooltip label="Stop"><ActionIcon aria-label="Stop sequence" color="yellow" variant="light"
        disabled={busy || !active(sequence.id)}
        onClick={() => void command("sequenceStop", sequence.id)}><IconPlayerStop size={16}/></ActionIcon></Tooltip>
      <Tooltip label="Abort / E-STOP"><ActionIcon aria-label="Abort sequence" color="red" variant="light"
        disabled={busy || !active(sequence.id)}
        onClick={() => void command("sequenceAbort", sequence.id)}><IconX size={16}/></ActionIcon></Tooltip>
      <Tooltip label="Edit"><ActionIcon aria-label="Edit sequence" color="violet" variant="light"
        disabled={busy || active(sequence.id)}
        onClick={() => { setError(null); setDraft({ ...sequence, steps: sequence.steps.map(step => ({ ...step })) }); }}>
        <IconEdit size={16}/></ActionIcon></Tooltip>
      <Tooltip label="Delete"><ActionIcon aria-label="Delete sequence" color="red" variant="light"
        disabled={busy || active(sequence.id)}
        onClick={() => { if (window.confirm(`Delete sequence "${sequence.name}"?`))
          void persist({ ...movements, sequences: movements.sequences.filter(item => item.id !== sequence.id) }); }}>
        <IconTrash size={16}/></ActionIcon></Tooltip>
    </Group>
  );

  return <Stack gap="sm" style={{ height: "100%", minHeight: 0 }}>
    <Group justify="flex-end">
      <Button size="xs" leftSection={<IconPlus size={14}/>} onClick={() => { setError(null); setDraft(blank()); }}>New sequence</Button>
    </Group>
    {error && <Text c="red" size="sm">{formatRuntimeMessage(error)}</Text>}
    <ScrollArea style={{ flex: 1, minHeight: 0 }} type="always">
      {presentation === "cards" ? (
        <Stack gap="sm">
          {movements.sequences.map(sequence => {
            const runtime = status(sequence.id);
            return <Paper key={sequence.id} withBorder radius="sm" p="sm"
              style={{ opacity: sequence.enabled ? 1 : 0.6 }}>
              <Stack gap="xs">
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={700} size="sm" truncate style={{ minWidth: 0 }}>{sequence.name}</Text>
                    <Badge size="xs" variant="light" style={{ flexShrink: 0 }}
                      color={active(sequence.id) ? "green" : runtime?.status === "error" ? "red" : "gray"}>
                      {runtime?.status ?? (sequence.enabled ? "Idle" : "Disabled")}
                    </Badge>
                  </Group>
                  <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                    {sequenceControls(sequence)}
                    <Tooltip label={expandedCards[sequence.id] ? "Hide details" : "Show details"}>
                      <ActionIcon
                        aria-label={expandedCards[sequence.id] ? "Hide sequence details" : "Show sequence details"}
                        aria-expanded={Boolean(expandedCards[sequence.id])}
                        variant="subtle"
                        color="gray"
                        onClick={() => toggleCardDetails(sequence.id)}
                      >
                        {expandedCards[sequence.id] ? <IconChevronUp size={16}/> : <IconChevronDown size={16}/>}
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
                <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                  {stepsText(sequence)}
                </Text>
                <Collapse opened={Boolean(expandedCards[sequence.id])}>
                  <Stack gap="xs" pt="xs">
                    <Group gap="xs">
                      <Badge variant="outline" size="xs">Speed {sequence.speed}</Badge>
                      <Badge variant="outline" size="xs">{sequence.steps.length} blocks</Badge>
                      {runtime && active(sequence.id) &&
                        <Badge variant="light" size="xs" color="blue">{runtime.stepIndex} / {runtime.stepCount}</Badge>}
                    </Group>
                    {sequence.steps.filter(step => step.waitMode !== "pass").map((step, i) =>
                      <Text key={i} size="xs" c="dimmed">
                        {blockName(step.blockId)}: {step.waitMode === "fixed"
                          ? `${step.waitSeconds} s` : `${step.minSeconds}–${step.maxSeconds} s (random)`}
                      </Text>)}
                    {runtime?.info && <Text size="xs" c="blue">{formatRuntimeMessage(runtime.info)}</Text>}
                    {runtime?.error && <Text size="xs" c="red">{formatRuntimeMessage(runtime.error)}</Text>}
                  </Stack>
                </Collapse>
              </Stack>
            </Paper>;
          })}
          {!movements.sequences.length && <Text ta="center" size="sm" c="dimmed">No sequential movements configured.</Text>}
        </Stack>
      ) : (
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead><Table.Tr>
          <Table.Th>Name</Table.Th><Table.Th>Block sequence</Table.Th><Table.Th>Speed</Table.Th>
          <Table.Th>Status</Table.Th><Table.Th>Actions</Table.Th>
        </Table.Tr></Table.Thead>
        <Table.Tbody>
          {movements.sequences.map(sequence => <Table.Tr key={sequence.id}>
            <Table.Td><Text fw={600} size="sm">{sequence.name}</Text></Table.Td>
            <Table.Td><Text size="xs">{stepsText(sequence)}</Text></Table.Td>
            <Table.Td>{sequence.speed}</Table.Td>
            <Table.Td><Badge variant="light" color={active(sequence.id) ? "green" : status(sequence.id)?.status === "error" ? "red" : "gray"}>
              {status(sequence.id)?.status ?? (sequence.enabled ? "Idle" : "Disabled")}
            </Badge><Text size="xs" c="dimmed">{formatRuntimeMessage(status(sequence.id)?.info ?? status(sequence.id)?.error)}</Text></Table.Td>
            <Table.Td>{sequenceControls(sequence)}</Table.Td>
          </Table.Tr>)}
          {!movements.sequences.length && <Table.Tr><Table.Td colSpan={5}><Text size="sm" c="dimmed" ta="center">No sequential movements configured.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      )}
    </ScrollArea>
    <AppModal opened={draft !== null} onClose={() => { if (!busy) setDraft(null); }} title="Sequential Movement Editor"
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
          <TextInput label="Name" value={draft.name} onChange={e => modify({ name: e.currentTarget.value })}/>
          <NumberInput label="Travel speed (DCC)" min={1} max={126} value={draft.speed} onChange={v => modify({ speed: Math.max(1, Math.min(126, Number(v) || 20)) })}/>
          <Switch label="Enabled" checked={draft.enabled} onChange={e => modify({ enabled: e.currentTarget.checked })}/>
        </Group>
        <Text size="xs" c="dimmed">Direction means travel into this block. A direction change needs a stop at the previous block (Fixed 0 s is allowed). Last block always stops. Wait starts only after arrival and verified speed zero.</Text>
        <ScrollArea type="always" style={{ flex: 1, minHeight: 0, width: "100%" }}>
          <Table striped withTableBorder stickyHeader stickyHeaderOffset={0} miw={820}>
            <Table.Thead><Table.Tr>
              <Table.Th>#</Table.Th><Table.Th>Block</Table.Th><Table.Th>Direction</Table.Th><Table.Th>Stop / wait</Table.Th><Table.Th>Fixed (s)</Table.Th><Table.Th>Min (s)</Table.Th><Table.Th>Max (s)</Table.Th><Table.Th/>
            </Table.Tr></Table.Thead>
            <Table.Tbody>
              {draft.steps.map((step, index) => <Table.Tr key={index}>
                <Table.Td>{index + 1}</Table.Td>
                <Table.Td><Select size="xs" searchable w={150} data={blocks} value={String(step.blockId)}
                  onChange={value => changeStep(index, { blockId: Number(value) || 0 })}/></Table.Td>
                <Table.Td><Select size="xs" w={108} allowDeselect={false} data={[{value:"forward",label:"Forward"},{value:"reverse",label:"Reverse"}]}
                  value={step.direction} onChange={v => changeStep(index,{ direction: v === "reverse" ? "reverse" : "forward" })}/></Table.Td>
                <Table.Td><Select size="xs" w={112} allowDeselect={false}
                  data={[{value:"pass",label:"Pass"},{value:"fixed",label:"Fixed wait"},{value:"random",label:"Random wait"}]}
                  value={step.waitMode} onChange={v => changeStep(index,{waitMode: (v ?? "pass") as SequentialWaitMode})}/></Table.Td>
                <Table.Td><NumberInput size="xs" w={75} min={0} max={86400} disabled={step.waitMode !== "fixed"}
                  value={step.waitSeconds} onChange={v => changeStep(index,{waitSeconds:Math.max(0,Math.min(86400,Number(v)||0))})}/></Table.Td>
                <Table.Td><NumberInput size="xs" w={75} min={0} max={86400} disabled={step.waitMode !== "random"}
                  value={step.minSeconds} onChange={v => changeStep(index,{minSeconds:Math.max(0,Math.min(86400,Number(v)||0))})}/></Table.Td>
                <Table.Td><NumberInput size="xs" w={75} min={0} max={86400} disabled={step.waitMode !== "random"}
                  value={step.maxSeconds} onChange={v => changeStep(index,{maxSeconds:Math.max(0,Math.min(86400,Number(v)||0))})}/></Table.Td>
                <Table.Td><Group gap={2} wrap="nowrap">
                  <ActionIcon size="sm" variant="subtle" disabled={index===0} onClick={() => {
                    const next=[...draft.steps]; [next[index-1],next[index]]=[next[index]!,next[index-1]!]; modify({steps:next});
                  }}><IconArrowUp size={15}/></ActionIcon>
                  <ActionIcon size="sm" variant="subtle" disabled={index===draft.steps.length-1} onClick={() => {
                    const next=[...draft.steps]; [next[index+1],next[index]]=[next[index]!,next[index+1]!]; modify({steps:next});
                  }}><IconArrowDown size={15}/></ActionIcon>
                  <ActionIcon size="sm" variant="subtle" color="red" disabled={draft.steps.length<=2}
                    onClick={() => modify({steps:draft.steps.filter((_,i)=>i!==index)})}><IconTrash size={15}/></ActionIcon>
                </Group></Table.Td>
              </Table.Tr>)}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Group justify="space-between" style={{ flexShrink: 0 }}>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14}/>}
            disabled={draft.steps.length >= 64}
            onClick={() => modify({steps:[...draft.steps,createStep(0,draft.steps[draft.steps.length-1]?.direction ?? "forward")]})}>Add block</Button>
          <Group><Button variant="default" onClick={() => setDraft(null)}>Cancel</Button>
            <Button loading={busy} onClick={() => void save()}>Save sequence</Button></Group>
        </Group>
      </Stack>}
    </AppModal>
  </Stack>;
}
