import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon, Badge, Button, Collapse, Group, Menu, NumberInput, ScrollArea, Select,
  Paper, Stack, Switch, Table, Text, TextInput, Tooltip,
} from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconChevronDown, IconChevronUp, IconDotsVertical, IconEdit, IconFlag, IconPlayerPlay, IconPlayerStop, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
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

type SavedRoute = PersistedClientRouteTopology["routeTable"][number];

/** Ordered checkpoints must all occur on the SAME physical route. */
function followsCheckpoints(route: SavedRoute, checkpoints: number[]): boolean {
  let pos = 0;
  for (const block of route.blockPath) {
    if (block.id === checkpoints[pos]) pos++;
  }
  return pos === checkpoints.length;
}

/** Start of the uninterrupted run containing the next requested block. */
function segmentStartIndex(steps: SequentialMovementStep[], nextIndex: number): number {
  for (let i = nextIndex - 1; i > 0; i--) {
    if (steps[i]?.waitMode !== "pass") return i;
  }
  return 0;
}

/** Reachable destinations in the given outgoing direction and route prefix. */
function reachableNextBlocks(
  steps: SequentialMovementStep[],
  index: number,
  routeTable: SavedRoute[],
): Set<number> {
  if (index === 0) return new Set<number>();
  const start = segmentStartIndex(steps, index);
  const source = steps[start];
  const previous = steps[index - 1];
  if (!source?.blockId || !previous?.blockId) return new Set<number>();

  const prefix = steps.slice(start, index).map(step => step.blockId);
  if (prefix.some(id => !id)) return new Set<number>();

  const result = new Set<number>();
  for (const route of routeTable) {
    if (route.fromBlockId !== source.blockId ||
        route.locoDirection !== source.direction ||
        route.toBlockId === previous.blockId ||
        !followsCheckpoints(route, [...prefix, route.toBlockId])) continue;
    result.add(route.toBlockId);
  }

  // A closed circuit can return to its starting block only after a scheduled
  // stop within the circuit (the current Movement runtime cannot execute a
  // same-source-and-destination Movement without stopping).
  if (index >= 2 && source.blockId !== previous.blockId &&
      routeTable.some(route => route.fromBlockId === previous.blockId &&
        route.toBlockId === source.blockId &&
        route.locoDirection === previous.direction)) {
    result.add(source.blockId);
  }
  return result;
}

/** Changing direction at a block means a zero-second stop, never a Pass. */
function normalizeReversals(steps: SequentialMovementStep[]): SequentialMovementStep[] {
  return steps.map((step, i): SequentialMovementStep => {
    if (i > 0 && i < steps.length - 1 &&
        steps[i - 1]?.direction !== step.direction && step.waitMode === "pass") {
      return { ...step, waitMode: "fixed", waitSeconds: 0 };
    }
    return step;
  });
}

function compileSegments(
  layout: LayoutView,
  steps: SequentialMovementStep[],
  blockName: (id: number) => string,
): SequentialMovementSegment[] {
  if (steps.length < 2 || steps.length > 64 || steps.some(step => !step.blockId))
    throw new Error("Choose at least two valid blocks (maximum 64).");
  if (steps.some((step, i) => i > 0 && step.blockId === steps[i - 1]?.blockId))
    throw new Error("Adjacent steps cannot refer to the same block.");
  if (steps.some(step => step.waitMode === "random" && step.minSeconds > step.maxSeconds))
    throw new Error("Random wait minimum must not exceed maximum.");

  const topology = createCurrentClientLayoutSnapshot(layout).routeTopology as PersistedClientRouteTopology | undefined;
  if (!topology?.routeTable?.length)
    throw new Error("No saved route topology. Regenerate and save the route graph first.");

  const segments: SequentialMovementSegment[] = [];
  let start = 0;
  while (start < steps.length - 1) {
    // Direction belongs to DEPARTURE from the current block.
    const direction = steps[start]!.direction;
    let end = start + 1;
    while (end < steps.length - 1 && steps[end]!.waitMode === "pass") {
      if (steps[end]!.direction !== direction)
        throw new Error(`Direction changes at ${blockName(steps[end]!.blockId)} require a stop (Fixed 0 s is allowed).`);
      end++;
    }

    const checkpoints = steps.slice(start, end + 1).map(step => step.blockId);
    if (checkpoints[0] === checkpoints[checkpoints.length - 1]) {
      throw new Error(
        `A non-stop circuit returning to ${blockName(checkpoints[0]!)} is not supported by the current Movement runtime. ` +
        "Set Fixed 0 s at an intermediate block to split the circuit into two safe routes."
      );
    }

    const matching = topology.routeTable.filter(route =>
      route.fromBlockId === checkpoints[0] &&
      route.toBlockId === checkpoints[checkpoints.length - 1] &&
      route.locoDirection === direction &&
      followsCheckpoints(route, checkpoints)
    );
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

/**
 * The server's stepIndex is 1-based: the last confirmed checkpoint.
 * During a non-stop leg the train may have reached a later block without
 * the sequence runtime advancing, so prefer the locomotive's actual layout
 * block assignment when it matches a checkpoint in the current leg.
 *
 * Repeated block IDs are disambiguated using the sequence's progress; an
 * earlier visit to B1 must not also highlight a later B1 in the same route.
 */
function currentSequenceStepIndex(
  sequence: SequentialMovementDefinition,
  runtime: SequentialMovementStatePayload | undefined,
  layout: LayoutView,
): number | null {
  if (!runtime || (runtime.status !== "running" && runtime.status !== "waiting" && runtime.status !== "finishing") ||
      runtime.stepIndex < 1 || sequence.steps.length === 0)
    return null;

  const confirmedIndex = Math.min(runtime.stepIndex - 1, sequence.steps.length - 1);
  if (runtime.status === "waiting") return confirmedIndex;

  const locoAddress = runtime.locoAddress;
  if (locoAddress == null || locoAddress <= 0) return confirmedIndex;

  const occupiedBlockIds = new Set(
    layout.blocks.elements
      .filter((block): block is BlockElement =>
        block instanceof BlockElement && block.locoAddress === locoAddress)
      .map(block => block.id),
  );
  const currentLegEnd = sequence.segments.find(segment =>
    segment.endStepIndex > confirmedIndex)?.endStepIndex ?? sequence.steps.length - 1;

  const detectedIndex = sequence.steps.findIndex((step, index) =>
    index >= confirmedIndex && index <= currentLegEnd && occupiedBlockIds.has(step.blockId));

  return detectedIndex >= 0 ? detectedIndex : confirmedIndex;
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
  const [startDialog, setStartDialog] = useState<{ sequenceId: string; mode: "current" | "approach" } | null>(null);
  const [startLoco, setStartLoco] = useState<string | null>(null);
  const [startStep, setStartStep] = useState<string | null>(null);
  const [draft, setDraft] = useState<SequentialMovementDefinition | null>(null);
  const [states, setStates] = useState<Record<string, SequentialMovementStatePayload>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorOpen = draft !== null;
  const editorRouteTable = useMemo<SavedRoute[]>(() => {
    if (!editorOpen) return [];
    try {
      const snapshot = createCurrentClientLayoutSnapshot(layout);
      const topology = snapshot.routeTopology as PersistedClientRouteTopology | undefined;
      return topology?.routeTable ?? [];
    } catch {
      return [];
    }
  }, [layout, editorOpen]);

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
    name: "Sequential Movement", directionMode: "departure", enabled: true, speed: 20,
    steps: [createStep(Number(blocks[0]?.value ?? 0)), createStep(Number(blocks[1]?.value ?? 0))],
    segments: [],
  });
  const modify = (patch: Partial<SequentialMovementDefinition>) =>
    setDraft(current => current ? { ...current, ...patch } : current);
  const changeStep = (index: number, patch: Partial<SequentialMovementStep>) =>
    setDraft(current => {
      if (!current) return current;
      const updated = normalizeReversals(current.steps.map((step, i) =>
        i === index ? { ...step, ...patch } : step));

      // Earlier block/direction/stop changes invalidate later route choices.
      // Clear only destinations that are no longer reachable, not the wait or
      // departure settings the operator already configured on those rows.
      if ("blockId" in patch || "direction" in patch || "waitMode" in patch) {
        for (let i = index + 1; i < updated.length; i++) {
          const block = updated[i]!;
          if (block.blockId && !reachableNextBlocks(updated, i, editorRouteTable).has(block.blockId)) {
            updated[i] = { ...block, blockId: 0 };
          }
        }
      }
      return { ...current, steps: updated };
    });
  const status = (id: string) => states[id];
  const active = (id: string) => ["running", "waiting", "finishing"].includes(status(id)?.status ?? "");
  const activeSequence = movements.sequences.find(sequence => sequence.id === startDialog?.sequenceId);
  const assignedLocos = layout.blocks.elements
    .filter((block): block is BlockElement => block instanceof BlockElement && block.locoAddress > 0)
    .map(block => ({ address: block.locoAddress, blockId: block.id }))
    .filter((item, index, all) => all.findIndex(other => other.address === item.address) === index);
  const selectedLocoBlock = assignedLocos.find(item => String(item.address) === startLoco)?.blockId;
  const startingSteps = activeSequence?.steps.flatMap((step, index) =>
    step.blockId === selectedLocoBlock && index < activeSequence.steps.length - 1
      ? [{ value: String(index), label: `#${index + 1} · ${blockName(step.blockId)} → ${blockName(activeSequence.steps[index + 1]!.blockId)}` }]
      : []) ?? [];

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
      const saved: SequentialMovementDefinition = { ...draft, name: draft.name.trim(), directionMode: "departure", segments };
      await onPersistRouteTopology?.();
      await persist({
        ...movements,
        sequences: [...movements.sequences.filter(sequence => sequence.id !== saved.id), saved],
      });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const command = async (
    action: "sequenceStart" | "sequenceStop" | "sequenceAbort" | "sequenceFinish",
    sequenceId: string,
    start?: { startMode: "current" | "approach"; locoAddress: number; startStepIndex?: number },
  ) => {
    setBusy(true); setError(null);
    try {
      const requestId = `seq-${Date.now()}-${Math.random()}`;
      const response = await wsApi.request("movementCommand",
        { requestId, action, sequenceId, ...start }, "movementResponse",
        item => item.requestId === requestId, 15000);
      if (!response.ok) throw new Error(response.message ?? "Sequence command rejected.");
      const extra = response.extra as unknown as { state?: SequentialMovementStatePayload } | undefined;
      if (extra?.state) setStates(current => ({ ...current, [sequenceId]: extra.state! }));
      if (action === "sequenceStart") setStartDialog(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const stepsText = (sequence: SequentialMovementDefinition) =>
    sequence.steps.map(step => blockName(step.blockId)).join(" → ");

  const sequenceControls = (sequence: SequentialMovementDefinition) => (
    <Group gap={4} wrap="nowrap">
      <Tooltip label="Start normally from first block">
        <ActionIcon aria-label="Start sequence normally" color="green" variant="light"
          disabled={busy || !sequence.enabled || sequence.directionMode !== "departure" || active(sequence.id)}
          onClick={() => void command("sequenceStart", sequence.id)}><IconPlayerPlay size={16}/></ActionIcon>
      </Tooltip>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon aria-label="More sequence start modes" color="green" variant="subtle"
            disabled={busy || !sequence.enabled || sequence.directionMode !== "departure" || active(sequence.id)}>
            <IconDotsVertical size={16}/>
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => { setStartLoco(null); setStartStep(null); setStartDialog({ sequenceId: sequence.id, mode: "current" }); }}>
            Start from current block
          </Menu.Item>
          <Menu.Item onClick={() => { setStartLoco(null); setStartStep(null); setStartDialog({ sequenceId: sequence.id, mode: "approach" }); }}>
            Go to starting block
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Tooltip label="Finish at next block">
        <ActionIcon aria-label="Finish sequence at next block" color="teal" variant="light"
          disabled={busy || !active(sequence.id) || status(sequence.id)?.status === "finishing"}
          onClick={() => void command("sequenceFinish", sequence.id)}><IconFlag size={16}/></ActionIcon>
      </Tooltip>
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
            const currentStepIndex = currentSequenceStepIndex(sequence, runtime, layout);
            return <Paper key={sequence.id} withBorder radius="sm" p="sm"
              style={{ opacity: sequence.enabled ? 1 : 0.6 }}>
              <Stack gap="xs">
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Text fw={700} size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                    {sequence.name}
                  </Text>
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
                <Group gap={5} wrap="wrap" align="center" aria-label={`Route: ${stepsText(sequence)}`}>
                  {sequence.steps.map((step, index) => (
                    <Group key={index} gap={5} wrap="nowrap">
                      {index > 0 && <Text size="xs" c="dimmed">→</Text>}
                      {index === currentStepIndex ? (
                        <Badge size="sm" color={runtime?.status === "waiting" ? "orange" : "lime"} variant="filled" radius="sm"
                          aria-label={`${runtime?.status === "waiting" ? "Waiting at" : "Current block"}: ${blockName(step.blockId)}`}>
                          {blockName(step.blockId)}
                        </Badge>
                      ) : (
                        <Text size="xs" c="dimmed">{blockName(step.blockId)}</Text>
                      )}
                    </Group>
                  ))}
                </Group>
                {sequence.directionMode !== "departure" &&
                  <Text size="xs" c="orange">Previous direction format: edit and resave this sequence before starting.</Text>}
                <Collapse expanded={Boolean(expandedCards[sequence.id])}>
                  <Stack gap="xs" pt="xs">
                    <Group gap="xs">
                      <Badge size="xs" variant="light"
                        color={runtime?.status === "waiting" ? "orange" :
                          runtime?.status === "finishing" ? "teal" :
                          runtime?.status === "running" ? "green" :
                            runtime?.status === "error" ? "red" : "gray"}>
                        {runtime?.status === "waiting" ? "Waiting" :
                          runtime?.status === "finishing" ? "Finishing" :
                          runtime?.status === "running" ? "Running" :
                            runtime?.status ?? (sequence.enabled ? "Idle" : "Disabled")}
                      </Badge>
                      <Badge variant="outline" size="xs">Speed {sequence.speed}</Badge>
                      <Badge variant="outline" size="xs">{sequence.steps.length} blocks</Badge>
                      {runtime && active(sequence.id) &&
                        <Badge variant="light" size="xs" color="blue">{runtime.stepIndex} / {runtime.stepCount}</Badge>}
                    </Group>
                    {sequence.steps.map((step, index) => step.waitMode === "pass" ? null : (
                      <Group key={index} gap={5} wrap="nowrap">
                        <Badge
                          size="xs"
                          radius="sm"
                          variant={index === currentStepIndex ? "filled" : "outline"}
                          color={index === currentStepIndex
                            ? runtime?.status === "waiting" ? "orange" : "lime"
                            : "gray"}
                        >
                          {blockName(step.blockId)}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          {step.waitMode === "fixed"
                            ? `${step.waitSeconds} s`
                            : `${step.minSeconds}–${step.maxSeconds} s (random)`}
                        </Text>
                      </Group>
                    ))}
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
            <Table.Td><Badge variant="light" color={status(sequence.id)?.status === "waiting" ? "orange" :
              status(sequence.id)?.status === "finishing" ? "teal" :
              active(sequence.id) ? "green" : status(sequence.id)?.status === "error" ? "red" : "gray"}>
              {status(sequence.id)?.status === "waiting" ? "Waiting" :
                status(sequence.id)?.status === "finishing" ? "Finishing" :
                status(sequence.id)?.status === "running" ? "Running" :
                  status(sequence.id)?.status ?? (sequence.enabled ? "Idle" : "Disabled")}
            </Badge><Text size="xs" c="dimmed">{formatRuntimeMessage(status(sequence.id)?.info ?? status(sequence.id)?.error)}</Text></Table.Td>
            <Table.Td>{sequenceControls(sequence)}</Table.Td>
          </Table.Tr>)}
          {!movements.sequences.length && <Table.Tr><Table.Td colSpan={5}><Text size="sm" c="dimmed" ta="center">No sequential movements configured.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      )}
    </ScrollArea>
    <AppModal opened={startDialog !== null} size="sm" centered draggable
      title={startDialog?.mode === "current" ? "Start from current block" : "Go to starting block"}
      onClose={() => { if (!busy) setStartDialog(null); }}>
      {startDialog && activeSequence && <Stack gap="sm">
        <Select label="Locomotive / current block" placeholder="Select locomotive"
          data={assignedLocos.map(item => ({
            value: String(item.address),
            label: `#${item.address} · ${blockName(item.blockId)}`,
          }))}
          searchable value={startLoco}
          onChange={value => { setStartLoco(value); setStartStep(null); }}/>
        {startDialog.mode === "current" &&
          <Select label="Start at sequence step" placeholder="Choose block occurrence"
            description="For repeated blocks, choose the exact position in the sequence."
            data={startingSteps} value={startStep} onChange={setStartStep}
            nothingFoundMessage="This locomotive is not in a runnable sequence block."/>}
        {startDialog.mode === "approach" &&
          <Text size="sm" c="dimmed">
            The Dispatcher routes this locomotive to {blockName(activeSequence.steps[0]!.blockId)}
            and starts the sequence after arrival and the confirmed stop.
          </Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setStartDialog(null)} disabled={busy}>Cancel</Button>
          <Button loading={busy}
            disabled={!startLoco || (startDialog.mode === "current" && startStep === null)}
            onClick={() => void command("sequenceStart", activeSequence.id, {
              startMode: startDialog.mode,
              locoAddress: Number(startLoco),
              ...(startDialog.mode === "current" ? { startStepIndex: Number(startStep) } : {}),
            })}>Start</Button>
        </Group>
      </Stack>}
    </AppModal>
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
        <Text size="xs" c="dimmed">Direction = departure from this block. The next block list is filtered by the saved route graph. Reversing here requires a stop (Fixed 0 s is added automatically). Pass means no stop; the final block always stops.</Text>
        {editorRouteTable.length === 0 &&
          <Text size="xs" c="orange">Route topology is missing. Generate and save the route graph to enable block filtering.</Text>}
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
                  data={index === 0 ? blocks : blocks.filter(block =>
                    reachableNextBlocks(draft.steps, index, editorRouteTable).has(Number(block.value)))}
                  value={step.blockId ? String(step.blockId) : null}
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
                    const next=[...draft.steps]; [next[index-1],next[index]]=[next[index]!,next[index-1]!]; modify({steps:normalizeReversals(next)});
                  }}><IconArrowUp size={15}/></ActionIcon>
                  <ActionIcon size="sm" variant="subtle" disabled={index===draft.steps.length-1} onClick={() => {
                    const next=[...draft.steps]; [next[index+1],next[index]]=[next[index]!,next[index+1]!]; modify({steps:normalizeReversals(next)});
                  }}><IconArrowDown size={15}/></ActionIcon>
                  <ActionIcon size="sm" variant="subtle" color="red" disabled={draft.steps.length<=2}
                    onClick={() => modify({steps:normalizeReversals(draft.steps.filter((_,i)=>i!==index))})}><IconTrash size={15}/></ActionIcon>
                </Group></Table.Td>
              </Table.Tr>)}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Group justify="space-between" style={{ flexShrink: 0 }}>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14}/>}
            disabled={draft.steps.length >= 64}
            onClick={() => modify({steps:normalizeReversals([
              ...draft.steps,
              createStep(0,draft.steps[draft.steps.length-1]?.direction ?? "forward"),
            ])})}>Add block</Button>
          <Group><Button variant="default" onClick={() => setDraft(null)}>Cancel</Button>
            <Button loading={busy} onClick={() => void save()}>Save sequence</Button></Group>
        </Group>
      </Stack>}
    </AppModal>
  </Stack>;
}
