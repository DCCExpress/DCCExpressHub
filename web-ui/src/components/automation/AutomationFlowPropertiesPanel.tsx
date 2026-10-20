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
  Checkbox,
  Combobox,
  Divider,
  Group,
  NumberInput,
  Pill,
  PillsInput,
  Portal,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  useCombobox,
} from "@mantine/core";

import {
  IconChevronDown,
  IconChevronRight,
  IconTrash,
} from "@tabler/icons-react";

import i18next from "i18next";

import type {
  FunctionBinding,
} from "@domain/types";

import {
  getFunctionBindings,
} from "../../api/domainApi";

import type {
  AutomationFlowNode,
  AutomationFlowNodeData,
} from "../../domain/automationFlow";

import AutomationFlowPayloadEditor from "./AutomationFlowPayloadEditor";
import AutomationFlowTurnoutEditor from "./AutomationFlowTurnoutEditor";
import AutomationFlowBlockEditor from "./AutomationFlowBlockEditor";
import AutomationFlowLocoInputEditor from "./AutomationFlowLocoInputEditor";
import { AudioFileInput } from "../../layout/property-panel/AudioFilePropertyEditor";
import { audioManager } from "../../services/audioManager";
import {
  dispatchAutomationFlowNodeCollapse,
} from "./automationFlowEvents";

import {
  loadAutomationBlockCatalog,
  type AutomationBlockOption,
} from "../../services/automationBlockCatalog";

import {
  loadAutomationSensorCatalog,
  type AutomationSensorOption,
} from "../../services/automationSensorCatalog";

const TRAIN_TYPE_OPTIONS = [
  "passenger",
  "freight",
  "mixed",
  "maintenance",
  "other",
] as const;

type Props = {
  node: AutomationFlowNode | null;
  pageId: string;
  onChange: (
    patch:
      Partial<AutomationFlowNodeData>
  ) => void;
  onDelete: () => void;
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

type TrainEventMultiSelectOption = {
  value: string;
  label: string;
};

type TrainEventMultiSelectProps = {
  label: string;
  description?: string;
  placeholder: string;
  data: TrainEventMultiSelectOption[];
  value: string[];
  onChange: (
    value: string[]
  ) => void;
};

function TrainEventMultiSelect({
  label,
  description,
  placeholder,
  data,
  value,
  onChange,
}: TrainEventMultiSelectProps) {
  const [
    search,
    setSearch,
  ] = useState("");

  const [
    dropdownOpened,
    setDropdownOpened,
  ] = useState(false);

  const combobox =
    useCombobox({
      opened:
        dropdownOpened,
      onOpenedChange:
        opened => {
          if (opened) {
            setDropdownOpened(
              true
            );
          }
        },
      onDropdownClose:
        () => {
          combobox.resetSelectedOption();
        },
      onDropdownOpen:
        () => {
          combobox.updateSelectedOptionIndex(
            "active"
          );
        },
    });

  const normalizedSearch =
    search
      .trim()
      .toLocaleLowerCase();

  const visibleOptions =
    data.filter(
      option =>
        !normalizedSearch ||
        option.label
          .toLocaleLowerCase()
          .includes(
            normalizedSearch
          ) ||
        option.value
          .toLocaleLowerCase()
          .includes(
            normalizedSearch
          )
    );

  const labelByValue =
    new Map(
      data.map(
        option => [
          option.value,
          option.label,
        ]
      )
    );

  const toggleValue = (
    nextValue: string
  ) => {
    onChange(
      value.includes(
        nextValue
      )
        ? value.filter(
            item =>
              item !==
              nextValue
          )
        : [
            ...value,
            nextValue,
          ]
    );

    setSearch("");
  };

  return (
    <>
      {dropdownOpened && (
        <Portal>
          <div
            aria-hidden="true"
            onPointerDown={
              event => {
                event.preventDefault();
                event.stopPropagation();
              }
            }
            onMouseDown={
              event => {
                event.preventDefault();
                event.stopPropagation();
              }
            }
            onClick={
              event => {
                event.preventDefault();
                event.stopPropagation();
              }
            }
            style={{
              position:
                "fixed",
              inset: 0,
              zIndex: 299,
              background:
                "rgba(0, 0, 0, 0.28)",
              cursor:
                "default",
            }}
          />
        </Portal>
      )}

      <Combobox
        store={combobox}
        onOptionSubmit={
          toggleValue
        }
        position="bottom-start"
        withinPortal
        zIndex={300}
      >
      <Combobox.DropdownTarget>
        <PillsInput
          label={label}
          description={
            description
          }
          onClick={
            () =>
              combobox.openDropdown()
          }
          rightSection={
            <Combobox.Chevron />
          }
          rightSectionPointerEvents="none"
        >
          <Pill.Group>
            {value.map(
              selectedValue => (
                <Pill
                  key={
                    selectedValue
                  }
                  withRemoveButton
                  onRemove={
                    () =>
                      onChange(
                        value.filter(
                          item =>
                            item !==
                            selectedValue
                        )
                      )
                  }
                >
                  {labelByValue.get(
                    selectedValue
                  ) ??
                    selectedValue}
                </Pill>
              )
            )}

            <Combobox.EventsTarget>
              <PillsInput.Field
                value={search}
                placeholder={
                  value.length ===
                    0 &&
                  search.length ===
                    0
                    ? placeholder
                    : ""
                }
                onFocus={
                  () =>
                    combobox.openDropdown()
                }
                onChange={
                  event => {
                    setSearch(
                      event
                        .currentTarget
                        .value
                    );
                    combobox.openDropdown();
                    combobox.updateSelectedOptionIndex();
                  }
                }
                onKeyDown={
                  event => {
                    if (
                      event.key ===
                      "Escape"
                    ) {
                      event.preventDefault();
                      event.stopPropagation();

                      setDropdownOpened(
                        false
                      );
                      setSearch(
                        ""
                      );
                      combobox.resetSelectedOption();

                      return;
                    }

                    if (
                      event.key ===
                        "Backspace" &&
                      search.length ===
                        0 &&
                      value.length >
                        0
                    ) {
                      event.preventDefault();

                      onChange(
                        value.slice(
                          0,
                          -1
                        )
                      );
                    }
                  }
                }
              />
            </Combobox.EventsTarget>
          </Pill.Group>
        </PillsInput>
      </Combobox.DropdownTarget>

      <Combobox.Dropdown>
        <Combobox.Options>
          <ScrollArea.Autosize
            mah={240}
            type="auto"
          >
            {visibleOptions.length ===
            0 ? (
              <Combobox.Empty>
                {t(
                  "ui.noResults",
                  "No results"
                )}
              </Combobox.Empty>
            ) : (
              visibleOptions.map(
                option => {
                  const checked =
                    value.includes(
                      option.value
                    );

                  return (
                    <Combobox.Option
                      key={
                        option.value
                      }
                      value={
                        option.value
                      }
                      active={
                        checked
                      }
                    >
                      <Group
                        gap="xs"
                        wrap="nowrap"
                      >
                        <Checkbox
                          size="xs"
                          checked={
                            checked
                          }
                          readOnly
                          tabIndex={
                            -1
                          }
                          style={{
                            pointerEvents:
                              "none",
                          }}
                        />

                        <Text
                          size="sm"
                        >
                          {
                            option.label
                          }
                        </Text>
                      </Group>
                    </Combobox.Option>
                  );
                }
              )
            )}
          </ScrollArea.Autosize>
        </Combobox.Options>

        <Combobox.Footer>
          <Group
            justify="flex-end"
          >
            <Button
              size="compact-xs"
              onPointerDown={
                event =>
                  event.preventDefault()
              }
              onClick={
                () => {
                  setDropdownOpened(
                    false
                  );
                  setSearch(
                    ""
                  );
                  combobox.resetSelectedOption();
                }
              }
            >
              {t(
                "ui.close",
                "Close"
              )}
            </Button>
          </Group>
        </Combobox.Footer>
      </Combobox.Dropdown>
      </Combobox>
    </>
  );
}

export default function AutomationFlowPropertiesPanel({
  node,
  pageId,
  onChange,
  onDelete,
}: Props) {
  const [
    functionBindings,
    setFunctionBindings,
  ] =
    useState<FunctionBinding[]>([]);

  const [trainBlocks, setTrainBlocks] =
    useState<AutomationBlockOption[]>([]);

  const [trainSensors, setTrainSensors] =
    useState<AutomationSensorOption[]>([]);

  useEffect(
    () => {
      let active =
        true;

      void loadAutomationBlockCatalog()
        .then(blocks => {
          if (active) {
            setTrainBlocks(blocks);
          }
        })
        .catch(error => {
          console.warn(
            "[Automation] Could not load block catalog for Train Event",
            error
          );
        });

      void loadAutomationSensorCatalog()
        .then(sensors => {
          if (active) {
            setTrainSensors(sensors);
          }
        })
        .catch(error => {
          console.warn(
            "[Automation] Could not load sensor catalog for Train Event",
            error
          );
        });

      void getFunctionBindings()
        .then(
          bindings => {
            if (active) {
              setFunctionBindings(
                bindings
              );
            }
          }
        )
        .catch(
          error => {
            console.warn(
              "[Automation] Could not load function bindings",
              error
            );
          }
        );

      return () => {
        active =
          false;
      };
    },
    []
  );

  const functionBindingOptions =
    useMemo(
      () =>
        functionBindings.map(
          binding => ({
            value:
              String(
                binding.id
              ),
            label:
              binding.name,
          })
        ),
      [
        functionBindings,
      ]
    );

  if (!node) {
    return (
      <Stack gap="sm">
        <Text
          size="sm"
          c="dimmed"
        >
          {
            t(
              "ui.flowNoNodeSelected",
              "Select a node to edit its properties."
            )
          }
        </Text>

        <Divider
          label={
            t(
              "ui.flowCanvasNodes",
              "Canvas nodes"
            )
          }
          labelPosition="left"
        />

        <Group
          grow
          gap="xs"
        >
          <Button
            size="xs"
            variant="light"
            color="gray"
            leftSection={
              <IconChevronRight
                size={14}
              />
            }
            onClick={
              () =>
                dispatchAutomationFlowNodeCollapse({
                  pageId,
                  collapsed:
                    true,
                })
            }
          >
            {
              t(
                "ui.flowCollapseAll",
                "Collapse all"
              )
            }
          </Button>

          <Button
            size="xs"
            variant="light"
            color="violet"
            leftSection={
              <IconChevronDown
                size={14}
              />
            }
            onClick={
              () =>
                dispatchAutomationFlowNodeCollapse({
                  pageId,
                  collapsed:
                    false,
                })
            }
          >
            {
              t(
                "ui.flowExpandAll",
                "Expand all"
              )
            }
          </Button>
        </Group>

        <Text
          size="xs"
          c="dimmed"
        >
          {
            t(
              "ui.flowCurrentPageOnly",
              "Applies to the current page only."
            )
          }
        </Text>
      </Stack>
    );
  }

  const data =
    node.data;

  return (
    <Stack gap="sm">
      <Group
        justify="space-between"
        wrap="nowrap"
      >
        <Badge
          variant="light"
          color="violet"
        >
          {data.kind}
        </Badge>

        <Tooltip
          label={
            t(
              "ui.delete",
              "Delete"
            )
          }
        >
          <ActionIcon
            color="red"
            variant="light"
            onClick={
              onDelete
            }
          >
            <IconTrash
              size={16}
            />
          </ActionIcon>
        </Tooltip>
      </Group>

      <TextInput
        label={
          t(
            "ui.name",
            "Name"
          )
        }
        value={
          data.label
        }
        onChange={
          event =>
            onChange({
              label:
                event.currentTarget
                  .value,
            })
        }
      />

      {data.kind ===
        "trigger" && (
        <>
          <Select
            label={
              t(
                "ui.flowTriggerMode",
                "Trigger mode"
              )
            }
            value={
              data.triggerMode ===
              "interval"
                ? "interval"
                : "manual"
            }
            data={[
              {
                value:
                  "manual",
                label:
                  t(
                    "ui.flowTriggerManual",
                    "Manual"
                  ),
              },
              {
                value:
                  "interval",
                label:
                  t(
                    "ui.flowTriggerInterval",
                    "Interval"
                  ),
              },
            ]}
            allowDeselect={
              false
            }
            onChange={
              value =>
                onChange({
                  triggerMode:
                    value ===
                    "interval"
                      ? "interval"
                      : "manual",
                })
            }
          />

          {data.triggerMode ===
            "interval" && (
            <NumberInput
              label={
                t(
                  "ui.flowIntervalMs",
                  "Interval (ms)"
                )
              }
              description={
                t(
                  "ui.flowIntervalDescription",
                  "1000 ms = 1 second, 60000 ms = 1 minute"
                )
              }
              value={
                data.intervalMs ??
                60000
              }
              min={1000}
              max={86400000}
              step={1000}
              onChange={
                value =>
                  onChange({
                    intervalMs:
                      Number(
                        value
                      ) ||
                      60000,
                  })
              }
            />
          )}

          <AutomationFlowPayloadEditor
            type={
              data.triggerPayloadType ??
              "json"
            }
            value={
              data.triggerPayloadValue ??
              "{}"
            }
            onChange={
              onChange
            }
          />
        </>
      )}

      {data.kind ===
        "setSpeed" && (
        <NumberInput
          label={
            t(
              "ui.speedLabel",
              "Speed"
            )
          }
          value={
            data.speed ??
            20
          }
          min={0}
          max={126}
          onChange={
            value =>
              onChange({
                speed:
                  Number(
                    value
                  ) ||
                  0,
              })
          }
        />
      )}

      {data.kind ===
        "waitForBlock" && (
        <TextInput
          label={
            t(
              "ui.block2",
              "Block"
            )
          }
          value={
            data.blockName ??
            ""
          }
          onChange={
            event =>
              onChange({
                blockName:
                  event.currentTarget
                    .value,
              })
          }
        />
      )}

      {(data.kind ===
        "sensorInput" ||
        data.kind ===
          "waitForSensor" ||
        data.kind ===
          "setSensor") && (
        <>
          <NumberInput
            label={
              t(
                "ui.sensorAddress",
                "Sensor address"
              )
            }
            value={
              data.sensorAddress ??
              1
            }
            min={1}
            max={65535}
            onChange={
              value =>
                onChange({
                  sensorAddress:
                    Number(
                      value
                    ) ||
                    1,
                })
            }
          />

          <Select
            label={
              data.kind ===
              "sensorInput"
                ? t(
                    "ui.flowSensorTriggerState",
                    "Trigger state"
                  )
                : data.kind ===
                  "waitForSensor"
                  ? t(
                      "ui.flowExpectedState",
                      "Expected state"
                    )
                  : t(
                      "ui.flowStateToSet",
                      "State to set"
                    )
            }
            value={
              data.sensorState !==
              false
                ? "true"
                : "false"
            }
            data={[
              {
                value:
                  "true",
                label:
                  "ON / true",
              },
              {
                value:
                  "false",
                label:
                  "OFF / false",
              },
            ]}
            allowDeselect={
              false
            }
            onChange={
              value =>
                onChange({
                  sensorState:
                    value !==
                    "false",
                })
            }
          />

          {data.kind ===
            "sensorInput" && (
            <Text
              size="xs"
              c="dimmed"
            >
              {
                t(
                  "ui.flowSensorInputDescription",
                  "Every matching sensorChanged event injects this branch once while the page is enabled."
                )
              }
            </Text>
          )}
        </>
      )}

      {data.kind ===
        "blockInput" && (
        <>
          <AutomationFlowBlockEditor
            data={
              data
            }
            onChange={
              onChange
            }
          />

          <Text
            size="xs"
            c="dimmed"
          >
            {
              t(
                "ui.flowBlockInputDescription",
                "Runs when the selected block state changes. The new block state is passed in payload."
              )
            }
          </Text>
        </>
      )}

      {data.kind ===
        "turnoutInput" && (
        <>
          <AutomationFlowTurnoutEditor
            data={
              data
            }
            onChange={
              onChange
            }
            inputOnly
          />

          <Text
            size="xs"
            c="dimmed"
          >
            {
              t(
                "ui.flowTurnoutInputDescription",
                "Runs when any DCC address belonging to this turnout changes. The changed address and state are passed in payload."
              )
            }
          </Text>
        </>
      )}

      {data.kind ===
        "setTurnout" && (
        <AutomationFlowTurnoutEditor
          data={
            data
          }
          onChange={
            onChange
          }
        />
      )}

      {(data.kind ===
        "basicAccessoryInput" ||
        data.kind ===
          "extendedAccessoryInput") && (
        <>
          <NumberInput
            label={
              t(
                "ui.flowAccessoryAddress",
                "Accessory address"
              )
            }
            value={
              data.accessoryAddress ??
              1
            }
            min={1}
            max={2048}
            onChange={
              value =>
                onChange({
                  accessoryAddress:
                    Number(
                      value
                    ) ||
                    1,
                })
            }
          />

          <Text
            size="xs"
            c="dimmed"
          >
            {
              data.kind ===
              "extendedAccessoryInput"
                ? t(
                    "ui.flowExtendedAccessoryInputDescription",
                    "Runs whenever this Extended Accessory aspect changes. payload contains eventType, address and aspect."
                  )
                : t(
                    "ui.flowBasicAccessoryInputDescription",
                    "Runs whenever this Basic Accessory state changes. payload contains eventType, address and active."
                  )
            }
          </Text>
        </>
      )}

      {data.kind ===
        "trainEventInput" && (
        <>
          <TrainEventMultiSelect
            label={t(
              "ui.flowTrainEventTypes",
              "Event types"
            )}
            description={t(
              "ui.flowTrainEventAllHint",
              "Empty selection means All."
            )}
            placeholder={t(
              "ui.flowAll",
              "All"
            )}
            data={[
              "arrival",
              "arrived",
              "afterArrived",
              "beforeLeave",
              "beforeStart",
              "starting",
              "leave",
              "afterLeave",
              "approach",
              "enter",
            ].map(value => ({
              value,
              label: value,
            }))}
            value={
              data.trainEventTypes ??
              []
            }
            onChange={
              value =>
                onChange({
                  trainEventTypes:
                    value,
                })
            }
          />

          <TrainEventMultiSelect
            label={t(
              "ui.flowTrainTypes",
              "Train types"
            )}
            description={t(
              "ui.flowTrainEventAllHint",
              "Empty selection means All."
            )}
            placeholder={t(
              "ui.flowAll",
              "All"
            )}
            data={TRAIN_TYPE_OPTIONS.map(
              value => ({
                value,
                label:
                  i18next.t(
                    `locodialog.trainTypes.${value}`,
                    {
                      defaultValue:
                        value,
                    }
                  ),
              })
            )}
            value={
              data.trainTypeFilters ??
              []
            }
            onChange={
              value =>
                onChange({
                  trainTypeFilters:
                    value,
                })
            }
          />

          <TrainEventMultiSelect
            label={t(
              "ui.flowTrainResourceTypes",
              "Resource types"
            )}
            description={t(
              "ui.flowTrainEventAllHint",
              "Empty selection means All."
            )}
            placeholder={t(
              "ui.flowAll",
              "All"
            )}
            data={[
              {
                value: "block",
                label: t(
                  "ui.flowTrainResourceBlock",
                  "Block"
                ),
              },
              {
                value: "segment",
                label: t(
                  "ui.flowTrainResourceSegment",
                  "Segment"
                ),
              },
              {
                value: "turnout",
                label: t(
                  "ui.flowTrainResourceTurnout",
                  "Turnout"
                ),
              },
            ]}
            value={
              data.trainResourceTypes ??
              []
            }
            onChange={
              value =>
                onChange({
                  trainResourceTypes:
                    value,
                })
            }
          />

          <TrainEventMultiSelect
            label={t(
              "ui.flowTrainBlocks",
              "Blocks"
            )}
            description={t(
              "ui.flowTrainEventAllHint",
              "Empty selection means All."
            )}
            placeholder={t(
              "ui.flowAll",
              "All"
            )}
            data={trainBlocks.map(
              block => ({
                value: String(
                  block.id
                ),
                label:
                  block.label,
              })
            )}
            value={(
              data.trainBlockFilters ??
              []
            ).map(String)}
            onChange={
              value =>
                onChange({
                  trainBlockFilters:
                    value
                      .map(
                        item =>
                          Number(
                            item
                          )
                      )
                      .filter(
                        item =>
                          Number.isInteger(
                            item
                          ) &&
                          item >
                            0
                      ),
                })
            }
          />

          <TrainEventMultiSelect
            label={t(
              "ui.flowTrainSensors",
              "Sensors"
            )}
            description={t(
              "ui.flowTrainEventAllHint",
              "Empty selection means All."
            )}
            placeholder={t(
              "ui.flowAll",
              "All"
            )}
            data={trainSensors.map(
              sensor => ({
                value: String(
                  sensor.address
                ),
                label:
                  sensor.label,
              })
            )}
            value={(
              data.trainSensorFilters ??
              []
            ).map(String)}
            onChange={
              value =>
                onChange({
                  trainSensorFilters:
                    value
                      .map(
                        item =>
                          Number(
                            item
                          )
                      )
                      .filter(
                        item =>
                          Number.isInteger(
                            item
                          ) &&
                          item >
                            0
                      ),
                })
            }
          />

          <TextInput
            label={t("ui.flowTrainResources", "Resources")}
            description={t(
              "ui.flowTrainResourcesHint",
              "Optional comma-separated resource names/keys. Empty means All."
            )}
            placeholder={t("ui.flowAll", "All")}
            value={(data.trainResourceFilters ?? []).join(", ")}
            onChange={event => {
              const value = event.currentTarget.value;
              onChange({
                trainResourceFilters: value
                  .split(",")
                  .map(item => item.trim())
                  .filter(Boolean),
              });
            }}
          />

          <TextInput
            label={t("ui.flowTrainLocos", "Locomotives")}
            description={t(
              "ui.flowTrainLocosHint",
              "Optional comma-separated DCC addresses. Empty means All."
            )}
            placeholder={t("ui.flowAll", "All")}
            value={(data.trainLocoAddressFilters ?? []).join(", ")}
            onChange={event => {
              const value = event.currentTarget.value;
              onChange({
                trainLocoAddressFilters: value
                  .split(",")
                  .map(item => Number(item.trim()))
                  .filter(item => Number.isInteger(item) && item > 0 && item <= 10239),
              });
            }}
          />

          <Text size="xs" c="dimmed">
            {t(
              "ui.flowTrainEventPayloadHint",
              "Matching TrainEvent data is passed to the connected branch as payload."
            )}
          </Text>
        </>
      )}

      {data.kind ===
        "locoInput" && (
        <AutomationFlowLocoInputEditor
          data={
            data
          }
          onChange={
            onChange
          }
        />
      )}

      {data.kind ===
        "setAccessory" && (
        <>
          <NumberInput
            label={
              t(
                "ui.flowAccessoryAddress",
                "Accessory address"
              )
            }
            value={
              data.accessoryAddress ??
              1
            }
            min={1}
            max={2048}
            onChange={
              value =>
                onChange({
                  accessoryAddress:
                    Number(
                      value
                    ) ||
                    1,
                })
            }
          />

          <Select
            label={
              t(
                "ui.flowAccessoryState",
                "Accessory state"
              )
            }
            value={
              data.accessoryActive !==
              false
                ? "true"
                : "false"
            }
            data={[
              {
                value:
                  "true",
                label:
                  "ON / active",
              },
              {
                value:
                  "false",
                label:
                  "OFF / inactive",
              },
            ]}
            allowDeselect={
              false
            }
            onChange={
              value =>
                onChange({
                  accessoryActive:
                    value !==
                    "false",
                })
            }
          />
        </>
      )}

      {data.kind ===
        "setExtendedAccessory" && (
        <>
          <NumberInput
            label={
              t(
                "ui.flowAccessoryAddress",
                "Accessory address"
              )
            }
            value={
              data.accessoryAddress ??
              1
            }
            min={1}
            max={2048}
            onChange={
              value =>
                onChange({
                  accessoryAddress:
                    Number(
                      value
                    ) ||
                    1,
                })
            }
          />

          <NumberInput
            label={
              t(
                "ui.flowExtendedAccessoryAspect",
                "Aspect"
              )
            }
            description={
              t(
                "ui.flowExtendedAccessoryAspectDescription",
                "DCC Extended Accessory aspect value (0..255)."
              )
            }
            value={
              data.accessoryAspect ??
              0
            }
            min={0}
            max={255}
            onChange={
              value =>
                onChange({
                  accessoryAspect:
                    Math.max(
                      0,
                      Math.min(
                        255,
                        Number(
                          value
                        ) ||
                        0
                      )
                    ),
                })
            }
          />
        </>
      )}

      {data.kind ===
        "setLoco" && (
        <>
          <AutomationFlowLocoInputEditor
            data={
              data
            }
            onChange={
              onChange
            }
            mode="output"
          />

          <NumberInput
            label={
              t(
                "ui.speedLabel",
                "Speed"
              )
            }
            value={
              data.speed ??
              20
            }
            min={0}
            max={126}
            onChange={
              value =>
                onChange({
                  speed:
                    Number(
                      value
                    ) ||
                    0,
                })
            }
          />

          <Select
            label={
              t(
                "ui.flowDirection",
                "Direction"
              )
            }
            value={
              data.locoDirection ===
              "reverse"
                ? "reverse"
                : "forward"
            }
            data={[
              {
                value:
                  "forward",
                label:
                  t(
                    "ui.forward",
                    "Forward"
                  ),
              },
              {
                value:
                  "reverse",
                label:
                  t(
                    "ui.reverse",
                    "Reverse"
                  ),
              },
            ]}
            allowDeselect={
              false
            }
            onChange={
              value =>
                onChange({
                  locoDirection:
                    value ===
                    "reverse"
                      ? "reverse"
                      : "forward",
                })
            }
          />
        </>
      )}

      {(data.kind ===
          "getBlock" ||
        data.kind ===
          "setBlock" ||
        data.kind ===
          "clearBlock" ||
        data.kind ===
          "getBlockTargetLoco" ||
        data.kind ===
          "setBlockTargetLoco" ||
        data.kind ===
          "clearBlockTargetLoco") && (
        <>
          <AutomationFlowBlockEditor
            data={
              data
            }
            onChange={
              onChange
            }
          />

          {(data.kind ===
              "getBlock" ||
            data.kind ===
              "getBlockTargetLoco") && (
            <Alert
              color="teal"
              py="xs"
            >
              {
                t(
                  "ui.flowBlockGetterPayloadHint",
                  "Writes the locomotive address to payload.locoAddress and passes the payload onward."
                )
              }
            </Alert>
          )}

          {data.kind ===
            "setBlock" && (
            <AutomationFlowLocoInputEditor
              data={
                data
              }
              onChange={
                onChange
              }
              mode="output"
            />
          )}

          {data.kind ===
            "setBlockTargetLoco" && (
            <Alert
              color="blue"
              py="xs"
            >
              {
                t(
                  "ui.flowBlockSetterPayloadHint",
                  "Uses payload.locoAddress as the locomotive address."
                )
              }
            </Alert>
          )}
        </>
      )}

      {data.kind ===
        "locoFunction" && (
        <>
          <Alert
            color="blue"
            py="xs"
          >
            {
              t(
                "ui.flowLocoFunctionPayloadHint",
                "Uses payload.locoAddress as the locomotive address and passes payload on unchanged."
              )
            }
          </Alert>

          <Select
            label={
              t(
                "ui.flowFunctionBinding",
                "Function binding"
              )
            }
            data={
              functionBindingOptions
            }
            value={
              data.functionBindingId ===
                undefined ||
              data.functionBindingId ===
                null
                ? null
                : String(
                    data.functionBindingId
                  )
            }
            searchable
            clearable
            onChange={
              value =>
                onChange({
                  functionBindingId:
                    value ===
                      null
                      ? null
                      : Number(
                          value
                        ),
                })
            }
          />

          <Select
            label="Function mode"
            data={[
              { value: "momentary", label: "Momentary (pulse)" },
              { value: "on", label: "ON" },
              { value: "off", label: "OFF" },
            ]}
            value={data.functionMode === "on" || data.functionMode === "off"
              ? data.functionMode
              : "momentary"}
            onChange={value => onChange({
              functionMode: value === "on" || value === "off" ? value : "momentary",
            })}
            allowDeselect={false}
          />

          {(data.functionMode === undefined || data.functionMode === "momentary") && (
          <NumberInput
            label={
              t(
                "ui.flowPulseMs",
                "Pulse (ms)"
              )
            }
            description={
              t(
                "ui.flowLocoFunctionPulseDescription",
                "Function ON, wait this long, then OFF."
              )
            }
            value={
              data.pulseMs ??
              700
            }
            min={1}
            max={600000}
            onChange={
              value =>
                onChange({
                  pulseMs:
                    Number(
                      value
                    ) ||
                    1,
                })
            }
          />
          )}
        </>
      )}

      {data.kind ===
        "horn" && (
        <>
          <Select
            label={
              t(
                "ui.flowFunctionBinding",
                "Function binding"
              )
            }
            data={
              functionBindingOptions
            }
            value={
              data.functionBindingId ===
                undefined ||
              data.functionBindingId ===
                null
                ? null
                : String(
                    data.functionBindingId
                  )
            }
            searchable
            clearable
            onChange={
              value =>
                onChange({
                  functionBindingId:
                    value ===
                      null
                      ? null
                      : Number(
                          value
                        ),
                })
            }
          />

          <NumberInput
            label={
              t(
                "ui.flowPulseMs",
                "Pulse (ms)"
              )
            }
            value={
              data.pulseMs ??
              700
            }
            min={1}
            max={600000}
            onChange={
              value =>
                onChange({
                  pulseMs:
                    Number(
                      value
                    ) ||
                    1,
                })
            }
          />
        </>
      )}

      {data.kind ===
        "delay" && (
        <NumberInput
          label={
            t(
              "ui.flowDelayMs",
              "Delay (ms)"
            )
          }
          value={
            data.delayMs ??
            500
          }
          min={0}
          max={600000}
          onChange={
            value =>
              onChange({
                delayMs:
                  Number(
                    value
                  ) ||
                  0,
              })
          }
        />
      )}

      {data.kind ===
        "playAudio" && (
        <>
          <AudioFileInput
            label={
              t(
                "ui.audioFile",
                "Audio file"
              )
            }
            description={
              t(
                "ui.flowAudioFileDescription",
                "Choose an audio file from the Hub emulated SD card."
              )
            }
            value={
              String(
                data.audioName ??
                ""
              )
            }
            onChange={
              audioName =>
                onChange({
                  audioName,
                })
            }
            onTest={
              previewSource => {
                const source =
                  String(
                    previewSource ??
                    data.audioName ??
                    ""
                  ).trim();

                if (source) {
                  const testSource =
                    source.startsWith("/") ||
                    source.includes(".")
                      ? source
                      : `${source}.mp3`;

                  audioManager.play(
                    testSource
                  );
                }
              }
            }
          />

          <Switch
            label={
              t(
                "ui.flowWaitForAudioEnd",
                "Wait for audio to finish"
              )
            }
            description={
              t(
                "ui.flowWaitForAudioEndDescription",
                "When enabled, the next node runs only after audio playback ends."
              )
            }
            checked={
              data.audioWaitForEnd ===
              true
            }
            onChange={
              event =>
                onChange({
                  audioWaitForEnd:
                    event.currentTarget
                      .checked,
                })
            }
          />
        </>
      )}

      {data.kind === "function" && (
        <Textarea
          label="JavaScript function body"
          description="Input: payload. Return a value for the next node; return null to stop."
          value={data.functionCode ?? "return payload;"}
          minRows={12}
          autosize
          maxRows={24}
          styles={{ input: { fontFamily: "monospace" } }}
          onChange={event => onChange({ functionCode: event.currentTarget.value })}
        />
      )}

      {data.kind === "switch" && (
        <Stack gap="xs">
          <Text size="sm" c="dimmed">Strict equality: payload === case value. First match wins; otherwise is used if no rule matches.</Text>
          {(data.switchRules ?? []).map((rule, index) => (
            <Group key={rule.id} gap="xs" wrap="nowrap">
              <Text size="xs" w={48}>Case {index + 1}</Text>
              <TextInput
                style={{ flex: 1 }}
                value={rule.value}
                placeholder="OK"
                onChange={event => onChange({
                  switchRules: (data.switchRules ?? []).map(item =>
                    item.id === rule.id ? { ...item, value: event.currentTarget.value } : item),
                })}
              />
              <Button size="xs" variant="light" color="red"
                onClick={() => onChange({ switchRules: (data.switchRules ?? []).filter(item => item.id !== rule.id) })}>
                Remove
              </Button>
            </Group>
          ))}
          <Button variant="light" size="xs" onClick={() => onChange({
            switchRules: [...(data.switchRules ?? []), {
              id: `case-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              value: "",
            }],
          })}>Add case</Button>
          <Text size="xs">The Otherwise output is always available.</Text>
        </Stack>
      )}

      {data.kind ===
        "log" && (
        <Textarea
          label={
            t(
              "ui.flowMessage",
              "Message"
            )
          }
          value={
            data.message ??
            ""
          }
          minRows={3}
          autosize
          onChange={
            event =>
              onChange({
                message:
                  event.currentTarget
                    .value,
              })
          }
        />
      )}
    </Stack>
  );
}
