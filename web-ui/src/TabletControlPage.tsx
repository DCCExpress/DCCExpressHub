import { Suspense, lazy, useEffect, useState } from "react";
import { ActionIcon, Center, Loader } from "@mantine/core";
import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconLayoutDashboard } from "@tabler/icons-react";
import { showNotification } from "@mantine/notifications";
import type { DccExStatusPayload, Loco } from "@domain/types";
import type { AutomationFlowDocument } from "@/domain/automationFlow";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import LocoPanel from "@/layout/LocoPanel";
import LayoutStatusBar from "@/components/LayoutStatusBar";
import { useCommandCenter } from "@/context/CommandCenterContext";
import { wsApi } from "@/services/wsApi";
import { wsClient } from "@/services/wsClient";
import {
  isBroadcastAudioEnabled, setBroadcastAudioEnabled, subscribeBroadcastAudioEnabled
} from "@/services/broadcastAudioRuntime";
import {
  getSwitchManModeState, setSwitchManModeEnabled, subscribeSwitchManModeState
} from "@/services/switchManModeRuntime";
import "./tablet-control.css";

const RuntimeLayoutOverlay = lazy(() => import("./RuntimeLayoutOverlay"));
const TabletRuntimeDrawer = lazy(() => import("./TabletRuntimeDrawer"));
type Props = { locos: Loco[]; status: string; version: string; automationFlow: AutomationFlowDocument; onAutomationFlowChange: (flow: AutomationFlowDocument) => void; onBack: () => void };

export default function TabletControlPage({ locos, status, version, automationFlow, onAutomationFlowChange, onBack }: Props) {
  const commandCenter = useCommandCenter();
  const [leftVisible, setLeftVisible] = useState(true);
  const [runtimeOpened, setRuntimeOpened] = useState(false);
  const [runtimeLayout, setRuntimeLayout] = useState<LayoutView | null>(null);
  const [rightVisible, setRightVisible] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(isBroadcastAudioEnabled);
  const [switchState, setSwitchState] = useState(getSwitchManModeState);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [dccExStatus, setDccExStatus] = useState<DccExStatusPayload | null>(null);
  const [elementCount, setElementCount] = useState(0);
  useEffect(() => subscribeBroadcastAudioEnabled(setAudioEnabled), []);
  useEffect(() => subscribeSwitchManModeState(setSwitchState), []);
  useEffect(() => wsClient.on("dccExStatus", setDccExStatus), []);
  useEffect(() => {
    let active = true;
    void fetch("/api/layout", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (active && data) setElementCount(Array.isArray(data.elements) ? data.elements.length : 0); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  const tracks = ((dccExStatus as any)?.tracks ?? []) as { letter?: string; overload?: boolean }[];
  const overloaded = tracks.filter(track => track.overload);
  const toggleSwitch = async () => {
    if (switchBusy) return;
    setSwitchBusy(true);
    try { await setSwitchManModeEnabled(!switchState.enabled); }
    catch (error) {
      showNotification({ color: "red", title: "SwitchMan", message: error instanceof Error ? error.message : String(error) });
    } finally { setSwitchBusy(false); }
  };
  return (
    <div className="tablet-control">
      <ActionIcon className="tablet-control-back" onClick={onBack} radius="xl" size={46}
        color="dark" variant="filled" aria-label="Back to home" title="Back to home">
        <IconArrowLeft size={25} />
      </ActionIcon>
      <ActionIcon className="tablet-control-runtime-button" size={44} radius="xl" variant="filled"
        color="dark" aria-label="Runtime panels" title="Runtime panels"
        onClick={() => setRuntimeOpened(true)}>
        <IconLayoutDashboard size={24} />
      </ActionIcon>
      <div className="tablet-control-workspace"
        data-left-visible={leftVisible} data-right-visible={rightVisible}>
        <aside className="tablet-control-loco tablet-control-loco-left"
          aria-label="Left locomotive controller" inert={!leftVisible} aria-hidden={!leftVisible}>
          <LocoPanel locos={locos} selectedLocoStorageKey="dcc-express.tablet.left-loco-id" />
        </aside>
        <ActionIcon className="tablet-panel-toggle tablet-panel-toggle-left"
          size={34} variant="filled" color="dark"
          aria-label={leftVisible ? "Hide left locomotive panel" : "Show left locomotive panel"}
          title={leftVisible ? "Hide left locomotive panel" : "Show left locomotive panel"}
          onClick={event => { event.stopPropagation(); setLeftVisible(value => !value); }}>
          {leftVisible ? <IconChevronLeft size={19} /> : <IconChevronRight size={19} />}
        </ActionIcon>
        <main className="tablet-control-layout" aria-label="Railway layout">
          <Suspense fallback={<Center h="100%"><Loader /></Center>}>
            <RuntimeLayoutOverlay locos={locos} open embedded onLayoutReady={setRuntimeLayout} />
          </Suspense>
        </main>
        <ActionIcon className="tablet-panel-toggle tablet-panel-toggle-right"
          size={34} variant="filled" color="dark"
          aria-label={rightVisible ? "Hide right locomotive panel" : "Show right locomotive panel"}
          title={rightVisible ? "Hide right locomotive panel" : "Show right locomotive panel"}
          onClick={event => { event.stopPropagation(); setRightVisible(value => !value); }}>
          {rightVisible ? <IconChevronRight size={19} /> : <IconChevronLeft size={19} />}
        </ActionIcon>
        <aside className="tablet-control-loco tablet-control-loco-right"
          aria-label="Right locomotive controller" inert={!rightVisible} aria-hidden={!rightVisible}>
          <LocoPanel locos={locos} selectedLocoStorageKey="dcc-express.tablet.right-loco-id" />
        </aside>
      </div>
      {runtimeOpened && runtimeLayout && <Suspense fallback={null}>
        <TabletRuntimeDrawer opened={runtimeOpened} onClose={() => setRuntimeOpened(false)}
          locos={locos} layout={runtimeLayout} version={version}
          automationFlow={automationFlow} onAutomationFlowChange={onAutomationFlowChange} />
      </Suspense>}
      <div className="tablet-control-status">
        <LayoutStatusBar
          wsStatus={status}
          powerOn={commandCenter.powerInfo?.trackVoltageOn === true}
          onTogglePower={() => { void wsApi.setTrackPower(!commandCenter.powerInfo?.trackVoltageOn); }}
          emergencyStop={commandCenter.powerInfo?.emergencyStop === true}
          onEmergencyStop={() => { void wsApi.emergencyStop(); }}
          anyTrackOverload={overloaded.length > 0}
          overloadedTrackNames={overloaded.map(t => t.letter ?? "").join(", ")}
          broadcastAudioEnabled={audioEnabled}
          onToggleAudio={() => setBroadcastAudioEnabled(!audioEnabled)}
          switchManModeEnabled={switchState.enabled}
          switchManOwnedCount={switchState.ownedAddresses.length}
          switchManModeBusy={switchBusy}
          onToggleSwitchMan={() => { void toggleSwitch(); }}
          elementCount={elementCount}
          locoCount={locos.length}
        />
      </div>
    </div>
  );
}
