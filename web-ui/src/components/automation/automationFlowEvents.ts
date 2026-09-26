export const AUTOMATION_FLOW_INJECT_EVENT =
  "dcc-express-automation-flow-inject";

export type AutomationFlowInjectEventDetail = {
  pageId: string;
  triggerNodeId: string;
};

export function dispatchAutomationFlowInject(
  detail: AutomationFlowInjectEventDetail
): void {
  window.dispatchEvent(
    new CustomEvent<AutomationFlowInjectEventDetail>(
      AUTOMATION_FLOW_INJECT_EVENT,
      {
        detail,
      }
    )
  );
}


export const AUTOMATION_FLOW_NODE_COLLAPSE_EVENT =
  "dcc-express-automation-flow-node-collapse";

export type AutomationFlowNodeCollapseEventDetail = {
  pageId: string;
  collapsed: boolean;
};

export function dispatchAutomationFlowNodeCollapse(
  detail: AutomationFlowNodeCollapseEventDetail
): void {
  window.dispatchEvent(
    new CustomEvent<AutomationFlowNodeCollapseEventDetail>(
      AUTOMATION_FLOW_NODE_COLLAPSE_EVENT,
      {
        detail,
      }
    )
  );
}
