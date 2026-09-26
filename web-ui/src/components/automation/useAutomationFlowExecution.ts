import {
  useEffect,
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
  subscribeClientScriptLog,
} from "../../services/clientScriptRunner";

import type {
  AutomationFlowLogLine,
} from "./AutomationFlowLogPanel";

import {
  AUTOMATION_FLOW_RUNTIME_LOG_EVENT,
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
  generated,
  generatedTest,
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
      const handleRuntimeLog =
        (
          event: Event
        ): void => {
          const detail =
            (
              event as CustomEvent<
                AutomationFlowRuntimeLogEventDetail
              >
            ).detail;

          if (
            !detail ||
            detail.pageId !==
              page?.id
          ) {
            return;
          }

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
                timestamp:
                  detail.timestamp,
                level:
                  "log",
                message:
                  detail.values
                    .map(
                      logValue
                    )
                    .join(
                      " "
                    ),
              },
            ]
          );
        };

      window.addEventListener(
        AUTOMATION_FLOW_RUNTIME_LOG_EVENT,
        handleRuntimeLog
      );

      return () => {
        window.removeEventListener(
          AUTOMATION_FLOW_RUNTIME_LOG_EVENT,
          handleRuntimeLog
        );
      };
    },
    [
      page?.id,
    ]
  );

  const start =
    async (
      mode:
        AutomationFlowExecutionMode,
      scriptOverride?: string
    ): Promise<void> => {
      if (
        !page ||
        execution
      ) {
        return;
      }

      const id =
        `visual-flow-${mode}:${page.id}`;

      const script =
        scriptOverride ??
        (
          mode ===
            "run"
            ? generated.code
            : generatedTest.code
        );

      setExecution({
        id,
        mode,
      });

      const actionLabel =
        mode ===
        "run"
          ? "RUN"
          : mode ===
            "inject"
            ? "INJECT"
            : "TEST";

      appendLog(
        "info",
        `${actionLabel} started: ${page.name}`
      );

      const unsubscribeLog =
        subscribeClientScriptLog(
          id,
          entry => {
            appendLog(
              "log",
              entry.values
                .map(
                  logValue
                )
                .join(
                  " "
                ),
              entry.timestamp
            );
          }
        );

      try {
        await runClientScript(
          script,
          {
            id,
            name:
              `Flow ${actionLabel}: ${page.name}`,
            type:
              "visual-flow",
          }
        );

        appendLog(
          "info",
          `${actionLabel} completed.`
        );
      } catch (error) {
        appendLog(
          "error",
          error instanceof Error
            ? error.message
            : String(error)
        );
      } finally {
        unsubscribeLog();

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
      if (!execution) {
        return;
      }

      abortClientScript(
        execution.id,
        "Visual flow stopped by user."
      );

      appendLog(
        "info",
        "STOP requested."
      );
    };

  return {
    logs,
    clearLogs:
      () =>
        setLogs([]),
    execution,
    runTest:
      () =>
        start("test"),
    inject:
      (
        script: string
      ) =>
        start(
          "inject",
          script
        ),
    run:
      () =>
        start("run"),
    stop,
  };
}
