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
import AutomationFlowPalette, {
  createDefaultAutomationNodeData,
} from "./AutomationFlowPalette";
import {
  useAutomationFlowExecution,
} from "./useAutomationFlowExecution";
import {
  useAutomationFlowPanelSizes,
} from "./useAutomationFlowPanelSizes";
import {
  AUTOMATION_FLOW_INJECT_EVENT,
  type AutomationFlowInjectEventDetail,
} from "./automationFlowEvents";

type AutomationFlowDialogProps = {
  opened: boolean;
  onClose: () => void;
  initialPageId?: string | null;
  onSaved?: (
    document:
      AutomationFlowDocument
  ) => void;
};

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
  initialPageId,
  onSaved,
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
    selectedEdgeId,
    setSelectedEdgeId,
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

  const displayEdges =
    useMemo(
      () =>
        activeEdges.map(
          edge => ({
            ...edge,
            selected:
              edge.id ===
              selectedEdgeId,
          })
        ),
      [
        activeEdges,
        selectedEdgeId,
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

  const generatedTest =
    useMemo(
      () =>
        generateAutomationFlowPageScript(
          document,
          activePageId,
          {
            testRun:
              true,
          }
        ),
      [
        document,
        activePageId,
      ]
    );

  const flowExecution =
    useAutomationFlowExecution({
      page:
        activePage,
      generated,
      generatedTest,
    });

  const panelSizes =
    useAutomationFlowPanelSizes();

  useEffect(
    () => {
      if (!opened) {
        return;
      }

      const handleInject =
        (
          event: Event
        ): void => {
          const detail =
            (
              event as CustomEvent<
                AutomationFlowInjectEventDetail
              >
            ).detail;

          if (
            !detail ||
            detail.pageId !==
              activePageId ||
            flowExecution.execution
          ) {
            return;
          }

          const injected =
            generateAutomationFlowPageScript(
              document,
              activePageId,
              {
                testRun:
                  true,
                triggerNodeId:
                  detail.triggerNodeId,
              }
            );

          void flowExecution.inject(
            injected.code
          );
        };

      window.addEventListener(
        AUTOMATION_FLOW_INJECT_EVENT,
        handleInject
      );

      return () => {
        window.removeEventListener(
          AUTOMATION_FLOW_INJECT_EVENT,
          handleInject
        );
      };
    },
    [
      opened,
      document,
      activePageId,
      flowExecution.execution,
      flowExecution.inject,
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

          const requestedPage =
            initialPageId &&
            loaded.pages.some(
              page =>
                page.id ===
                initialPageId
            )
              ? initialPageId
              : loaded.activePageId;

          setDocument({
            ...loaded,
            activePageId:
              requestedPage,
          });

          setSelectedNodeId(
            null
          );

          setSelectedEdgeId(
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
      [
        initialPageId,
      ]
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

        onSaved?.(
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
              120,
            y:
              70 +
              index *
                120,
          },
          data:
            createDefaultAutomationNodeData(
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

      setSelectedEdgeId(
        null
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
      setSelectedEdgeId(
        null
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

      if (
        selectedEdgeId
      ) {
        const edge =
          activeEdges.find(
            item =>
              item.id ===
              selectedEdgeId
          );

        if (
          edge &&
          (
            deleted.has(
              edge.source
            ) ||
            deleted.has(
              edge.target
            )
          )
        ) {
          setSelectedEdgeId(
            null
          );
        }
      }
    };

  const deleteEdgeById =
    (
      edgeId:
        string
    ): void => {
      setDocument(
        current => ({
          ...current,
          edges:
            current.edges.filter(
              edge =>
                edge.id !==
                edgeId
            ),
        })
      );

      setSelectedEdgeId(
        current =>
          current ===
          edgeId
            ? null
            : current
      );
    };

  useEffect(
    () => {
      if (
        !opened ||
        !selectedEdgeId
      ) {
        return;
      }

      const handleDeleteKey =
        (
          event:
            KeyboardEvent
        ): void => {
          if (
            event.key !==
              "Delete" &&
            event.key !==
              "Backspace"
          ) {
            return;
          }

          const target =
            event.target as
              HTMLElement |
              null;

          if (
            target &&
            (
              target.tagName ===
                "INPUT" ||
              target.tagName ===
                "TEXTAREA" ||
              target.tagName ===
                "SELECT" ||
              target.isContentEditable
            )
          ) {
            return;
          }

          event.preventDefault();

          deleteEdgeById(
            selectedEdgeId
          );
        };

      window.addEventListener(
        "keydown",
        handleDeleteKey,
        true
      );

      return () => {
        window.removeEventListener(
          "keydown",
          handleDeleteKey,
          true
        );
      };
    },
    [
      opened,
      selectedEdgeId,
    ]
  );

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
                  flowExecution.execution?.mode ===
                  "test"
                }
                disabled={
                  !activePage ||
                  generatedTest.code.trim().startsWith(
                    "//"
                  ) ||
                  flowExecution.execution !==
                  null
                }
                onClick={
                  () =>
                    void flowExecution.runTest()
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
                color="blue"
                leftSection={
                  <IconPlayerPlay
                    size={15}
                  />
                }
                loading={
                  flowExecution.execution?.mode ===
                  "run"
                }
                disabled={
                  !activePage ||
                  generated.code.trim().startsWith(
                    "//"
                  ) ||
                  flowExecution.execution !==
                  null
                }
                onClick={
                  () =>
                    void flowExecution.run()
                }
              >
                {
                  t(
                    "ui.flowRun",
                    "RUN"
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
                  flowExecution.execution ===
                  null
                }
                onClick={
                  flowExecution.stop
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

          <div
            className="automation-flow-workspace"
            style={
              panelSizes.workspaceStyle
            }
          >
            <Card
              withBorder
              p="sm"
              className="automation-flow-sidebar"
            >
              <AutomationFlowPalette
                onAdd={
                  addNode
                }
              />
            </Card>

            <div
              className="automation-flow-splitter automation-flow-splitter-left"
              role="separator"
              aria-orientation="vertical"
              aria-label={
                t(
                  "ui.flowResizeNodePanel",
                  "Resize node panel"
                )
              }
              title={
                `${Math.round(panelSizes.leftWidth)} px · ${t(
                  "ui.flowDoubleClickReset",
                  "Double-click to reset"
                )}`
              }
              onPointerDown={
                event =>
                  panelSizes.beginResize(
                    "left",
                    event
                  )
              }
              onDoubleClick={
                () =>
                  panelSizes.resetWidth(
                    "left"
                  )
              }
            />

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
                    displayEdges as Edge[]
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
                    ) => {
                      setSelectedNodeId(
                        node.id
                      );

                      setSelectedEdgeId(
                        null
                      );
                    }
                  }
                  onEdgeClick={
                    (
                      _,
                      edge
                    ) => {
                      setSelectedNodeId(
                        null
                      );

                      setSelectedEdgeId(
                        edge.id
                      );
                    }
                  }
                  onEdgeDoubleClick={
                    (
                      event,
                      edge
                    ) => {
                      event.preventDefault();
                      event.stopPropagation();

                      deleteEdgeById(
                        edge.id
                      );
                    }
                  }
                  onPaneClick={
                    () => {
                      setSelectedNodeId(
                        null
                      );

                      setSelectedEdgeId(
                        null
                      );
                    }
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

            <div
              className="automation-flow-splitter automation-flow-splitter-right"
              role="separator"
              aria-orientation="vertical"
              aria-label={
                t(
                  "ui.flowResizeInspectorPanel",
                  "Resize properties panel"
                )
              }
              title={
                `${Math.round(panelSizes.rightWidth)} px · ${t(
                  "ui.flowDoubleClickReset",
                  "Double-click to reset"
                )}`
              }
              onPointerDown={
                event =>
                  panelSizes.beginResize(
                    "right",
                    event
                  )
              }
              onDoubleClick={
                () =>
                  panelSizes.resetWidth(
                    "right"
                  )
              }
            />

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
                  flowExecution.logs
                }
                onClearLogs={
                  flowExecution.clearLogs
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
