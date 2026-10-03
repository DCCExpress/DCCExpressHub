import {
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  TextInput,
  Table,
  Tabs,
  Text,
} from "@mantine/core";

import {
  IconEye,
  IconPlayerPlay,
  IconX,
  IconRefresh,
  IconRoute,
} from "@tabler/icons-react";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  LayoutView,
} from "@/models/editor/core/LayoutView";

import type {
  ClientRouteGraphBuildResult,
} from "@/services/clientRouteGraphBuilder";

import {
  createCurrentClientLayoutSnapshot,
  ensureClientRouteGraph,
} from "@/services/clientRouteGraphCache";

import {
  createMovementRouteKey,
} from "@/services/movementRouteIdentity";

import {
  createMovementPage,
  type MovementDocument,
  type MovementPage,
} from "@/domain/movement";

import {
  applyMovementRouteCandidate,
  loadMovementRouteCandidates,
  type MovementRouteCandidate,
} from "@/services/movementRouteCatalog";

import {
  saveAutomationMovement,
} from "@/services/automationApi";

import AppModal from "@/components/common/AppModal";

import RoutePreviewDialog from "@/components/routes/RoutePreviewDialog";

import {
  testRouteTurnoutStates,
} from "@/services/routeGraphTestExecutor";

import {
  showNotification,
} from "@mantine/notifications";

import {
  useTranslation,
} from "react-i18next";

type RoutesDialogProps = {
  opened: boolean;
  onClose: () => void;
  layout: LayoutView;
  movements: MovementDocument;
  editingMovementId:
    string | null;
  onMovementsChange: (
    document:
      MovementDocument
  ) => void;
  onGenerated?: () => void;
};

function previewMovementPage(
  route:
    ClientRouteGraphBuildResult["routes"][number]
): MovementPage {
  const nodeIndexByName =
    new Map(
      route.solution.nodes.map(
        (node, index) => [
          node.name,
          index,
        ] as const
      )
    );

  const blockPath =
    route.solution.path
      .filter(
        item =>
          item.type ===
          "block"
      )
      .map(
        item => {
          if (item.type !== "block") {
            throw new Error("invalid_route_preview_block");
          }

          return {
            id:
              Number(
                item.block.id
              ),
            nodeIndex:
              nodeIndexByName.get(
                item.node.name
              ) ??
              0,
          };
        }
      );

  const routeKey =
    createMovementRouteKey({
      fromBlockId:
        Number(
          route.fromBlock.id
        ),
      toBlockId:
        Number(
          route.toBlock.id
        ),
      blockPath,
      nodes:
        route.solution.nodes.map(
          node =>
            node.name
        ),
      edgePath:
        route.solution.edges.map(
          edge => ({
            from:
              edge.from.name,
            to:
              edge.to.name,
            locoDirection:
              edge.locoDirection,
            turnoutStates:
              edge.turnoutStates.map(
                state => ({
                  ...state,
                })
              ),
            turnoutPath:
              edge.turnoutPath.map(
                passage => ({
                  elementId:
                    Number(
                      passage.elementId
                    ),
                  turnoutStates:
                    passage.turnoutStates.map(
                      state => ({
                        ...state,
                      })
                    ),
                })
              ),
          })
        ),
      locoDirection:
        route.solution.locoDirection,
    });

  return {
    id:
      "route-preview",
    name:
      route.fromBlock.name +
      " → " +
      route.toBlock.name,
    enabled:
      false,
    speed:
      0,
    startedAt:
      null,
    stoppedAt:
      null,
    routeKey,
    fromBlockId:
      Number(
        route.fromBlock.id
      ),
    viaBlockIds:
      blockPath
        .slice(
          1,
          -1
        )
        .map(
          block =>
            Number(
              block.id
            )
        ),
    toBlockId:
      Number(
        route.toBlock.id
      ),
    blockRules: [],
    resourceEventRules: [],
    safetyRules: [],
    actions: [],
  };
}
function turnoutText(
  states: ReadonlyArray<{
    address: number;
    closed: boolean;
  }>
): string {
  if (states.length === 0) {
    return "—";
  }

  return states
    .map(
      item =>
        `${item.address}:${item.closed ? "C" : "T"}`
    )
    .join(", ");
}

export default function RoutesDialog({
  opened,
  onClose,
  layout,
  movements,
  editingMovementId,
  onMovementsChange,
  onGenerated,
}: RoutesDialogProps) {
  const { t } = useTranslation();

  const [
    result,
    setResult,
  ] = useState<ClientRouteGraphBuildResult | null>(
    null
  );

  const [
    error,
    setError,
  ] = useState<string | null>(
    null
  );

  const [
    generating,
    setGenerating,
  ] = useState(false);

  const [
    testingKey,
    setTestingKey,
  ] = useState<string | null>(
    null
  );

  const [
    previewPage,
    setPreviewPage,
  ] = useState<MovementPage | null>(
    null
  );

  const [
    revisionText,
    setRevisionText,
  ] = useState<string>(
    ""
  );

  const [
    revisionRebuilt,
    setRevisionRebuilt,
  ] = useState(false);

  const [
    fromFilter,
    setFromFilter,
  ] = useState<string | null>(
    null
  );

  const [
    toFilter,
    setToFilter,
  ] = useState<string | null>(
    null
  );

  const [
    assigningRoute,
    setAssigningRoute,
  ] = useState(false);

  const [
    candidates,
    setCandidates,
  ] = useState<MovementRouteCandidate[]>(
    []
  );

  const [
    candidatesLoading,
    setCandidatesLoading,
  ] = useState(false);

  const [
    candidatesError,
    setCandidatesError,
  ] = useState<string | null>(
    null
  );

  const [
    selectFromFilter,
    setSelectFromFilter,
  ] = useState("");

  const [
    selectToFilter,
    setSelectToFilter,
  ] = useState("");

  const [
    movementName,
    setMovementName,
  ] = useState("");

  const [
    cruiseSpeed,
    setCruiseSpeed,
  ] = useState(20);

  const [
    exactRouteFilter,
    setExactRouteFilter,
  ] = useState<string | null>(
    null
  );

  const generate =
    useCallback(
      (
        force = false
      ) => {
        try {
          setGenerating(true);
          setError(null);

          const ensured =
            ensureClientRouteGraph(
              layout,
              {
                force,
              }
            );

          setResult(
            ensured.result
          );

          setRevisionText(
            `T${ensured.topologyRevision} / G${ensured.graphRevision} · ${ensured.rebuilt ? t("ui.rebuilt") : t("ui.cached")}`
          );
          setRevisionRebuilt(
            ensured.rebuilt
          );

          if (ensured.rebuilt) {
            onGenerated?.();
          }
        } catch (buildError) {
          setResult(null);
          setRevisionText("");
          setRevisionRebuilt(false);

          setError(
            buildError instanceof Error
              ? buildError.message
              : String(buildError)
          );
        } finally {
          setGenerating(false);
        }
      },
      [
        layout,
        onGenerated,
        t,
      ]
    );

  const testTurnouts =
    useCallback(
      async (
        key: string,
        label: string,
        turnoutStates: readonly {
          address: number;
          closed: boolean;
        }[]
      ) => {
        if (turnoutStates.length === 0) {
          showNotification({
            color: "blue",
            title: t("ui.routeTest"),
            message: t(
              "ui.routeTestNoTurnoutRequired",
              { value1: label }
            ),
          });

          return;
        }

        try {
          setTestingKey(key);

          const sent =
            await testRouteTurnoutStates(
              layout,
              turnoutStates,
              500
            );

          showNotification({
            color: "green",
            title: t("ui.routeTestSucceeded"),
            message: t(
              "ui.routeTestCommandsSent",
              {
                value1: label,
                value2: sent,
              }
            ),
          });
        } catch (testError) {
          showNotification({
            color: "red",
            title: t("ui.routeTestFailed"),
            message:
              testError instanceof Error
                ? testError.message
                : String(testError),
          });
        } finally {
          setTestingKey(null);
        }
      },
      [
        layout,
        t,
      ]
    );

  useEffect(() => {
    if (!opened) {
      return;
    }

    generate(false);
  }, [
    opened,
    generate,
  ]);

  useEffect(
    () => {
      if (!opened) {
        return;
      }

      let disposed =
        false;

      const editingPage =
        editingMovementId ===
          null
          ? null
          : movements.pages.find(
              page =>
                page.id ===
                  editingMovementId
            ) ??
            null;

      setMovementName(
        editingPage?.name ??
        ""
      );

      setCruiseSpeed(
        Math.max(
          0,
          Math.min(
            126,
            Math.round(
              editingPage?.speed ??
              20
            )
          )
        )
      );

      setExactRouteFilter(
        editingPage?.routeKey?.trim()
          ? editingPage.routeKey
          : null
      );

      setSelectFromFilter(
        ""
      );

      setSelectToFilter(
        ""
      );

      setCandidatesLoading(
        true
      );

      setCandidatesError(
        null
      );

      const candidateDocument: MovementDocument = {
        ...movements,
        pages:
          editingMovementId ===
            null
            ? movements.pages
            : movements.pages.filter(
                page =>
                  page.id !==
                    editingMovementId
              ),
      };

      const layoutSnapshot =
        createCurrentClientLayoutSnapshot(
          layout
        );

      void loadMovementRouteCandidates(
        candidateDocument,
        layoutSnapshot
      )
        .then(
          loaded => {
            if (!disposed) {
              setCandidates(
                loaded
              );

              if (
                editingPage
              ) {
                const current =
                  (
                    editingPage.routeKey.trim()
                      ? loaded.find(
                          candidate =>
                            candidate.key ===
                            editingPage.routeKey
                        )
                      : null
                  ) ??
                  loaded.find(
                    candidate =>
                      candidate.fromBlockId ===
                        editingPage.fromBlockId &&
                      candidate.toBlockId ===
                        editingPage.toBlockId &&
                      candidate.blockPath
                        .slice(
                          1,
                          -1
                        )
                        .map(
                          block =>
                            block.id
                        )
                        .join(
                          ","
                        ) ===
                        editingPage.viaBlockIds.join(
                          ","
                        )
                  );

                if (current) {
                  setSelectFromFilter(
                    current.fromBlockName
                  );

                  setSelectToFilter(
                    current.toBlockName
                  );

                  setExactRouteFilter(
                    current.key
                  );
                } else {
                  setExactRouteFilter(
                    null
                  );

                  const sameEndpoints =
                    loaded.find(
                      candidate =>
                        candidate.fromBlockId ===
                          editingPage.fromBlockId &&
                        candidate.toBlockId ===
                          editingPage.toBlockId
                    );

                  if (sameEndpoints) {
                    setSelectFromFilter(
                      sameEndpoints.fromBlockName
                    );

                    setSelectToFilter(
                      sameEndpoints.toBlockName
                    );
                  }
                }
              }
            }
          }
        )
        .catch(
          loadError => {
            if (!disposed) {
              setCandidates(
                []
              );

              setCandidatesError(
                loadError instanceof Error
                  ? loadError.message
                  : String(
                      loadError
                    )
              );
            }
          }
        )
        .finally(
          () => {
            if (!disposed) {
              setCandidatesLoading(
                false
              );
            }
          }
        );

      return () => {
        disposed =
          true;
      };
    },
    [
      opened,
      editingMovementId,
      movements,
      layout,
    ]
  );

  const nodes =
    result?.graph.nodes ?? [];

  const edges =
    result?.graph.edges ?? [];

  const routes =
    result?.routes ?? [];

  const routeBlockOptions =
    useMemo(
      () => {
        const blocks =
          new Map<
            number,
            string
          >();

        for (const route of routes) {
          blocks.set(
            Number(
              route.fromBlock.id
            ),
            route.fromBlock.name
          );

          blocks.set(
            Number(
              route.toBlock.id
            ),
            route.toBlock.name
          );
        }

        return [
          ...blocks.entries(),
        ]
          .sort(
            (
              [, leftName],
              [, rightName]
            ) =>
              leftName.localeCompare(
                rightName,
                undefined,
                {
                  numeric: true,
                  sensitivity:
                    "base",
                }
              )
          )
          .map(
            ([id, name]) => ({
              value:
                String(
                  id
                ),
              label:
                name,
            })
          );
      },
      [
        routes,
      ]
    );

  const filteredRoutes =
    useMemo(
      () =>
        routes.filter(
          route =>
            (
              fromFilter ===
                null ||
              String(
                route.fromBlock.id
              ) ===
                fromFilter
            ) &&
            (
              toFilter ===
                null ||
              String(
                route.toBlock.id
              ) ===
                toFilter
            )
        ),
      [
        routes,
        fromFilter,
        toFilter,
      ]
    );

  const filteredCandidates =
    useMemo(
      () => {
        const fromNeedle =
          selectFromFilter
            .trim()
            .toLocaleLowerCase();

        const toNeedle =
          selectToFilter
            .trim()
            .toLocaleLowerCase();

        return candidates.filter(
          candidate =>
            (
              exactRouteFilter ===
                null ||
              candidate.key ===
                exactRouteFilter
            ) &&
            (
              !fromNeedle ||
              candidate.fromBlockName
                .toLocaleLowerCase()
                .includes(
                  fromNeedle
                )
            ) &&
            (
              !toNeedle ||
              candidate.toBlockName
                .toLocaleLowerCase()
                .includes(
                  toNeedle
                )
            )
        );
      },
      [
        candidates,
        selectFromFilter,
        selectToFilter,
        exactRouteFilter,
      ]
    );

  const previewCandidate =
    (
      candidate:
        MovementRouteCandidate
    ): MovementPage => {
      const base =
        editingMovementId ===
          null
          ? createMovementPage(
              movementName.trim() ||
              candidate.fromBlockName +
                " → " +
                candidate.toBlockName
            )
          : movements.pages.find(
              page =>
                page.id ===
                  editingMovementId
            ) ??
            createMovementPage(
              movementName.trim() ||
              candidate.fromBlockName +
                " → " +
                candidate.toBlockName
            );

      const next =
        applyMovementRouteCandidate(
          base,
          candidate
        );

      return {
        ...next,
        name:
          movementName.trim() ||
          next.name,
        speed:
          Math.max(
            0,
            Math.min(
              126,
              Math.round(
                cruiseSpeed
              )
            )
          ),
      };
    };

  const assignCandidateToMovement =
    async (
      candidate:
        MovementRouteCandidate
    ): Promise<void> => {
      if (
        candidate.used ||
        candidate.locoDirection ===
          "unknown"
      ) {
        if (
          candidate.locoDirection ===
            "unknown"
        ) {
          showNotification({
            color: "red",
            title:
              t(
                "ui.error"
              ),
            message:
              `${t("ui.direction")}: ${t("ui.unknown")}`,
          });
        }

        return;
      }

      const nextPage =
        previewCandidate(
          candidate
        );

      const existing =
        editingMovementId ===
          null
          ? null
          : movements.pages.find(
              page =>
                page.id ===
                  editingMovementId
            ) ??
            null;

      const next: MovementDocument =
        existing
          ? {
              ...movements,
              pages:
                movements.pages.map(
                  page =>
                    page.id ===
                      existing.id
                      ? nextPage
                      : page
                ),
              activePageId:
                nextPage.id,
            }
          : {
              ...movements,
              pages: [
                ...movements.pages,
                nextPage,
              ],
              activePageId:
                nextPage.id,
            };

      setAssigningRoute(
        true
      );

      try {
        await saveAutomationMovement(
          next
        );

        onMovementsChange(
          next
        );

        showNotification({
          color: "teal",
          title:
            t(
              "ui.routes"
            ),
          message:
            existing
              ? "Movement route updated."
              : "Movement added.",
        });

        onClose();
      } catch (assignError) {
        showNotification({
          color: "red",
          title:
            t(
              "ui.error"
            ),
          message:
            assignError instanceof Error
              ? assignError.message
              : String(
                  assignError
                ),
        });
      } finally {
        setAssigningRoute(
          false
        );
      }
    };

  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      draggable
      title={
        <Group gap="xs">
          <IconRoute size={19} />
          <Text fw={700}>
            {t("ui.routes")}
          </Text>
        </Group>
      }
      size="min(1200px, 94vw)"
      centered
      styles={{
        content: {
          height:
            "min(820px, 92dvh)",
          overflow:
            "hidden",
        },
        body: {
          height:
            "calc(100% - 48px)",
          overflow:
            "hidden",
        },
      }}
    >
      <Stack
        gap="sm"
        h="100%"
        style={{
          minHeight: 0,
        }}
      >
        <Group justify="space-between">
          <Group gap="xs">
            <Badge variant="light">
              {t("ui.segmentsCount", { value1: nodes.length })}
            </Badge>

            <Badge variant="light">
              {t("ui.graphEdgesCount", { value1: edges.length })}
            </Badge>

            <Badge variant="light">
              {t("ui.blockRoutesCount", { value1: routes.length })}
            </Badge>

            {revisionText && (
              <Badge
                variant="outline"
                color={
                  revisionRebuilt
                    ? "teal"
                    : "gray"
                }
              >
                {revisionText}
              </Badge>
            )}
          </Group>

          <Button
            size="xs"
            variant="light"
            leftSection={
              <IconRefresh size={15} />
            }
            loading={generating}
            onClick={() =>
              generate(true)
            }
          >
            {t("ui.regenerate")}
          </Button>
        </Group>

        {error && (
          <Alert
            color="red"
            title={t("ui.graphGenerationError")}
          >
            {error}
          </Alert>
        )}

        {!error && result && (
          <Tabs
            defaultValue="selectRoute"
            keepMounted={false}
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Tabs.List>
              <Tabs.Tab value="selectRoute">
                {t("ui.movementSelectRouteTitle")}
              </Tabs.Tab>

              <Tabs.Tab value="routes">
                {t("ui.routeNetwork")}
              </Tabs.Tab>

              <Tabs.Tab value="graph">
                {t("ui.graph")}
              </Tabs.Tab>

              <Tabs.Tab value="segments">
                {t("ui.segments")}
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel
              value="selectRoute"
              pt="sm"
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <Stack gap="sm">
                <Group
                  gap="sm"
                  align="flex-end"
                  wrap="nowrap"
                >
                  <TextInput
                    label={t("ui.movementName")}
                    value={movementName}
                    onChange={
                      event =>
                        setMovementName(
                          event.currentTarget.value
                        )
                    }
                    placeholder={t("ui.movementName")}
                    style={{
                      flex: 1,
                    }}
                  />

                  <NumberInput
                    label={t("ui.movementCruiseSpeed")}
                    value={cruiseSpeed}
                    onChange={
                      value =>
                        setCruiseSpeed(
                          Math.max(
                            0,
                            Math.min(
                              126,
                              Math.round(
                                typeof value ===
                                  "number"
                                  ? value
                                  : Number(
                                      value
                                    ) ||
                                    0
                              )
                            )
                          )
                        )
                    }
                    min={0}
                    max={126}
                    step={1}
                    clampBehavior="strict"
                    allowDecimal={false}
                    w={170}
                  />
                </Group>

                <Group
                  gap="sm"
                  grow
                  align="flex-end"
                >
                  <TextInput
                    label={t("ui.movementFromFilter")}
                    placeholder={t("ui.movementFilterPlaceholder")}
                    value={selectFromFilter}
                    onChange={
                      event => {
                        setExactRouteFilter(
                          null
                        );

                        setSelectFromFilter(
                          event.currentTarget.value
                        );
                      }
                    }
                    rightSection={
                      selectFromFilter ? (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="gray"
                          px={4}
                          onClick={
                            () => {
                              setExactRouteFilter(
                                null
                              );

                              setSelectFromFilter(
                                ""
                              );
                            }
                          }
                        >
                          <IconX size={14} />
                        </Button>
                      ) : null
                    }
                  />

                  <TextInput
                    label={t("ui.movementToFilter")}
                    placeholder={t("ui.movementFilterPlaceholder")}
                    value={selectToFilter}
                    onChange={
                      event => {
                        setExactRouteFilter(
                          null
                        );

                        setSelectToFilter(
                          event.currentTarget.value
                        );
                      }
                    }
                    rightSection={
                      selectToFilter ? (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="gray"
                          px={4}
                          onClick={
                            () => {
                              setExactRouteFilter(
                                null
                              );

                              setSelectToFilter(
                                ""
                              );
                            }
                          }
                        >
                          <IconX size={14} />
                        </Button>
                      ) : null
                    }
                  />
                </Group>

                {
                  candidatesLoading && (
                    <Text
                      size="sm"
                      c="dimmed"
                    >
                      {t("ui.loading")}
                    </Text>
                  )
                }

                {
                  candidatesError && (
                    <Alert
                      color="red"
                      title={t("ui.error")}
                    >
                      {candidatesError}
                    </Alert>
                  )
                }

                {
                  !candidatesLoading &&
                  !candidatesError && (
                    <ScrollArea.Autosize mah="54dvh">
                      <Table
                        striped
                        highlightOnHover
                        withTableBorder
                        withColumnBorders
                      >
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>
                              {t("ui.path")}
                            </Table.Th>

                            <Table.Th>
                              {t("ui.blockPath")}
                            </Table.Th>

                            <Table.Th>
                              {t("ui.direction")}
                            </Table.Th>

                            <Table.Th>
                              {t("ui.turnouts")}
                            </Table.Th>

                            <Table.Th
                              style={{ width: 110 }}
                            >
                              {t("ui.preview")}
                            </Table.Th>

                            <Table.Th
                              style={{ width: 110 }}
                            />
                          </Table.Tr>
                        </Table.Thead>

                        <Table.Tbody>
                          {
                            filteredCandidates.map(
                              candidate => (
                                <Table.Tr
                                  key={
                                    candidate.key
                                  }
                                >
                                  <Table.Td>
                                    <Stack gap={2}>
                                      <Text
                                        fw={700}
                                        size="sm"
                                      >
                                        {
                                          candidate.fromBlockName
                                        }
                                        {" → "}
                                        {
                                          candidate.toBlockName
                                        }
                                      </Text>

                                      {
                                        candidate.used && (
                                          <Text
                                            size="xs"
                                            c="red"
                                          >
                                            {
                                              candidate.usedByMovementNames.join(
                                                ", "
                                              )
                                            }
                                          </Text>
                                        )
                                      }
                                    </Stack>
                                  </Table.Td>

                                  <Table.Td>
                                    <Text size="sm">
                                      {
                                        candidate.blockPath
                                          .map(
                                            block =>
                                              block.name
                                          )
                                          .join(
                                            " → "
                                          )
                                      }
                                    </Text>

                                    {
                                      candidate.nodePath.length >
                                        0 && (
                                        <Text
                                          size="xs"
                                          c="dimmed"
                                        >
                                          {
                                            candidate.nodePath.join(
                                              " → "
                                            )
                                          }
                                        </Text>
                                      )
                                    }
                                  </Table.Td>

                                  <Table.Td>
                                    <Badge
                                      variant="light"
                                      color={
                                        candidate.locoDirection ===
                                          "forward"
                                          ? "blue"
                                          : candidate.locoDirection ===
                                              "reverse"
                                            ? "orange"
                                            : "gray"
                                      }
                                    >
                                      {
                                        candidate.locoDirection ===
                                          "forward"
                                          ? t("ui.forward")
                                          : candidate.locoDirection ===
                                              "reverse"
                                            ? t("ui.reverse")
                                            : t("ui.unknown")
                                      }
                                    </Badge>
                                  </Table.Td>

                                  <Table.Td>
                                    {
                                      candidate.turnoutCount
                                    }
                                  </Table.Td>

                                  <Table.Td>
                                    <Button
                                      size="xs"
                                      variant="light"
                                      leftSection={
                                        <IconEye size={14} />
                                      }
                                      onClick={
                                        () =>
                                          setPreviewPage(
                                            previewCandidate(
                                              candidate
                                            )
                                          )
                                      }
                                    >
                                      {t("ui.preview")}
                                    </Button>
                                  </Table.Td>

                                  <Table.Td>
                                    <Button
                                      size="xs"
                                      fullWidth
                                      color="teal"
                                      disabled={
                                        candidate.used ||
                                        candidate.locoDirection ===
                                          "unknown" ||
                                        assigningRoute
                                      }
                                      title={
                                        candidate.locoDirection ===
                                          "unknown"
                                          ? `${t("ui.direction")}: ${t("ui.unknown")}`
                                          : undefined
                                      }
                                      loading={
                                        assigningRoute
                                      }
                                      onClick={
                                        () =>
                                          void assignCandidateToMovement(
                                            candidate
                                          )
                                      }
                                    >
                                      {t("ui.select")}
                                    </Button>
                                  </Table.Td>
                                </Table.Tr>
                              )
                            )
                          }
                        </Table.Tbody>
                      </Table>
                    </ScrollArea.Autosize>
                  )
                }
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel
              value="graph"
              pt="sm"
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <ScrollArea.Autosize mah="60dvh">
                <Table
                  striped
                  highlightOnHover
                  withTableBorder
                  withColumnBorders
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        {t("ui.from")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.to")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.turnoutPositions")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.direction")}
                      </Table.Th>

                      <Table.Th
                        style={{ width: 100 }}
                      >
                        {t("ui.test")}
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>

                  <Table.Tbody>
                    {edges.map(
                      (edge, index) => (
                        <Table.Tr
                          key={`${edge.from.name}-${edge.to.name}-${index}`}
                        >
                          <Table.Td>
                            {edge.from.name}
                          </Table.Td>

                          <Table.Td>
                            {edge.to.name}
                          </Table.Td>

                          <Table.Td>
                            {turnoutText(
                              edge.turnoutStates
                            )}
                          </Table.Td>

                          <Table.Td>
                            {edge.locoDirection === "forward"
                              ? t("ui.forward")
                              : edge.locoDirection === "reverse"
                                ? t("ui.reverse")
                                : t("ui.unknown")}
                          </Table.Td>

                          <Table.Td>
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={
                                <IconPlayerPlay size={14} />
                              }
                              loading={
                                testingKey ===
                                `edge-${index}`
                              }
                              disabled={
                                testingKey !== null &&
                                testingKey !== `edge-${index}`
                              }
                              onClick={() =>
                                void testTurnouts(
                                  `edge-${index}`,
                                  `${edge.from.name} → ${edge.to.name}`,
                                  edge.turnoutStates
                                )
                              }
                            >
                              {t("ui.test")}
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      )
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            </Tabs.Panel>

            <Tabs.Panel
              value="segments"
              pt="sm"
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <ScrollArea.Autosize mah="60dvh">
                <Table
                  striped
                  highlightOnHover
                  withTableBorder
                  withColumnBorders
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        {t("ui.segment")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.network")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.trackElements")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.blocks")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.detectors")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.signals")}
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>

                  <Table.Tbody>
                    {nodes.map(node => (
                      <Table.Tr key={node.name}>
                        <Table.Td>
                          {node.name}
                        </Table.Td>

                        <Table.Td>
                          {node.trackName || "—"}
                        </Table.Td>

                        <Table.Td>
                          {node.elementIds.join(", ")}
                        </Table.Td>

                        <Table.Td>
                          {node.blocks
                            .map(block => block.name)
                            .join(", ") || "—"}
                        </Table.Td>

                        <Table.Td>
                          {node.detectors
                            .map(item => item.address)
                            .join(", ") || "—"}
                        </Table.Td>

                        <Table.Td>
                          {node.signals
                            .map(item => item.address)
                            .join(", ") || "—"}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            </Tabs.Panel>

            <Tabs.Panel
              value="routes"
              pt="sm"
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <Stack gap="sm">
                <Group
                  gap="sm"
                  align="flex-end"
                  wrap="wrap"
                >
                  <Select
                    label={t("ui.from")}
                    placeholder={t("ui.from")}
                    data={routeBlockOptions}
                    value={fromFilter}
                    onChange={setFromFilter}
                    clearable
                    searchable
                    w={220}
                  />

                  <Select
                    label={t("ui.to")}
                    placeholder={t("ui.to")}
                    data={routeBlockOptions}
                    value={toFilter}
                    onChange={setToFilter}
                    clearable
                    searchable
                    w={220}
                  />

                  <Badge
                    variant="light"
                    color="gray"
                    mb={6}
                  >
                    {filteredRoutes.length} / {routes.length}
                  </Badge>
                </Group>

                <ScrollArea.Autosize mah="54dvh">
                <Table
                  striped
                  highlightOnHover
                  withTableBorder
                  withColumnBorders
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        {t("ui.from")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.to")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.segmentChain")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.turnoutPositions")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.direction")}
                      </Table.Th>

                      <Table.Th
                        style={{ width: 110 }}
                      >
                        {t("ui.preview")}
                      </Table.Th>

                      <Table.Th
                        style={{ width: 100 }}
                      >
                        {t("ui.test")}
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>

                  <Table.Tbody>
                    {filteredRoutes.map(
                      (route, index) => (
                        <Table.Tr
                          key={`${route.fromBlock.id}-${route.toBlock.id}-${index}`}
                        >
                          <Table.Td>
                            {route.fromBlock.name}
                          </Table.Td>

                          <Table.Td>
                            {route.toBlock.name}
                          </Table.Td>

                          <Table.Td>
                            {route.solution.nodes
                              .map(node => node.name)
                              .join(" → ")}
                          </Table.Td>

                          <Table.Td>
                            {turnoutText(
                              route.solution.turnoutStates
                            )}
                          </Table.Td>

                          <Table.Td>
                            {route.solution.locoDirection === "forward"
                              ? t("ui.forward")
                              : route.solution.locoDirection === "reverse"
                                ? t("ui.reverse")
                                : t("ui.unknown")}
                          </Table.Td>

                          <Table.Td>
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={
                                <IconEye size={14} />
                              }
                              onClick={() =>
                                setPreviewPage(
                                  previewMovementPage(
                                    route
                                  )
                                )
                              }
                            >
                              {t("ui.preview")}
                            </Button>
                          </Table.Td>

                          <Table.Td>
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={
                                <IconPlayerPlay size={14} />
                              }
                              loading={
                                testingKey ===
                                `route-${index}`
                              }
                              disabled={
                                testingKey !== null &&
                                testingKey !== `route-${index}`
                              }
                              onClick={() =>
                                void testTurnouts(
                                  `route-${index}`,
                                  `${route.fromBlock.name} → ${route.toBlock.name}`,
                                  route.solution.turnoutStates
                                )
                              }
                            >
                              {t("ui.test")}
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      )
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
              </Stack>
            </Tabs.Panel>
          </Tabs>
        )}
      </Stack>
      <RoutePreviewDialog
        opened={previewPage !== null}
        onClose={() =>
          setPreviewPage(
            null
          )
        }
        page={previewPage}
        layout={layout}
      />
    </AppModal>
  );
}
