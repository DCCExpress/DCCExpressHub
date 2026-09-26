import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";

import {
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

import {
  createMovementAction,
  type MovementAction,
  type MovementActionKind,
  type MovementWhen,
} from "../../domain/movement";

import type {
  MovementPlanResourceKind,
} from "../../services/movementPlan";

type Props = {
  resourceKey: string;
  resourceKind:
    MovementPlanResourceKind;
  actions:
    MovementAction[];
  onChange: (
    actions:
      MovementAction[]
  ) => void;
};

function whenOptions(
  kind:
    MovementPlanResourceKind
): Array<{
  value:
    MovementWhen;
  label: string;
}> {
  if (
    kind ===
    "block"
  ) {
    return [
      {
        value:
          "depart",
        label:
          "DEPART",
      },
      {
        value:
          "arrived",
        label:
          "ARRIVED",
      },
    ];
  }

  if (
    kind ===
    "turnout"
  ) {
    return [
      {
        value:
          "approach",
        label:
          "APPROACH",
      },
      {
        value:
          "leave",
        label:
          "LEAVE",
      },
    ];
  }

  return [
    {
      value:
        "enter",
      label:
        "ENTER",
    },
    {
      value:
        "leave",
      label:
        "LEAVE",
    },
  ];
}

function defaultWhen(
  kind:
    MovementPlanResourceKind
): MovementWhen {
  if (
    kind ===
    "turnout"
  ) {
    return "approach";
  }

  if (
    kind ===
    "segment"
  ) {
    return "enter";
  }

  return "arrived";
}

const WHAT_OPTIONS:
  Array<{
    value:
      MovementActionKind;
    label: string;
  }> = [
    {
      value:
        "speed",
      label:
        "Set speed",
    },
    {
      value:
        "function",
      label:
        "Loco function",
    },
    {
      value:
        "horn",
      label:
        "Horn pulse",
    },
    {
      value:
        "delay",
      label:
        "Delay",
    },
    {
      value:
        "randomDelay",
      label:
        "Random delay",
    },
    {
      value:
        "playAudio",
      label:
        "Play audio",
    },
    {
      value:
        "log",
      label:
        "Log",
    },
  ];

export default function MovementActionEditor({
  resourceKey,
  resourceKind,
  actions,
  onChange,
}: Props) {
  const options =
    whenOptions(
      resourceKind
    );

  const update =
    (
      id: string,
      patch:
        Partial<MovementAction>
    ): void => {
      onChange(
        actions.map(
          action =>
            action.id ===
            id
              ? {
                  ...action,
                  ...patch,
                }
              : action
        )
      );
    };

  return (
    <Stack
      gap="xs"
    >
      <Group
        justify="space-between"
        align="center"
      >
        <Text
          size="sm"
          fw={600}
        >
          WHEN → WHAT
        </Text>

        <Button
          size="compact-xs"
          variant="light"
          leftSection={
            <IconPlus
              size={13}
            />
          }
          onClick={
            () =>
              onChange([
                ...actions,
                createMovementAction(
                  resourceKey,
                  defaultWhen(
                    resourceKind
                  ),
                  "speed"
                ),
              ])
          }
        >
          Action
        </Button>
      </Group>

      {
        actions.length ===
          0 && (
          <Text
            size="xs"
            c="dimmed"
          >
            No actions for this route resource.
          </Text>
        )
      }

      {
        actions.map(
          action => (
            <Stack
              key={
                action.id
              }
              gap={6}
              p={8}
              style={{
                border:
                  "1px solid var(--mantine-color-default-border)",
                borderRadius:
                  "var(--mantine-radius-sm)",
              }}
            >
              <Group
                gap="xs"
                wrap="nowrap"
                align="flex-end"
              >
                <Select
                  label="WHEN"
                  size="xs"
                  allowDeselect={
                    false
                  }
                  data={
                    options
                  }
                  value={
                    action.when
                  }
                  onChange={
                    value => {
                      if (
                        value
                      ) {
                        update(
                          action.id,
                          {
                            when:
                              value as MovementWhen,
                          }
                        );
                      }
                    }
                  }
                  style={{
                    flex: 1,
                  }}
                />

                <Select
                  label="WHAT"
                  size="xs"
                  allowDeselect={
                    false
                  }
                  data={
                    WHAT_OPTIONS
                  }
                  value={
                    action.kind
                  }
                  onChange={
                    value => {
                      if (
                        value
                      ) {
                        update(
                          action.id,
                          {
                            kind:
                              value as MovementActionKind,
                          }
                        );
                      }
                    }
                  }
                  style={{
                    flex: 1.25,
                  }}
                />

                <ActionIcon
                  size="sm"
                  variant="light"
                  color="red"
                  onClick={
                    () =>
                      onChange(
                        actions.filter(
                          current =>
                            current.id !==
                            action.id
                        )
                      )
                  }
                >
                  <IconTrash
                    size={14}
                  />
                </ActionIcon>
              </Group>

              {
                action.kind ===
                  "speed" && (
                  <NumberInput
                    size="xs"
                    label="Speed"
                    min={0}
                    max={126}
                    value={
                      action.speed
                    }
                    onChange={
                      value =>
                        update(
                          action.id,
                          {
                            speed:
                              Math.max(
                                0,
                                Math.min(
                                  126,
                                  Math.round(
                                    Number(
                                      value
                                    ) ||
                                    0
                                  )
                                )
                              ),
                          }
                        )
                    }
                  />
                )
              }

              {
                action.kind ===
                  "function" && (
                  <Group
                    gap="xs"
                    align="flex-end"
                  >
                    <NumberInput
                      size="xs"
                      label="Function"
                      min={0}
                      max={68}
                      value={
                        action.functionNumber
                      }
                      onChange={
                        value =>
                          update(
                            action.id,
                            {
                              functionNumber:
                                Math.max(
                                  0,
                                  Math.min(
                                    68,
                                    Math.round(
                                      Number(
                                        value
                                      ) ||
                                      0
                                    )
                                  )
                                ),
                            }
                          )
                      }
                      style={{
                        flex: 1,
                      }}
                    />

                    <Switch
                      checked={
                        action.functionActive
                      }
                      label={
                        action.functionActive
                          ? "ON"
                          : "OFF"
                      }
                      onChange={
                        event =>
                          update(
                            action.id,
                            {
                              functionActive:
                                event.currentTarget.checked,
                            }
                          )
                      }
                    />
                  </Group>
                )
              }

              {
                action.kind ===
                  "horn" && (
                  <Group
                    gap="xs"
                  >
                    <NumberInput
                      size="xs"
                      label="Function"
                      min={0}
                      max={68}
                      value={
                        action.functionNumber
                      }
                      onChange={
                        value =>
                          update(
                            action.id,
                            {
                              functionNumber:
                                Math.max(
                                  0,
                                  Math.min(
                                    68,
                                    Math.round(
                                      Number(
                                        value
                                      ) ||
                                      0
                                    )
                                  )
                                ),
                            }
                          )
                      }
                      style={{
                        flex: 1,
                      }}
                    />

                    <NumberInput
                      size="xs"
                      label="Pulse (ms)"
                      min={1}
                      max={600000}
                      value={
                        action.pulseMs
                      }
                      onChange={
                        value =>
                          update(
                            action.id,
                            {
                              pulseMs:
                                Math.max(
                                  1,
                                  Math.min(
                                    600000,
                                    Math.round(
                                      Number(
                                        value
                                      ) ||
                                      1
                                    )
                                  )
                                ),
                            }
                          )
                      }
                      style={{
                        flex: 1,
                      }}
                    />
                  </Group>
                )
              }

              {
                action.kind ===
                  "delay" && (
                  <NumberInput
                    size="xs"
                    label="Delay (ms)"
                    min={0}
                    max={600000}
                    value={
                      action.delayMs
                    }
                    onChange={
                      value =>
                        update(
                          action.id,
                          {
                            delayMs:
                              Math.max(
                                0,
                                Math.min(
                                  600000,
                                  Math.round(
                                    Number(
                                      value
                                    ) ||
                                    0
                                  )
                                )
                              ),
                          }
                        )
                    }
                  />
                )
              }

              {
                action.kind ===
                  "randomDelay" && (
                  <Group
                    gap="xs"
                  >
                    <NumberInput
                      size="xs"
                      label="Min (ms)"
                      min={0}
                      max={600000}
                      value={
                        action.minDelayMs
                      }
                      onChange={
                        value =>
                          update(
                            action.id,
                            {
                              minDelayMs:
                                Math.max(
                                  0,
                                  Math.min(
                                    600000,
                                    Math.round(
                                      Number(
                                        value
                                      ) ||
                                      0
                                    )
                                  )
                                ),
                            }
                          )
                      }
                      style={{
                        flex: 1,
                      }}
                    />

                    <NumberInput
                      size="xs"
                      label="Max (ms)"
                      min={0}
                      max={600000}
                      value={
                        action.maxDelayMs
                      }
                      onChange={
                        value =>
                          update(
                            action.id,
                            {
                              maxDelayMs:
                                Math.max(
                                  action.minDelayMs,
                                  Math.min(
                                    600000,
                                    Math.round(
                                      Number(
                                        value
                                      ) ||
                                      0
                                    )
                                  )
                                ),
                            }
                          )
                      }
                      style={{
                        flex: 1,
                      }}
                    />
                  </Group>
                )
              }

              {
                action.kind ===
                  "playAudio" && (
                  <>
                    <TextInput
                      size="xs"
                      label="Audio file"
                      placeholder="/sd/audio/file.mp3"
                      value={
                        action.audioName
                      }
                      onChange={
                        event =>
                          update(
                            action.id,
                            {
                              audioName:
                                event.currentTarget.value,
                            }
                          )
                      }
                    />

                    <Switch
                      size="sm"
                      checked={
                        action.audioWaitForEnd
                      }
                      label="Wait for audio end"
                      onChange={
                        event =>
                          update(
                            action.id,
                            {
                              audioWaitForEnd:
                                event.currentTarget.checked,
                            }
                          )
                      }
                    />
                  </>
                )
              }

              {
                action.kind ===
                  "log" && (
                  <TextInput
                    size="xs"
                    label="Message"
                    value={
                      action.message
                    }
                    onChange={
                      event =>
                        update(
                          action.id,
                          {
                            message:
                              event.currentTarget.value,
                          }
                        )
                    }
                  />
                )
              }
            </Stack>
          )
        )
      }
    </Stack>
  );
}
