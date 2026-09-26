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


export const AUTOMATION_FLOW_NODE_COLLAPSED_CHANGE_EVENT =
  "dcc-express-automation-flow-node-collapsed-change";

export type AutomationFlowNodeCollapsedChangeEventDetail = {
  pageId: string;
  nodeId: string;
  collapsed: boolean;
};

export function dispatchAutomationFlowNodeCollapsedChange(
  detail: AutomationFlowNodeCollapsedChangeEventDetail
): void {
  window.dispatchEvent(
    new CustomEvent<AutomationFlowNodeCollapsedChangeEventDetail>(
      AUTOMATION_FLOW_NODE_COLLAPSED_CHANGE_EVENT,
      {
        detail,
      }
    )
  );
}


export const AUTOMATION_FLOW_RUNTIME_LOG_EVENT =
  "dcc-express-automation-flow-runtime-log";

export type AutomationFlowRuntimeLogLevel =
  | "info"
  | "log"
  | "error";

export type AutomationFlowRuntimeLogEventDetail = {
  pageId: string;
  timestamp: number;
  level: AutomationFlowRuntimeLogLevel;
  values: unknown[];
};

type AutomationFlowRuntimeLogListener =
  (
    detail:
      AutomationFlowRuntimeLogEventDetail
  ) => void;

const MAX_RUNTIME_LOG_LINES =
  500;

const runtimeLogsByPage =
  new Map<
    string,
    AutomationFlowRuntimeLogEventDetail[]
  >();

const runtimeLogListenersByPage =
  new Map<
    string,
    Set<
      AutomationFlowRuntimeLogListener
    >
  >();

export function hasAutomationFlowRuntimeLogSubscribers(
  pageId: string
): boolean {
  return (
    runtimeLogListenersByPage.get(
      pageId
    )?.size ??
    0
  ) > 0;
}

export function getAutomationFlowRuntimeLogs(
  pageId: string
): AutomationFlowRuntimeLogEventDetail[] {
  return (
    runtimeLogsByPage.get(
      pageId
    ) ??
    []
  ).map(
    entry => ({
      ...entry,
      values: [
        ...entry.values,
      ],
    })
  );
}

export function clearAutomationFlowRuntimeLogs(
  pageId: string
): void {
  runtimeLogsByPage.delete(
    pageId
  );
}

export function subscribeAutomationFlowRuntimeLogs(
  pageId: string,
  listener:
    AutomationFlowRuntimeLogListener
): () => void {
  let listeners =
    runtimeLogListenersByPage.get(
      pageId
    );

  if (!listeners) {
    listeners =
      new Set<
        AutomationFlowRuntimeLogListener
      >();

    runtimeLogListenersByPage.set(
      pageId,
      listeners
    );
  }

  listeners.add(
    listener
  );

  return () => {
    const current =
      runtimeLogListenersByPage.get(
        pageId
      );

    if (!current) {
      return;
    }

    current.delete(
      listener
    );

    if (
      current.size ===
      0
    ) {
      runtimeLogListenersByPage.delete(
        pageId
      );
    }
  };
}

export function dispatchAutomationFlowRuntimeLog(
  detail: AutomationFlowRuntimeLogEventDetail
): void {
  const entry:
    AutomationFlowRuntimeLogEventDetail = {
      ...detail,
      values: [
        ...detail.values,
      ],
    };

  const current =
    runtimeLogsByPage.get(
      detail.pageId
    ) ??
    [];

  runtimeLogsByPage.set(
    detail.pageId,
    [
      ...current.slice(
        -(MAX_RUNTIME_LOG_LINES - 1)
      ),
      entry,
    ]
  );

  for (
    const listener of
    runtimeLogListenersByPage.get(
      detail.pageId
    ) ??
    []
  ) {
    listener(
      entry
    );
  }

  window.dispatchEvent(
    new CustomEvent<AutomationFlowRuntimeLogEventDetail>(
      AUTOMATION_FLOW_RUNTIME_LOG_EVENT,
      {
        detail:
          entry,
      }
    )
  );
}
