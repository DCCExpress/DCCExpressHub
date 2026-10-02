import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  createAutomationFlowId,
  type AutomationFlowPage,
  type GeneratedAutomationFlowScript,
} from "../../domain/automationFlow";

import {
  abortClientScript,
  runClientScript,
} from "../../services/clientScriptRunner";

import {
  wsApi,
} from "../../services/wsApi";

import {
  wsClient,
} from "../../services/wsClient";

import type {
  AutomationFlowLogLine,
} from "./AutomationFlowLogPanel";

import {
  clearAutomationFlowRuntimeLogs,
  getAutomationFlowRuntimeLogs,
  subscribeAutomationFlowRuntimeLogs,
  type AutomationFlowRuntimeLogEventDetail,
} from "./automationFlowEvents";

export type AutomationFlowExecutionMode =
  | "test"
  | "inject"
  | "run";

type Args = {
  page:
    AutomationFlowPage |
    undefined;
  generated:
    GeneratedAutomationFlowScript;
  generatedTest:
    GeneratedAutomationFlowScript;
};

type FlowResponse = {
  requestId?: string;
  action?: string;
  ok?: boolean;
  message?: string | null;
  extra?: {
    state?: {
      pages?: Array<{
        pageId: string;
        activeExecutions: number;
      }>;
    };
    count?: number;
  } | null;
};

let sequence =
  0;

function requestId(
  action: string
): string {
  sequence +=
    1;

  return (
    `${wsApi.clientUuid}:flow-editor:` +
    `${action}:${Date.now()}:${sequence}`
  );
}

function logValue(
  value: unknown
): string {
  if (
    typeof value ===
      "string"
  ) {
    return value;
  }

  try {
    const serialized =
      JSON.stringify(
        value
      );

    if (
      serialized !==
        undefined
    ) {
      return serialized;
    }
  } catch {
    // Fall through.
  }

  return String(
    value
  );
}

export function useAutomationFlowExecution({
  page,
  generated:
    _generated,
  generatedTest:
    _generatedTest,
}: Args) {
  const [
    execution,
    setExecution,
  ] =
    useState<{
      id: string;
      mode:
        AutomationFlowExecutionMode;
    } | null>(
      null
    );

  const [
    logs,
    setLogs,
  ] =
    useState<
      AutomationFlowLogLine[]
    >([]);

  const flowStartedRef =
    useRef(
      false
    );

  const appendLog =
    (
      level:
        AutomationFlowLogLine["level"],
      message: string,
      timestamp =
        Date.now()
    ): void => {
      setLogs(
        current => [
          ...current.slice(
            -499
          ),
          {
            id:
              createAutomationFlowId(
                "flow-log"
              ),
            timestamp,
            level,
            message,
          },
        ]
      );
    };

  useEffect(
    () => {
      const pageId =
        page?.id;

      if (!pageId) {
        setLogs(
          []
        );
        return;
      }

      const toLine =
        (
          detail:
            AutomationFlowRuntimeLogEventDetail
        ): AutomationFlowLogLine => ({
          id:
            createAutomationFlowId(
              "flow-log"
            ),
          timestamp:
            detail.timestamp,
          level:
            detail.level,
          message:
            detail.values
              .map(
                logValue
              )
              .join(
                " "
              ),
        });

      setLogs(
        getAutomationFlowRuntimeLogs(
          pageId
        ).map(
          toLine
        )
      );

      return subscribeAutomationFlowRuntimeLogs(
        pageId,
        detail => {
          setLogs(
            current => [
              ...current.slice(
                -499
              ),
              toLine(
                detail
              ),
            ]
          );
        }
      );
    },
    [
      page?.id,
    ]
  );

  useEffect(
    () =>
      wsClient.subscribeMessages(
        message => {
          const raw =
            message as unknown as {
              type?: string;
              data?: unknown;
            };

          if (
            raw.type !==
              "flowStateChanged"
          ) {
            return;
          }

          const state =
            raw.data as {
              pages?: Array<{
                pageId: string;
                activeExecutions: number;
              }>;
            };

          const pageId =
            page?.id;

          if (!pageId) {
            return;
          }

          const runtimePage =
            state.pages?.find(
              candidate =>
                candidate.pageId ===
                  pageId
            );

          if (
            (
              runtimePage
                ?.activeExecutions ??
              0
            ) >
            0
          ) {
            flowStartedRef.current =
              true;
            return;
          }

          if (
            flowStartedRef.current
          ) {
            flowStartedRef.current =
              false;

            setExecution(
              current =>
                current?.mode ===
                  "inject"
                  ? current
                  : null
            );
          }
        }
      ),
    [
      page?.id,
    ]
  );

  const startFlow =
    async (
      mode:
        "test" |
        "run"
    ): Promise<void> => {
      if (
        !page ||
        execution
      ) {
        return;
      }

      const id =
        `visual-flow-${mode}:${page.id}`;

      setExecution({
        id,
        mode,
      });

      flowStartedRef.current =
        false;

      appendLog(
        "info",
        `${mode === "run" ? "RUN" : "TEST"} requested: ${page.name}`
      );

      const rid =
        requestId(
          "runPage"
        );

      try {
        const response =
          await wsApi.requestBackendCommand<FlowResponse>(
            "flowCommand",
            {
              requestId:
                rid,
              action:
                "runPage",
              pageId:
                page.id,
              mode,
            },
            "flowResponse",
            value =>
              value.requestId ===
                rid,
            15000
          );

        if (
          response.ok ===
            false
        ) {
          throw new Error(
            response.message ||
            "Flow could not be started."
          );
        }

        const active =
          response.extra?.state
            ?.pages
            ?.find(
              candidate =>
                candidate.pageId ===
                  page.id
            )
            ?.activeExecutions ??
          0;

        if (
          active >
          0
        ) {
          flowStartedRef.current =
            true;
        } else {
          setExecution(
            null
          );
        }
      } catch (
        error
      ) {
        setExecution(
          null
        );

        appendLog(
          "error",
          error instanceof Error
            ? error.message
            : String(
                error
              )
        );
      }
    };

  const inject =
    async (
      script: string
    ): Promise<void> => {
      if (
        !page ||
        execution
      ) {
        return;
      }

      const id =
        `visual-flow-inject:${page.id}`;

      setExecution({
        id,
        mode:
          "inject",
      });

      appendLog(
        "info",
        `INJECT requested: ${page.name}`
      );

      try {
        await runClientScript(
          script,
          {
            id,
            name:
              `Flow INJECT: ${page.name}`,
            type:
              "visual-flow",
          }
        );

        appendLog(
          "info",
          "INJECT completed."
        );
      } catch (
        error
      ) {
        appendLog(
          "error",
          error instanceof Error
            ? error.message
            : String(
                error
              )
        );
      } finally {
        setExecution(
          current =>
            current?.id ===
              id
              ? null
              : current
        );
      }
    };

  const stop =
    (): void => {
      if (
        !execution ||
        !page
      ) {
        return;
      }

      if (
        execution.mode ===
          "inject"
      ) {
        abortClientScript(
          execution.id,
          "Visual flow inject stopped by user."
        );
      } else {
        wsApi.sendBackendCommand(
          "flowCommand",
          {
            requestId:
              requestId(
                "abortPage"
              ),
            action:
              "abortPage",
            pageId:
              page.id,
          }
        );
      }

      appendLog(
        "info",
        "STOP requested."
      );
    };

  return {
    logs,
    clearLogs:
      () => {
        if (
          page?.id
        ) {
          clearAutomationFlowRuntimeLogs(
            page.id
          );
        }

        setLogs(
          []
        );
      },
    execution,
    runTest:
      () =>
        startFlow(
          "test"
        ),
    inject,
    run:
      () =>
        startFlow(
          "run"
        ),
    stop,
  };
}
