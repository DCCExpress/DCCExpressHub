import {
  Stack,
  Tabs,
} from "@mantine/core";

import i18next from "i18next";

import {
  useState,
} from "react";

import type {
  AutomationFlowDocument,
} from "../domain/automationFlow";

import type {
  MovementDocument,
} from "../domain/movement";

import type {
  AutomationScriptDefinition,
} from "../services/automationApi";

import type {
  Loco,
} from "../domain/domainTypes";

import AutomationFlowsTable from "./automation/AutomationFlowsTable";
import AutomationScriptsTable from "./automation/AutomationScriptsTable";
import MovementPagesTable from "./movement/MovementPagesTable";
import MovementTaskManager from "./movement/MovementTaskManager";
import TrainTrackingPanel from "./automation/TrainTrackingPanel";

type AutomationPanelTab =
  | "scripts"
  | "flows"
  | "movement"
  | "tracking";

const AUTOMATION_PANEL_TAB_STORAGE_KEY =
  "dcc-express-hub.automation.activeTab";

function loadAutomationPanelTab(): AutomationPanelTab {
  if (
    typeof window ===
      "undefined"
  ) {
    return "scripts";
  }

  const stored =
    window.localStorage.getItem(
      AUTOMATION_PANEL_TAB_STORAGE_KEY
    );

  return stored ===
      "flows" ||
    stored ===
      "movement" ||
    stored ===
      "scripts"
    ? stored
    : "scripts";
}

type AutomationPanelProps = {
  locos:
    Loco[];
  scripts:
    AutomationScriptDefinition[];
  onScriptsChange: (
    scripts:
      AutomationScriptDefinition[]
  ) => void;
  flows:
    AutomationFlowDocument;
  onFlowsChange: (
    flows:
      AutomationFlowDocument
  ) => void;
  onOpenFlowEditor: (
    pageId:
      string
  ) => void;
  movements:
    MovementDocument;
  onMovementsChange: (
    movements:
      MovementDocument
  ) => void;
  onSelectMovementRoute: (
    pageId:
      string | null
  ) => void;
};

export default function AutomationPanel({
  locos,
  scripts,
  onScriptsChange,
  flows,
  onFlowsChange,
  onOpenFlowEditor,
  movements,
  onMovementsChange,
  onSelectMovementRoute,
}: AutomationPanelProps) {
  const [movementSubTab, setMovementSubTab] = useState<string>("movements");
  const [
    activeTab,
    setActiveTab,
  ] =
    useState<AutomationPanelTab>(
      loadAutomationPanelTab
    );

  const changeTab =
    (
      value:
        string | null
    ): void => {
      if (
        value !==
          "scripts" &&
        value !==
          "flows" &&
        value !==
          "movement" &&
        value !==
          "tracking"
      ) {
        return;
      }

      setActiveTab(
        value
      );

      if (
        typeof window !==
          "undefined"
      ) {
        window.localStorage.setItem(
          AUTOMATION_PANEL_TAB_STORAGE_KEY,
          value
        );
      }
    };

  return (
    <Tabs
      value={
        activeTab
      }
      onChange={
        changeTab
      }
      h="100%"
      keepMounted={
        false
      }
      className="automation-runtime-tabs"
    >
      <Stack
        gap="xs"
        h="100%"
      >
        <Tabs.List>
          <Tabs.Tab
            value="movement"
          >
            {
              i18next.t(
                "ui.automationMovementTab",
                {
                  defaultValue:
                    "Movement",
                }
              )
            }
          </Tabs.Tab>

          <Tabs.Tab
            value="tracking"
          >
            {
              i18next.t(
                "ui.automationTrackingTab",
                {
                  defaultValue:
                    "Tracking",
                }
              )
            }
          </Tabs.Tab>

          <Tabs.Tab
            value="flows"
          >
            {
              i18next.t(
                "ui.automationFlowsTab",
                {
                  defaultValue:
                    "Flows",
                }
              )
            }
          </Tabs.Tab>

          <Tabs.Tab
            value="scripts"
          >
            {
              i18next.t(
                "ui.automationScriptsTab",
                {
                  defaultValue:
                    "Scripts",
                }
              )
            }
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel
          value="scripts"
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <AutomationScriptsTable
            scripts={
              scripts
            }
            onScriptsChange={
              onScriptsChange
            }
          />
        </Tabs.Panel>

        <Tabs.Panel
          value="flows"
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <AutomationFlowsTable
            document={
              flows
            }
            onDocumentChange={
              onFlowsChange
            }
            onOpenEditor={
              onOpenFlowEditor
            }
          />
        </Tabs.Panel>

        <Tabs.Panel
          value="movement"
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <Tabs value={movementSubTab} onChange={value => setMovementSubTab(value ?? "movements")} keepMounted={false} h="100%">
            <Stack gap="xs" h="100%">
              <Tabs.List>
                <Tabs.Tab value="movements">Movements</Tabs.Tab>
                <Tabs.Tab value="tasks">Task Manager</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="movements" style={{ flex: 1, minHeight: 0 }}>
          <MovementPagesTable
            document={
              movements
            }
            onDocumentChange={
              onMovementsChange
            }
            onSelectRoute={
              onSelectMovementRoute
            }
          />
              </Tabs.Panel>
              <Tabs.Panel value="tasks" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                <MovementTaskManager document={movements} locos={locos} />
              </Tabs.Panel>
            </Stack>
          </Tabs>
        </Tabs.Panel>

        <Tabs.Panel
          value="tracking"
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <TrainTrackingPanel
            locos={
              locos
            }
          />
        </Tabs.Panel>
      </Stack>
    </Tabs>
  );
}
