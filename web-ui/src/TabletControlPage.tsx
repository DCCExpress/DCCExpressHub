import { Suspense, lazy } from "react";
import { ActionIcon, Badge, Card, Center, Group, Loader, Text } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import type { Loco } from "@domain/types";
import LocoPanel from "@/layout/LocoPanel";
import { useCommandCenter } from "@/context/CommandCenterContext";
import { wsApi } from "@/services/wsApi";
import "./tablet-control.css";

const RuntimeLayoutOverlay = lazy(() => import("./RuntimeLayoutOverlay"));
type Props = { locos: Loco[]; status: string; onBack: () => void };

export default function TabletControlPage({ locos, status, onBack }: Props) {
  const commandCenter = useCommandCenter();
  const estop = commandCenter.powerInfo?.emergencyStop === true;
  return (
    <div className="tablet-control">
      <ActionIcon className="tablet-control-back" onClick={onBack} radius="xl" size={46}
        color="dark" variant="filled" aria-label="Back to home" title="Back to home">
        <IconArrowLeft size={25} />
      </ActionIcon>
      <div className="tablet-control-workspace">
        <aside className="tablet-control-loco" aria-label="Left locomotive controller">
          <LocoPanel locos={locos} selectedLocoStorageKey="dcc-express.tablet.left-loco-id" />
        </aside>
        <main className="tablet-control-layout" aria-label="Railway layout">
          <Suspense fallback={<Center h="100%"><Loader /></Center>}>
            <RuntimeLayoutOverlay locos={locos} open embedded />
          </Suspense>
        </main>
        <aside className="tablet-control-loco" aria-label="Right locomotive controller">
          <LocoPanel locos={locos} selectedLocoStorageKey="dcc-express.tablet.right-loco-id" />
        </aside>
      </div>
      <Card withBorder p={5} radius="sm" className="lite-status-bar tablet-control-status">
        <Group justify="flex-start" wrap="nowrap" gap="xs" w="100%">
          <Badge size="sm" variant={status === "connected" ? "light" : "filled"}
            color={status === "connected" ? "green" : "red"}
            className={status === "connected" ? "" : "lite-ws-alert"}
            title={status === "connected" ? "WebSocket connected" : "WebSocket: " + status}>
            {status === "connected" ? "WS" : "WS LOST"}
          </Badge>
          <Badge size="sm" color={estop ? "red" : "gray"} variant={estop ? "filled" : "light"}
            className={estop ? "blinkBadge lite-status-action" : "lite-status-action"}
            onClick={() => void wsApi.emergencyStop()}
            style={{ cursor: "pointer" }} title="Emergency stop">
            E-STOP
          </Badge>
          <Badge size="sm" variant="light" color={commandCenter.powerInfo?.trackVoltageOn ? "green" : "red"}>
            POWER {commandCenter.powerInfo?.trackVoltageOn ? "ON" : "OFF"}
          </Badge>
          <Text size="xs" c="dimmed" truncate>{commandCenter.name || commandCenter.type || "Command Center"}</Text>
          <Text size="xs" c="dimmed" truncate style={{ marginLeft: "auto" }}>{locos.length} locos</Text>
        </Group>
      </Card>
    </div>
  );
}
