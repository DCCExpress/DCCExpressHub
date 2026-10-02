import {
  useEffect,
} from "react";

import type {
  AutomationFlowDocument,
} from "../../domain/automationFlow";

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

let sequence =
  0;

function requestId(
  action: string
): string {
  sequence +=
    1;

  return (
    `${wsApi.clientUuid}:flow:` +
    `${action}:${Date.now()}:${sequence}`
  );
}

function send(
  action: string,
  values:
    Record<string, unknown> =
      {}
): boolean {
  return wsApi.sendBackendCommand(
    "flowCommand",
    {
      requestId:
        requestId(
          action
        ),
      action,
      ...values,
    }
  );
}

function installFlowProxy():
  void {
  if (installed) {
    return;
  }

  installed =
    true;

  wsClient.subscribeMessages(
    message => {
      const raw =
        message as unknown as {
          type?: string;
          data?: unknown;
        };

      if (
        raw.type !==
          "flowLog"
      ) {
        return;
      }

      const entry =
        raw.data as {
          pageId?: string;
          timestamp?: number;
          level?:
            | "info"
            | "log"
            | "error";
          values?: unknown[];
        };

      if (
        !entry.pageId
      ) {
        return;
      }

      dispatchAutomationFlowRuntimeLog({
        pageId:
          entry.pageId,
        timestamp:
          entry.timestamp ??
          Date.now(),
        level:
          entry.level ??
          "log",
        values:
          entry.values ??
          [],
      });
    }
  );

  wsClient.subscribeStatus(
    status => {
      if (
        status ===
          "connected"
      ) {
        send(
          "snapshot"
        );
      }
    }
  );

  if (
    wsClient.getStatus() ===
      "connected"
  ) {
    send(
      "snapshot"
    );
  }
}

/*
 * Flow execution is backend-owned. The second parameter is intentionally
 * accepted for compatibility with the former Control Station UI, but it does
 * not gate backend execution.
 */
export function useAutomationFlowRuntime(
  _document:
    AutomationFlowDocument,
  _controlStationActive?:
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

  return send(
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

  return send(
    "abortAll"
  )
    ? 1
    : 0;
}

installFlowProxy();
