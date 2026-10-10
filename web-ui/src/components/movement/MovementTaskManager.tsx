import { ActionIcon, Badge, Group, Paper, Stack, Text, Tooltip } from "@mantine/core";
import { IconAlertTriangle, IconPlayerStop } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { MovementDocument } from "../../domain/movement";
import type { Loco } from "../../domain/domainTypes";
import LocoImage from "../loco/LocoImage";
import {
  abortMovement, getMovementTaskStates, stopMovement, subscribeMovementTaskStates,
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
        <Badge variant="light" color={active.length ? "green" : "gray"}>{active.length} active</Badge>
      </Group>
      {!active.length && <Text c="dimmed" size="sm">No running movements.</Text>}
      {active.map(({ pageId, state }) => {
        const page = document.pages.find(item => item.id === pageId);
        const loco = locos.find(item => item.address === state.locoAddress);
        const title = page?.name || (pageId.startsWith("quick-route-loco-")
          ? `Quick route · Loco #${state.locoAddress ?? pageId.slice("quick-route-loco-".length)}`
          : `Movement · ${pageId}`);
        return (
          <Paper key={pageId} withBorder p="sm" radius="sm">
            <Group justify="space-between" align="center" wrap="nowrap">
              <LocoImage locoId={loco?.id} image={loco?.image} name={loco?.name} width={110} height={40} />
              <Stack gap={3} style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" fw={600} truncate>{title}</Text>
                <Group gap={6} wrap="wrap">
                  <Badge color={state.status === "stopping" ? "yellow" : "green"} size="xs">{state.status}</Badge>
                  {state.locoAddress !== null && <Text size="xs" c="dimmed">Loco #{state.locoAddress}</Text>}
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
