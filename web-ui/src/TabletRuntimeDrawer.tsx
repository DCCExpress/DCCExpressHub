import { useCallback, useEffect, useState } from "react";
import { Button, Drawer, Group, Loader, ScrollArea, Stack, Tabs, Text } from "@mantine/core";
import { IconCalendarTime, IconClipboardList, IconLockOpen, IconRoute, IconSettings } from "@tabler/icons-react";
import { showNotification } from "@mantine/notifications";
import i18next from "i18next";

import type { Loco } from "@domain/types";
import type { AutomationFlowDocument } from "@/domain/automationFlow";
import { createEmptyMovementDocument, type MovementDocument } from "@/domain/movement";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import { ensureClientRouteGraph, attachClientRouteTopologyToLayoutJson } from "@/services/clientRouteGraphCache";
import {
  loadAutomationMovement,
  loadAutomationScripts,
  type AutomationScriptDefinition,
} from "@/services/automationApi";
import { abortAllClientScriptExecutions, getActiveClientScriptExecutions } from "@/services/clientScriptRunner";
import { wsClient } from "@/services/wsClient";
import AutomationPanel from "@/components/AutomationPanel";
import MovementTaskManager from "@/components/movement/MovementTaskManager";
import TimetablePanel from "@/components/TimetablePanel";
import TimetableDialog from "@/components/TimetableDialog";
import RoutesDialog from "@/components/RoutesDialog";
import SelectMovementRouteDialog from "@/components/routes/SelectMovementRouteDialog";
import StationRouteEditorDialog from "@/components/routes/StationRouteEditorDialog";
import SystemInfoPanel from "@/components/SystemInfoPanel";

type Props = {
  opened: boolean;
  onClose: () => void;
  locos: Loco[];
  layout: LayoutView;
  version: string;
  automationFlow: AutomationFlowDocument;
  onAutomationFlowChange: (flow: AutomationFlowDocument) => void;
};

type RuntimeTab = "tasks" | "automation" | "timetable" | "settings";

/** Reuses Layout Page's actual runtime widgets; tablet only disables the
 * Flow/Script editors. The shared canvas instance remains untouched. */
export default function TabletRuntimeDrawer({
  opened, onClose, locos, layout, version, automationFlow, onAutomationFlowChange,
}: Props) {
  const [tab, setTab] = useState<RuntimeTab>("tasks");
  const [scripts, setScripts] = useState<AutomationScriptDefinition[]>([]);
  const [movements, setMovements] = useState<MovementDocument>(createEmptyMovementDocument);
  const [loading, setLoading] = useState(true);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [timetableOpened, setTimetableOpened] = useState(false);
  const [timetableRevision, setTimetableRevision] = useState(0);
  const [routesOpened, setRoutesOpened] = useState(false);
  const [selectedMovementId, setSelectedMovementId] = useState<string | null>(null);
  const [routeSelectionOpened, setRouteSelectionOpened] = useState(false);
  const [stationRouteEditId, setStationRouteEditId] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    let active = true;
    setLoading(true);
    void Promise.all([loadAutomationScripts(), loadAutomationMovement()])
      .then(([nextScripts, nextMovements]) => {
        if (!active) return;
        setScripts(nextScripts);
        setMovements({
          ...nextMovements,
          pages: nextMovements.pages.filter(page => !page.id.startsWith("quick-route-loco-")),
        });
      })
      .catch(error => {
        if (active) showNotification({
          color: "red", title: "Runtime",
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [opened]);

  const persistRouteTopology = useCallback(async () => {
    ensureClientRouteGraph(layout);
    const plain = JSON.parse(JSON.stringify(layout)) as Record<string, unknown>;
    delete plain.automationScript;
    delete plain.automationScripts;
    attachClientRouteTopologyToLayoutJson(layout, plain);
    const result = await fetch("/api/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plain),
    });
    if (!result.ok) throw new Error(`Could not save route topology (HTTP ${result.status}).`);
  }, [layout]);

  const releaseAll = useCallback(async () => {
    if (unlockBusy) return;
    const running = getActiveClientScriptExecutions();
    const confirmMessage = running.length
      ? i18next.t("ui.forceReleaseAllTurnoutLocksWithScriptsConfirm", {
          value1: running.map(script => script.name).join(", "),
        })
      : i18next.t("ui.forceReleaseAllTurnoutLocksConfirm");
    if (!window.confirm(confirmMessage)) return;

    setUnlockBusy(true);
    try {
      if (running.length) {
        abortAllClientScriptExecutions("Turnout locks were force-released by the user.");
        const deadline = Date.now() + 2000;
        while (getActiveClientScriptExecutions().length && Date.now() < deadline) {
          await new Promise<void>(resolve => window.setTimeout(resolve, 50));
        }
      }
      const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID() : `tablet-unlock-${Date.now()}`;
      const released = await new Promise<number>((resolve, reject) => {
        let finished = false;
        const done = (callback: () => void) => {
          if (finished) return;
          finished = true;
          window.clearTimeout(timer);
          unsubscribe();
          callback();
        };
        const unsubscribe = wsClient.subscribeMessages(message => {
          const frame = message as unknown as {
            type?: string;
            data?: { requestId?: string; action?: string; ok?: boolean; message?: string | null; extra?: { released?: number } };
          };
          if (frame.type !== "switchManResponse" || frame.data?.requestId !== requestId ||
              frame.data.action !== "forceReleaseAll") return;
          if (!frame.data.ok) {
            done(() => reject(new Error(frame.data?.message || i18next.t("ui.turnoutLockReleaseFailed"))));
          } else {
            done(() => resolve(Number(frame.data?.extra?.released ?? 0)));
          }
        });
        const timer = window.setTimeout(
          () => done(() => reject(new Error(i18next.t("ui.turnoutLockReleaseTimeout")))), 5000
        );
        if (!wsClient.send({ type: "switchManCommand", data: { requestId, action: "forceReleaseAll" } })) {
          done(() => reject(new Error(i18next.t("ui.noWebSocketConnection"))));
        }
      });
      showNotification({
        color: "green", title: i18next.t("ui.turnoutLocksReleased"),
        message: released > 0
          ? i18next.t("ui.turnoutLocksReleasedCount", { value1: released })
          : i18next.t("ui.noActiveTurnoutLocks"),
      });
    } catch (error) {
      showNotification({
        color: "red", title: i18next.t("ui.releaseAllTurnoutLocksFailed"),
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setUnlockBusy(false);
    }
  }, [unlockBusy]);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title="Runtime"
      position="right"
      size="min(620px, 96vw)"
      padding="sm"
      className="tablet-runtime-drawer"
      styles={{
        content: { display: "flex", flexDirection: "column" },
        body: { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" },
      }}
    >
      <Group justify="flex-end" mb="xs">
        <Button size="xs" variant="light" color="red" leftSection={<IconLockOpen size={16} />}
          loading={unlockBusy} onClick={() => { void releaseAll(); }}>
          {i18next.t("ui.releaseAllTurnoutLocks")}
        </Button>
      </Group>

      {loading ? <Loader size="sm" /> : (
        <Tabs value={tab} onChange={value => setTab(
          value === "tasks" || value === "automation" || value === "timetable" || value === "settings" ? value : "tasks"
        )} keepMounted={false} className="tablet-runtime-tabs">
          <Tabs.List grow>
            <Tabs.Tab value="tasks" leftSection={<IconClipboardList size={16} />}>TaskMan</Tabs.Tab>
            <Tabs.Tab value="automation" leftSection={<IconRoute size={16} />}>Automation</Tabs.Tab>
            <Tabs.Tab value="timetable" leftSection={<IconCalendarTime size={16} />}>Timetable</Tabs.Tab>
            <Tabs.Tab value="settings" leftSection={<IconSettings size={16} />}>Settings</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="tasks" className="tablet-runtime-tab-content">
            <MovementTaskManager document={movements} locos={locos} layout={layout} />
          </Tabs.Panel>
          <Tabs.Panel value="automation" className="tablet-runtime-tab-content">
            <Stack h="100%" gap="xs">
              <Group justify="flex-end">
                <Button size="xs" variant="light" onClick={() => { setSelectedMovementId(null); setRoutesOpened(true); }}>
                  {i18next.t("ui.routes")}
                </Button>
              </Group>
              <div style={{ flex: 1, minHeight: 0 }}>
                <AutomationPanel
                  editorsEnabled={false}
                  locos={locos}
                  scripts={scripts}
                  onScriptsChange={setScripts}
                  flows={automationFlow}
                  onFlowsChange={onAutomationFlowChange}
                  onOpenFlowEditor={() => {}}
                  movements={movements}
                  onMovementsChange={setMovements}
                  stationRoutes={layout.stationRoutes}
                  layout={layout}
                  stationNames={layout.stations}
                  onPersistRouteTopology={persistRouteTopology}
                  onOpenStationRoutes={setStationRouteEditId}
                  onSelectMovementRoute={pageId => {
                    setSelectedMovementId(pageId);
                    setRouteSelectionOpened(true);
                  }}
                />
              </div>
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="timetable" className="tablet-runtime-tab-content">
            <TimetablePanel scripts={scripts} movements={movements.pages}
              timetableRevision={timetableRevision} onOpenTimetable={() => setTimetableOpened(true)} />
          </Tabs.Panel>
          <Tabs.Panel value="settings" className="tablet-runtime-tab-content">
            <ScrollArea h="100%">
              <Stack gap="sm" p="sm">
                <SystemInfoPanel status={null} wsStatus={wsClient.getStatus()} flashInfo={null}
                  version={version} showHubInfo={false} />
                <Text size="xs" c="dimmed">Flow and Script editing is available in the full Layout Page.</Text>
              </Stack>
            </ScrollArea>
          </Tabs.Panel>
        </Tabs>
      )}

      <RoutesDialog opened={routesOpened} onClose={() => setRoutesOpened(false)}
        mode="network" layout={layout} movements={movements}
        editingMovementId={null} onMovementsChange={setMovements}
        onPersistRouteTopology={persistRouteTopology} />
      <SelectMovementRouteDialog opened={routeSelectionOpened}
        onClose={() => { setRouteSelectionOpened(false); setSelectedMovementId(null); }}
        layout={layout} movements={movements} editingMovementId={selectedMovementId}
        onMovementsChange={setMovements} onPersistRouteTopology={persistRouteTopology} />
      <StationRouteEditorDialog layout={layout} editingRouteId={stationRouteEditId}
        onClose={() => setStationRouteEditId(null)} onSave={persistRouteTopology} onChanged={() => {}} />
      <TimetableDialog opened={timetableOpened} onClose={() => setTimetableOpened(false)}
        onSaved={() => setTimetableRevision(value => value + 1)}
        scripts={scripts} movements={movements.pages} layout={layout} movementDocument={movements} />
    </Drawer>
  );
}
