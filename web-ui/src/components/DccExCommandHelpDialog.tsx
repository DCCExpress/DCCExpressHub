import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Code,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconExternalLink,
  IconInfoCircle,
  IconSearch,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import AppModal from "./common/AppModal";

type DccExCommandHelpEntry = {
  syntax: string;
  description: string;
  deprecated?: boolean;
  danger?: boolean;
};

type DccExCommandHelpCategory = {
  title: string;
  commands: DccExCommandHelpEntry[];
};

type DccExCommandHelpData = {
  title: string;
  intro: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceNote?: string;
  conventions?: string[];
  categories: DccExCommandHelpCategory[];
};

type Props = {
  opened: boolean;
  onClose: () => void;
  onCommandSelect: (
    command: string
  ) => void;
};

const HELP_URL =
  "/help/dcc-ex-commands.json";

export default function DccExCommandHelpDialog({
  opened,
  onClose,
  onCommandSelect,
}: Props) {
  const [
    data,
    setData,
  ] =
    useState<DccExCommandHelpData | null>(
      null
    );
  const [
    error,
    setError,
  ] =
    useState("");
  const [
    loading,
    setLoading,
  ] =
    useState(false);
  const [
    search,
    setSearch,
  ] =
    useState("");

  useEffect(
    () => {
      if (
        !opened ||
        data
      ) {
        return;
      }

      const controller =
        new AbortController();

      setLoading(true);
      setError("");

      void fetch(
        HELP_URL,
        {
          cache:
            "no-store",
          signal:
            controller.signal,
        }
      )
        .then(
          async response => {
            if (
              !response.ok
            ) {
              throw new Error(
                `HTTP ${response.status}`
              );
            }

            return await response.json() as
              DccExCommandHelpData;
          }
        )
        .then(
          next => {
            setData(
              next
            );
          }
        )
        .catch(
          cause => {
            if (
              controller.signal
                .aborted
            ) {
              return;
            }

            setError(
              cause instanceof Error
                ? cause.message
                : String(
                    cause
                  )
            );
          }
        )
        .finally(
          () => {
            if (
              !controller.signal
                .aborted
            ) {
              setLoading(
                false
              );
            }
          }
        );

      return () => {
        controller.abort();
      };
    },
    [
      opened,
      data,
    ]
  );

  const filteredCategories =
    useMemo(
      () => {
        if (!data) {
          return [];
        }

        const query =
          search
            .trim()
            .toLocaleLowerCase();

        if (!query) {
          return data.categories;
        }

        return data.categories
          .map(
            category => ({
              ...category,
              commands:
                category.commands.filter(
                  command =>
                    command.syntax
                      .toLocaleLowerCase()
                      .includes(
                        query
                      ) ||
                    command.description
                      .toLocaleLowerCase()
                      .includes(
                        query
                      ) ||
                    category.title
                      .toLocaleLowerCase()
                      .includes(
                        query
                      )
                ),
            })
          )
          .filter(
            category =>
              category.commands.length >
              0
          );
      },
      [
        data,
        search,
      ]
    );

  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      title={
        data?.title ??
        "DCC-EX Command Help"
      }
      size="xl"
      centered
      draggable
    >
      <Stack
        gap="sm"
      >
        {
          loading && (
            <Group
              justify="center"
              py="xl"
            >
              <Loader
                size="sm"
              />
            </Group>
          )
        }

        {
          error && (
            <Alert
              color="red"
              icon={
                <IconAlertTriangle
                  size={18}
                />
              }
            >
              Could not load DCC-EX command help: {error}
            </Alert>
          )
        }

        {
          data && (
            <>
              <Stack
                gap={4}
              >
                <Text
                  size="sm"
                >
                  {data.intro}
                </Text>

                {
                  data.conventions?.map(
                    convention => (
                      <Text
                        key={
                          convention
                        }
                        size="xs"
                        c="dimmed"
                      >
                        • {convention}
                      </Text>
                    )
                  )
                }

                <Group
                  gap="xs"
                  wrap="wrap"
                >
                  <Anchor
                    href={
                      data.sourceUrl
                    }
                    target="_blank"
                    rel="noreferrer"
                    size="sm"
                  >
                    <Group
                      gap={4}
                      wrap="nowrap"
                    >
                      <span>
                        {data.sourceLabel}
                      </span>
                      <IconExternalLink
                        size={14}
                      />
                    </Group>
                  </Anchor>
                </Group>

                {
                  data.sourceNote && (
                    <Text
                      size="xs"
                      c="dimmed"
                    >
                      {data.sourceNote}
                    </Text>
                  )
                }
              </Stack>

              <TextInput
                value={search}
                onChange={
                  event =>
                    setSearch(
                      event
                        .currentTarget
                        .value
                    )
                }
                placeholder="Search command or description..."
                leftSection={
                  <IconSearch
                    size={16}
                  />
                }
              />

              <Group
                gap="xs"
                wrap="nowrap"
              >
                <ThemeIcon
                  size="sm"
                  radius="xl"
                  color="yellow"
                  variant="light"
                >
                  <IconInfoCircle
                    size={14}
                  />
                </ThemeIcon>

                <Text
                  size="xs"
                  c="yellow.7"
                >
                  Double-click a command to copy it to the Command field.
                </Text>
              </Group>

              <ScrollArea
                h={520}
                type="auto"
              >
                <Accordion
                  multiple
                  variant="separated"
                >
                  {
                    filteredCategories.map(
                      category => (
                        <Accordion.Item
                          key={
                            category.title
                          }
                          value={
                            category.title
                          }
                        >
                          <Accordion.Control>
                            <Group
                              justify="space-between"
                              wrap="nowrap"
                              pr="sm"
                            >
                              <Text
                                fw={600}
                              >
                                {category.title}
                              </Text>

                              <Badge
                                variant="light"
                                color="gray"
                              >
                                {
                                  category.commands.length
                                }
                              </Badge>
                            </Group>
                          </Accordion.Control>

                          <Accordion.Panel>
                            <Table
                              striped
                              highlightOnHover
                              withTableBorder
                              withColumnBorders
                              verticalSpacing="xs"
                            >
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th
                                    w={330}
                                  >
                                    Command
                                  </Table.Th>
                                  <Table.Th>
                                    Description
                                  </Table.Th>
                                </Table.Tr>
                              </Table.Thead>

                              <Table.Tbody>
                                {
                                  category.commands.map(
                                    command => (
                                      <Table.Tr
                                        key={
                                          command.syntax
                                        }
                                        onDoubleClick={
                                          () => {
                                            onCommandSelect(
                                              command.syntax
                                            );
                                            onClose();
                                          }
                                        }
                                        title="Double-click to copy this command to the Command field"
                                        style={{
                                          cursor:
                                            "pointer",
                                        }}
                                      >
                                        <Table.Td>
                                          <Group
                                            gap="xs"
                                            wrap="wrap"
                                          >
                                            <Code>
                                              {
                                                command.syntax
                                              }
                                            </Code>

                                            {
                                              command.deprecated && (
                                                <Badge
                                                  size="xs"
                                                  color="orange"
                                                  variant="light"
                                                >
                                                  Deprecated
                                                </Badge>
                                              )
                                            }

                                            {
                                              command.danger && (
                                                <Badge
                                                  size="xs"
                                                  color="red"
                                                  variant="light"
                                                >
                                                  Restart / destructive
                                                </Badge>
                                              )
                                            }
                                          </Group>
                                        </Table.Td>

                                        <Table.Td>
                                          <Text
                                            size="sm"
                                          >
                                            {
                                              command.description
                                            }
                                          </Text>
                                        </Table.Td>
                                      </Table.Tr>
                                    )
                                  )
                                }
                              </Table.Tbody>
                            </Table>
                          </Accordion.Panel>
                        </Accordion.Item>
                      )
                    )
                  }
                </Accordion>

                {
                  filteredCategories.length ===
                    0 && (
                    <Text
                      ta="center"
                      c="dimmed"
                      size="sm"
                      py="xl"
                    >
                      No matching commands.
                    </Text>
                  )
                }
              </ScrollArea>
            </>
          )
        }
      </Stack>
    </AppModal>
  );
}
