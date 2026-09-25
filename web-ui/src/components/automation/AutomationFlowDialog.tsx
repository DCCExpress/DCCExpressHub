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

type AutomationFlowDialogProps = {
  opened: boolean;
  onClose: () => void;
};

type PaletteItem = {
  kind: AutomationFlowNodeKind;
  icon: React.ReactNode;
  labelKey: string;
  fallback: string;
  color: string;
};

const PALETTE: PaletteItem[] = [
  {
    kind: "smartDispatcher",
    icon: <IconRoute size={16} />,
    labelKey: "ui.flowNodeSmartDispatcher",
    fallback: "SmartDispatcher",
    color: "violet",
  },
  {
    kind: "setSpeed",
    icon: <IconBolt size={16} />,
    labelKey: "ui.flowNodeSetSpeed",
    fallback: "Set speed",
    color: "blue",
  },
  {
    kind: "waitForBlock",
    icon: <IconGitBranch size={16} />,
    labelKey: "ui.flowNodeWaitBlock",
    fallback: "Wait block",
    color: "cyan",
  },
  {
    kind: "waitForSensor",
    icon: <IconAntenna size={16} />,
    labelKey: "ui.flowNodeWaitSensor",
    fallback: "Wait sensor",
    color: "teal",
  },
  {
    kind: "horn",
    icon: <IconVolume size={16} />,
    labelKey: "ui.flowNodeHorn",
    fallback: "Horn",
    color: "orange",
  },
  {
    kind: "delay",
    icon: <IconClock size={16} />,
    labelKey: "ui.flowNodeDelay",
    fallback: "Delay",
    color: "gray",
  },
  {
    kind: "log",
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

function parseRouteText(
  value: string
): string[] {
  const seen =
    new Set<string>();

  return value
    .split(
      /(?:->|→|,|;|\n)+/
    )
    .map(
      item =>
        item.trim()
    )
    .filter(Boolean)
    .filter(
      item => {
        const key =
          item.toLocaleLowerCase();

        if (
          seen.has(key)
        ) {
          return false;
        }

        seen.add(key);
        return true;
      }
    );
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

  const renderNodeProperties =
    (): ReactNode => {
      if (!selectedNode) {
        return (
          <Text
            size="sm"
            c="dimmed"
          >
            {
              t(
                "ui.flowNoNodeSelected",
                "Select a node to edit its properties."
              )
            }
          </Text>
        );
      }

      const data =
        selectedNode.data;

      return (
        <Stack gap="sm">
          <Group
            justify="space-between"
            wrap="nowrap"
          >
            <Badge
              variant="light"
              color="violet"
            >
              {data.kind}
            </Badge>

            <Tooltip
              label={
                t(
                  "ui.delete",
                  "Delete"
                )
              }
            >
              <ActionIcon
                color="red"
                variant="light"
                onClick={
                  deleteSelectedNode
                }
              >
                <IconTrash
                  size={16}
                />
              </ActionIcon>
            </Tooltip>
          </Group>

          <TextInput
            label={
              t(
                "ui.name",
                "Name"
              )
            }
            value={
              data.label
            }
            onChange={
              event =>
                updateSelectedNode({
                  label:
                    event.currentTarget
                      .value,
                })
            }
          />

          {data.kind ===
            "smartDispatcher" && (
            <>
              <TextInput
                label={
                  t(
                    "ui.flowRouteBlocks",
                    "Route blocks"
                  )
                }
                description={
                  t(
                    "ui.flowRouteBlocksDescription",
                    "Example: A1 → B1 → C1"
                  )
                }
                value={
                  (
                    data.route ??
                    []
                  ).join(
                    " → "
                  )
                }
                onChange={
                  event =>
                    updateSelectedNode({
                      route:
                        parseRouteText(
                          event.currentTarget
                            .value
                        ),
                    })
                }
              />

              <Divider
                label={
                  t(
                    "ui.flowArrivalConditions",
                    "Arrival conditions"
                  )
                }
                labelPosition="left"
              />

              <Stack gap="xs">
                {(
                  data.arrivalRules ??
                  []
                ).map(
                  rule => (
                    <Card
                      key={
                        rule.id
                      }
                      withBorder
                      p="xs"
                    >
                      <Stack gap="xs">
                        <Group
                          align="flex-end"
                          wrap="nowrap"
                        >
                          <TextInput
                            label={
                              t(
                                "ui.block2",
                                "Block"
                              )
                            }
                            value={
                              rule.block
                            }
                            onChange={
                              event =>
                                updateArrivalRule(
                                  rule.id,
                                  {
                                    block:
                                      event.currentTarget
                                        .value,
                                  }
                                )
                            }
                            style={{
                              flex: 1,
                            }}
                          />

                          <NumberInput
                            label={
                              t(
                                "ui.sensorAddress",
                                "Sensor address"
                              )
                            }
                            value={
                              rule.sensor
                            }
                            min={1}
                            max={65535}
                            onChange={
                              value =>
                                updateArrivalRule(
                                  rule.id,
                                  {
                                    sensor:
                                      Number(
                                        value
                                      ) ||
                                      1,
                                  }
                                )
                            }
                            w={120}
                          />

                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={
                              () =>
                                deleteArrivalRule(
                                  rule.id
                                )
                            }
                          >
                            <IconTrash
                              size={15}
                            />
                          </ActionIcon>
                        </Group>

                        <Switch
                          size="sm"
                          checked={
                            rule.state
                          }
                          label={
                            rule.state
                              ? "ON / true"
                              : "OFF / false"
                          }
                          onChange={
                            event =>
                              updateArrivalRule(
                                rule.id,
                                {
                                  state:
                                    event.currentTarget
                                      .checked,
                                }
                              )
                          }
                        />
                      </Stack>
                    </Card>
                  )
                )}

                <Button
                  size="xs"
                  variant="light"
                  leftSection={
                    <IconPlus
                      size={14}
                    />
                  }
                  onClick={
                    addArrivalRule
                  }
                >
                  {
                    t(
                      "ui.flowAddArrivalCondition",
                      "Add arrival condition"
                    )
                  }
                </Button>
              </Stack>
            </>
          )}

          {data.kind ===
            "setSpeed" && (
            <NumberInput
              label={
                t(
                  "ui.speedLabel",
                  "Speed"
                )
              }
              value={
                data.speed ??
                20
              }
              min={0}
              max={126}
              onChange={
                value =>
                  updateSelectedNode({
                    speed:
                      Number(
                        value
                      ) ||
                      0,
                  })
              }
            />
          )}

          {data.kind ===
            "waitForBlock" && (
            <TextInput
              label={
                t(
                  "ui.block2",
                  "Block"
                )
              }
              value={
                data.blockName ??
                ""
              }
              onChange={
                event =>
                  updateSelectedNode({
                    blockName:
                      event.currentTarget
                        .value,
                  })
              }
            />
          )}

          {data.kind ===
            "waitForSensor" && (
            <>
              <NumberInput
                label={
                  t(
                    "ui.sensorAddress",
                    "Sensor address"
                  )
                }
                value={
                  data.sensorAddress ??
                  1
                }
                min={1}
                max={65535}
                onChange={
                  value =>
                    updateSelectedNode({
                      sensorAddress:
                        Number(
                          value
                        ) ||
                        1,
                    })
                }
              />

              <Select
                label={
                  t(
                    "ui.flowExpectedState",
                    "Expected state"
                  )
                }
                value={
                  data.sensorState !==
                  false
                    ? "true"
                    : "false"
                }
                data={[
                  {
                    value:
                      "true",
                    label:
                      "ON / true",
                  },
                  {
                    value:
                      "false",
                    label:
                      "OFF / false",
                  },
                ]}
                allowDeselect={
                  false
                }
                onChange={
                  value =>
                    updateSelectedNode({
                      sensorState:
                        value !==
                        "false",
                    })
                }
              />
            </>
          )}

          {data.kind ===
            "horn" && (
            <>
              <NumberInput
                label={
                  t(
                    "ui.flowFunctionNumber",
                    "Function number"
                  )
                }
                value={
                  data.functionNumber ??
                  2
                }
                min={0}
                max={68}
                onChange={
                  value =>
                    updateSelectedNode({
                      functionNumber:
                        Number(
                          value
                        ) ||
                        0,
                    })
                }
              />

              <NumberInput
                label={
                  t(
                    "ui.flowPulseMs",
                    "Pulse (ms)"
                  )
                }
                value={
                  data.pulseMs ??
                  700
                }
                min={1}
                max={600000}
                onChange={
                  value =>
                    updateSelectedNode({
                      pulseMs:
                        Number(
                          value
                        ) ||
                        1,
                    })
                }
              />
            </>
          )}

          {data.kind ===
            "delay" && (
            <NumberInput
              label={
                t(
                  "ui.flowDelayMs",
                  "Delay (ms)"
                )
              }
              value={
                data.delayMs ??
                500
              }
              min={0}
              max={600000}
              onChange={
                value =>
                  updateSelectedNode({
                    delayMs:
                      Number(
                        value
                      ) ||
                      0,
                  })
              }
            />
          )}

          {data.kind ===
            "log" && (
            <Textarea
              label={
                t(
                  "ui.flowMessage",
                  "Message"
                )
              }
              value={
                data.message ??
                ""
              }
              minRows={3}
              autosize
              onChange={
                event =>
                  updateSelectedNode({
                    message:
                      event.currentTarget
                        .value,
                  })
              }
            />
          )}
        </Stack>
      );
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
                    {PALETTE.map(
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
                  />
                </ReactFlow>
              )}
            </div>

            <Card
              withBorder
              p="sm"
              className="automation-flow-properties"
            >
              <Stack
                gap="sm"
                h="100%"
              >
                <Text
                  fw={700}
                  size="sm"
                >
                  {
                    t(
                      "ui.flowProperties",
                      "Properties"
                    )
                  }
                </Text>

                <ScrollArea
                  style={{
                    flex: 1,
                    minHeight: 0,
                  }}
                >
                  <Stack
                    gap="md"
                    pr={4}
                  >
                    {
                      renderNodeProperties()
                    }

                    <Divider
                      label={
                        t(
                          "ui.flowGeneratedCode",
                          "Generated JavaScript"
                        )
                      }
                      labelPosition="left"
                    />

                    {generated.warnings.length >
                      0 && (
                      <Alert
                        color="yellow"
                        icon={
                          <IconAlertTriangle
                            size={16}
                          />
                        }
                        py="xs"
                      >
                        <Stack gap={2}>
                          {generated.warnings.map(
                            warning => (
                              <Text
                                key={
                                  warning
                                }
                                size="xs"
                              >
                                {
                                  warning
                                }
                              </Text>
                            )
                          )}
                        </Stack>
                      </Alert>
                    )}

                    <Textarea
                      value={
                        generated.code
                      }
                      readOnly
                      autosize
                      minRows={12}
                      maxRows={28}
                      className="automation-flow-generated-code"
                      styles={{
                        input: {
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                          fontSize: 12,
                        },
                      }}
                    />
                  </Stack>
                </ScrollArea>
              </Stack>
            </Card>
          </div>
        </Stack>
      </div>
    </Modal>
  );
}
