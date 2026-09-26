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
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconRoute,
} from "@tabler/icons-react";

import {
  createMovementPage,
  type MovementDocument,
  type MovementPage,
} from "../../domain/movement";

import {
  saveAutomationMovement,
} from "../../services/automationApi";

import {
  loadAutomationBlockCatalog,
  type AutomationBlockOption,
} from "../../services/automationBlockCatalog";

import {
  abortClientScript,
  getClientScriptState,
  runClientScript,
  ScriptAbortError,
  subscribeClientScriptState,
  type ClientScriptState,
} from "../../services/clientScriptRunner";

import {
  buildMovementScript,
  movementExecutionId,
} from "../../services/movementRuntime";

import {
  wsApi,
} from "../../services/wsApi";

type Props = {
  document:
    MovementDocument;
  onDocumentChange: (
    document:
      MovementDocument
  ) => void;
  onOpenEditor: (
    pageId:
      string
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

  return [
    page.fromBlockId,
    ...page.viaBlockIds,
    page.toBlockId,
  ]
    .map(
      name
    )
    .join(
      " → "
    );
}

function movementStatusColor(
  state:
    ClientScriptState
): string {
  if (
    state.status ===
    "running"
  ) {
    return "green";
  }

  if (
    state.status ===
    "paused"
  ) {
    return "yellow";
  }

  return state.error
    ? "red"
    : "gray";
}

function MovementCard({
  page,
  catalog,
  onEnabledChange,
  onOpenEditor,
}: {
  page:
    MovementPage;
  catalog:
    AutomationBlockOption[];
  onEnabledChange: (
    enabled:
      boolean
  ) => void;
  onOpenEditor: () => void;
}) {
  const executionId =
    movementExecutionId(
      page.id
    );

  const [
    state,
    setState,
  ] =
    useState<ClientScriptState>(
      () =>
        getClientScriptState(
          executionId
        )
    );

  useEffect(
    () =>
      subscribeClientScriptState(
        executionId,
        setState
      ),
    [
      executionId,
    ]
  );

  const hasRoute =
    page.fromBlockId !==
      null &&
    page.toBlockId !==
      null;

  const routeIds = [
    page.fromBlockId,
    ...page.viaBlockIds,
    page.toBlockId,
  ].filter(
    (
      value
    ): value is number =>
      value !==
      null
  );

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
    "idle";

  const running =
    state.status ===
    "running";

  const run =
    async (): Promise<void> => {
      try {
        const script =
          buildMovementScript(
            page,
            catalog
          );

        await runClientScript(
          script,
          {
            id:
              executionId,
            name:
              page.name,
            type:
              "movement",
          }
        );

        showNotification({
          color: "green",
          title:
            "Movement completed",
          message:
            page.name,
        });
      } catch (error) {
        if (
          error instanceof
          ScriptAbortError
        ) {
          return;
        }

        showNotification({
          color: "red",
          title:
            "Movement failed",
          message:
            error instanceof Error
              ? error.message
              : String(
                  error
                ),
        });
      }
    };

  const stop =
    (): void => {
      abortClientScript(
        executionId,
        "Movement stopped by user."
      );
  };

  const abort =
    (): void => {
      abortClientScript(
        executionId,
        "Movement aborted by user."
      );

      if (
        !wsApi.emergencyStop()
      ) {
        showNotification({
          color: "red",
          title:
            "Emergency stop could not be sent",
          message:
            page.name,
        });
      }
    };

  return (
    <Card
      withBorder
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
              wrap="nowrap"
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
                  movementStatusColor(
                    state
                  )
                }
              >
                {
                  state.status
                }
              </Badge>

              <Badge
                size="xs"
                variant="light"
                color="cyan"
              >
                speed {
                  page.speed
                }
              </Badge>
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
            <Tooltip
              withArrow
              label="Start movement"
            >
              <ActionIcon
                size="sm"
                variant="light"
                color="green"
                disabled={
                  !idle ||
                  !page.enabled ||
                  !routeResolved
                }
                onClick={
                  () =>
                    void run()
                }
              >
                <IconPlayerPlay
                  size={15}
                />
              </ActionIcon>
            </Tooltip>

            <Tooltip
              withArrow
              label="Stop movement"
            >
              <ActionIcon
                size="sm"
                variant="light"
                color="yellow"
                disabled={
                  idle
                }
                onClick={
                  stop
                }
              >
                <IconPlayerStop
                  size={15}
                />
              </ActionIcon>
            </Tooltip>

            <Tooltip
              withArrow
              label="Abort + emergency stop"
            >
              <ActionIcon
                size="sm"
                variant="light"
                color="red"
                disabled={
                  idle
                }
                onClick={
                  abort
                }
              >
                <IconAlertTriangle
                  size={15}
                />
              </ActionIcon>
            </Tooltip>

            <Tooltip
              withArrow
              label="Edit movement"
            >
              <ActionIcon
                size="sm"
                variant="light"
                color="violet"
                disabled={
                  running
                }
                onClick={
                  onOpenEditor
                }
              >
                <IconEdit
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
            label="Enabled"
            onChange={
              event => {
                const enabled =
                  event.currentTarget
                    .checked;

                if (
                  !enabled &&
                  !idle
                ) {
                  stop();
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
                FROM / TO missing
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
                Route references a missing block
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
  onOpenEditor,
}: Props) {
  const [
    catalog,
    setCatalog,
  ] =
    useState<
      AutomationBlockOption[]
    >([]);

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

  const persist =
    async (
      next:
        MovementDocument
    ): Promise<boolean> => {
      onDocumentChange(
        next
      );

      try {
        await saveAutomationMovement(
          next
        );

        return true;
      } catch (error) {
        showNotification({
          color: "red",
          title:
            "Movement save failed",
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

  const createPage =
    (): void => {
      const page =
        createMovementPage(
          `Movement ${pageCount + 1}`
        );

      const next = {
        ...document,
        pages: [
          ...document.pages,
          page,
        ],
        activePageId:
          page.id,
      };

      void persist(
        next
      ).then(
        saved => {
          if (
            saved
          ) {
            onOpenEditor(
              page.id
            );
          }
        }
      );
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
            Saved movements
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
              enabledCount
            } enabled
          </Badge>
        </Group>

        <Group
          gap="xs"
        >
          <Button
            size="xs"
            variant="light"
            color="violet"
            leftSection={
              <IconEdit
                size={14}
              />
            }
            onClick={
              () =>
                onOpenEditor(
                  document.activePageId
                )
            }
          >
            Movement editor
          </Button>

          <Button
            size="xs"
            leftSection={
              <IconPlus
                size={14}
              />
            }
            onClick={
              createPage
            }
          >
            New
          </Button>
        </Group>
      </Group>

      <Text
        size="xs"
        c="dimmed"
      >
        Play runs the saved Movement through SmartDispatcher. Stop ends only this Movement; Abort also requests emergency stop.
      </Text>

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
                  onOpenEditor={
                    () =>
                      onOpenEditor(
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
                />
              )
            )
          }
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
