import { Suspense, lazy } from "react";
import { ActionIcon, Center, Loader } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import type { Loco } from "@domain/types";
import LocoPanel from "@/layout/LocoPanel";
import "./tablet-control.css";

const RuntimeLayoutOverlay = lazy(() => import("./RuntimeLayoutOverlay"));

type Props = { locos: Loco[]; onBack: () => void };

export default function TabletControlPage({ locos, onBack }: Props) {
  return (
    <div className="tablet-control">
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
      <ActionIcon className="tablet-control-back" onClick={onBack} radius="xl" size={42}
        color="dark" variant="filled" aria-label="Back to home" title="Back to home">
        <IconArrowLeft size={23} />
      </ActionIcon>
    </div>
  );
}
