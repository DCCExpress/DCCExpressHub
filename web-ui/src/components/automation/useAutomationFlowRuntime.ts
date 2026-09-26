import {
  useEffect,
  useRef,
} from "react";

import {
  generateAutomationFlowPageScript,
  isAutomationFlowInputNodeKind,
  type AutomationFlowDocument,
  type AutomationFlowNode,
} from "../../domain/automationFlow";

import {
  abortClientScript,
  getActiveClientScriptExecutions,
  runClientScript,
  ScriptAbortError,
  subscribeClientScriptLog,
} from "../../services/clientScriptRunner";

import {
  wsClient,
} from "../../services/wsClient";

import {
  dispatchAutomationFlowRuntimeLog,
  hasAutomationFlowRuntimeLogSubscribers,
} from "./automationFlowEvents";

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
    AutomationFlowNode,
  inputPayload?: unknown
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
        ...(
          inputPayload ===
            undefined
            ? {}
            : {
                inputPayload,
              }
        ),
      }
    );

  dispatchAutomationFlowRuntimeLog({
    pageId,
    timestamp:
      Date.now(),
    level:
      "info",
    values: [
      `EVENT ${currentInput.data.label}`,
      inputPayload ??
        null,
    ],
  });

  if (
    !isRunnableCode(
      generated.code
    )
  ) {
    dispatchAutomationFlowRuntimeLog({
      pageId,
      timestamp:
        Date.now(),
      level:
        "error",
      values: [
        `SKIP ${currentInput.data.label}`,
        generated.warnings.join(
          " | "
        ) ||
          "The input has no runnable connected branch.",
      ],
    });

    return;
  }

  const id =
    executionId(
      pageId,
      currentInput.id
    );

  const unsubscribeLog =
    subscribeClientScriptLog(
      id,
      entry => {
        dispatchAutomationFlowRuntimeLog({
          pageId,
          timestamp:
            entry.timestamp,
          level:
            "log",
          values:
            entry.values,
        });
      }
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
  )
    .catch(
      error => {
        if (
          error instanceof
          ScriptAbortError
        ) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : String(
                error
              );

        dispatchAutomationFlowRuntimeLog({
          pageId,
          timestamp:
            Date.now(),
          level:
            "error",
          values: [
            `ERROR ${currentInput.data.label}`,
            message,
          ],
        });

        console.error(
          "[Automation Flow Runtime]",
          page.name,
          currentInput.data.label,
          error
        );
      }
    )
    .finally(
      () => {
        unsubscribeLog();
      }
    );
}

function runtimeConfigSignature(
  document:
    AutomationFlowDocument
): string {
  return JSON.stringify({
    pages:
      document.pages
        .map(
          page => ({
            id:
              page.id,
            enabled:
              page.enabled,
          })
        )
        .sort(
          (
            left,
            right
          ) =>
            left.id.localeCompare(
              right.id
            )
        ),
    inputs:
      document.nodes
        .filter(
          node =>
            isAutomationFlowInputNodeKind(
              node.data.kind
            )
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
            blockElementId:
              node.data.blockElementId,
            turnoutElementId:
              node.data.turnoutElementId,
            turnoutAddresses:
              node.data.turnoutAddresses,
            accessoryAddress:
              node.data.accessoryAddress,
            locoAddress:
              node.data.locoAddress,
          })
        )
        .sort(
          (
            left,
            right
          ) =>
            left.id.localeCompare(
              right.id
            )
        ),
  });
}

export function useAutomationFlowRuntime(
  document:
    AutomationFlowDocument,
  controlStationActive:
    boolean
): void {
  const documentRef =
    useRef(
      document
    );

  const controlStationActiveRef =
    useRef(
      controlStationActive
    );

  const blockStateSignaturesRef =
    useRef(
      new Map<string, string>()
    );

  const locoStateSignaturesRef =
    useRef(
      new Map<number, string>()
    );

  documentRef.current =
    document;

  controlStationActiveRef.current =
    controlStationActive;

  const signature =
    `${runtimeConfigSignature(
      document
    )}:${controlStationActive ? "control" : "standby"}`;

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
      if (
        controlStationActive
      ) {
        return;
      }

      abortAllAutomationFlowExecutions(
        "Control Station ownership is not active."
      );
    },
    [
      controlStationActive,
    ]
  );

  useEffect(
    () => {
      const current =
        documentRef.current;

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
          if (
            !controlStationActiveRef.current
          ) {
            return;
          }

          const current =
            documentRef.current;

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
                input,
                {
                  eventType:
                    "sensorChanged",
                  address,
                  on:
                    state,
                  sensorAddress:
                    address,
                  sensorState:
                    state,
                }
              );
            }
          }
        }
      ),
    []
  );

  useEffect(
    () =>
      wsClient.on(
        "turnoutChanged",
        data => {
          if (
            !controlStationActiveRef.current
          ) {
            return;
          }

          const current =
            documentRef.current;

          const address =
            Number(
              data.address
            );

          if (
            !Number.isInteger(
              address
            )
          ) {
            return;
          }

          let matchedAny =
            false;

          for (
            const page of
            current.pages
          ) {
            const inputs =
              current.nodes.filter(
                node => {
                  if (
                    node.data.pageId !==
                      page.id ||
                    node.data.kind !==
                      "turnoutInput"
                  ) {
                    return false;
                  }

                  const configured =
                    node.data.turnoutAddresses ??
                    [];

                  if (
                    configured.includes(
                      address
                    )
                  ) {
                    return true;
                  }

                  return (
                    Math.round(
                      node.data.turnoutAddress ??
                      0
                    ) ===
                    address
                  );
                }
              );

            if (
              inputs.length ===
              0
            ) {
              continue;
            }

            matchedAny =
              true;

            const payload = {
              eventType:
                "turnoutChanged",
              ...data,
            };

            if (
              !page.enabled
            ) {
              dispatchAutomationFlowRuntimeLog({
                pageId:
                  page.id,
                timestamp:
                  Date.now(),
                level:
                  "error",
                values: [
                  "IGNORED turnoutChanged",
                  `Page "${page.name}" is disabled.`,
                  payload,
                ],
              });

              continue;
            }

            for (
              const input of
              inputs
            ) {
              runInputBranch(
                current,
                page.id,
                input,
                {
                  eventType:
                    "turnoutChanged",
                  turnoutElementId:
                    input.data.turnoutElementId ??
                    0,
                  turnoutLabel:
                    input.data.turnoutLabel ??
                    "",
                  ...data,
                }
              );
            }
          }

          if (
            !matchedAny
          ) {
            const pageId =
              current.activePageId;

            if (
              pageId &&
              hasAutomationFlowRuntimeLogSubscribers(
                pageId
              )
            ) {
              dispatchAutomationFlowRuntimeLog({
                pageId,
                timestamp:
                  Date.now(),
                level:
                  "info",
                values: [
                  "WS turnoutChanged",
                  `No matching SAVED Turnout event input for address ${address}. Save editor changes first.`,
                  data,
                ],
              });
            }
          }
        }
      ),
    []
  );

  useEffect(
    () =>
      wsClient.on(
        "accessoryChanged",
        data => {
          if (
            !controlStationActiveRef.current
          ) {
            return;
          }

          const current =
            documentRef.current;

          const address =
            Number(
              data.address
            );

          if (
            !Number.isInteger(
              address
            )
          ) {
            return;
          }

          let matchedAny =
            false;

          for (
            const page of
            current.pages
          ) {
            const inputs =
              current.nodes.filter(
                node =>
                  node.data.pageId ===
                    page.id &&
                  node.data.kind ===
                    "basicAccessoryInput" &&
                  Math.round(
                    node.data.accessoryAddress ??
                    0
                  ) ===
                    address
              );

            if (
              inputs.length ===
              0
            ) {
              continue;
            }

            matchedAny =
              true;

            const payload = {
              eventType:
                "accessoryChanged",
              address,
              active:
                Boolean(
                  data.active
                ),
            };

            if (
              !page.enabled
            ) {
              dispatchAutomationFlowRuntimeLog({
                pageId:
                  page.id,
                timestamp:
                  Date.now(),
                level:
                  "error",
                values: [
                  "IGNORED accessoryChanged",
                  `Page "${page.name}" is disabled.`,
                  payload,
                ],
              });

              continue;
            }

            for (
              const input of
              inputs
            ) {
              runInputBranch(
                current,
                page.id,
                input,
                payload
              );
            }
          }

          if (
            !matchedAny
          ) {
            const pageId =
              current.activePageId;

            if (
              pageId &&
              hasAutomationFlowRuntimeLogSubscribers(
                pageId
              )
            ) {
              dispatchAutomationFlowRuntimeLog({
                pageId,
                timestamp:
                  Date.now(),
                level:
                  "info",
                values: [
                  "WS accessoryChanged",
                  `No matching SAVED Basic Accessory event input for address ${address}. Save editor changes first.`,
                  data,
                ],
              });
            }
          }
        }
      ),
    []
  );

  useEffect(
    () =>
      wsClient.on(
        "signalAspectChanged",
        data => {
          if (
            !controlStationActiveRef.current
          ) {
            return;
          }

          const current =
            documentRef.current;

          const address =
            Number(
              data.address
            );

          const aspect =
            Number(
              data.aspect
            );

          if (
            !Number.isInteger(
              address
            ) ||
            !Number.isInteger(
              aspect
            )
          ) {
            return;
          }

          let matchedAny =
            false;

          for (
            const page of
            current.pages
          ) {
            const inputs =
              current.nodes.filter(
                node =>
                  node.data.pageId ===
                    page.id &&
                  node.data.kind ===
                    "extendedAccessoryInput" &&
                  Math.round(
                    node.data.accessoryAddress ??
                    0
                  ) ===
                    address
              );

            if (
              inputs.length ===
              0
            ) {
              continue;
            }

            matchedAny =
              true;

            const payload = {
              eventType:
                "signalAspectChanged",
              address,
              aspect,
            };

            if (
              !page.enabled
            ) {
              dispatchAutomationFlowRuntimeLog({
                pageId:
                  page.id,
                timestamp:
                  Date.now(),
                level:
                  "error",
                values: [
                  "IGNORED signalAspectChanged",
                  `Page "${page.name}" is disabled.`,
                  payload,
                ],
              });

              continue;
            }

            for (
              const input of
              inputs
            ) {
              runInputBranch(
                current,
                page.id,
                input,
                payload
              );
            }
          }

          if (
            !matchedAny
          ) {
            const pageId =
              current.activePageId;

            if (
              pageId &&
              hasAutomationFlowRuntimeLogSubscribers(
                pageId
              )
            ) {
              dispatchAutomationFlowRuntimeLog({
                pageId,
                timestamp:
                  Date.now(),
                level:
                  "info",
                values: [
                  "WS signalAspectChanged",
                  `No matching SAVED Extended Accessory event input for address ${address}. Save editor changes first.`,
                  data,
                ],
              });
            }
          }
        }
      ),
    []
  );

  useEffect(
    () =>
      wsClient.on(
        "blockStateChanged",
        data => {
          if (
            !controlStationActiveRef.current
          ) {
            return;
          }

          const changed:
            Array<{
              blockId: string;
              locoId: string | null;
              locoAddress: number;
            }> = [];

          for (
            const [
              key,
              state,
            ] of Object.entries(
              data ??
              {}
            )
          ) {
            const blockId =
              String(
                state?.blockId ??
                key
              );

            const locoId =
              state?.locoId
                ? String(
                    state.locoId
                  )
                : null;

            const locoAddress =
              Math.max(
                0,
                Math.round(
                  Number(
                    state?.locoAddress ??
                    0
                  ) ||
                  0
                )
              );

            const signature =
              JSON.stringify({
                locoId,
                locoAddress,
              });

            const previous =
              blockStateSignaturesRef.current.get(
                blockId
              );

            blockStateSignaturesRef.current.set(
              blockId,
              signature
            );

            if (
              previous ===
                undefined ||
              previous ===
                signature
            ) {
              continue;
            }

            changed.push({
              blockId,
              locoId,
              locoAddress,
            });
          }

          if (
            changed.length ===
              0
          ) {
            return;
          }

          const current =
            documentRef.current;

          for (
            const change of
            changed
          ) {
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
                      "blockInput" &&
                    String(
                      Math.round(
                        node.data.blockElementId ??
                        0
                      )
                    ) ===
                      change.blockId
                );

              for (
                const input of
                inputs
              ) {
                runInputBranch(
                  current,
                  page.id,
                  input,
                  {
                    eventType:
                      "blockStateChanged",
                    blockId:
                      change.blockId,
                    blockName:
                      input.data.blockName ??
                      "",
                    locoId:
                      change.locoId,
                    locoAddress:
                      change.locoAddress,
                    occupied:
                      change.locoAddress >
                        0 ||
                      Boolean(
                        change.locoId
                      ),
                  }
                );
              }
            }
          }
        }
      ),
    []
  );

  useEffect(
    () =>
      wsClient.on(
        "locoState",
        data => {
          if (
            !controlStationActiveRef.current
          ) {
            return;
          }

          const loco =
            data.loco;

          if (!loco) {
            return;
          }

          const address =
            Number(
              loco.address
            );

          if (
            !Number.isInteger(
              address
            ) ||
            address < 1
          ) {
            return;
          }

          const signature =
            JSON.stringify(
              loco
            );

          const previous =
            locoStateSignaturesRef.current.get(
              address
            );

          locoStateSignaturesRef.current.set(
            address,
            signature
          );

          // locoState is sticky in WsClient. The first value received for an
          // address seeds the comparison cache instead of firing a flow.
          if (
            previous ===
              undefined ||
            previous ===
              signature
          ) {
            return;
          }

          const current =
            documentRef.current;

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
                    "locoInput" &&
                  Math.round(
                    node.data.locoAddress ??
                    0
                  ) ===
                    address
              );

            for (
              const input of
              inputs
            ) {
              runInputBranch(
                current,
                page.id,
                input,
                {
                  eventType:
                    "locoState",
                  locoAddress:
                    address,
                  speed:
                    loco.speed,
                  direction:
                    loco.direction,
                  functionsMask:
                    loco.functionsMask,
                  reservation:
                    loco.reservation ??
                    null,
                  loco,
                }
              );
            }
          }
        }
      ),
    []
  );

  useEffect(
    () => {
      if (
        !controlStationActiveRef.current
      ) {
        return;
      }

      const current =
        documentRef.current;

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
