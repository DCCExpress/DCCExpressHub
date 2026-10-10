import { ActionIcon, Badge, Button, Group, Paper, Stack, Text, Tooltip, Divider, SimpleGrid } from "@mantine/core";
import { IconAlertTriangle, IconPlayerStop } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { MovementDocument } from "../../domain/movement";
import type { Loco } from "../../domain/domainTypes";
import LocoImage from "../loco/LocoImage";
import { wsClient } from "../../services/wsClient";
import {
  abortAllMovements, abortMovement, getMovementTaskStates, stopAllMovements, stopMovement, subscribeMovementTaskStates,
  type MovementEngineState,
} from "../../services/movementEngine";

type Task = { pageId: string; state: MovementEngineState };
type Lock = { address: number; ownerName: string; ownerId: string };
type Lease = { ownerId: string; ownerName: string; locoAddress: number; fromBlockId?: number; toBlockId?: number; sourceBlockId?: number; destinationBlockId?: number };
type Traffic = { locks: Lock[]; leases: Lease[]; routes: Lease[] };
const emptyTraffic: Traffic = { locks: [], leases: [], routes: [] };
type Props = { document: MovementDocument; locos: Loco[] };

export default function MovementTaskManager({ document, locos }: Props) {
  const [tasks, setTasks] = useState<Task[]>(getMovementTaskStates);
  const [traffic, setTraffic] = useState<Traffic>(emptyTraffic);
  const [loaded, setLoaded] = useState({ locks: false, dispatcher: false });
  const liveTraffic = loaded.locks && loaded.dispatcher;

  useEffect(() => subscribeMovementTaskStates(() => setTasks(getMovementTaskStates())), []);

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
    .filter(task => task.state.status === "running" || task.state.status === "stopping")
    .sort((a, b) => (a.state.startedAt ?? 0) - (b.state.startedAt ?? 0));

  const reservations = [...traffic.leases, ...traffic.routes];
  const waiting = active.filter(({ state }) => /wait|hold|block|lock|authority|sensor/i.test(state.info || ""));

  return (
    <Stack gap="xs" p="xs" style={{ minHeight: 0, overflowY: "auto" }}>
      <Group justify="space-between">
        <Text fw={600}>Task Manager</Text>
        <Group gap="xs" wrap="wrap">
          <Badge variant="light" color={active.length ? "green" : "gray"}>{active.length} active</Badge>
          <Button size="xs" color="yellow" variant="light" leftSection={<IconPlayerStop size={14} />}
            disabled={!active.length} onClick={() => stopAllMovements()}>Stop All</Button>
          <Button size="xs" color="red" variant="light" leftSection={<IconAlertTriangle size={14} />}
            disabled={!active.length} onClick={() => abortAllMovements()}>Abort All</Button>
        </Group>
      </Group>
      <Paper withBorder p="sm" radius="sm">
        <Group justify="space-between" mb="xs">
          <Text size="sm" fw={600}>Traffic control</Text>
          <Badge size="xs" color={liveTraffic ? "green" : "gray"}>{liveTraffic ? "Live backend" : "Awaiting state"}</Badge>
        </Group>
        <SimpleGrid cols={4} spacing="xs">
          <Stack gap={0}><Text size="lg" fw={700}>{active.length}</Text><Text size="xs" c="dimmed">Movements</Text></Stack>
          <Stack gap={0}><Text size="lg" fw={700}>{waiting.length}</Text><Text size="xs" c="dimmed">Waiting</Text></Stack>
          <Stack gap={0}><Text size="lg" fw={700}>{loaded.dispatcher ? reservations.length : "—"}</Text><Text size="xs" c="dimmed">Leases</Text></Stack>
          <Stack gap={0}><Text size="lg" fw={700}>{loaded.locks ? traffic.locks.length : "—"}</Text><Text size="xs" c="dimmed">Locks</Text></Stack>
        </SimpleGrid>
        <Divider my="xs"/>
        <Text size="sm" fw={600}>Dispatcher</Text>
        {loaded.dispatcher && reservations.length === 0 && <Text size="xs" c="dimmed">No active reservations.</Text>}
        {reservations.map((lease, index) => (
          <Group key={lease.ownerId + index} justify="space-between" gap="xs">
            <Text size="xs">Loco #{lease.locoAddress}: {lease.fromBlockId ?? lease.sourceBlockId ?? "?"} → {lease.toBlockId ?? lease.destinationBlockId ?? "?"}</Text>
            <Text size="xs" c="dimmed">{lease.ownerName}</Text>
          </Group>
        ))}
        <Divider my="xs"/>
        <Text size="sm" fw={600}>SwitchMan</Text>
        {loaded.locks && traffic.locks.length === 0 && <Text size="xs" c="dimmed">No locked turnouts.</Text>}
        {traffic.locks.map(lock => (
          <Group key={lock.address} justify="space-between" gap="xs">
            <Badge size="xs" color="yellow">Turnout #{lock.address}</Badge>
            <Text size="xs" c="dimmed">{lock.ownerName}</Text>
          </Group>
        ))}
        {waiting.length > 0 && <>
          <Divider my="xs"/>
          <Text size="sm" fw={600}>Why waiting?</Text>
          {waiting.map(({ pageId, state }) => (
            <Text key={pageId} size="xs">Loco #{state.locoAddress ?? "?"}: {state.info}</Text>
          ))}
        </>}
      </Paper>
      {!active.length && <Text c="dimmed" size="sm">No running movements.</Text>}
      {active.map(({ pageId, state }) => {
        const page = document.pages.find(item => item.id === pageId);
        const loco = locos.find(item => item.address === state.locoAddress);
        const isQuickRoute = pageId.startsWith("quick-route-loco-");
        const fullName = state.movementName || page?.name || (isQuickRoute
          ? "Quick route"
          : `Movement · ${pageId}`);
        // Existing quick routes use "Quick route · #12 · A1 → B1".
        // Keep the locomotive identity under its image, and show the path separately.
        const quickRouteMatch = isQuickRoute
          ? /^Quick route\\s*·\\s*(?:#\\d+\\s*·\\s*)?(.*)$/i.exec(fullName)
          : null;
        const title = isQuickRoute ? "Quick route" : fullName;
        const route = state.routeDescription?.trim() || quickRouteMatch?.[1]?.trim() || null;
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
                  <Text size="xs" c="dimmed">Speed {state.desiredSpeed}</Text>
                  {state.currentBlockId != null && (
                    <Text size="xs" c="dimmed">
                      Block {state.currentBlockName || `#${state.currentBlockId}`}
                    </Text>
                  )}
                  {state.targetBlockId != null && (
                    <Text size="xs" c="dimmed">
                      → {state.targetBlockName || `#${state.targetBlockId}`}
                    </Text>
                  )}
                </Group>
                {route && <Text size="sm" fw={500} lineClamp={2}>{route}</Text>}
              </Stack>
              <Group gap={5} wrap="nowrap">
                <Tooltip label="Stop movement">
                  <ActionIcon aria-label="Stop movement" variant="light" color="yellow"
                    disabled={state.status === "stopping"}
                    onClick={() => stopMovement(pageId)}><IconPlayerStop size={17} /></ActionIcon>
                </Tooltip>
                <Tooltip label="Abort movement (E-STOP)">
                  <ActionIcon aria-label="Abort movement (E-STOP)" variant="light" color="red"
                    onClick={() => abortMovement(pageId)}><IconAlertTriangle size={17} /></ActionIcon>
                </Tooltip>
              </Group>
            </Group>
            {state.info && (
              <Text size="xs" c="dimmed" mt="xs" style={{ width: "100%" }}>
                {state.info}
              </Text>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}
