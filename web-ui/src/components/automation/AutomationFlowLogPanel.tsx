import {
  ActionIcon,
  Group,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";

import {
  IconTrash,
} from "@tabler/icons-react";

import i18next from "i18next";

export type AutomationFlowLogLine = {
  id: string;
  timestamp: number;
  level:
    | "info"
    | "log"
    | "error";
  message: string;
};

type Props = {
  lines: AutomationFlowLogLine[];
  onClear: () => void;
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

function timeLabel(
  timestamp: number
): string {
  return new Date(
    timestamp
  ).toLocaleTimeString();
}

export default function AutomationFlowLogPanel({
  lines,
  onClear,
}: Props) {
  return (
    <Stack
      gap="xs"
      h="100%"
    >
      <Group
        justify="space-between"
        wrap="nowrap"
      >
        <Text
          size="xs"
          c="dimmed"
        >
          {
            t(
              "ui.flowRuntimeLogDescription",
              "Live event inputs use the last saved flow. Run flows and the page must be enabled. log(...) messages appear here."
            )
          }
        </Text>

        <Tooltip
          label={
            t(
              "ui.flowClearLog",
              "Clear log"
            )
          }
        >
          <ActionIcon
            size="sm"
            variant="light"
            color="gray"
            onClick={
              onClear
            }
          >
            <IconTrash
              size={15}
            />
          </ActionIcon>
        </Tooltip>
      </Group>

      <ScrollArea
        style={{
          flex: 1,
          minHeight: 0,
        }}
      >
        <Stack gap={4}>
          {lines.length ===
          0 ? (
            <Text
              size="xs"
              c="dimmed"
            >
              {
                t(
                  "ui.flowNoLogMessages",
                  "No log messages yet."
                )
              }
            </Text>
          ) : (
            lines.map(
              line => (
                <Group
                  key={
                    line.id
                  }
                  gap="xs"
                  align="flex-start"
                  wrap="nowrap"
                  className={
                    `automation-flow-log-line automation-flow-log-${line.level}`
                  }
                >
                  <Text
                    size="xs"
                    c="dimmed"
                    ff="monospace"
                  >
                    {
                      timeLabel(
                        line.timestamp
                      )
                    }
                  </Text>

                  <Text
                    size="xs"
                    ff="monospace"
                    style={{
                      whiteSpace:
                        "pre-wrap",
                      wordBreak:
                        "break-word",
                    }}
                  >
                    {
                      line.message
                    }
                  </Text>
                </Group>
              )
            )
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
