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

let requestSequence =
  0;

function requestId(
  action: string
): string {
  requestSequence +=
    1;

  return (
    `${wsApi.clientUuid}:flow-editor:` +
    `${action}:` +
    `${Date.now()}:` +
    `${requestSequence}`
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
      wsClient.on(
        "flowStateChanged",
        state => {
          const pageId =
            page?.id;

          if (
            !pageId
          ) {
            return;
          }

          const runtimePage =
            state.pages.find(
              candidate =>
                candidate.pageId ===
                pageId
            );

          if (
            (
              runtimePage?.activeExecutions ??
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

      const label =
        mode ===
          "run"
          ? "RUN"
          : "TEST";

      appendLog(
        "info",
        `${label} requested: ${page.name}`
      );

      try {
        const response =
          await wsApi.flowRequest(
            requestId(
              "runPage"
            ),
            "runPage",
            {
              pageId:
                page.id,
              mode,
            }
          );

        if (
          !response.ok
        ) {
          throw new Error(
            response.message ||
            "Flow could not be started."
          );
        }

        const active =
          response.extra?.state
            ?.pages
            .find(
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
        wsApi.flowCommand(
          requestId(
            "abortPage"
          ),
          "abortPage",
          {
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
