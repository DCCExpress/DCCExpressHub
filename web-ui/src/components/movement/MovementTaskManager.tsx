import type { TrainDriverStatePayload } from "@/domain/wsTypes";
import { getSequentialMovementStates, subscribeSequentialMovementStates } from "../../services/sequentialMovementStates";
import { resolveLocoTaskStatus } from "../../services/locoTaskStatus";
import { ActionIcon, Badge, Button, Group, Paper, Stack, Text, Tooltip, Divider, SimpleGrid, ScrollArea } from "@mantine/core";
import { IconX, IconPlayerStop, IconPlayerPlay, IconFlag } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { MovementDocument } from "../../domain/movement";
import type { Loco } from "../../domain/domainTypes";
import type { LayoutView } from "../../models/editor/core/LayoutView";
import { BlockElement } from "../../models/editor/elements/BlockElement";
import LocoImage from "../loco/LocoImage";
import { wsClient } from "../../services/wsClient";
import {
  abortAllMovements, abortMovement, getMovementTaskStates, stopMovement, subscribeMovementTaskStates,
  type MovementEngineState,
} from "../../services/movementEngine";

type Task = { pageId: string; state: MovementEngineState };
type Lock = { address: number; ownerName: string; ownerId: string };
type Lease = { ownerId: string; ownerName: string; locoAddress: number; fromBlockId?: number; toBlockId?: number; sourceBlockId?: number; destinationBlockId?: number };
type Traffic = { locks: Lock[]; leases: Lease[]; routes: Lease[] };
const emptyTraffic: Traffic = { locks: [], leases: [], routes: [] };
type Props = { document: MovementDocument; locos: Loco[]; layout: LayoutView };

// Reuse the same classification for Dispatcher leases and SwitchMan locks.
function routeTypeForOwner(owner: Pick<Lease, "ownerId" | "ownerName">): "QR" | "SR" | "S2S" | null {
  const ownerId = owner.ownerId.toLowerCase();
  const ownerName = owner.ownerName.toLowerCase();
  if (ownerId.includes("sequence-step-") || ownerName.includes("sequential movement"))
    return "SR";
  if (ownerId.includes("quick-route-loco-")) {
    return ownerId.includes("-station-") || ownerName.includes("station route")
      ? "S2S" : "QR";
  }
  if (ownerName.includes("station route") || ownerName.includes("station-to-station"))
    return "S2S";
  if (ownerName.includes("quick route")) return "QR";
  return null;
}

export default function MovementTaskManager({ document, locos, layout }: Props) {
  const [tasks, setTasks] = useState<Task[]>(getMovementTaskStates);
  const [drivers, setDrivers] = useState<TrainDriverStatePayload[]>([]);
  const [sequences, setSequences] = useState(getSequentialMovementStates);
  const [traffic, setTraffic] = useState<Traffic>(emptyTraffic);
  const [loaded, setLoaded] = useState({ locks: false, dispatcher: false });
  const liveTraffic = loaded.locks && loaded.dispatcher;

  useEffect(() => subscribeMovementTaskStates(() => setTasks(getMovementTaskStates())), []);
  useEffect(() => subscribeSequentialMovementStates(() => setSequences(getSequentialMovementStates())), []);

  // The backend's initial broadcasts may arrive before the Tasks tab mounts.
  // Request authoritative snapshots on mount AND after every reconnect,
  // then keep them current with the normal change broadcasts.
  useEffect(() => {
    const unsubscribeMessages = wsClient.subscribeMessages(message => {
      const frame = message as unknown as {
        type?: string;
        data?: {
          action?: string;
          ok?: boolean;
          locks?: Lock[];
          leases?: Lease[];
          routes?: Lease[];
          extra?: { locks?: Lock[]; leases?: Lease[]; routes?: Lease[] } | null;
        };
      };
      if (frame.type === "trainDriverStateChanged") {
        const driver = frame.data as unknown as TrainDriverStatePayload;
        if (driver?.taskId) setDrivers(previous => [...previous.filter(t => t.taskId !== driver.taskId), driver]);
      } else if (frame.type === "trainDriverResponse" && frame.data?.action === "snapshot" && frame.data?.ok === true) {
        const states = (frame.data as unknown as { states?: TrainDriverStatePayload[] }).states;
        if (Array.isArray(states)) setDrivers(states);
      }
      const isSwitchManSnapshot =
        frame.type === "switchManResponse" &&
        frame.data?.action === "snapshot" &&
        frame.data.ok === true;
      const isDispatcherSnapshot =
        frame.type === "dispatcherResponse" &&
        frame.data?.action === "snapshot" &&
        frame.data.ok === true;

      if (frame.type === "switchManChanged" || isSwitchManSnapshot) {
        const locks = isSwitchManSnapshot ? frame.data?.extra?.locks : frame.data?.locks;
        if (Array.isArray(locks)) {
          setTraffic(previous => ({ ...previous, locks }));
          setLoaded(previous => ({ ...previous, locks: true }));
        }
      } else if (frame.type === "dispatcherChanged" || isDispatcherSnapshot) {
        const data = isDispatcherSnapshot ? frame.data?.extra : frame.data;
        if (Array.isArray(data?.leases) && Array.isArray(data?.routes)) {
          setTraffic(previous => ({ ...previous, leases: data.leases!, routes: data.routes! }));
          setLoaded(previous => ({ ...previous, dispatcher: true }));
        }
      }
    });

    const unsubscribeStatus = wsClient.subscribeStatus(status => {
      if (status !== "connected") {
        setDrivers([]);
        setTraffic(emptyTraffic);
        setLoaded({ locks: false, dispatcher: false });
        return;
      }

      const requestId = () =>
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `taskman-${Date.now()}`;
      wsClient.send({
        type: "switchManCommand",
        data: { action: "snapshot", requestId: requestId() },
      });
      wsClient.send({ type: "trainDriverCommand", data: { action: "snapshot", requestId: requestId() } });
      wsClient.send({
        type: "dispatcherCommand",
        data: { action: "snapshot", requestId: requestId() },
      });
    });

    return () => {
      unsubscribeMessages();
      unsubscribeStatus();
    };
  }, []);

  const active = tasks
    .filter(task => !task.pageId.startsWith("sequence-step-") &&
      (task.state.status === "running" || task.state.status === "stopping"))
    .sort((a, b) => (a.state.startedAt ?? 0) - (b.state.startedAt ?? 0));

  const activeSequences = sequences.filter(state =>
    ["running", "waiting", "finishing"].includes(state.status));
  const commandSequence = (action: "sequenceStop" | "sequenceAbort" | "sequenceFinish", sequenceId: string) =>
    wsClient.send({ type: "movementCommand", data: {
      requestId: `taskman-sequence-${action}-${Date.now()}`, action, sequenceId,
    } });

  const blockNames = new Map(
    layout.getAllElements()
      .filter((element): element is BlockElement => element instanceof BlockElement)
      .map(block => [block.id, block.name.trim()] as const),
  );
  const blockLabel = (id: number | null | undefined, backendName?: string | null) => {
    if (id == null) return "?";
    const name = blockNames.get(id);
    return name && name !== "element" ? name : (backendName?.trim() || `#${id}`);
  };

  const reservations = [...traffic.leases, ...traffic.routes];
  const waiting = active.filter(({ state }) => /wait|hold|block|lock|authority|sensor/i.test(state.info || ""));

  return (
    <Stack h="100%" gap="xs" p="xs" style={{ minHeight: 0, overflow: "hidden" }}>
      <Group justify="space-between">
        <Text fw={600}>Task Manager</Text>
        <Group gap="xs" wrap="wrap">
          <Badge variant="light" color={active.length + activeSequences.length ? "green" : "gray"}>{active.length + activeSequences.length} active</Badge>
          <Button size="xs" color="yellow" variant="light" leftSection={<IconPlayerStop size={14} />}
            disabled={!active.length && !activeSequences.length} onClick={() => {
              const managed = drivers.filter(driver => ["created", "running", "waiting", "paused"].includes(driver.status));
              for (const driver of managed) {
                if (driver.status !== "paused") wsClient.send({ type: "trainDriverCommand", data: {
                  requestId: `driver-pause-all-${Date.now()}-${driver.taskId}`,
                  action: "stop", taskId: driver.taskId,
                } });
              }
              const owned = new Set(managed.map(driver => driver.movementId));
              for (const task of active.filter(task => !owned.has(task.pageId)))
                stopMovement(task.pageId);
              for (const sequence of activeSequences) commandSequence("sequenceStop", sequence.sequenceId);
            }}>Stop All</Button>
          <Button size="xs" color="red" variant="light" leftSection={<IconX size={14} />}
            disabled={!active.length && !activeSequences.length} onClick={() => {
              abortAllMovements();
              for (const sequence of activeSequences) commandSequence("sequenceAbort", sequence.sequenceId);
            }}>Abort All</Button>
        </Group>
      </Group>

      <ScrollArea type="auto" scrollbarSize={8} style={{ flex: "1 1 0", minHeight: 0 }}>
        <Stack gap="xs" pr="xs">
          <Paper withBorder p="sm" radius="sm">
        <Group justify="space-between" mb="xs">
          <Text size="sm" fw={600}>Traffic control</Text>
          <Badge size="xs" color={liveTraffic ? "green" : "gray"}>{liveTraffic ? "Live backend" : "Awaiting state"}</Badge>
        </Group>
        <SimpleGrid cols={4} spacing="xs">
          <Stack gap={0}><Text size="lg" fw={700}>{active.length + activeSequences.length}</Text><Text size="xs" c="dimmed">Movements</Text></Stack>
          <Stack gap={0}><Text size="lg" fw={700}>{waiting.length + activeSequences.filter(item => item.status === "waiting").length}</Text><Text size="xs" c="dimmed">Waiting</Text></Stack>
          <Stack gap={0}><Text size="lg" fw={700}>{loaded.dispatcher ? reservations.length : "—"}</Text><Text size="xs" c="dimmed">Leases</Text></Stack>
          <Stack gap={0}><Text size="lg" fw={700}>{loaded.locks ? traffic.locks.length : "—"}</Text><Text size="xs" c="dimmed">Locks</Text></Stack>
        </SimpleGrid>
        <Divider my="xs"/>
        <Text size="sm" fw={600}>Dispatcher</Text>
        {loaded.dispatcher && reservations.length === 0 && <Text size="xs" c="dimmed">No active reservations.</Text>}
        {reservations.map((lease, index) => {
          const routeType = routeTypeForOwner(lease);
          return <Group key={lease.ownerId + index} justify="space-between" gap="xs" wrap="nowrap">
            <Text size="xs" truncate style={{ minWidth: 0 }}>Loco #{lease.locoAddress}: {blockLabel(lease.fromBlockId ?? lease.sourceBlockId)} → {blockLabel(lease.toBlockId ?? lease.destinationBlockId)}</Text>
            {routeType && <Text size="xs" c="dimmed" fw={600}>{routeType}</Text>}
          </Group>;
        })}
        <Divider my="xs"/>
        <Text size="sm" fw={600}>SwitchMan</Text>
        {loaded.locks && traffic.locks.length === 0 && <Text size="xs" c="dimmed">No locked turnouts.</Text>}
        {traffic.locks.map(lock => {
          const routeType = routeTypeForOwner(lock);
          // SwitchMan and Dispatcher share the exact same owner ID for a
          // reserved leg, so display the real locked section rather than the
          // full Movement name (which may span many more blocks).
          const lease = reservations.find(item => item.ownerId === lock.ownerId);
          const fromId = lease?.fromBlockId ?? lease?.sourceBlockId;
          const toId = lease?.toBlockId ?? lease?.destinationBlockId;
          const route = fromId != null && toId != null
            ? `${blockLabel(fromId)} → ${blockLabel(toId)}`
            : null;
          return <Group key={lock.address} justify="space-between" gap="xs" wrap="nowrap">
            <Badge size="xs" color="yellow">Turnout #{lock.address}</Badge>
            {route
              ? <Text size="xs" truncate style={{ flex: 1, minWidth: 0 }}>{route}</Text>
              : <Text size="xs" c="dimmed" truncate style={{ flex: 1, minWidth: 0 }}>
                  {routeType ? "Awaiting route…" : lock.ownerName}
                </Text>}
            {routeType && <Text size="xs" c="dimmed" fw={600}>{routeType}</Text>}
          </Group>;
        })}
        {waiting.length > 0 && <>
          <Divider my="xs"/>
          <Text size="sm" fw={600}>Why waiting?</Text>
          {waiting.map(({ pageId, state }) => (
            <Text key={pageId} size="xs">Loco #{state.locoAddress ?? "?"}: {state.info}</Text>
          ))}
        </>}
      </Paper>

          {!active.length && !activeSequences.length && <Text c="dimmed" size="sm">No running movements.</Text>}
          {activeSequences.map(state => {
            const definition = document.sequences.find(item => item.id === state.sequenceId);
            const loco = locos.find(item => item.address === state.locoAddress);
            const route = definition?.steps.map(step => blockLabel(step.blockId)).join(" → ");
            const taskStatus = state.locoAddress == null ? null : resolveLocoTaskStatus(
              state.locoAddress, tasks, sequences, drivers,
              id => blockLabel(id),
            );
            const formattedInfo = taskStatus?.message ??
              (state.info ?? "").replace(/\bblock\s+#(\d+)\b/gi,
                (_match, id: string) => blockLabel(Number(id)));
            return <Paper key={state.sequenceId} withBorder p="sm" radius="sm">
              <Group justify="space-between" align="center" wrap="nowrap">
                <Stack gap={2} align="center" style={{ width: 110, flexShrink: 0 }}>
                  <LocoImage locoId={loco?.id ?? ""} image={loco?.image} name={loco?.name} width={110} height={40}/>
                  <Text size="xs" fw={600} ta="center" lineClamp={2}>{loco?.name || "Locomotive"}</Text>
                  <Text size="xs" c="dimmed">#{state.locoAddress ?? "?"}</Text>
                </Stack>
                <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                  <Text fw={600} size="sm" truncate>{state.name}</Text>
                  <Group gap="xs">
                    <Badge size="xs" color={state.status === "waiting" ? "orange" :
                      state.status === "finishing" ? "teal" : "green"}>{state.status}</Badge>
                    <Text size="xs" c="dimmed">{state.stepIndex} / {state.stepCount} blocks</Text>
                  </Group>
                  {route && <Text size="xs" lineClamp={2}>{route}</Text>}
                  {formattedInfo && <Text size="xs" fw={500}>{formattedInfo}</Text>}
                  {taskStatus?.progress && <Text size="xs" c="dimmed">({taskStatus.progress})</Text>}
                </Stack>
                <Group gap={5} wrap="nowrap">
                  <Tooltip label="Finish at next block"><ActionIcon color="teal" variant="light"
                    aria-label="Finish sequential task" disabled={state.status === "finishing"}
                    onClick={() => commandSequence("sequenceFinish", state.sequenceId)}>
                    <IconFlag size={17}/></ActionIcon></Tooltip>
                  <Tooltip label="Stop sequence"><ActionIcon color="yellow" variant="light"
                    aria-label="Stop sequential task" onClick={() => commandSequence("sequenceStop", state.sequenceId)}>
                    <IconPlayerStop size={17}/></ActionIcon></Tooltip>
                  <Tooltip label="Abort sequence (E-STOP)"><ActionIcon color="red" variant="light"
                    aria-label="Abort sequential task" onClick={() => commandSequence("sequenceAbort", state.sequenceId)}>
                    <IconX size={17}/></ActionIcon></Tooltip>
                </Group>
              </Group>
            </Paper>;
          })}
          {active.map(({ pageId, state }) => {
        const page = document.pages.find(item => item.id === pageId);
        const loco = locos.find(item => item.address === state.locoAddress);
        const driver = [...drivers]
          .filter(item => item.movementId === pageId)
          .sort((a, b) => b.createdAt - a.createdAt)
          .find(item => ["created", "running", "waiting", "paused", "stopping"].includes(item.status));
        const isQuickRoute = pageId.startsWith("quick-route-loco-");
        const fullName = state.movementName || page?.name || (isQuickRoute
          ? "Quick route"
          : `Movement · ${pageId}`);
        // Existing quick routes use "Quick route · #12 · A1 → B1".
        // Keep the locomotive identity under its image, and show the path separately.
        const quickRouteMatch = isQuickRoute
          ? /^Quick route\\s*·\\s*(?:#\\d+\\s*·\\s*)?(.*)$/i.exec(fullName)
          : null;
        const isStationRoute = isQuickRoute && fullName.startsWith("Station Route ·");
        const title = isStationRoute ? fullName : isQuickRoute ? "Quick route" : fullName;
        const route = state.routeDescription?.trim() || quickRouteMatch?.[1]?.trim() || null;
        const taskStatus = state.locoAddress == null ? null : resolveLocoTaskStatus(
          state.locoAddress, tasks, sequences, drivers,
          id => blockLabel(id),
        );
        return (
          <Paper key={pageId} withBorder p="sm" radius="sm">
            <Group justify="space-between" align="center" wrap="nowrap">
              <Stack gap={2} align="center" style={{ width: 110, flexShrink: 0 }}>
                <LocoImage locoId={loco?.id ?? ""} image={loco?.image} name={loco?.name} width={110} height={40} />
                <Text size="xs" fw={600} ta="center" style={{ maxWidth: "100%" }} lineClamp={2}>
                  {loco?.name || "Locomotive"}
                </Text>
                {state.locoAddress !== null && (
                  <Text size="xs" c="dimmed" ta="center">#{state.locoAddress}</Text>
                )}
              </Stack>
              <Stack gap={3} style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" fw={600} truncate>{title}</Text>
                <Group gap={6} wrap="wrap">
                  <Badge color={state.status === "stopping" ? "yellow" : "green"} size="xs">{state.status}</Badge>
                  {driver && <Badge size="xs" variant="light" color={driver.status === "paused" ? "yellow" : "blue"}>Train Driver · {driver.status}</Badge> }
                  <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                    Speed {state.desiredSpeed}
                    {state.currentBlockId != null && (
                      <> · {blockLabel(state.currentBlockId, state.currentBlockName)}
                        {state.targetBlockId != null && <> → {blockLabel(state.targetBlockId, state.targetBlockName)}</>}
                      </>
                    )}
                  </Text>
                </Group>
                {route && <Text size="sm" fw={500} lineClamp={2}>{route}</Text>}
              </Stack>
              <Group gap={5} wrap="nowrap">
                {driver?.status === "paused" && (
                  <Tooltip label="Resume train driver">
                    <ActionIcon aria-label="Resume train driver" variant="light" color="green"
                      onClick={() => wsClient.send({ type: "trainDriverCommand", data: {
                        requestId: `driver-resume-${Date.now()}`, action: "resume", taskId: driver.taskId,
                      } })}><IconPlayerPlay size={17} /></ActionIcon>
                  </Tooltip>
                )}
                <Tooltip label={driver ? "Pause train driver (speed 0)" : "Stop movement"}>
                  <ActionIcon aria-label="Stop movement" variant="light" color="yellow"
                    disabled={state.status === "stopping" || driver?.status === "paused"}
                    onClick={() => driver ? wsClient.send({type:"trainDriverCommand", data:{requestId:`driver-stop-${Date.now()}`,action:"stop",taskId:driver.taskId}}) : stopMovement(pageId)}><IconPlayerStop size={17} /></ActionIcon>
                </Tooltip>
                <Tooltip label="Abort movement (E-STOP)">
                  <ActionIcon aria-label="Abort movement (E-STOP)" variant="light" color="red"
                    onClick={() => driver ? wsClient.send({type:"trainDriverCommand", data:{requestId:`driver-abort-${Date.now()}`,action:"abort",taskId:driver.taskId}}) : abortMovement(pageId)}><IconX size={17} /></ActionIcon>
                </Tooltip>
              </Group>
            </Group>
            {taskStatus && (
              <Text size="xs" fw={500} mt="xs" style={{ width: "100%" }}>
                {taskStatus.message}
                {taskStatus.progress ? ` (${taskStatus.progress})` : ""}
              </Text>
            )}
          </Paper>
        );
          })}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
