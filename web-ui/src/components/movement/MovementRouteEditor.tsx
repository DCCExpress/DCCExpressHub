import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Select,
  Stack,
  Text,
} from "@mantine/core";

import {
  IconArrowDown,
  IconArrowUp,
  IconPlus,
  IconRoute,
  IconTrash,
} from "@tabler/icons-react";

import type {
  MovementBlockRule,
  MovementPage,
} from "../../domain/movement";

import {
  loadAutomationBlockCatalog,
  type AutomationBlockOption,
} from "../../services/automationBlockCatalog";

import {
  loadAutomationSensorCatalog,
  type AutomationSensorOption,
} from "../../services/automationSensorCatalog";

import MovementRouteRow from "./MovementRouteRow";

type Props = {
  page:
    MovementPage;
  onChange: (
    page:
      MovementPage
  ) => void;
};

export default function MovementRouteEditor({
  page,
  onChange,
}: Props) {
  const [
    catalog,
    setCatalog,
  ] =
    useState<
      AutomationBlockOption[]
    >([]);

  const [
    sensorCatalog,
    setSensorCatalog,
  ] =
    useState<
      AutomationSensorOption[]
    >([]);

  const [
    loading,
    setLoading,
  ] =
    useState(
      true
    );

  const [
    loadError,
    setLoadError,
  ] =
    useState<string | null>(
      null
    );

  const [
    viaCandidate,
    setViaCandidate,
  ] =
    useState<string | null>(
      null
    );

  useEffect(
    () => {
      let disposed =
        false;

      setLoading(
        true
      );

      setLoadError(
        null
      );

      void Promise.all([
        loadAutomationBlockCatalog(),
        loadAutomationSensorCatalog(),
      ])
        .then(
          ([
            blocks,
            sensors,
          ]) => {
            if (
              !disposed
            ) {
              setCatalog(
                blocks
              );

              setSensorCatalog(
                sensors
              );
            }
          }
        )
        .catch(
          error => {
            if (
              !disposed
            ) {
              setLoadError(
                error instanceof Error
                  ? error.message
                  : String(
                      error
                    )
              );
            }
          }
        )
        .finally(
          () => {
            if (
              !disposed
            ) {
              setLoading(
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
    []
  );

  const selectData =
    useMemo(
      () =>
        catalog.map(
          block => ({
            value:
              String(
                block.id
              ),
            label:
              block.label,
          })
        ),
      [
        catalog,
      ]
    );

  const routeIds =
    useMemo(
      () => {
        const result:
          number[] = [];

        if (
          page.fromBlockId !==
          null
        ) {
          result.push(
            page.fromBlockId
          );
        }

        for (
          const blockId of
          page.viaBlockIds
        ) {
          if (
            !result.includes(
              blockId
            )
          ) {
            result.push(
              blockId
            );
          }
        }

        if (
          page.toBlockId !==
            null &&
          !result.includes(
            page.toBlockId
          )
        ) {
          result.push(
            page.toBlockId
          );
        }

        return result;
      },
      [
        page.fromBlockId,
        page.viaBlockIds,
        page.toBlockId,
      ]
    );

  const routeBlocks =
    routeIds
      .map(
        blockId =>
          catalog.find(
            block =>
              block.id ===
              blockId
          ) ??
          null
      )
      .filter(
        (
          block
        ): block is AutomationBlockOption =>
          block !==
          null
      );

  const updateRule =
    (
      rule:
        MovementBlockRule
    ): void => {
      const exists =
        page.blockRules.some(
          current =>
            current.blockId ===
            rule.blockId
        );

      onChange({
        ...page,
        blockRules:
          exists
            ? page.blockRules.map(
                current =>
                  current.blockId ===
                  rule.blockId
                    ? rule
                    : current
              )
            : [
                ...page.blockRules,
                rule,
              ],
      });
    };

  const moveVia =
    (
      index: number,
      offset: number
    ): void => {
      const target =
        index +
        offset;

      if (
        target < 0 ||
        target >=
          page.viaBlockIds.length
      ) {
        return;
      }

      const next =
        [
          ...page.viaBlockIds,
        ];

      const current =
        next[index];

      const other =
        next[target];

      if (
        current ===
          undefined ||
        other ===
          undefined
      ) {
        return;
      }

      next[index] =
        other;

      next[target] =
        current;

      onChange({
        ...page,
        viaBlockIds:
          next,
      });
    };

  return (
    <Stack
      gap="md"
      className="movement-route-editor"
    >
      <Card
        withBorder
        p="md"
      >
        <Stack
          gap="sm"
        >
          <Group
            gap="xs"
          >
            <IconRoute
              size={18}
            />

            <Text
              fw={700}
            >
              Movement route
            </Text>

            <Badge
              variant="light"
              color="violet"
            >
              FROM / VIA / TO
            </Badge>
          </Group>

          {
            loading && (
              <Group
                gap="xs"
              >
                <Loader
                  size="sm"
                />

                <Text
                  size="sm"
                  c="dimmed"
                >
                  Loading blocks...
                </Text>
              </Group>
            )
          }

          {
            loadError && (
              <Alert
                color="red"
              >
                {
                  loadError
                }
              </Alert>
            )
          }

          <div
            className="movement-route-selector-grid"
          >
            <Select
              label="From block"
              placeholder="Select source"
              searchable
              clearable
              data={
                selectData
              }
              value={
                page.fromBlockId ===
                null
                  ? null
                  : String(
                      page.fromBlockId
                    )
              }
              onChange={
                value => {
                  const blockId =
                    value ===
                    null
                      ? null
                      : Number(
                          value
                        );

                  onChange({
                    ...page,
                    fromBlockId:
                      blockId,
                    viaBlockIds:
                      page.viaBlockIds.filter(
                        id =>
                          id !==
                          blockId
                      ),
                    toBlockId:
                      page.toBlockId ===
                      blockId
                        ? null
                        : page.toBlockId,
                  });
                }
              }
            />

            <Select
              label="To block"
              placeholder="Select destination"
              searchable
              clearable
              data={
                selectData
              }
              value={
                page.toBlockId ===
                null
                  ? null
                  : String(
                      page.toBlockId
                    )
              }
              onChange={
                value => {
                  const blockId =
                    value ===
                    null
                      ? null
                      : Number(
                          value
                        );

                  onChange({
                    ...page,
                    toBlockId:
                      blockId,
                    viaBlockIds:
                      page.viaBlockIds.filter(
                        id =>
                          id !==
                          blockId
                      ),
                    fromBlockId:
                      page.fromBlockId ===
                      blockId
                        ? null
                        : page.fromBlockId,
                  });
                }
              }
            />
          </div>

          <Group
            align="flex-end"
            wrap="wrap"
          >
            <Select
              label="Via block"
              placeholder="Optional checkpoint"
              searchable
              clearable
              data={
                selectData.filter(
                  option => {
                    const id =
                      Number(
                        option.value
                      );

                    return (
                      id !==
                        page.fromBlockId &&
                      id !==
                        page.toBlockId &&
                      !page.viaBlockIds.includes(
                        id
                      )
                    );
                  }
                )
              }
              value={
                viaCandidate
              }
              onChange={
                setViaCandidate
              }
              style={{
                flex:
                  "1 1 260px",
              }}
            />

            <Button
              variant="light"
              leftSection={
                <IconPlus
                  size={15}
                />
              }
              disabled={
                viaCandidate ===
                null
              }
              onClick={
                () => {
                  if (
                    viaCandidate ===
                    null
                  ) {
                    return;
                  }

                  const blockId =
                    Number(
                      viaCandidate
                    );

                  onChange({
                    ...page,
                    viaBlockIds: [
                      ...page.viaBlockIds,
                      blockId,
                    ],
                  });

                  setViaCandidate(
                    null
                  );
                }
              }
            >
              Add VIA
            </Button>
          </Group>

          {
            page.viaBlockIds.length >
              0 && (
              <Stack
                gap={6}
              >
                {
                  page.viaBlockIds.map(
                    (
                      blockId,
                      index
                    ) => {
                      const block =
                        catalog.find(
                          item =>
                            item.id ===
                            blockId
                        );

                      return (
                        <Group
                          key={
                            blockId
                          }
                          gap="xs"
                          wrap="nowrap"
                        >
                          <Badge
                            variant="light"
                            color="violet"
                            style={{
                              flex: 1,
                            }}
                          >
                            {
                              block?.label ??
                              `Block #${blockId}`
                            }
                          </Badge>

                          <ActionIcon
                            variant="light"
                            color="gray"
                            disabled={
                              index ===
                              0
                            }
                            onClick={
                              () =>
                                moveVia(
                                  index,
                                  -1
                                )
                            }
                          >
                            <IconArrowUp
                              size={14}
                            />
                          </ActionIcon>

                          <ActionIcon
                            variant="light"
                            color="gray"
                            disabled={
                              index ===
                              page.viaBlockIds.length -
                                1
                            }
                            onClick={
                              () =>
                                moveVia(
                                  index,
                                  1
                                )
                            }
                          >
                            <IconArrowDown
                              size={14}
                            />
                          </ActionIcon>

                          <ActionIcon
                            variant="light"
                            color="red"
                            onClick={
                              () => {
                                onChange({
                                  ...page,
                                  viaBlockIds:
                                    page.viaBlockIds.filter(
                                      id =>
                                        id !==
                                        blockId
                                    ),
                                });
                              }
                            }
                          >
                            <IconTrash
                              size={14}
                            />
                          </ActionIcon>
                        </Group>
                      );
                    }
                  )
                }
              </Stack>
            )
          }
        </Stack>
      </Card>

      {
        page.fromBlockId ===
          null ||
        page.toBlockId ===
          null
          ? (
            <Alert
              color="blue"
              variant="light"
            >
              Select a FROM and TO block. The vertical dispatcher timeline will be built from the route checkpoints.
            </Alert>
          )
          : (
            <>
              <div
                className="movement-route-grid-header"
              >
                <Text
                  size="xs"
                  fw={700}
                  c="dimmed"
                >
                  ROUTE
                </Text>

                <Text
                  size="xs"
                  fw={700}
                  c="dimmed"
                >
                  ARRIVAL / CONDITION
                </Text>

                <Text
                  size="xs"
                  fw={700}
                  c="dimmed"
                >
                  ACTIONS
                </Text>
              </div>

              <div
                className="movement-route-timeline"
              >
                {
                  routeBlocks.map(
                    (
                      block,
                      index
                    ) => (
                      <MovementRouteRow
                        key={
                          block.id
                        }
                        block={
                          block
                        }
                        index={
                          index
                        }
                        isSource={
                          index ===
                          0
                        }
                        isDestination={
                          index ===
                          routeBlocks.length -
                            1
                        }
                        rule={
                          page.blockRules.find(
                            rule =>
                              rule.blockId ===
                              block.id
                          ) ??
                          null
                        }
                        sensorCatalog={
                          sensorCatalog
                        }
                        onRuleChange={
                          updateRule
                        }
                      />
                    )
                  )
                }
              </div>

              <Alert
                color="gray"
                variant="light"
              >
                This first editor layer shows block checkpoints. The saved route topology will expand the gaps with Segment / Turnout / Signal resources without changing the page model.
              </Alert>
            </>
          )
      }
    </Stack>
  );
}
