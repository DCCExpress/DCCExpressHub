import {
  useEffect,
} from "react";

import type {
  AutomationFlowDocument,
} from "../../domain/automationFlow";

import {
  isControlStationRuntimeActive,
} from "../../services/controlStationRuntime";

import {
  wsApi,
} from "../../services/wsApi";

import {
  wsClient,
} from "../../services/wsClient";

import {
  dispatchAutomationFlowRuntimeLog,
} from "./automationFlowEvents";

let installed =
  false;

let requestSequence =
  0;

function requestId(
  action: string
): string {
  requestSequence +=
    1;

  return (
    `${wsApi.clientUuid}:flow:` +
    `${action}:` +
    `${Date.now()}:` +
    `${requestSequence}`
  );
}

function requestSnapshot():
  void {
  wsApi.flowCommand(
    requestId(
      "snapshot"
    ),
    "snapshot"
  );
}

function installFlowProxy():
  void {
  if (installed) {
    return;
  }

  installed =
    true;

  wsClient.on(
    "flowLog",
    entry => {
      dispatchAutomationFlowRuntimeLog({
        pageId:
          entry.pageId,
        timestamp:
          entry.timestamp,
        level:
          entry.level,
        values:
          entry.values,
      });
    }
  );

  wsClient.subscribeStatus(
    status => {
      if (
        status ===
          "connected"
      ) {
        requestSnapshot();
      }
    }
  );

  requestSnapshot();
}

/*
 * Compatibility hook for App.tsx.
 *
 * Flow event subscriptions, state comparisons and interval timers are no
 * longer installed in the browser. The authoritative FlowRuntime reads the
 * saved visualFlow document and watches backend runtime events itself.
 */
export function useAutomationFlowRuntime(
  _document:
    AutomationFlowDocument,
  _controlStationActive:
    boolean
): void {
  useEffect(
    () => {
      installFlowProxy();
    },
    []
  );
}

export function abortAutomationFlowPageExecutions(
  pageId: string,
  _reason =
    "Visual flow page disabled."
): number {
  installFlowProxy();

  if (
    !isControlStationRuntimeActive()
  ) {
    return 0;
  }

  return wsApi.flowCommand(
    requestId(
      "abortPage"
    ),
    "abortPage",
    {
      pageId,
    }
  )
    ? 1
    : 0;
}

export function abortAllAutomationFlowExecutions(
  _reason =
    "Visual flows disabled."
): number {
  installFlowProxy();

  if (
    !isControlStationRuntimeActive()
  ) {
    return 0;
  }

  return wsApi.flowCommand(
    requestId(
      "abortAll"
    ),
    "abortAll"
  )
    ? 1
    : 0;
}

installFlowProxy();
