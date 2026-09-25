import {
  useEffect,
  useRef,
} from "react";

import {
  generateAutomationFlowPageScript,
  type AutomationFlowDocument,
  type AutomationFlowNode,
} from "../../domain/automationFlow";

import {
  abortClientScript,
  getActiveClientScriptExecutions,
  runClientScript,
  ScriptAbortError,
} from "../../services/clientScriptRunner";

import {
  wsClient,
} from "../../services/wsClient";

const FLOW_RUNTIME_PREFIX =
  "visual-flow-runtime:";

let executionSequence =
  0;

function executionId(
  pageId: string,
  inputNodeId: string
): string {
  executionSequence +=
    1;

  return (
    `${FLOW_RUNTIME_PREFIX}${pageId}:` +
    `${inputNodeId}:${Date.now()}:${executionSequence}`
  );
}

function belongsToFlowPage(
  executionIdValue: unknown,
  pageId: string
): boolean {
  const id =
    String(
      executionIdValue
    );

  return (
    id.startsWith(
      `${FLOW_RUNTIME_PREFIX}${pageId}:`
    ) ||
    id ===
      `visual-flow-run:${pageId}` ||
    id ===
      `visual-flow-test:${pageId}` ||
    id ===
      `visual-flow-inject:${pageId}`
  );
}

function isAnyFlowExecution(
  executionIdValue: unknown
): boolean {
  const id =
    String(
      executionIdValue
    );

  return (
    id.startsWith(
      FLOW_RUNTIME_PREFIX
    ) ||
    id.startsWith(
      "visual-flow-run:"
    ) ||
    id.startsWith(
      "visual-flow-test:"
    ) ||
    id.startsWith(
      "visual-flow-inject:"
    )
  );
}

export function abortAutomationFlowPageExecutions(
  pageId: string,
  reason =
    "Visual flow page disabled."
): number {
  let aborted =
    0;

  for (
    const execution of
    getActiveClientScriptExecutions()
  ) {
    if (
      !belongsToFlowPage(
        execution.id,
        pageId
      )
    ) {
      continue;
    }

    if (
      abortClientScript(
        execution.id,
        reason
      )
    ) {
      aborted +=
        1;
    }
  }

  return aborted;
}

export function abortAllAutomationFlowExecutions(
  reason =
    "Visual flows disabled."
): number {
  let aborted =
    0;

  for (
    const execution of
    getActiveClientScriptExecutions()
  ) {
    if (
      !isAnyFlowExecution(
        execution.id
      )
    ) {
      continue;
    }

    if (
      abortClientScript(
        execution.id,
        reason
      )
    ) {
      aborted +=
        1;
    }
  }

  return aborted;
}

function isRunnableCode(
  code: string
): boolean {
  const source =
    code.trim();

  return Boolean(
    source &&
    !source.startsWith(
      "//"
    )
  );
}

function runInputBranch(
  document:
    AutomationFlowDocument,
  pageId: string,
  input:
    AutomationFlowNode
): void {
  const page =
    document.pages.find(
      candidate =>
        candidate.id ===
        pageId
    );

  if (
    !page ||
    !page.enabled
  ) {
    return;
  }

  const currentInput =
    document.nodes.find(
      node =>
        node.id ===
          input.id &&
        node.data.pageId ===
          pageId
    );

  if (!currentInput) {
    return;
  }

  const generated =
    generateAutomationFlowPageScript(
      document,
      pageId,
      {
        testRun: true,
        inputNodeId:
          currentInput.id,
      }
    );

  if (
    !isRunnableCode(
      generated.code
    )
  ) {
    return;
  }

  const id =
    executionId(
      pageId,
      currentInput.id
    );

  void runClientScript(
    generated.code,
    {
      id,
      name:
        `Flow input: ${page.name} / ${currentInput.data.label}`,
      type:
        "visual-flow",
    }
  ).catch(
    error => {
      if (
        error instanceof
        ScriptAbortError
      ) {
        return;
      }

      console.error(
        "[Automation Flow Runtime]",
        page.name,
        currentInput.data.label,
        error
      );
    }
  );
}

function runtimeConfigSignature(
  document:
    AutomationFlowDocument,
  runtimeEnabled:
    boolean
): string {
  return JSON.stringify({
    enabled:
      runtimeEnabled,
    pages:
      document.pages.map(
        page => ({
          id:
            page.id,
          enabled:
            page.enabled,
        })
      ),
    inputs:
      document.nodes
        .filter(
          node =>
            node.data.kind ===
              "trigger" ||
            node.data.kind ===
              "sensorInput"
        )
        .map(
          node => ({
            id:
              node.id,
            pageId:
              node.data.pageId,
            kind:
              node.data.kind,
            triggerMode:
              node.data.triggerMode,
            intervalMs:
              node.data.intervalMs,
            sensorAddress:
              node.data.sensorAddress,
            sensorState:
              node.data.sensorState,
          })
        ),
  });
}

export function useAutomationFlowRuntime(
  document:
    AutomationFlowDocument,
  runtimeEnabled:
    boolean
): void {
  const documentRef =
    useRef(
      document
    );

  const runtimeEnabledRef =
    useRef(
      runtimeEnabled
    );

  documentRef.current =
    document;

  runtimeEnabledRef.current =
    runtimeEnabled;

  const signature =
    runtimeConfigSignature(
      document,
      runtimeEnabled
    );

  useEffect(
    () =>
      () => {
        abortAllAutomationFlowExecutions(
          "Visual flow runtime was unloaded."
        );
      },
    []
  );

  useEffect(
    () => {
      const current =
        documentRef.current;

      if (
        !runtimeEnabledRef.current
      ) {
        abortAllAutomationFlowExecutions(
          "Visual flows globally disabled."
        );
        return;
      }

      for (
        const page of
        current.pages
      ) {
        if (
          !page.enabled
        ) {
          abortAutomationFlowPageExecutions(
            page.id,
            "Visual flow page disabled."
          );
        }
      }

      for (
        const execution of
        getActiveClientScriptExecutions()
      ) {
        if (
          !isAnyFlowExecution(
            execution.id
          )
        ) {
          continue;
        }

        const belongsToKnownPage =
          current.pages.some(
            page =>
              belongsToFlowPage(
                execution.id,
                page.id
              )
          );

        if (
          !belongsToKnownPage
        ) {
          abortClientScript(
            execution.id,
            "Visual flow page was removed."
          );
        }
      }
    },
    [
      signature,
    ]
  );

  useEffect(
    () =>
      wsClient.on(
        "sensorChanged",
        data => {
          const current =
            documentRef.current;

          if (
            !runtimeEnabledRef.current
          ) {
            return;
          }

          const address =
            Number(
              data.address
            );

          const state =
            Boolean(
              data.on
            );

          if (
            !Number.isInteger(
              address
            )
          ) {
            return;
          }

          for (
            const page of
            current.pages
          ) {
            if (
              !page.enabled
            ) {
              continue;
            }

            const inputs =
              current.nodes.filter(
                node =>
                  node.data.pageId ===
                    page.id &&
                  node.data.kind ===
                    "sensorInput" &&
                  Math.round(
                    node.data.sensorAddress ??
                    0
                  ) ===
                    address &&
                  (
                    node.data.sensorState !==
                    false
                  ) ===
                    state
              );

            for (
              const input of
              inputs
            ) {
              runInputBranch(
                current,
                page.id,
                input
              );
            }
          }
        }
      ),
    []
  );

  useEffect(
    () => {
      const current =
        documentRef.current;

      if (
        !runtimeEnabledRef.current
      ) {
        return;
      }

      const timers:
        number[] = [];

      for (
        const page of
        current.pages
      ) {
        if (
          !page.enabled
        ) {
          continue;
        }

        const intervalInputs =
          current.nodes.filter(
            node =>
              node.data.pageId ===
                page.id &&
              node.data.kind ===
                "trigger" &&
              node.data.triggerMode ===
                "interval"
          );

        for (
          const input of
          intervalInputs
        ) {
          const intervalMs =
            Math.max(
              1000,
              Math.min(
                86400000,
                Math.round(
                  input.data.intervalMs ??
                  60000
                )
              )
            );

          runInputBranch(
            current,
            page.id,
            input
          );

          timers.push(
            window.setInterval(
              () => {
                const latest =
                  documentRef.current;

                const latestPage =
                  latest.pages.find(
                    candidate =>
                      candidate.id ===
                      page.id
                  );

                const latestInput =
                  latest.nodes.find(
                    node =>
                      node.id ===
                        input.id &&
                      node.data.pageId ===
                        page.id &&
                      node.data.kind ===
                        "trigger" &&
                      node.data.triggerMode ===
                        "interval"
                  );

                if (
                  !runtimeEnabledRef.current ||
                  !latestPage?.enabled ||
                  !latestInput
                ) {
                  return;
                }

                runInputBranch(
                  latest,
                  page.id,
                  latestInput
                );
              },
              intervalMs
            )
          );
        }
      }

      return () => {
        for (
          const timer of
          timers
        ) {
          window.clearInterval(
            timer
          );
        }
      };
    },
    [
      signature,
    ]
  );
}
