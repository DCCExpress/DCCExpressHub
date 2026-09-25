import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";

import {
  showNotification,
} from "@mantine/notifications";

import {
  IconAlertTriangle,
  IconAntenna,
  IconBolt,
  IconClock,
  IconDeviceFloppy,
  IconGitBranch,
  IconNote,
  IconPlus,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconRoute,
  IconTrash,
  IconVolume,
} from "@tabler/icons-react";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import "../../styles/automationFlow.css";

import i18next from "i18next";

import {
  createAutomationFlowId,
  createAutomationFlowPage,
  createEmptyAutomationFlowDocument,
  generateAutomationFlowPageScript,
  normalizeAutomationFlowDocument,
  type AutomationArrivalRule,
  type AutomationFlowDocument,
  type AutomationFlowEdge,
  type AutomationFlowNode,
  type AutomationFlowNodeData,
  type AutomationFlowNodeKind,
} from "../../domain/automationFlow";

import {
  loadAutomationFlow,
  saveAutomationFlow,
} from "../../services/automationApi";

import {
  automationFlowNodeTypes,
} from "./AutomationFlowNode";
import AutomationFlowInspector from "./AutomationFlowInspector";
import type {
  AutomationFlowLogLine,
} from "./AutomationFlowLogPanel";
import CollapsiblePanelCard from "../common/CollapsiblePanelCard";

import {
  abortClientScript,
  runClientScript,
  subscribeClientScriptLog,
} from "../../services/clientScriptRunner";

type AutomationFlowDialogProps = {
  opened: boolean;
  onClose: () => void;
};

type PaletteGroup =
  | "railway"
  | "sensors"
  | "dcc"
  | "utility";

type PaletteItem = {
  kind: AutomationFlowNodeKind;
  group: PaletteGroup;
  icon: ReactNode;
  labelKey: string;
  fallback: string;
  color: string;
};

const PALETTE_GROUPS: Array<{
  id: PaletteGroup;
  labelKey: string;
  fallback: string;
  color: string;
  defaultCollapsed?: boolean;
}> = [
  {
    id: "railway",
    labelKey: "ui.flowGroupRailway",
    fallback: "Railway",
    color: "violet",
  },
  {
    id: "sensors",
    labelKey: "ui.flowGroupSensors",
    fallback: "Sensors",
    color: "teal",
  },
  {
    id: "dcc",
    labelKey: "ui.flowGroupDcc",
    fallback: "DCC / Outputs",
    color: "orange",
  },
  {
    id: "utility",
    labelKey: "ui.flowGroupUtility",
    fallback: "Utility",
    color: "gray",
    defaultCollapsed: true,
  },
];

const PALETTE: PaletteItem[] = [
  {
    kind: "smartDispatcher",
    group: "railway",
    icon: <IconRoute size={16} />,
    labelKey: "ui.flowNodeSmartDispatcher",
    fallback: "SmartDispatcher",
    color: "violet",
  },
  {
    kind: "setSpeed",
    group: "railway",
    icon: <IconBolt size={16} />,
    labelKey: "ui.flowNodeSetSpeed",
    fallback: "Set speed",
    color: "blue",
  },
  {
    kind: "waitForBlock",
    group: "railway",
    icon: <IconGitBranch size={16} />,
    labelKey: "ui.flowNodeWaitBlock",
    fallback: "Wait block",
    color: "cyan",
  },
  {
    kind: "waitForSensor",
    group: "sensors",
    icon: <IconAntenna size={16} />,
    labelKey: "ui.flowNodeWaitSensor",
    fallback: "Wait sensor",
    color: "teal",
  },
  {
    kind: "setSensor",
    group: "sensors",
    icon: <IconAntenna size={16} />,
    labelKey: "ui.flowNodeSetSensor",
    fallback: "Set sensor",
    color: "teal",
  },
  {
    kind: "setTurnout",
    group: "dcc",
    icon: <IconGitBranch size={16} />,
    labelKey: "ui.flowNodeSetTurnout",
    fallback: "Set turnout",
    color: "grape",
  },
  {
    kind: "setAccessory",
    group: "dcc",
    icon: <IconBolt size={16} />,
    labelKey: "ui.flowNodeSetAccessory",
    fallback: "Set accessory",
    color: "yellow",
  },
  {
    kind: "horn",
    group: "railway",
    icon: <IconVolume size={16} />,
    labelKey: "ui.flowNodeHorn",
    fallback: "Horn",
    color: "orange",
  },
  {
    kind: "delay",
    group: "utility",
    icon: <IconClock size={16} />,
    labelKey: "ui.flowNodeDelay",
    fallback: "Delay",
    color: "gray",
  },
  {
    kind: "log",
    group: "utility",
    icon: <IconNote size={16} />,
    labelKey: "ui.flowNodeLog",
    fallback: "Log",
    color: "lime",
  },
];

function t(
  key: string,
  fallback: string
): string {
  return i18next.t(
    key,
    {
      defaultValue:
        fallback,
    }
  );
}

function flowLogValue(
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
    // Fall through to String().
  }

  return String(
    value
  );
}

function defaultNodeData(
  kind: AutomationFlowNodeKind,
  pageId: string
): AutomationFlowNodeData {
  const item =
    PALETTE.find(
      entry =>
        entry.kind === kind
    );

  const label =
    item
      ? t(
          item.labelKey,
          item.fallback
        )
      : kind;

  const base: AutomationFlowNodeData = {
    kind,
    label,
    pageId,
  };

  switch (kind) {
    case "smartDispatcher":
      return {
        ...base,
        route: [
          "A1",
          "B1",
        ],
        arrivalRules: [],
      };

    case "setSpeed":
      return {
        ...base,
        speed: 20,
      };

    case "waitForBlock":
      return {
        ...base,
        blockName: "B1",
      };

    case "waitForSensor":
      return {
        ...base,
        sensorAddress: 1,
        sensorState: true,
      };

    case "setSensor":
      return {
        ...base,
        sensorAddress: 1,
        sensorState: true,
      };

    case "setTurnout":
      return {
        ...base,
        turnoutAddress: 1,
        turnoutClosed: true,
      };

    case "setAccessory":
      return {
        ...base,
        accessoryAddress: 1,
        accessoryActive: true,
      };

    case "horn":
      return {
        ...base,
        functionNumber: 2,
        pulseMs: 700,
      };

    case "delay":
      return {
        ...base,
        delayMs: 500,
      };

    case "log":
      return {
        ...base,
        message: "",
      };

    default:
      return base;
  }
}

function mergePageNodes(
  document: AutomationFlowDocument,
  pageId: string,
  pageNodes: AutomationFlowNode[]
): AutomationFlowDocument {
  return {
    ...document,
    nodes: [
      ...document.nodes.filter(
        node =>
          node.data.pageId !==
          pageId
      ),
      ...pageNodes.map(
        node => ({
          ...node,
          data: {
            ...node.data,
            pageId,
          },
        })
      ),
    ],
  };
}

function mergePageEdges(
  document: AutomationFlowDocument,
  pageId: string,
  pageEdges: AutomationFlowEdge[]
): AutomationFlowDocument {
  const pageNodeIds =
    new Set(
      document.nodes
        .filter(
          node =>
            node.data.pageId ===
            pageId
        )
        .map(
          node =>
            node.id
        )
    );

  return {
    ...document,
    edges: [
      ...document.edges.filter(
        edge =>
          !pageNodeIds.has(
            edge.source
          ) &&
          !pageNodeIds.has(
            edge.target
          )
      ),
      ...pageEdges,
    ],
  };
}

function pageViewport(
  page:
    AutomationFlowDocument["pages"][number] |
    undefined
): Viewport {
  return {
    x:
      page?.viewportX ??
      0,
    y:
      page?.viewportY ??
      0,
    zoom:
      page?.viewportZoom ??
      1,
  };
}

export default function AutomationFlowDialog({
  opened,
  onClose,
}: AutomationFlowDialogProps) {
  const [
    document,
    setDocument,
  ] =
    useState<AutomationFlowDocument>(
      () =>
        createEmptyAutomationFlowDocument()
    );

  const [
    selectedNodeId,
    setSelectedNodeId,
  ] =
    useState<string | null>(
      null
    );

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    testingExecutionId,
    setTestingExecutionId,
  ] =
    useState<string | null>(
      null
    );

  const [
    flowLogs,
    setFlowLogs,
  ] =
    useState<
      AutomationFlowLogLine[]
    >([]);

  const activePage =
    document.pages.find(
      page =>
        page.id ===
        document.activePageId
    ) ??
    document.pages[0];

  const activePageId =
    activePage?.id ??
    "";

  const activeNodes =
    useMemo(
      () =>
        document.nodes.filter(
          node =>
            node.data.pageId ===
            activePageId
        ),
      [
        document.nodes,
        activePageId,
      ]
    );

  const activeNodeIds =
    useMemo(
      () =>
        new Set(
          activeNodes.map(
            node =>
              node.id
          )
        ),
      [
        activeNodes,
      ]
    );

  const activeEdges =
    useMemo(
      () =>
        document.edges.filter(
          edge =>
            activeNodeIds.has(
              edge.source
            ) &&
            activeNodeIds.has(
              edge.target
            )
        ),
      [
        document.edges,
        activeNodeIds,
      ]
    );

  const selectedNode =
    selectedNodeId
      ? document.nodes.find(
          node =>
            node.id ===
            selectedNodeId
        ) ??
        null
      : null;

  const generated =
    useMemo(
      () =>
        generateAutomationFlowPageScript(
          document,
          activePageId
        ),
      [
        document,
        activePageId,
      ]
    );

  const load =
    useCallback(
      async () => {
        setLoading(true);

        try {
          const loaded =
            normalizeAutomationFlowDocument(
              await loadAutomationFlow()
            );

          setDocument(
            loaded
          );

          setSelectedNodeId(
            null
          );
        } catch (error) {
          showNotification({
            color: "red",
            title:
              t(
                "ui.flowLoadFailed",
                "Flow load failed"
              ),
            message:
              error instanceof Error
                ? error.message
                : String(error),
          });
        } finally {
          setLoading(
            false
          );
        }
      },
      []
    );

  useEffect(
    () => {
      if (opened) {
        void load();
      }
    },
    [
      opened,
      load,
    ]
  );

  const save =
    async (): Promise<void> => {
      setSaving(
        true
      );

      try {
        const normalized =
          normalizeAutomationFlowDocument(
            document
          );

        await saveAutomationFlow(
          normalized
        );

        setDocument(
          normalized
        );

        showNotification({
          color: "teal",
          title:
            t(
              "ui.flowSaved",
              "Flow saved"
            ),
          message:
            activePage?.name ??
            "",
        });
      } catch (error) {
        showNotification({
          color: "red",
          title:
            t(
              "ui.flowSaveFailed",
              "Flow save failed"
            ),
          message:
            error instanceof Error
              ? error.message
              : String(error),
        });
      } finally {
        setSaving(
          false
        );
      }
    };

  const setActivePage =
    (
      pageId: string
    ): void => {
      setDocument(
        current => ({
          ...current,
          activePageId:
            pageId,
        })
      );

      setSelectedNodeId(
        null
      );
    };

  const addPage =
    (): void => {
      const page =
        createAutomationFlowPage(
          `${t(
            "ui.flowPage",
            "Page"
          )} ${document.pages.length + 1}`
        );

      setDocument(
        current => ({
          ...current,
          pages: [
            ...current.pages,
            page,
          ],
          activePageId:
            page.id,
        })
      );

      setSelectedNodeId(
        null
      );
    };

  const updateActivePage =
    (
      patch:
        Partial<
          AutomationFlowDocument["pages"][number]
        >
    ): void => {
      if (!activePage) {
        return;
      }

      setDocument(
        current => ({
          ...current,
          pages:
            current.pages.map(
              page =>
                page.id ===
                activePage.id
                  ? {
                      ...page,
                      ...patch,
                    }
                  : page
            ),
        })
      );
    };

  const deleteActivePage =
    (): void => {
      if (
        !activePage ||
        document.pages.length <=
          1
      ) {
        showNotification({
          color: "orange",
          title:
            t(
              "ui.flowCannotDeleteLastPage",
              "The last page cannot be deleted"
            ),
          message:
            "",
        });

        return;
      }

      if (
        !window.confirm(
          t(
            "ui.flowDeletePageConfirm",
            "Delete this automation page and all of its nodes?"
          )
        )
      ) {
        return;
      }

      const nextPages =
        document.pages.filter(
          page =>
            page.id !==
            activePage.id
        );

      const removedNodeIds =
        new Set(
          document.nodes
            .filter(
              node =>
                node.data.pageId ===
                activePage.id
            )
            .map(
              node =>
                node.id
            )
        );

      setDocument(
        current => ({
          ...current,
          pages:
            nextPages,
          activePageId:
            nextPages[0]!.id,
          nodes:
            current.nodes.filter(
              node =>
                node.data.pageId !==
                activePage.id
            ),
          edges:
            current.edges.filter(
              edge =>
                !removedNodeIds.has(
                  edge.source
                ) &&
                !removedNodeIds.has(
                  edge.target
                )
            ),
        })
      );

      setSelectedNodeId(
        null
      );
    };

  const addNode =
    (
      kind:
        AutomationFlowNodeKind
    ): void => {
      if (!activePage) {
        return;
      }

      const index =
        activeNodes.length;

      const node:
        AutomationFlowNode = {
          id:
            createAutomationFlowId(
              kind
            ),
          type:
            "automationNode",
          position: {
            x:
              80 +
              (
                index %
                3
              ) *
                250,
            y:
              70 +
              Math.floor(
                index /
                3
              ) *
                125,
          },
          data:
            defaultNodeData(
              kind,
              activePage.id
            ),
        };

      setDocument(
        current => ({
          ...current,
          nodes: [
            ...current.nodes,
            node,
          ],
        })
      );

      setSelectedNodeId(
        node.id
      );
    };

  const onNodesChange =
    (
      changes:
        NodeChange<Node>[]
    ): void => {
      const next =
        applyNodeChanges(
          changes,
          activeNodes as Node[]
        ) as unknown as
          AutomationFlowNode[];

      setDocument(
        current =>
          mergePageNodes(
            current,
            activePageId,
            next
          )
      );
    };

  const onEdgesChange =
    (
      changes:
        EdgeChange<Edge>[]
    ): void => {
      const next =
        applyEdgeChanges(
          changes,
          activeEdges as Edge[]
        ) as unknown as
          AutomationFlowEdge[];

      setDocument(
        current =>
          mergePageEdges(
            current,
            activePageId,
            next
          )
      );
    };

  const onConnect =
    (
      connection:
        Connection
    ): void => {
      if (
        !connection.source ||
        !connection.target
      ) {
        return;
      }

      const next =
        addEdge(
          {
            ...connection,
            id:
              createAutomationFlowId(
                "edge"
              ),
            type:
              "smoothstep",
            markerEnd: {
              type:
                MarkerType.ArrowClosed,
            },
          },
          activeEdges as Edge[]
        ) as unknown as
          AutomationFlowEdge[];

      setDocument(
        current =>
          mergePageEdges(
            current,
            activePageId,
            next
          )
      );
    };

  const onNodesDelete =
    (
      nodes:
        Node[]
    ): void => {
      const deleted =
        new Set(
          nodes.map(
            node =>
              node.id
          )
        );

      setDocument(
        current => ({
          ...current,
          edges:
            current.edges.filter(
              edge =>
                !deleted.has(
                  edge.source
                ) &&
                !deleted.has(
                  edge.target
                )
            ),
        })
      );

      if (
        selectedNodeId &&
        deleted.has(
          selectedNodeId
        )
      ) {
        setSelectedNodeId(
          null
        );
      }
    };

  const updateSelectedNode =
    (
      patch:
        Partial<
          AutomationFlowNodeData
        >
    ): void => {
      if (!selectedNode) {
        return;
      }

      setDocument(
        current => ({
          ...current,
          nodes:
            current.nodes.map(
              node =>
                node.id ===
                selectedNode.id
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        ...patch,
                      },
                    }
                  : node
            ),
        })
      );
    };

  const deleteSelectedNode =
    (): void => {
      if (!selectedNode) {
        return;
      }

      const id =
        selectedNode.id;

      setDocument(
        current => ({
          ...current,
          nodes:
            current.nodes.filter(
              node =>
                node.id !==
                id
            ),
          edges:
            current.edges.filter(
              edge =>
                edge.source !==
                  id &&
                edge.target !==
                  id
            ),
        })
      );

      setSelectedNodeId(
        null
      );
    };

  const addArrivalRule =
    (): void => {
      if (
        !selectedNode ||
        selectedNode.data.kind !==
          "smartDispatcher"
      ) {
        return;
      }

      const route =
        selectedNode.data.route ??
        [];

      const rule:
        AutomationArrivalRule = {
          id:
            createAutomationFlowId(
              "arrival"
            ),
          block:
            route[1] ??
            route[0] ??
            "B1",
          sensor: 1,
          state: true,
        };

      updateSelectedNode({
        arrivalRules: [
          ...(
            selectedNode.data
              .arrivalRules ??
            []
          ),
          rule,
        ],
      });
    };

  const updateArrivalRule =
    (
      id: string,
      patch:
        Partial<
          AutomationArrivalRule
        >
    ): void => {
      if (
        !selectedNode ||
        selectedNode.data.kind !==
          "smartDispatcher"
      ) {
        return;
      }

      updateSelectedNode({
        arrivalRules:
          (
            selectedNode.data
              .arrivalRules ??
            []
          ).map(
            rule =>
              rule.id ===
              id
                ? {
                    ...rule,
                    ...patch,
                  }
                : rule
          ),
      });
    };

  const deleteArrivalRule =
    (
      id: string
    ): void => {
      if (!selectedNode) {
        return;
      }

      updateSelectedNode({
        arrivalRules:
          (
            selectedNode.data
              .arrivalRules ??
            []
          ).filter(
            rule =>
              rule.id !==
              id
          ),
      });
    };

  const appendFlowLog =
    (
      level:
        AutomationFlowLogLine["level"],
      message: string,
      timestamp =
        Date.now()
    ): void => {
      setFlowLogs(
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

  const runTest =
    async (): Promise<void> => {
      if (
        !activePage ||
        testingExecutionId
      ) {
        return;
      }

      const executionId =
        `visual-flow-test:${activePage.id}`;

      setTestingExecutionId(
        executionId
      );

      appendFlowLog(
        "info",
        `TEST started: ${activePage.name}`
      );

      const unsubscribeLog =
        subscribeClientScriptLog(
          executionId,
          entry => {
            appendFlowLog(
              "log",
              entry.values
                .map(
                  flowLogValue
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
          generated.code,
          {
            id:
              executionId,
            name:
              `Flow Test: ${activePage.name}`,
            type:
              "visual-flow-test",
          }
        );

        appendFlowLog(
          "info",
          "TEST completed."
        );
      } catch (error) {
        appendFlowLog(
          "error",
          error instanceof Error
            ? error.message
            : String(error)
        );
      } finally {
        unsubscribeLog();

        setTestingExecutionId(
          current =>
            current ===
            executionId
              ? null
              : current
        );
      }
    };

  const stopTest =
    (): void => {
      if (
        !testingExecutionId
      ) {
        return;
      }

      abortClientScript(
        testingExecutionId,
        "Visual flow test stopped by user."
      );

      appendFlowLog(
        "info",
        "TEST stop requested."
      );
    };

  const updateViewport =
    (
      viewport:
        Viewport
    ): void => {
      updateActivePage({
        viewportX:
          viewport.x,
        viewportY:
          viewport.y,
        viewportZoom:
          viewport.zoom,
      });
    };

  return (
    <Modal
      opened={
        opened
      }
      onClose={
        onClose
      }
      title={
        t(
          "ui.visualAutomationEditor",
          "Visual Automation Editor"
        )
      }
      fullScreen
      closeOnEscape={
        false
      }
      closeOnClickOutside={
        false
      }
      styles={{
        body: {
          padding: 10,
        },
      }}
    >
      <div className="automation-flow-dialog-body">
        <Stack
          gap="xs"
          h="100%"
          className="automation-flow-dialog-stack"
        >
          <Group
            justify="space-between"
            wrap="nowrap"
          >
            <Group
              gap="xs"
              wrap="nowrap"
            >
              <Button
                size="xs"
                leftSection={
                  <IconDeviceFloppy
                    size={15}
                  />
                }
                loading={
                  saving
                }
                onClick={
                  () =>
                    void save()
                }
              >
                {
                  t(
                    "ui.save",
                    "Save"
                  )
                }
              </Button>

              <Button
                size="xs"
                variant="light"
                leftSection={
                  <IconRefresh
                    size={15}
                  />
                }
                loading={
                  loading
                }
                onClick={
                  () =>
                    void load()
                }
              >
                {
                  t(
                    "ui.reload",
                    "Reload"
                  )
                }
              </Button>

              <Button
                size="xs"
                variant="light"
                color="teal"
                leftSection={
                  <IconPlayerPlay
                    size={15}
                  />
                }
                loading={
                  testingExecutionId !==
                  null
                }
                disabled={
                  !activePage ||
                  generated.code.trim().startsWith(
                    "//"
                  ) ||
                  testingExecutionId !==
                  null
                }
                onClick={
                  () =>
                    void runTest()
                }
              >
                {
                  t(
                    "ui.flowTest",
                    "TEST"
                  )
                }
              </Button>

              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={
                  <IconPlayerStop
                    size={15}
                  />
                }
                disabled={
                  testingExecutionId ===
                  null
                }
                onClick={
                  stopTest
                }
              >
                {
                  t(
                    "ui.flowStop",
                    "STOP"
                  )
                }
              </Button>

              <Divider
                orientation="vertical"
              />

              <Button
                size="xs"
                variant="light"
                leftSection={
                  <IconPlus
                    size={15}
                  />
                }
                onClick={
                  addPage
                }
              >
                {
                  t(
                    "ui.flowAddPage",
                    "Add page"
                  )
                }
              </Button>
            </Group>

            {activePage && (
              <Group
                gap="xs"
                wrap="nowrap"
              >
                <TextInput
                  size="xs"
                  value={
                    activePage.name
                  }
                  onChange={
                    event =>
                      updateActivePage({
                        name:
                          event.currentTarget
                            .value,
                      })
                  }
                  w={220}
                />

                <Switch
                  size="sm"
                  checked={
                    activePage.enabled
                  }
                  label={
                    t(
                      "ui.enabled",
                      "Enabled"
                    )
                  }
                  onChange={
                    event =>
                      updateActivePage({
                        enabled:
                          event.currentTarget
                            .checked,
                      })
                  }
                />

                <Tooltip
                  label={
                    t(
                      "ui.flowDeletePage",
                      "Delete page"
                    )
                  }
                >
                  <ActionIcon
                    color="red"
                    variant="light"
                    onClick={
                      deleteActivePage
                    }
                  >
                    <IconTrash
                      size={16}
                    />
                  </ActionIcon>
                </Tooltip>
              </Group>
            )}
          </Group>

          <Tabs
            value={
              activePageId
            }
            onChange={
              value => {
                if (value) {
                  setActivePage(
                    value
                  );
                }
              }
            }
            variant="outline"
            className="automation-flow-page-tabs"
          >
            <Tabs.List>
              {document.pages.map(
                page => (
                  <Tabs.Tab
                    key={
                      page.id
                    }
                    value={
                      page.id
                    }
                    rightSection={
                      page.enabled
                        ? null
                        : (
                          <Badge
                            size="xs"
                            color="gray"
                            variant="light"
                          >
                            OFF
                          </Badge>
                        )
                    }
                  >
                    {page.name}
                  </Tabs.Tab>
                )
              )}
            </Tabs.List>
          </Tabs>

          <div className="automation-flow-workspace">
            <Card
              withBorder
              p="sm"
              className="automation-flow-sidebar"
            >
              <Stack
                gap="xs"
                h="100%"
              >
                <Text
                  fw={700}
                  size="sm"
                >
                  {
                    t(
                      "ui.flowNodes",
                      "Nodes"
                    )
                  }
                </Text>

                <Text
                  size="xs"
                  c="dimmed"
                >
                  {
                    t(
                      "ui.flowNodesDescription",
                      "Add nodes, then connect them from left to right."
                    )
                  }
                </Text>

                <ScrollArea
                  style={{
                    flex: 1,
                  }}
                >
                  <Stack
                    gap="xs"
                    pr={4}
                  >
                    {PALETTE_GROUPS.map(
                      group => {
                        const items =
                          PALETTE.filter(
                            item =>
                              item.group ===
                              group.id
                          );

                        return (
                          <CollapsiblePanelCard
                            key={
                              group.id
                            }
                            title={
                              <Group
                                gap="xs"
                                wrap="nowrap"
                              >
                                <Text
                                  size="sm"
                                  fw={700}
                                >
                                  {
                                    t(
                                      group.labelKey,
                                      group.fallback
                                    )
                                  }
                                </Text>

                                <Badge
                                  size="xs"
                                  variant="light"
                                  color={
                                    group.color
                                  }
                                >
                                  {
                                    items.length
                                  }
                                </Badge>
                              </Group>
                            }
                            collapsedStorageKey={
                              `dcc-express-flow-palette-${group.id}-collapsed`
                            }
                            expandTooltip={
                              t(
                                "ui.flowExpandCategory",
                                "Expand category"
                              )
                            }
                            collapseTooltip={
                              t(
                                "ui.flowCollapseCategory",
                                "Collapse category"
                              )
                            }
                            defaultCollapsed={
                              group.defaultCollapsed ===
                              true
                            }
                          >
                            <Stack gap={6}>
                              {items.map(
                                item => (
                                  <Button
                                    key={
                                      item.kind
                                    }
                                    size="xs"
                                    variant="light"
                                    color={
                                      item.color
                                    }
                                    leftSection={
                                      item.icon
                                    }
                                    className="automation-flow-palette-button"
                                    onClick={
                                      () =>
                                        addNode(
                                          item.kind
                                        )
                                    }
                                  >
                                    {
                                      t(
                                        item.labelKey,
                                        item.fallback
                                      )
                                    }
                                  </Button>
                                )
                              )}
                            </Stack>
                          </CollapsiblePanelCard>
                        );
                      }
                    )}
                  </Stack>
                </ScrollArea>
              </Stack>
            </Card>

            <div className="automation-flow-canvas">
              {activePage && (
                <ReactFlow
                  key={
                    activePage.id
                  }
                  nodes={
                    activeNodes as Node[]
                  }
                  edges={
                    activeEdges as Edge[]
                  }
                  nodeTypes={
                    automationFlowNodeTypes
                  }
                  onNodesChange={
                    onNodesChange
                  }
                  onEdgesChange={
                    onEdgesChange
                  }
                  onNodesDelete={
                    onNodesDelete
                  }
                  onConnect={
                    onConnect
                  }
                  onNodeClick={
                    (
                      _,
                      node
                    ) =>
                      setSelectedNodeId(
                        node.id
                      )
                  }
                  onPaneClick={
                    () =>
                      setSelectedNodeId(
                        null
                      )
                  }
                  onMoveEnd={
                    (
                      _,
                      viewport
                    ) =>
                      updateViewport(
                        viewport
                      )
                  }
                  defaultViewport={
                    pageViewport(
                      activePage
                    )
                  }
                  fitView={
                    activePage.viewportZoom ===
                    undefined
                  }
                  defaultEdgeOptions={{
                    type:
                      "smoothstep",
                    markerEnd: {
                      type:
                        MarkerType.ArrowClosed,
                    },
                  }}
                  deleteKeyCode={[
                    "Backspace",
                    "Delete",
                  ]}
                  minZoom={0.2}
                  maxZoom={2.5}
                  proOptions={{
                    hideAttribution: true,
                  }}
                >
                  <Background
                    variant={
                      BackgroundVariant.Dots
                    }
                    gap={18}
                    size={1}
                  />
                  <Controls />
                  <MiniMap
                    pannable
                    zoomable
                    maskColor="rgba(0, 0, 0, 0.55)"
                  />
                </ReactFlow>
              )}
            </div>

            <Card
              withBorder
              p="sm"
              className="automation-flow-properties"
            >
              <AutomationFlowInspector
                node={
                  selectedNode
                }
                generated={
                  generated
                }
                logs={
                  flowLogs
                }
                onClearLogs={
                  () =>
                    setFlowLogs(
                      []
                    )
                }
                onChangeNode={
                  updateSelectedNode
                }
                onDeleteNode={
                  deleteSelectedNode
                }
                onAddArrivalRule={
                  addArrivalRule
                }
                onChangeArrivalRule={
                  updateArrivalRule
                }
                onDeleteArrivalRule={
                  deleteArrivalRule
                }
              />
            </Card>

          </div>
        </Stack>
      </div>
    </Modal>
  );
}
