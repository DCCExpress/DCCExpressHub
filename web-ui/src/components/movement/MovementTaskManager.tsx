import { ActionIcon, Badge, Button, Group, Paper, Stack, Text, Tooltip } from "@mantine/core";
import { IconAlertTriangle, IconPlayerStop } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { MovementDocument } from "../../domain/movement";
import type { Loco } from "../../domain/domainTypes";
import LocoImage from "../loco/LocoImage";
import {
  abortAllMovements, abortMovement, getMovementTaskStates, stopAllMovements, stopMovement, subscribeMovementTaskStates,
  type MovementEngineState,
} from "../../services/movementEngine";

type Task = { pageId: string; state: MovementEngineState };
type Props = { document: MovementDocument; locos: Loco[] };

export default function MovementTaskManager({ document, locos }: Props) {
  const [tasks, setTasks] = useState<Task[]>(getMovementTaskStates);
  useEffect(() => subscribeMovementTaskStates(() => setTasks(getMovementTaskStates())), []);

  const active = tasks
    .filter(task => task.state.status === "running" || task.state.status === "stopping")
    .sort((a, b) => (a.state.startedAt ?? 0) - (b.state.startedAt ?? 0));

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
        const route = quickRouteMatch?.[1]?.trim() || null;
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
                {route && <Text size="sm" fw={500} lineClamp={2}>{route}</Text>}
                <Group gap={6} wrap="wrap">
                  <Badge color={state.status === "stopping" ? "yellow" : "green"} size="xs">{state.status}</Badge>
                  <Text size="xs" c="dimmed">Speed {state.desiredSpeed}</Text>
                  {state.currentBlockId !== undefined && state.currentBlockId !== null &&
                    <Text size="xs" c="dimmed">Block #{state.currentBlockId}</Text>}
                  {state.targetBlockId !== undefined && state.targetBlockId !== null &&
                    <Text size="xs" c="dimmed">→ #{state.targetBlockId}</Text>}
                </Group>
                {state.info && <Text size="xs" c="dimmed" lineClamp={2}>{state.info}</Text>}
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
          </Paper>
        );
      })}
    </Stack>
  );
}
