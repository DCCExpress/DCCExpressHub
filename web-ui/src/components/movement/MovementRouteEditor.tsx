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
  MovementAction,
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

import {
  loadMovementPlan,
  type MovementPlan,
} from "../../services/movementPlan";

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
    plan,
    setPlan,
  ] =
    useState<
      MovementPlan |
      null
    >(
      null
    );

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
              disposed
            ) {
              return;
            }

            setCatalog(
              blocks
            );

            setSensorCatalog(
              sensors
            );
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

  const routeSignature =
    [
      page.fromBlockId ??
        0,
      ...page.viaBlockIds,
      page.toBlockId ??
        0,
    ].join(
      ":"
    );

  useEffect(
    () => {
      let disposed =
        false;

      if (
        page.fromBlockId ===
          null ||
        page.toBlockId ===
          null
      ) {
        setPlan(
          null
        );

        return () => {
          disposed =
            true;
        };
      }

      setLoading(
        true
      );

      setLoadError(
        null
      );

      void loadMovementPlan(
        page
      )
        .then(
          nextPlan => {
            if (
              !disposed
            ) {
              setPlan(
                nextPlan
              );
            }
          }
        )
        .catch(
          error => {
            if (
              !disposed
            ) {
              setPlan(
                null
              );

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
    [
      routeSignature,
    ]
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

  const updateActionsForResource =
    (
      resourceKey: string,
      actions:
        MovementAction[]
    ): void => {
      onChange({
        ...page,
        actions: [
          ...page.actions.filter(
            action =>
              action.resourceKey !==
              resourceKey
          ),
          ...actions,
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

      const next = [
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

            {
              plan && (
                <Badge
                  variant="light"
                  color={
                    plan.topologyVersion >=
                    3
                      ? "teal"
                      : "yellow"
                  }
                >
                  topology v{
                    plan.topologyVersion
                  }
                </Badge>
              )
            }
          </Group>

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

                  onChange({
                    ...page,
                    viaBlockIds: [
                      ...page.viaBlockIds,
                      Number(
                        viaCandidate
                      ),
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
                              () =>
                                onChange({
                                  ...page,
                                  viaBlockIds:
                                    page.viaBlockIds.filter(
                                      id =>
                                        id !==
                                        blockId
                                    ),
                                })
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
              Building physical movement plan...
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

      {
        plan &&
        plan.topologyVersion <
          3 && (
          <Alert
            color="yellow"
            variant="light"
          >
            Legacy route topology: segments are exact, but turnout passage order is reconstructed from old edge requirements. Generate and save the route graph once to upgrade to topology v3.
          </Alert>
        )
      }

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
              Select a FROM and TO block.
            </Alert>
          )
          : plan && (
            <>
              <div
                className="movement-route-grid-header"
              >
                <Text
                  size="xs"
                  fw={700}
                  c="dimmed"
                >
                  PHYSICAL ROUTE
                </Text>

                <Text
                  size="xs"
                  fw={700}
                  c="dimmed"
                >
                  CONDITION / EVENT
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
                  plan.resources.map(
                    (
                      resource,
                      index
                    ) => {
                      const blockId =
                        resource.blockId;

                      return (
                        <MovementRouteRow
                          key={
                            `${resource.key}:${index}`
                          }
                          resource={
                            resource
                          }
                          index={
                            index
                          }
                          isSource={
                            resource.key ===
                            `block:${page.fromBlockId}`
                          }
                          isDestination={
                            resource.key ===
                            `block:${page.toBlockId}`
                          }
                          rule={
                            blockId ===
                            null
                              ? null
                              : page.blockRules.find(
                                  rule =>
                                    rule.blockId ===
                                    blockId
                                ) ??
                                null
                          }
                          sensorCatalog={
                            sensorCatalog
                          }
                          actions={
                            page.actions.filter(
                              action =>
                                action.resourceKey ===
                                resource.key
                            )
                          }
                          onRuleChange={
                            updateRule
                          }
                          onActionsChange={
                            actions =>
                              updateActionsForResource(
                                resource.key,
                                actions
                              )
                          }
                        />
                      );
                    }
                  )
                }
              </div>
            </>
          )
      }
    </Stack>
  );
}
