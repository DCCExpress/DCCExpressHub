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
  Loco,
} from "../domain/domainTypes";

import type {
  AutomationScriptDefinition,
} from "../services/automationApi";

import AutomationFlowsTable from "./automation/AutomationFlowsTable";
import AutomationScriptsTable from "./automation/AutomationScriptsTable";
import MovementPagesTable from "./movement/MovementPagesTable";
import TrainTrackingPanel from "./automation/TrainTrackingPanel";
import DispatcherPanel from "./automation/DispatcherPanel";

type AutomationPanelTab =
  | "scripts"
  | "flows"
  | "movement"
  | "dispatcher"
  | "tracking";

const AUTOMATION_PANEL_TAB_STORAGE_KEY =
  "dcc-express-hub.automation.activeTab";

function loadAutomationPanelTab(): AutomationPanelTab {
  if (
    typeof window ===
      "undefined"
  ) {
    return "movement";
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
      "scripts" ||
    stored ===
      "dispatcher" ||
    stored ===
      "tracking"
    ? stored
    : "movement";
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
  onOpenMovementEditor: (
    pageId:
      string
  ) => void;
  controlStationActive:
    boolean;
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
  onOpenMovementEditor,
  controlStationActive,
}: AutomationPanelProps) {
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
          "dispatcher" &&
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
                    "Movements",
                }
              )
            }
          </Tabs.Tab>

          <Tabs.Tab
            value="dispatcher"
          >
            {
              i18next.t(
                "ui.automationDispatcherTab",
                {
                  defaultValue:
                    "Dispatcher",
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
        </Tabs.List>

        <Tabs.Panel
          value="movement"
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <MovementPagesTable
            document={
              movements
            }
            onDocumentChange={
              onMovementsChange
            }
            onOpenEditor={
              onOpenMovementEditor
            }
          />
        </Tabs.Panel>

        <Tabs.Panel
          value="dispatcher"
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <DispatcherPanel
            movements={
              movements
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
          value="tracking"
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <TrainTrackingPanel
            controlStationActive={
              controlStationActive
            }
            locos={
              locos
            }
          />
        </Tabs.Panel>
      </Stack>
    </Tabs>
  );
}
