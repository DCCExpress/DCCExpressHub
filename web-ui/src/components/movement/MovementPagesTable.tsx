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

  const route = [
    page.fromBlockId,
    ...page.viaBlockIds,
    page.toBlockId,
  ].map(
    name
  );

  return route.join(
    " → "
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
        Each page is one saved dispatcher movement. Enabled pages are ready for the future runtime engine.
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
                <Card
                  key={
                    page.id
                  }
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
                        }}
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

                      <ActionIcon
                        size="sm"
                        variant="light"
                        color="violet"
                        onClick={
                          () =>
                            onOpenEditor(
                              page.id
                            )
                        }
                      >
                        <IconEdit
                          size={15}
                        />
                      </ActionIcon>
                    </Group>

                    <Switch
                      size="sm"
                      color="green"
                      checked={
                        page.enabled
                      }
                      label="Enabled"
                      onChange={
                        event => {
                          void persist({
                            ...document,
                            pages:
                              document.pages.map(
                                current =>
                                  current.id ===
                                  page.id
                                    ? {
                                        ...current,
                                        enabled:
                                          event.currentTarget.checked,
                                      }
                                    : current
                              ),
                          });
                        }
                      }
                    />
                  </Stack>
                </Card>
              )
            )
          }
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
