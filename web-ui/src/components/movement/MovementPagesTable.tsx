import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  ScrollArea,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";

import {
  showNotification,
} from "@mantine/notifications";

import {
  IconAlertTriangle,
  IconEdit,
  IconPlayerStop,
  IconPlus,
  IconRoute,
  IconTrash,
  IconX,
} from "@tabler/icons-react";

import type {
  MovementDocument,
  MovementPage,
} from "../../domain/movement";

import {
  saveAutomationMovement,
} from "../../services/automationApi";

import {
  loadAutomationBlockCatalog,
  type AutomationBlockOption,
} from "../../services/automationBlockCatalog";

import {
  abortAllMovements,
  getMovementEngineState,
  stopAllMovements,
  stopMovement,
  subscribeMovementEngineState,
  type MovementEngineState,
} from "../../services/movementEngine";

import {
  useCommandCenter,
} from "../../context/CommandCenterContext";

import {
  wsApi,
} from "../../services/wsApi";

import MovementElapsedBadge from "./MovementElapsedBadge";

import {
  useMovementTranslation,
} from "./movementI18n";

import MovementRuntimeControls, {
  movementRuntimeStatusColor,
  useMovementRuntimeState,
} from "./MovementRuntimeControls";

type Props = {
  document:
    MovementDocument;
  onDocumentChange: (
    document:
      MovementDocument
  ) => void;
  onSelectRoute: (
    pageId:
      string | null
  ) => void;
};

function routeLabel(
  page:
    MovementPage,
  catalog:
    AutomationBlockOption[]
): string {
  const name =
    (
      blockId:
        number | null
    ): string => {
      if (
        blockId ===
        null
      ) {
        return "—";
      }

      return (
        catalog.find(
          block =>
            block.id ===
            blockId
        )?.name ??
        `#${blockId}`
      );
    };

  return (
    page.routeRef
      ? [
          page.routeRef.fromBlockId,
          ...page.routeRef.viaBlockIds,
          page.routeRef.toBlockId,
        ]
      : []
  )
    .map(
      name
    )
    .join(
      " → "
    );
}

function MovementCard({
  page,
  catalog,
  onEnabledChange,
  onSelectRoute,
  onDelete,
}: {
  page:
    MovementPage;
  catalog:
    AutomationBlockOption[];
  onEnabledChange: (
    enabled:
      boolean
  ) => void;
  onSelectRoute: () => void;
  onDelete: () => void;
}) {
  const mt =
    useMovementTranslation();

  const state =
    useMovementRuntimeState(
      page.id
    );

  const hasRoute =
    page.routeRef !==
      null;

  const routeIds =
    page.routeRef
      ? [
          page.routeRef.fromBlockId,
          ...page.routeRef.viaBlockIds,
          page.routeRef.toBlockId,
        ]
      : [];

  const routeResolved =
    hasRoute &&
    routeIds.every(
      blockId =>
        catalog.some(
          block =>
            block.id ===
            blockId
        )
    );

  const idle =
    state.status ===
      "idle" ||
    state.status ===
      "error";

  const running =
    state.status ===
    "running";



  return (
    <Card
      withBorder
      radius="sm"
      p="sm"
      style={{
        opacity:
          page.enabled
            ? 1
            : 0.6,
      }}
    >
      <Stack
        gap="xs"
      >
        <Group
          justify="space-between"
          wrap="nowrap"
        >
          <div
            style={{
              minWidth: 0,
              flex: 1,
            }}
          >
            <Group
              gap="xs"
              wrap="wrap"
            >
              <Text
                fw={700}
                size="sm"
                truncate
              >
                {
                  page.name
                }
              </Text>

              <Badge
                size="xs"
                variant="light"
                color={
                  movementRuntimeStatusColor(
                    state
                  )
                }
              >
                {
                  mt(
                    state.status === "running"
                      ? "movementStatusRunning"
                      : state.status === "stopping"
                        ? "movementStatusStopping"
                        : state.status === "error"
                          ? "movementStatusError"
                          : "movementStatusIdle"
                  )
                }
              </Badge>

              <MovementElapsedBadge
                page={
                  page
                }
                state={
                  state
                }
                compact
              />
            </Group>

            <Text
              size="xs"
              c="dimmed"
              truncate
            >
              {
                routeLabel(
                  page,
                  catalog
                )
              }
            </Text>
          </div>

          <Group
            gap={4}
            wrap="nowrap"
          >
            <MovementRuntimeControls
              page={
                page
              }
              routeResolved={
                routeResolved
              }
              showStatus={
                false
              }
            />

            <Tooltip
              withArrow
              label={mt("movementEdit")}
            >
              <ActionIcon
                size="sm"
                variant="light"
                color="violet"
                disabled={
                  running
                }
                onClick={
                  onSelectRoute
                }
              >
                <IconEdit
                  size={15}
                />
              </ActionIcon>
            </Tooltip>

            <Tooltip
              withArrow
              label={mt("movementDelete")}
            >
              <ActionIcon
                size="sm"
                variant="light"
                color="red"
                disabled={
                  running
                }
                onClick={
                  onDelete
                }
              >
                <IconTrash
                  size={15}
                />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Group
          justify="space-between"
          wrap="wrap"
        >
          <Switch
            size="sm"
            color="green"
            checked={
              page.enabled
            }
            label={mt("movementEnabledLabel")}
            onChange={
              event => {
                const enabled =
                  event.currentTarget
                    .checked;

                if (
                  !enabled &&
                  !idle
                ) {
                  stopMovement(
                    page.id
                  );
                }

                onEnabledChange(
                  enabled
                );
              }
            }
          />

          {
            !hasRoute && (
              <Text
                size="xs"
                c="orange"
              >
                {mt("movementRouteEndpointsMissing")}
              </Text>
            )
          }

          {
            hasRoute &&
            !routeResolved && (
              <Text
                size="xs"
                c="red"
              >
                {mt("movementRouteMissingBlock")}
              </Text>
            )
          }

          {
            state.info && (
              <Text
                size="xs"
                c={
                  state.status ===
                    "error"
                    ? "red"
                    : state.status ===
                        "running"
                      ? "blue"
                      : "dimmed"
                }
              >
                {
                  state.info
                }
              </Text>
            )
          }

          {
            state.error && (
              <Text
                size="xs"
                c="red"
              >
                {
                  state.error
                }
              </Text>
            )
          }
        </Group>
      </Stack>
    </Card>
  );
}

export default function MovementPagesTable({
  document,
  onDocumentChange,
  onSelectRoute,
}: Props) {
  const mt =
    useMovementTranslation();

  const commandCenter =
    useCommandCenter();

  const [
    catalog,
    setCatalog,
  ] =
    useState<
      AutomationBlockOption[]
    >([]);

  const [
    runtimeStates,
    setRuntimeStates,
  ] =
    useState<
      Record<
        string,
        MovementEngineState
      >
    >({});

  useEffect(
    () => {
      let disposed =
        false;

      void loadAutomationBlockCatalog()
        .then(
          blocks => {
            if (
              !disposed
            ) {
              setCatalog(
                blocks
              );
            }
          }
        )
        .catch(
          () => {
            // The editor itself will surface a detailed layout load error.
          }
        );

      return () => {
        disposed =
          true;
      };
    },
    []
  );

  const movementSignature =
    document.pages
      .map(
        page =>
          page.id
      )
      .join(
        "\u001f"
      );

  useEffect(
    () => {
      const unsubscribes =
        document.pages.map(
          page =>
            subscribeMovementEngineState(
              page.id,
              state => {
                setRuntimeStates(
                  current => ({
                    ...current,
                    [page.id]:
                      state,
                  })
                );
              }
            )
        );

      setRuntimeStates(
        Object.fromEntries(
          document.pages.map(
            page => [
              page.id,
              getMovementEngineState(
                page.id
              ),
            ]
          )
        )
      );

      return () => {
        for (
          const unsubscribe of
          unsubscribes
        ) {
          unsubscribe();
        }
      };
    },
    [
      movementSignature,
    ]
  );

  const pageCount =
    document.pages.length;

  const enabledCount =
    useMemo(
      () =>
        document.pages.filter(
          page =>
            page.enabled
        ).length,
      [
        document.pages,
      ]
    );

  const activeCount =
    document.pages.filter(
      page => {
        const status =
          runtimeStates[
            page.id
          ]?.status ??
          "idle";

        return (
          status !==
            "idle" &&
          status !==
            "error"
        );
      }
    ).length;

  const stopAll =
    (): void => {
      const sent =
        stopAllMovements();

      showNotification({
        color:
          sent
            ? "yellow"
            : "red",
        title:
          mt("movementStopAll"),
        message:
          sent
            ? mt(
                "movementStoppingCount",
                {
                  count:
                    activeCount,
                }
              )
            : mt(
                "movementCommandFailed"
              ),
      });
    };

  const abortAll =
    (): void => {
      const sent =
        abortAllMovements();

      showNotification({
        color:
          "red",
        title:
          mt("movementAbortAll"),
        message:
          sent
            ? mt(
                "movementAbortedAndEstop",
                {
                  count:
                    activeCount,
                }
              )
            : mt(
                "movementCommandFailed"
              ),
      });
    };

  const toggleEmergencyStop =
    (): void => {
      if (
        !commandCenter.alive ||
        !commandCenter.powerInfo
      ) {
        showNotification({
          color:
            "red",
          title:
            mt("movementEmergencyStop"),
          message:
            mt("movementCommandCenterUnavailable"),
        });

        return;
      }

      const clearing =
        commandCenter.powerInfo
          .emergencyStop ===
        true;

      const sent =
        wsApi.emergencyStop();

      showNotification({
        color:
          sent
            ? clearing
              ? "yellow"
              : "red"
            : "red",
        title:
          clearing
            ? mt("movementClearEstop")
            : mt("movementEmergencyStop"),
        message:
          sent
            ? clearing
              ? mt("movementResumeRequested")
              : mt("movementEstopRequested")
            : mt("movementCommandFailed"),
      });
    };

  const persist =
    async (
      next:
        MovementDocument
    ): Promise<boolean> => {
      const withRuntimeTiming:
        MovementDocument = {
        ...next,
        pages:
          next.pages.map(
            page => {
              const runtime =
                getMovementEngineState(
                  page.id
                );

              if (
                runtime.startedAt ===
                null
              ) {
                return page;
              }

              return {
                ...page,
                startedAt:
                  runtime.startedAt,
                stoppedAt:
                  runtime.stoppedAt,
              };
            }
          ),
      };

      onDocumentChange(
        withRuntimeTiming
      );

      try {
        await saveAutomationMovement(
          withRuntimeTiming
        );

        return true;
      } catch (error) {
        showNotification({
          color: "red",
          title:
            mt("movementSaveFailed"),
          message:
            error instanceof Error
              ? error.message
              : String(
                  error
                ),
        });

        return false;
      }
    };

  const deletePage =
    (
      page:
        MovementPage
    ): void => {
      const runtime =
        getMovementEngineState(
          page.id
        );

      if (
        runtime.status === "running" ||
        runtime.status === "stopping"
      ) {
        showNotification({
          color: "orange",
          title:
            mt("movementRunningTitle"),
          message:
            mt("movementStopBeforeDelete"),
        });

        return;
      }

      if (
        !window.confirm(
          mt(
            "movementDeleteConfirm",
            {
              name:
                page.name,
            }
          )
        )
      ) {
        return;
      }

      const pages =
        document.pages.filter(
          current =>
            current.id !==
            page.id
        );

      void persist({
        ...document,
        pages,
        activePageId:
          document.activePageId ===
            page.id
            ? pages[0]?.id ??
              ""
            : document.activePageId,
      });
    };

  return (
    <Stack
      gap="sm"
      h="100%"
    >
      <Group
        justify="space-between"
        align="center"
        wrap="wrap"
      >
        <Group
          gap="xs"
        >
          <IconRoute
            size={17}
          />

          <Text
            fw={700}
            size="sm"
          >
            {mt("movementSavedMovements")}
          </Text>

          <Badge
            variant="light"
            color="violet"
          >
            {
              pageCount
            }
          </Badge>

          <Badge
            variant="light"
            color={
              enabledCount >
                0
                ? "green"
                : "gray"
            }
          >
            {
              mt(
                "movementEnabledCount",
                {
                  count:
                    enabledCount,
                }
              )
            }
          </Badge>
        </Group>

        <Group
          gap="xs"
          wrap="wrap"
        >
          <Button
            size="xs"
            leftSection={
              <IconPlus
                size={14}
              />
            }
            onClick={
              () =>
                onSelectRoute(
                  null
                )
            }
          >
            {mt("movementNew")}
          </Button>
        </Group>
      </Group>

      <Text
        size="xs"
        c="dimmed"
      >
        {mt("movementPagesHelp")}
      </Text>

      <Group
        gap="xs"
        wrap="wrap"
      >
        <Button
          size="xs"
          variant="light"
          color="yellow"
          leftSection={
            <IconPlayerStop
              size={14}
            />
          }
          disabled={
            activeCount ===
            0
          }
          onClick={
            stopAll
          }
        >
          {mt("movementStopAll")}
        </Button>

        <Button
          size="xs"
          variant="light"
          color="red"
          leftSection={
            <IconX
              size={14}
            />
          }
          disabled={
            activeCount ===
            0
          }
          onClick={
            abortAll
          }
        >
          {mt("movementAbortAll")}
        </Button>

        <Button
          size="xs"
          variant={
            commandCenter.powerInfo
              ?.emergencyStop
              ? "filled"
              : "light"
          }
          color="red"
          leftSection={
            <IconAlertTriangle
              size={14}
            />
          }
          disabled={
            !commandCenter.alive ||
            !commandCenter.powerInfo
          }
          onClick={
            toggleEmergencyStop
          }
        >
          {
            commandCenter.powerInfo
              ?.emergencyStop
              ? mt("movementClearEstop")
              : mt("movementEmergencyStop")
          }
        </Button>
      </Group>

      <ScrollArea
        style={{
          flex: 1,
          minHeight: 0,
        }}
        type="always"
      >
        <Stack
          gap="sm"
        >
          {
            document.pages.map(
              page => (
                <MovementCard
                  key={
                    page.id
                  }
                  page={
                    page
                  }
                  catalog={
                    catalog
                  }
                  onSelectRoute={
                    () =>
                      onSelectRoute(
                        page.id
                      )
                  }
                  onEnabledChange={
                    enabled => {
                      void persist({
                        ...document,
                        pages:
                          document.pages.map(
                            current =>
                              current.id ===
                              page.id
                                ? {
                                    ...current,
                                    enabled,
                                  }
                                : current
                          ),
                      });
                    }
                  }
                  onDelete={
                    () =>
                      deletePage(
                        page
                      )
                  }
                />
              )
            )
          }
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
