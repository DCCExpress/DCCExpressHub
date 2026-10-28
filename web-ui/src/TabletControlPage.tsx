import { Suspense, lazy } from "react";
import { ActionIcon, Badge, Center, Group, Loader, Text } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import type { Loco } from "@domain/types";
import LocoPanel from "@/layout/LocoPanel";
import "./tablet-control.css";

const RuntimeLayoutOverlay = lazy(() => import("./RuntimeLayoutOverlay"));

type Props = { locos: Loco[]; status: string; onBack: () => void };

export default function TabletControlPage({ locos, status, onBack }: Props) {
  return (
    <div className="tablet-control">\n      <header className="tablet-control-status">\n        <ActionIcon className="tablet-control-back" onClick={onBack} radius="xl" size={42}\n          color="dark" variant="filled" aria-label="Back to home" title="Back to home">\n          <IconArrowLeft size={23} />\n        </ActionIcon>\n        <Text size="sm" fw={700}>Tablet Control</Text>\n        <Group gap="xs" ml="auto">\n          <Badge color={status === "connected" ? "green" : "red"} variant="light">{status}</Badge>\n        </Group>\n      </header>\n      <div className="tablet-control-workspace">
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
    </div>
  );
}
