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
