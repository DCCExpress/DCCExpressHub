import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";

import {
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

import i18next from "i18next";

import type {
  AutomationArrivalRule,
  AutomationFlowNode,
  AutomationFlowNodeData,
} from "../../domain/automationFlow";

import AutomationFlowPayloadEditor from "./AutomationFlowPayloadEditor";
import AutomationFlowTurnoutEditor from "./AutomationFlowTurnoutEditor";
import AutomationFlowBlockEditor from "./AutomationFlowBlockEditor";

type Props = {
  node: AutomationFlowNode | null;
  onChange: (
    patch:
      Partial<AutomationFlowNodeData>
  ) => void;
  onDelete: () => void;
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

export default function AutomationFlowPropertiesPanel({
  node,
  onChange,
  onDelete,
  onAddArrivalRule,
  onChangeArrivalRule,
  onDeleteArrivalRule,
}: Props) {
  if (!node) {
    return (
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
        "smartDispatcher" && (
        <>
          <Stack gap="xs">
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

            <Text
              size="xs"
              c="dimmed"
            >
              {
                t(
                  "ui.flowRouteBlocksDescription",
                  "Example: A1 → B1 → C1"
                )
              }
            </Text>

            {(
              data.route ??
              []
            ).map(
              (
                block,
                index
              ) => (
                <Group
                  key={
                    `${node.id}-route-${index}`
                  }
                  gap="xs"
                  wrap="nowrap"
                >
                  <TextInput
                    size="xs"
                    label={
                      `#${index + 1}`
                    }
                    value={
                      block
                    }
                    onChange={
                      event => {
                        const route = [
                          ...(
                            data.route ??
                            []
                          ),
                        ];

                        route[index] =
                          event.currentTarget
                            .value;

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
                    mt={22}
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
              )
            )}

            <Button
              size="xs"
              variant="light"
              leftSection={
                <IconPlus
                  size={14}
                />
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
              rule => (
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
                      <TextInput
                        label={
                          t(
                            "ui.block2",
                            "Block"
                          )
                        }
                        value={
                          rule.block
                        }
                        onChange={
                          event =>
                            onChangeArrivalRule(
                              rule.id,
                              {
                                block:
                                  event.currentTarget
                                    .value,
                              }
                            )
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
              )
            )}

            <Button
              size="xs"
              variant="light"
              leftSection={
                <IconPlus
                  size={14}
                />
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
                  "When flows are enabled, every matching sensorChanged event injects this branch once."
                )
              }
            </Text>
          )}
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
        "setLoco" && (
        <>
          <Alert
            color="blue"
            py="xs"
          >
            {
              t(
                "ui.flowSetLocoPayloadHint",
                "Uses payload.locoAddress as the locomotive address and passes payload on unchanged."
              )
            }
          </Alert>

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

          {(data.kind ===
              "setBlock" ||
            data.kind ===
              "setBlockTargetLoco") && (
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

          <NumberInput
            label={
              t(
                "ui.flowFunctionNumber",
                "Function number"
              )
            }
            value={
              data.functionNumber ??
              2
            }
            min={0}
            max={28}
            onChange={
              value =>
                onChange({
                  functionNumber:
                    Number(
                      value
                    ) ||
                    0,
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
        </>
      )}

      {data.kind ===
        "horn" && (
        <>
          <NumberInput
            label={
              t(
                "ui.flowFunctionNumber",
                "Function number"
              )
            }
            value={
              data.functionNumber ??
              2
            }
            min={0}
            max={28}
            onChange={
              value =>
                onChange({
                  functionNumber:
                    Number(
                      value
                    ) ||
                    0,
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
          <TextInput
            label={
              t(
                "ui.flowAudioName",
                "Audio name"
              )
            }
            description={
              t(
                "ui.flowAudioNameDescription",
                "Base MP3 filename in /sd/audio, without path or .mp3 extension."
              )
            }
            placeholder="station"
            value={
              data.audioName ??
              ""
            }
            onChange={
              event =>
                onChange({
                  audioName:
                    event.currentTarget
                      .value,
                })
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

          <Text
            size="xs"
            c="dimmed"
          >
            {
              data.audioName
                ? `/sd/audio/${data.audioName}.mp3`
                : "/sd/audio/<name>.mp3"
            }
          </Text>
        </>
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
