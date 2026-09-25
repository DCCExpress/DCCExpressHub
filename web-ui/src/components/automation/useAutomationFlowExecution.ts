import {
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

export type AutomationFlowExecutionMode =
  | "test"
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

  const start =
    async (
      mode:
        AutomationFlowExecutionMode
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
        mode ===
        "test"
          ? generatedTest.code
          : generated.code;

      setExecution({
        id,
        mode,
      });

      appendLog(
        "info",
        `${mode === "test" ? "TEST" : "RUN"} started: ${page.name}`
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
              `Flow ${mode === "test" ? "Test" : "Run"}: ${page.name}`,
            type:
              "visual-flow",
          }
        );

        appendLog(
          "info",
          `${mode === "test" ? "TEST" : "RUN"} completed.`
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
    run:
      () =>
        start("run"),
    stop,
  };
}
