import {
  useEffect,
  useMemo,
  useState,
} from "react";

import i18next from "i18next";

import {
  ActionIcon,
  Badge,
  Button,
  Group,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";

import {
  showNotification,
} from "@mantine/notifications";

import {
  IconEdit,
  IconGitBranch,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
} from "@tabler/icons-react";

import {
  generateAutomationFlowPageScript,
  type AutomationFlowDocument,
  type AutomationFlowPage,
} from "../../domain/automationFlow";

import {
  saveAutomationFlow,
} from "../../services/automationApi";

import {
  abortClientScript,
  getClientScriptState,
  pauseClientScript,
  resumeClientScript,
  runClientScript,
  ScriptAbortError,
  subscribeClientScriptState,
  type ClientScriptState,
} from "../../services/clientScriptRunner";

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

function executionId(
  pageId: string
): string {
  return `visual-flow-run:${pageId}`;
}

function statusColor(
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

  return "gray";
}

function triggerLabel(
  document:
    AutomationFlowDocument,
  pageId:
    string
): string {
  const trigger =
    document.nodes.find(
      node =>
        node.data.pageId ===
          pageId &&
        node.data.kind ===
          "trigger"
    );

  if (!trigger) {
    return i18next.t("ui.flowTriggerManual", { defaultValue: "Manual" });
  }

  if (
    trigger.data.triggerMode ===
    "interval"
  ) {
    const ms =
      trigger.data.intervalMs ??
      60000;

    if (
      ms %
        60000 ===
      0
    ) {
      return i18next.t("ui.flowEveryMinutes", { defaultValue: "Every {{count}} min", count: ms / 60000 });
    }

    if (
      ms %
        1000 ===
      0
    ) {
      return i18next.t("ui.flowEverySeconds", { defaultValue: "Every {{count}} sec", count: ms / 1000 });
    }

    return i18next.t("ui.flowEveryMilliseconds", { defaultValue: "Every {{count}} ms", count: ms });
  }

  return i18next.t("ui.flowTriggerManual", { defaultValue: "Manual" });
}

function FlowRow({
  page,
  document,
  onDocumentChange,
  onOpenEditor,
}: {
  page:
    AutomationFlowPage;
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
}) {
  const id =
    executionId(
      page.id
    );

  const [
    state,
    setState,
  ] =
    useState<
      ClientScriptState
    >(
      () =>
        getClientScriptState(
          id
        )
    );

  useEffect(
    () =>
      subscribeClientScriptState(
        id,
        setState
      ),
    [
      id,
    ]
  );

  const generated =
    useMemo(
      () =>
        generateAutomationFlowPageScript(
          document,
          page.id
        ),
      [
        document,
        page.id,
      ]
    );

  const nodeCount =
    document.nodes.filter(
      node =>
        node.data.pageId ===
        page.id
    ).length;

  const idle =
    state.status ===
    "idle";

  const running =
    state.status ===
    "running";

  const paused =
    state.status ===
    "paused";

  const start =
    (): void => {
      if (paused) {
        resumeClientScript(
          id
        );
        return;
      }

      if (
        !idle ||
        !generated.code.trim() ||
        generated.code
          .trim()
          .startsWith(
            "//"
          )
      ) {
        return;
      }

      void runClientScript(
        generated.code,
        {
          id,
          name:
            `Flow: ${page.name}`,
          type:
            "visual-flow",
        }
      ).catch(
        error => {
          if (
            error instanceof
            ScriptAbortError
          ) {
            return;
          }

          showNotification({
            color:
              "red",
            title:
              i18next.t(
                "ui.automationFailed"
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

  const toggleEnabled =
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
    <Table.Tr>
      <Table.Td>
        <Group
          gap={4}
          wrap="nowrap"
        >
          <Tooltip
            withArrow
            label={
              paused
                ? i18next.t(
                    "ui.resume"
                  )
                : i18next.t(
                    "ui.start"
                  )
            }
          >
            <ActionIcon
              size="sm"
              variant="light"
              color="green"
              disabled={
                running ||
                generated.code
                  .trim()
                  .startsWith(
                    "//"
                  )
              }
              onClick={
                start
              }
              aria-label={
                paused
                  ? i18next.t(
                      "ui.resume"
                    )
                  : i18next.t(
                      "ui.start"
                    )
              }
            >
              <IconPlayerPlay
                size={15}
              />
            </ActionIcon>
          </Tooltip>

          <Tooltip
            withArrow
            label={
              i18next.t(
                "ui.stop"
              )
            }
          >
            <ActionIcon
              size="sm"
              variant="light"
              color="yellow"
              disabled={
                !running
              }
              onClick={
                () =>
                  pauseClientScript(
                    id
                  )
              }
              aria-label={
                i18next.t(
                  "ui.stop"
                )
              }
            >
              <IconPlayerPause
                size={15}
              />
            </ActionIcon>
          </Tooltip>

          <Tooltip
            withArrow
            label={
              i18next.t(
                "ui.abort"
              )
            }
          >
            <ActionIcon
              size="sm"
              variant="light"
              color="red"
              disabled={
                idle
              }
              onClick={
                () =>
                  abortClientScript(
                    id
                  )
              }
              aria-label={
                i18next.t(
                  "ui.abort"
                )
              }
            >
              <IconPlayerStop
                size={15}
              />
            </ActionIcon>
          </Tooltip>

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
      </Table.Td>      <Table.Td>
        <Badge
          size="sm"
          variant="light"
          color={
            statusColor(
              state
            )
          }
        >
          {
            state.status.toUpperCase()
          }
        </Badge>
      </Table.Td>

      <Table.Td>
        <Text
          fw={600}
          size="sm"
        >
          {
            page.name
          }
        </Text>
      </Table.Td>

      <Table.Td>
        <Switch
          size="xs"
          checked={
            page.enabled
          }
          onChange={
            event =>
              toggleEnabled(
                event.currentTarget
                  .checked
              )
          }
        />
      </Table.Td>

      <Table.Td>
        <Text
          size="xs"
          c="dimmed"
        >
          {
            nodeCount
          }
        </Text>
      </Table.Td>

      <Table.Td>
        <Badge
          size="sm"
          variant="outline"
          color="violet"
        >
          {
            triggerLabel(
              document,
              page.id
            )
          }
        </Badge>
      </Table.Td>


    </Table.Tr>
  );
}

export default function AutomationFlowsTable({
  document,
  onDocumentChange,
  onOpenEditor,
}: Props) {
  return (
    <Stack
      gap="sm"
      h="100%"
    >
      <Group
        justify="space-between"
        align="center"
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

      <ScrollArea
        style={{
          flex: 1,
          minHeight: 0,
        }}
        type="always"
      >
        <Table
          striped
          highlightOnHover
          withTableBorder
          withColumnBorders
          verticalSpacing="xs"
          horizontalSpacing="sm"
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th
                w={150}
              >
                {i18next.t("ui.automationActions", { defaultValue: "Controls" })}
              </Table.Th>
              <Table.Th>
                {i18next.t("ui.automationStatus", { defaultValue: "Status" })}
              </Table.Th>
              <Table.Th>
                {
                  i18next.t(
                    "ui.name"
                  )
                }
              </Table.Th>
              <Table.Th>
                {i18next.t("ui.enabled", { defaultValue: "Enabled" })}
              </Table.Th>
              <Table.Th>
                {i18next.t("ui.flowNodes", { defaultValue: "Nodes" })}
              </Table.Th>
              <Table.Th>
                {i18next.t("ui.flowNodeTrigger", { defaultValue: "Trigger" })}
              </Table.Th>
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {
              document.pages.map(
                page => (
                  <FlowRow
                    key={
                      page.id
                    }
                    page={
                      page
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
                  />
                )
              )
            }
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}
