import {
  ScrollArea,
  Stack,
  Tabs,
} from "@mantine/core";

import {
  IconListDetails,
  IconTerminal2,
} from "@tabler/icons-react";

import i18next from "i18next";

import type {
  AutomationFlowNode,
  AutomationFlowNodeData,
  GeneratedAutomationFlowScript,
} from "../../domain/automationFlow";

import AutomationFlowLogPanel, {
  type AutomationFlowLogLine,
} from "./AutomationFlowLogPanel";
import AutomationFlowPropertiesPanel from "./AutomationFlowPropertiesPanel";

type Props = {
  node: AutomationFlowNode | null;
  pageId: string;
  generated: GeneratedAutomationFlowScript;
  logs: AutomationFlowLogLine[];
  onClearLogs: () => void;
  onChangeNode: (
    patch:
      Partial<AutomationFlowNodeData>
  ) => void;
  onDeleteNode: () => void;
};

function t(
  key: string,
  fallback: string
): string {
  return i18next.t(
    key,
    {
      defaultValue:
        fallback,
    }
  );
}

export default function AutomationFlowInspector({
  node,
  pageId,
  generated,
  logs,
  onClearLogs,
  onChangeNode,
  onDeleteNode,
}: Props) {
  return (
    <Tabs
      defaultValue="properties"
      h="100%"
      className="automation-flow-inspector-tabs"
    >
      <Tabs.List>
        <Tabs.Tab
          value="properties"
          leftSection={
            <IconListDetails
              size={15}
            />
          }
        >
          {
            t(
              "ui.flowProperties",
              "Properties"
            )
          }
        </Tabs.Tab>

        <Tabs.Tab
          value="log"
          leftSection={
            <IconTerminal2
              size={15}
            />
          }
        >
          {
            t(
              "ui.flowLog",
              "Log"
            )
          }
        </Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel
        value="properties"
        pt="sm"
        className="automation-flow-inspector-panel"
      >
        <ScrollArea
          h="100%"
        >
          <Stack
            gap="md"
            pr={4}
          >
            <AutomationFlowPropertiesPanel
              node={
                node
              }
              pageId={
                pageId
              }
              onChange={
                onChangeNode
              }
              onDelete={
                onDeleteNode
              }
            />


          </Stack>
        </ScrollArea>
      </Tabs.Panel>

      <Tabs.Panel
        value="log"
        pt="sm"
        className="automation-flow-inspector-panel"
      >
        <AutomationFlowLogPanel
          lines={
            logs
          }
          onClear={
            onClearLogs
          }
        />
      </Tabs.Panel>
    </Tabs>
  );
}
