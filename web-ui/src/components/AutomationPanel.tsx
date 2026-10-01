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

import AutomationFlowsTable from "./automation/AutomationFlowsTable";
import AutomationScriptsTable from "./automation/AutomationScriptsTable";
import MovementPagesTable from "./movement/MovementPagesTable";

type AutomationPanelTab =
  | "scripts"
  | "flows"
  | "movement";

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
      "scripts"
    ? stored
    : "movement";
}

type AutomationPanelProps = {
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
};

export default function AutomationPanel({
  scripts,
  onScriptsChange,
  flows,
  onFlowsChange,
  onOpenFlowEditor,
  movements,
  onMovementsChange,
  onOpenMovementEditor,
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
          "movement"
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
      </Stack>
    </Tabs>
  );
}
