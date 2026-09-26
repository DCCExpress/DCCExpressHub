import {
  type DragEvent,
  useState,
} from "react";

import i18next from "i18next";

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
  useComputedColorScheme,
} from "@mantine/core";

import {
  showNotification,
} from "@mantine/notifications";

import {
  IconArrowDown,
  IconArrowUp,
  IconEdit,
  IconGitBranch,
  IconGripVertical,
} from "@tabler/icons-react";

import {
  type AutomationFlowDocument,
  type AutomationFlowPage,
} from "../../domain/automationFlow";

import {
  saveAutomationFlow,
} from "../../services/automationApi";

import {
  abortAutomationFlowPageExecutions,
} from "./useAutomationFlowRuntime";

type Props = {
  document:
    AutomationFlowDocument;
  onDocumentChange: (
    document:
      AutomationFlowDocument
  ) => void;
  onOpenEditor: (
    pageId:
      string
  ) => void;
};

function moveFlowPage(
  pages:
    AutomationFlowPage[],
  fromIndex:
    number,
  toIndex:
    number
): AutomationFlowPage[] {
  if (
    fromIndex < 0 ||
    fromIndex >= pages.length ||
    toIndex < 0 ||
    toIndex >= pages.length ||
    fromIndex ===
    toIndex
  ) {
    return pages;
  }

  const next =
    [...pages];

  const [
    moved,
  ] =
    next.splice(
      fromIndex,
      1
    );

  if (!moved) {
    return pages;
  }

  next.splice(
    toIndex,
    0,
    moved
  );

  return next;
}

function FlowCard({
  page,
  pageIndex,
  pageCount,
  draggedPageId,
  document,
  onDocumentChange,
  onOpenEditor,
  onDragStart,
  onDragEnd,
  onDragOverPage,
  onMoveByOffset,
}: {
  page:
    AutomationFlowPage;
  pageIndex:
    number;
  pageCount:
    number;
  draggedPageId:
    string | null;
  document:
    AutomationFlowDocument;
  onDocumentChange: (
    document:
      AutomationFlowDocument
  ) => void;
  onOpenEditor: (
    pageId:
      string
  ) => void;
  onDragStart: (
    event:
      DragEvent<HTMLDivElement>,
    pageId:
      string
  ) => void;
  onDragEnd: () => void;
  onDragOverPage: (
    event:
      DragEvent<HTMLDivElement>,
    pageId:
      string,
    pageIndex:
      number
  ) => void;
  onMoveByOffset: (
    pageId:
      string,
    offset:
      number
  ) => void;
}) {
  const computedColorScheme =
    useComputedColorScheme(
      "light"
    );

  const cardBackground =
    computedColorScheme ===
    "dark"
      ? "var(--mantine-color-dark-5)"
      : "var(--mantine-color-blue-0)";

  const cardBorderColor =
    computedColorScheme ===
    "dark"
      ? "var(--mantine-color-dark-3)"
      : "var(--mantine-color-blue-2)";

  const saveEnabled =
    (
      enabled:
        boolean
    ): void => {
      const next = {
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
      };

      if (!enabled) {
        abortAutomationFlowPageExecutions(
          page.id,
          "Visual flow page disabled."
        );
      }

      onDocumentChange(
        next
      );

      void saveAutomationFlow(
        next
      ).catch(
        error => {
          showNotification({
            color:
              "red",
            title:
              i18next.t(
                "ui.flowSaveFailed",
                {
                  defaultValue:
                    "Flow save failed",
                }
              ),
            message:
              error instanceof Error
                ? error.message
                : String(
                    error
                  ),
          });
        }
      );
    };

  return (
    <Card
      withBorder
      p="sm"
      draggable
      onDragStart={
        event =>
          onDragStart(
            event,
            page.id
          )
      }
      onDragEnd={
        onDragEnd
      }
      onDragOver={
        event =>
          onDragOverPage(
            event,
            page.id,
            pageIndex
          )
      }
      style={{
        backgroundColor:
          cardBackground,
        borderColor:
          cardBorderColor,
        opacity:
          draggedPageId ===
          page.id
            ? 0.35
            : page.enabled
              ? 1
              : 0.6,
        transition:
          "opacity 120ms ease, transform 120ms ease, background-color 120ms ease, border-color 120ms ease",
      }}
    >
      <Stack gap={8}>
        <Group
          justify="space-between"
          wrap="nowrap"
        >
          <Group
            gap="xs"
            wrap="nowrap"
            style={{
              flex: 1,
              minWidth: 0,
            }}
          >
            <ActionIcon
              variant="subtle"
              color="gray"
              style={{
                cursor:
                  "grab",
                touchAction:
                  "none",
              }}
              aria-label={
                i18next.t(
                  "ui.reorder",
                  {
                    defaultValue:
                      "Reorder",
                  }
                )
              }
            >
              <IconGripVertical
                size={18}
              />
            </ActionIcon>

            <Text
              fw={700}
              size="sm"
              truncate
            >
              {
                page.name
              }
            </Text>
          </Group>

          <Group
            gap={4}
            wrap="nowrap"
          >
            <Tooltip
              withArrow
              label={
                i18next.t(
                  "ui.moveUp",
                  {
                    defaultValue:
                      "Move up",
                  }
                )
              }
            >
              <ActionIcon
                size="sm"
                color="gray"
                variant="light"
                disabled={
                  pageIndex ===
                  0
                }
                onClick={
                  () =>
                    onMoveByOffset(
                      page.id,
                      -1
                    )
                }
              >
                <IconArrowUp
                  size={15}
                />
              </ActionIcon>
            </Tooltip>

            <Tooltip
              withArrow
              label={
                i18next.t(
                  "ui.moveDown",
                  {
                    defaultValue:
                      "Move down",
                  }
                )
              }
            >
              <ActionIcon
                size="sm"
                color="gray"
                variant="light"
                disabled={
                  pageIndex >=
                  pageCount - 1
                }
                onClick={
                  () =>
                    onMoveByOffset(
                      page.id,
                      1
                    )
                }
              >
                <IconArrowDown
                  size={15}
                />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Group
          justify="space-between"
          wrap="nowrap"
        >
          <Switch
            size="sm"
            color="green"
            checked={
              page.enabled
            }
            label={
              i18next.t(
                "ui.enabled",
                {
                  defaultValue:
                    "Enabled",
                }
              )
            }
            onChange={
              event =>
                saveEnabled(
                  event.currentTarget
                    .checked
                )
            }
          />

          <Tooltip
            withArrow
            label={
              i18next.t(
                "ui.edit",
                {
                  defaultValue:
                    "Edit",
                }
              )
            }
          >
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
              aria-label={
                i18next.t(
                  "ui.edit",
                  {
                    defaultValue:
                      "Edit",
                  }
                )
              }
            >
              <IconEdit
                size={15}
              />
            </ActionIcon>
          </Tooltip>
        </Group>


      </Stack>
    </Card>
  );
}

export default function AutomationFlowsTable({
  document,
  onDocumentChange,
  onOpenEditor,
}: Props) {
  const [
    draggedPageId,
    setDraggedPageId,
  ] =
    useState<string | null>(
      null
    );

  const persistDocument =
    (
      next:
        AutomationFlowDocument
    ): void => {
      onDocumentChange(
        next
      );

      void saveAutomationFlow(
        next
      ).catch(
        error => {
          showNotification({
            color:
              "red",
            title:
              i18next.t(
                "ui.flowSaveFailed",
                {
                  defaultValue:
                    "Flow save failed",
                }
              ),
            message:
              error instanceof Error
                ? error.message
                : String(
                    error
                  ),
          });
        }
      );
    };

  const persistPageOrder =
    (
      pages:
        AutomationFlowPage[]
    ): void => {
      persistDocument({
        ...document,
        pages,
      });
    };

  const movePageByOffset =
    (
      pageId:
        string,
      offset:
        number
    ): void => {
      const fromIndex =
        document.pages.findIndex(
          page =>
            page.id ===
            pageId
        );

      const toIndex =
        Math.max(
          0,
          Math.min(
            fromIndex +
              offset,
            document.pages.length -
              1
          )
        );

      const next =
        moveFlowPage(
          document.pages,
          fromIndex,
          toIndex
        );

      if (
        next !==
        document.pages
      ) {
        persistPageOrder(
          next
        );
      }
    };

  const moveDraggedPageToIndex =
    (
      targetIndex:
        number
    ): void => {
      if (
        !draggedPageId
      ) {
        return;
      }

      const fromIndex =
        document.pages.findIndex(
          page =>
            page.id ===
            draggedPageId
        );

      const boundedTargetIndex =
        Math.max(
          0,
          Math.min(
            targetIndex,
            document.pages.length -
              1
          )
        );

      const next =
        moveFlowPage(
          document.pages,
          fromIndex,
          boundedTargetIndex
        );

      if (
        next !==
        document.pages
      ) {
        persistPageOrder(
          next
        );
      }
    };

  const handlePageDragStart =
    (
      event:
        DragEvent<HTMLDivElement>,
      pageId:
        string
    ): void => {
      setDraggedPageId(
        pageId
      );

      event.dataTransfer.effectAllowed =
        "move";

      event.dataTransfer.setData(
        "text/plain",
        pageId
      );
    };

  const clearPageDragState =
    (): void => {
      setDraggedPageId(
        null
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
        <Group gap="xs">
          <IconGitBranch
            size={17}
          />

          <Text
            fw={700}
            size="sm"
          >
            {
              i18next.t(
                "ui.flowSavedFlows",
                {
                  defaultValue:
                    "Saved flows",
                }
              )
            }
          </Text>

          <Badge
            variant="light"
            color="violet"
          >
            {
              document.pages.length
            }
          </Badge>
        </Group>

        <Group gap="md">
          <Button
            size="xs"
            variant="light"
            color="violet"
            leftSection={
              <IconGitBranch
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
            {
              i18next.t(
                "ui.visualAutomation",
                {
                  defaultValue:
                    "Flow editor",
                }
              )
            }
          </Button>
        </Group>
      </Group>

      <Text
        size="xs"
        c="dimmed"
      >
        {
          i18next.t(
            "ui.flowRuntimeEnabledDescription",
            {
              defaultValue:
                "Enabled pages are live. Event and interval inputs can start their connected branches."
            }
          )
        }
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
              (
                page,
                pageIndex
              ) => (
                <FlowCard
                  key={
                    page.id
                  }
                  page={
                    page
                  }
                  pageIndex={
                    pageIndex
                  }
                  pageCount={
                    document.pages.length
                  }
                  draggedPageId={
                    draggedPageId
                  }
                  document={
                    document
                  }
                  onDocumentChange={
                    onDocumentChange
                  }
                  onOpenEditor={
                    onOpenEditor
                  }
                  onDragStart={
                    handlePageDragStart
                  }
                  onDragEnd={
                    clearPageDragState
                  }
                  onDragOverPage={
                    (
                      event,
                      pageId,
                      targetIndex
                    ) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect =
                        "move";

                      if (
                        draggedPageId &&
                        draggedPageId !==
                        pageId
                      ) {
                        moveDraggedPageToIndex(
                          targetIndex
                        );
                      }
                    }
                  }
                  onMoveByOffset={
                    movePageByOffset
                  }
                />
              )
            )
          }

          {
            draggedPageId &&
            document.pages.length >
              0 && (
              <Card
                withBorder
                p="sm"
                onDragOver={
                  event => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect =
                      "move";

                    moveDraggedPageToIndex(
                      document.pages.length -
                        1
                    );
                  }
                }
                style={{
                  borderStyle:
                    "dashed",
                  opacity:
                    0.45,
                }}
              >
                <Text
                  size="sm"
                  c="dimmed"
                  ta="center"
                >
                  {
                    i18next.t(
                      "ui.moveToEnd",
                      {
                        defaultValue:
                          "Move to end",
                      }
                    )
                  }
                </Text>
              </Card>
            )
          }
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
