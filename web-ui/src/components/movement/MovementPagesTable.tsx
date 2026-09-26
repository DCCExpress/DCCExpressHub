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
  IconEdit,
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
  getMovementEngineState,
  stopMovement,
} from "../../services/movementEngine";

import MovementElapsedBadge from "./MovementElapsedBadge";

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
  const state =
    useMovementRuntimeState(
      page.id
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
      "idle" ||
    state.status ===
      "error";

  const running =
    state.status ===
    "running";



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
        Play runs the dedicated MovementEngine. The engine locks and sets route turnouts automatically after the next leg is clear. Stop ends only this Movement; Abort also requests emergency stop.
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
