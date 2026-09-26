import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";

import {
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import i18next from "i18next";

import type {
  AutomationArrivalRule,
  AutomationFlowNodeData,
} from "../../domain/automationFlow";

import {
  loadAutomationBlockCatalog,
  type AutomationBlockOption,
} from "../../services/automationBlockCatalog";

type Props = {
  nodeId: string;
  data: AutomationFlowNodeData;
  onChange: (
    patch:
      Partial<AutomationFlowNodeData>
  ) => void;
  onAddArrivalRule: () => void;
  onChangeArrivalRule: (
    id: string,
    patch:
      Partial<AutomationArrivalRule>
  ) => void;
  onDeleteArrivalRule: (
    id: string
  ) => void;
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

export default function AutomationFlowSmartDispatcherEditor({
  nodeId,
  data,
  onChange,
  onAddArrivalRule,
  onChangeArrivalRule,
  onDeleteArrivalRule,
}: Props) {
  const [
    catalog,
    setCatalog,
  ] =
    useState<
      AutomationBlockOption[]
    >([]);

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<
      string |
      null
    >(null);

  const load =
    useCallback(
      async () => {
        setLoading(
          true
        );

        setError(
          null
        );

        try {
          setCatalog(
            await loadAutomationBlockCatalog()
          );
        } catch (loadError) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : String(loadError)
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      []
    );

  useEffect(
    () => {
      void load();
    },
    [
      load,
    ]
  );

  const selectData =
    useMemo(
      () =>
        catalog.map(
          option => ({
            value:
              String(
                option.id
              ),
            label:
              option.label,
          })
        ),
      [
        catalog,
      ]
    );

  const optionForName =
    useCallback(
      (
        rawName:
          string |
          undefined
      ):
        AutomationBlockOption |
        undefined => {
        const name =
          String(
            rawName ??
            ""
          ).trim();

        if (!name) {
          return undefined;
        }

        return (
          catalog.find(
            option =>
              option.name ===
              name
          ) ??
          catalog.find(
            option =>
              option.name
                .toLocaleLowerCase() ===
              name.toLocaleLowerCase()
          )
        );
      },
      [
        catalog,
      ]
    );

  const nameForValue =
    (
      value:
        string |
        null
    ):
      string |
      null => {
    const id =
      Number(
        value ??
        0
      );

    const option =
      catalog.find(
        item =>
          item.id ===
          id
      );

    return option?.name ??
      null;
  };

  return (
    <>
      <Stack gap="xs">
        <Group
          justify="space-between"
          align="center"
          wrap="nowrap"
        >
          <Text
            size="sm"
            fw={500}
          >
            {
              t(
                "ui.flowRouteBlocks",
                "Route blocks"
              )
            }
          </Text>

          <Tooltip
            label={
              t(
                "ui.reload",
                "Reload"
              )
            }
          >
            <ActionIcon
              size="sm"
              variant="light"
              loading={
                loading
              }
              onClick={
                () =>
                  void load()
              }
            >
              <IconRefresh
                size={15}
              />
            </ActionIcon>
          </Tooltip>
        </Group>

        <Text
          size="xs"
          c="dimmed"
        >
          {
            t(
              "ui.flowRouteBlocksDescription",
              "Choose the route blocks from the current layout."
            )
          }
        </Text>

        {loading &&
          catalog.length ===
            0 && (
          <Group gap="xs">
            <Loader
              size="xs"
            />
            <Text
              size="xs"
              c="dimmed"
            >
              {
                t(
                  "ui.flowLoadingBlocks",
                  "Loading blocks..."
                )
              }
            </Text>
          </Group>
        )}

        {error && (
          <Alert
            color="red"
            py="xs"
          >
            {error}
          </Alert>
        )}

        {!loading &&
          !error &&
          catalog.length ===
            0 && (
          <Alert
            color="yellow"
            py="xs"
          >
            {
              t(
                "ui.flowNoConfiguredBlocks",
                "No blocks were found in the layout."
              )
            }
          </Alert>
        )}

        {(
          data.route ??
          []
        ).map(
          (
            block,
            index
          ) => {
            const selected =
              optionForName(
                block
              );

            return (
              <Group
                key={
                  `${nodeId}-route-${index}`
                }
                gap="xs"
                wrap="nowrap"
                align="flex-end"
              >
                <Select
                  size="xs"
                  label={
                    `#${index + 1}`
                  }
                  placeholder={
                    t(
                      "ui.flowSelectBlock",
                      "Select block"
                    )
                  }
                  value={
                    selected
                      ? String(
                          selected.id
                        )
                      : null
                  }
                  data={
                    selectData
                  }
                  allowDeselect={
                    false
                  }
                  disabled={
                    loading ||
                    catalog.length ===
                      0
                  }
                  onChange={
                    value => {
                      const blockName =
                        nameForValue(
                          value
                        );

                      if (!blockName) {
                        return;
                      }

                      const route = [
                        ...(
                          data.route ??
                          []
                        ),
                      ];

                      route[index] =
                        blockName;

                      onChange({
                        route,
                      });
                    }
                  }
                  style={{
                    flex: 1,
                  }}
                />

                <ActionIcon
                  mb={1}
                  color="red"
                  variant="subtle"
                  disabled={
                    (
                      data.route
                        ?.length ??
                      0
                    ) <= 2
                  }
                  onClick={
                    () =>
                      onChange({
                        route:
                          (
                            data.route ??
                            []
                          ).filter(
                            (
                              _,
                              routeIndex
                            ) =>
                              routeIndex !==
                              index
                          ),
                      })
                  }
                >
                  <IconTrash
                    size={15}
                  />
                </ActionIcon>
              </Group>
            );
          }
        )}

        <Button
          size="xs"
          variant="light"
          leftSection={
            <IconPlus
              size={14}
            />
          }
          disabled={
            loading ||
            catalog.length ===
              0
          }
          onClick={
            () =>
              onChange({
                route: [
                  ...(
                    data.route ??
                    []
                  ),
                  "",
                ],
              })
          }
        >
          {
            t(
              "ui.flowAddRouteBlock",
              "Add route block"
            )
          }
        </Button>
      </Stack>

      <Divider
        label={
          t(
            "ui.flowArrivalConditions",
            "Arrival conditions"
          )
        }
        labelPosition="left"
      />

      <Stack gap="xs">
        {(
          data.arrivalRules ??
          []
        ).map(
          rule => {
            const selected =
              optionForName(
                rule.block
              );

            return (
              <Card
                key={
                  rule.id
                }
                withBorder
                p="xs"
              >
                <Stack gap="xs">
                  <Group
                    align="flex-end"
                    wrap="nowrap"
                  >
                    <Select
                      label={
                        t(
                          "ui.block2",
                          "Block"
                        )
                      }
                      placeholder={
                        t(
                          "ui.flowSelectBlock",
                          "Select block"
                        )
                      }
                      value={
                        selected
                          ? String(
                              selected.id
                            )
                          : null
                      }
                      data={
                        selectData
                      }
                      allowDeselect={
                        false
                      }
                      disabled={
                        loading ||
                        catalog.length ===
                          0
                      }
                      onChange={
                        value => {
                          const blockName =
                            nameForValue(
                              value
                            );

                          if (!blockName) {
                            return;
                          }

                          onChangeArrivalRule(
                            rule.id,
                            {
                              block:
                                blockName,
                            }
                          );
                        }
                      }
                      style={{
                        flex: 1,
                      }}
                    />

                    <NumberInput
                      label={
                        t(
                          "ui.sensorAddress",
                          "Sensor address"
                        )
                      }
                      value={
                        rule.sensor
                      }
                      min={1}
                      max={65535}
                      onChange={
                        value =>
                          onChangeArrivalRule(
                            rule.id,
                            {
                              sensor:
                                Number(
                                  value
                                ) ||
                                1,
                            }
                          )
                      }
                      w={120}
                    />

                    <ActionIcon
                      mb={1}
                      color="red"
                      variant="subtle"
                      onClick={
                        () =>
                          onDeleteArrivalRule(
                            rule.id
                          )
                      }
                    >
                      <IconTrash
                        size={15}
                      />
                    </ActionIcon>
                  </Group>

                  <Switch
                    size="sm"
                    checked={
                      rule.state
                    }
                    label={
                      rule.state
                        ? "ON / true"
                        : "OFF / false"
                    }
                    onChange={
                      event =>
                        onChangeArrivalRule(
                          rule.id,
                          {
                            state:
                              event.currentTarget
                                .checked,
                          }
                        )
                    }
                  />
                </Stack>
              </Card>
            );
          }
        )}

        <Button
          size="xs"
          variant="light"
          leftSection={
            <IconPlus
              size={14}
            />
          }
          disabled={
            loading ||
            catalog.length ===
              0
          }
          onClick={
            onAddArrivalRule
          }
        >
          {
            t(
              "ui.flowAddArrivalCondition",
              "Add arrival condition"
            )
          }
        </Button>
      </Stack>
    </>
  );
}
