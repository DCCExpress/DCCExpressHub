import {
  type DragEvent,
  useMemo,
  useState,
} from "react";

import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";

import {
  IconArrowDown,
  IconArrowUp,
  IconGripVertical,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

import {
  createMovementAction,
  createMovementId,
  type MovementAction,
  type MovementActionKind,
  type MovementSequenceMode,
  type MovementWhen,
} from "../../domain/movement";

import type {
  MovementPlanResourceKind,
} from "../../services/movementPlan";

import {
  AudioFileInput,
} from "../../layout/property-panel/AudioFilePropertyEditor";

import {
  audioManager,
} from "../../services/audioManager";

type Props = {
  resourceKey: string;
  resourceKind:
    MovementPlanResourceKind;
  isSource?: boolean;
  isDestination?: boolean;
  actions:
    MovementAction[];
  onChange: (
    actions:
      MovementAction[]
  ) => void;
};

type SequenceGroup = {
  id: string;
  when: MovementWhen;
  mode:
    MovementSequenceMode;
  actions:
    MovementAction[];
};

function whenOptions(
  kind:
    MovementPlanResourceKind,
  isSource = false,
  isDestination = false
): Array<{
  value:
    MovementWhen;
  label: string;
}> {
  if (
    kind ===
    "block"
  ) {
    if (
      isDestination
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
            "arrived",
          label:
            "ARRIVED",
        },
      ];
    }

    const options:
      Array<{
        value:
          MovementWhen;
        label: string;
      }> = [
        {
          value:
            "beforeDepart",
          label:
            "BEFORE DEPART",
        },
        {
          value:
            "depart",
          label:
            "DEPART",
        },
        {
          value:
            "leave",
          label:
            "LEAVE",
        },
        {
          value:
            "afterLeave",
          label:
            "AFTER LEAVE",
        },
      ];

    if (
      !isSource
    ) {
      options.unshift(
        {
          value:
            "arrived",
          label:
            "ARRIVED",
        }
      );

      options.unshift(
        {
          value:
            "approach",
          label:
            "APPROACH",
        }
      );
    }

    return options;
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
    MovementPlanResourceKind,
  isSource = false,
  isDestination = false
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

  if (
    isDestination
  ) {
    return "approach";
  }

  if (
    isSource
  ) {
    return "beforeDepart";
  }

  return "approach";
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

const SEQUENCE_MODE_OPTIONS:
  Array<{
    value:
      MovementSequenceMode;
    label: string;
  }> = [
    {
      value:
        "blocking",
      label:
        "Blocking",
    },
    {
      value:
        "background",
      label:
        "Background",
    },
  ];

function groupSequences(
  actions:
    MovementAction[]
): SequenceGroup[] {
  const result:
    SequenceGroup[] = [];

  const byId =
    new Map<
      string,
      SequenceGroup
    >();

  for (const action of actions) {
    let sequence =
      byId.get(
        action.sequenceId
      );

    if (!sequence) {
      sequence = {
        id:
          action.sequenceId,
        when:
          action.when,
        mode:
          action.sequenceMode,
        actions: [],
      };

      byId.set(
        action.sequenceId,
        sequence
      );

      result.push(
        sequence
      );
    }

    sequence.actions.push(
      action
    );
  }

  return result;
}

function flattenSequences(
  sequences:
    SequenceGroup[]
): MovementAction[] {
  return sequences.flatMap(
    sequence =>
      sequence.actions.map(
        action => ({
          ...action,
          sequenceId:
            sequence.id,
          sequenceMode:
            sequence.mode,
          when:
            sequence.when,
        })
      )
  );
}

export default function MovementActionEditor({
  resourceKey,
  resourceKind,
  isSource = false,
  isDestination = false,
  actions,
  onChange,
}: Props) {
  const options =
    whenOptions(
      resourceKind,
      isSource,
      isDestination
    );

  const sequences =
    useMemo(
      () =>
        groupSequences(
          actions
        ),
      [
        actions,
      ]
    );

  const [
    draggedActionId,
    setDraggedActionId,
  ] =
    useState<string | null>(
      null
    );

  const commitSequences =
    (
      next:
        SequenceGroup[]
    ): void => {
      onChange(
        flattenSequences(
          next
        )
      );
    };

  const updateSequence =
    (
      sequenceId: string,
      patch:
        Partial<
          Pick<
            SequenceGroup,
            "when" |
            "mode"
          >
        >
    ): void => {
      commitSequences(
        sequences.map(
          sequence =>
            sequence.id ===
            sequenceId
              ? {
                  ...sequence,
                  ...patch,
                }
              : sequence
        )
      );
    };

  const addSequence =
    (): void => {
      const sequenceId =
        createMovementId(
          "movement-sequence"
        );

      const when =
        defaultWhen(
          resourceKind,
          isSource,
          isDestination
        );

      const action =
        createMovementAction(
          resourceKey,
          when,
          "speed",
          sequenceId,
          "blocking"
        );

      commitSequences([
        ...sequences,
        {
          id:
            sequenceId,
          when,
          mode:
            "blocking",
          actions: [
            action,
          ],
        },
      ]);
    };

  const addAction =
    (
      sequence:
        SequenceGroup
    ): void => {
      commitSequences(
        sequences.map(
          current =>
            current.id ===
            sequence.id
              ? {
                  ...current,
                  actions: [
                    ...current.actions,
                    createMovementAction(
                      resourceKey,
                      current.when,
                      "speed",
                      current.id,
                      current.mode
                    ),
                  ],
                }
              : current
        )
      );
    };

  const deleteSequence =
    (
      sequenceId:
        string
    ): void => {
      commitSequences(
        sequences.filter(
          sequence =>
            sequence.id !==
            sequenceId
        )
      );
    };

  const moveSequence =
    (
      sequenceIndex:
        number,
      offset:
        number
    ): void => {
      const toIndex =
        Math.max(
          0,
          Math.min(
            sequenceIndex +
              offset,
            sequences.length -
              1
          )
        );

      if (
        toIndex ===
        sequenceIndex
      ) {
        return;
      }

      const next =
        [...sequences];

      const [
        moved,
      ] =
        next.splice(
          sequenceIndex,
          1
        );

      if (!moved) {
        return;
      }

      next.splice(
        toIndex,
        0,
        moved
      );

      commitSequences(
        next
      );
    };

  const updateAction =
    (
      sequenceId:
        string,
      actionId:
        string,
      patch:
        Partial<MovementAction>
    ): void => {
      commitSequences(
        sequences.map(
          sequence =>
            sequence.id ===
            sequenceId
              ? {
                  ...sequence,
                  actions:
                    sequence.actions.map(
                      action =>
                        action.id ===
                        actionId
                          ? {
                              ...action,
                              ...patch,
                            }
                          : action
                    ),
                }
              : sequence
        )
      );
    };

  const deleteAction =
    (
      sequenceId:
        string,
      actionId:
        string
    ): void => {
      const next =
        sequences
          .map(
            sequence =>
              sequence.id ===
              sequenceId
                ? {
                    ...sequence,
                    actions:
                      sequence.actions.filter(
                        action =>
                          action.id !==
                          actionId
                      ),
                  }
                : sequence
          )
          .filter(
            sequence =>
              sequence.actions.length >
              0
          );

      commitSequences(
        next
      );
    };

  const moveAction =
    (
      sequenceId:
        string,
      actionId:
        string,
      targetIndex:
        number
    ): void => {
      commitSequences(
        sequences.map(
          sequence => {
            if (
              sequence.id !==
              sequenceId
            ) {
              return sequence;
            }

            const fromIndex =
              sequence.actions.findIndex(
                action =>
                  action.id ===
                  actionId
              );

            if (
              fromIndex < 0
            ) {
              return sequence;
            }

            const boundedTarget =
              Math.max(
                0,
                Math.min(
                  targetIndex,
                  sequence.actions.length -
                    1
                )
              );

            if (
              boundedTarget ===
              fromIndex
            ) {
              return sequence;
            }

            const nextActions =
              [
                ...sequence.actions,
              ];

            const [
              moved,
            ] =
              nextActions.splice(
                fromIndex,
                1
              );

            if (!moved) {
              return sequence;
            }

            nextActions.splice(
              boundedTarget,
              0,
              moved
            );

            return {
              ...sequence,
              actions:
                nextActions,
            };
          }
        )
      );
    };

  const moveActionByOffset =
    (
      sequence:
        SequenceGroup,
      actionId:
        string,
      offset:
        number
    ): void => {
      const fromIndex =
        sequence.actions.findIndex(
          action =>
            action.id ===
            actionId
        );

      if (
        fromIndex < 0
      ) {
        return;
      }

      moveAction(
        sequence.id,
        actionId,
        fromIndex +
          offset
      );
    };

  const handleDragStart =
    (
      event:
        DragEvent<HTMLDivElement>,
      actionId:
        string
    ): void => {
      setDraggedActionId(
        actionId
      );

      event.dataTransfer.effectAllowed =
        "move";

      event.dataTransfer.setData(
        "text/plain",
        actionId
      );
    };

  return (
    <Stack
      gap="sm"
    >
      <Group
        justify="space-between"
        align="center"
        className="movement-action-editor-toolbar"
      >
        <div>
          <Text
            size="sm"
            fw={700}
          >
            Sequences
          </Text>

          <Text
            size="xs"
            c="dimmed"
          >
            Blocking waits for the sequence. Background keeps the train moving while its actions still run in order.
          </Text>
        </div>

        <Button
          size="compact-xs"
          variant="light"
          leftSection={
            <IconPlus
              size={13}
            />
          }
          onClick={
            addSequence
          }
        >
          Sequence
        </Button>
      </Group>

      {
        sequences.length ===
          0 && (
          <Text
            size="xs"
            c="dimmed"
          >
            No action sequences for this route resource.
          </Text>
        )
      }

      {
        sequences.map(
          (
            sequence,
            sequenceIndex
          ) => (
            <Card
              key={
                sequence.id
              }
              withBorder
              p={0}
              className="movement-sequence-card"
            >
              <Group
                justify="space-between"
                align="flex-end"
                wrap="wrap"
                className="movement-sequence-card-header"
              >
                <Group
                  gap="xs"
                  align="flex-end"
                  wrap="wrap"
                  style={{
                    flex: 1,
                  }}
                >
                  <Badge
                    variant="filled"
                    color={
                      sequence.mode ===
                        "background"
                        ? "cyan"
                        : "violet"
                    }
                  >
                    Sequence {sequenceIndex + 1}
                  </Badge>

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
                      sequence.when
                    }
                    onChange={
                      value => {
                        if (
                          value
                        ) {
                          updateSequence(
                            sequence.id,
                            {
                              when:
                                value as MovementWhen,
                            }
                          );
                        }
                      }
                    }
                    w={180}
                  />

                  <Select
                    label="MODE"
                    size="xs"
                    allowDeselect={
                      false
                    }
                    data={
                      SEQUENCE_MODE_OPTIONS
                    }
                    value={
                      sequence.mode
                    }
                    onChange={
                      value => {
                        if (
                          value
                        ) {
                          updateSequence(
                            sequence.id,
                            {
                              mode:
                                value as MovementSequenceMode,
                            }
                          );
                        }
                      }
                    }
                    w={150}
                  />
                </Group>

                <Group
                  gap={4}
                  wrap="nowrap"
                >
                  <Tooltip
                    withArrow
                    label="Move sequence up"
                  >
                    <ActionIcon
                      size="sm"
                      color="gray"
                      variant="light"
                      disabled={
                        sequenceIndex ===
                        0
                      }
                      onClick={
                        () =>
                          moveSequence(
                            sequenceIndex,
                            -1
                          )
                      }
                    >
                      <IconArrowUp
                        size={14}
                      />
                    </ActionIcon>
                  </Tooltip>

                  <Tooltip
                    withArrow
                    label="Move sequence down"
                  >
                    <ActionIcon
                      size="sm"
                      color="gray"
                      variant="light"
                      disabled={
                        sequenceIndex >=
                        sequences.length -
                          1
                      }
                      onClick={
                        () =>
                          moveSequence(
                            sequenceIndex,
                            1
                          )
                      }
                    >
                      <IconArrowDown
                        size={14}
                      />
                    </ActionIcon>
                  </Tooltip>

                  <Tooltip
                    withArrow
                    label="Add action"
                  >
                    <ActionIcon
                      size="sm"
                      color="blue"
                      variant="light"
                      onClick={
                        () =>
                          addAction(
                            sequence
                          )
                      }
                    >
                      <IconPlus
                        size={14}
                      />
                    </ActionIcon>
                  </Tooltip>

                  <Tooltip
                    withArrow
                    label="Delete sequence"
                  >
                    <ActionIcon
                      size="sm"
                      color="red"
                      variant="light"
                      onClick={
                        () =>
                          deleteSequence(
                            sequence.id
                          )
                      }
                    >
                      <IconTrash
                        size={14}
                      />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>

              <Stack
                gap="xs"
                className="movement-sequence-card-body"
              >
                {
                  sequence.actions.map(
                    (
                      action,
                      actionIndex
                    ) => (
                      <div
                        key={
                          action.id
                        }
                        className={
                          "movement-inner-step-row movement-action-step-row" +
                          (
                            actionIndex ===
                            sequence.actions.length -
                              1
                              ? " is-last"
                              : ""
                          )
                        }
                      >
                        <div
                          className="movement-inner-step-spine"
                        >
                          <div
                            className="movement-inner-step-dot movement-action-step-dot"
                          >
                            {
                              actionIndex + 1
                            }
                          </div>

                          <div
                            className="movement-inner-step-line"
                          />
                        </div>

                        <Card
                          withBorder
                          p={0}
                          className="movement-action-card"
                          onDragOver={
                            event => {
                              event.preventDefault();

                              event.dataTransfer.dropEffect =
                                "move";

                              if (
                                draggedActionId &&
                                draggedActionId !==
                                  action.id &&
                                sequence.actions.some(
                                  current =>
                                    current.id ===
                                    draggedActionId
                                )
                              ) {
                                moveAction(
                                  sequence.id,
                                  draggedActionId,
                                  actionIndex
                                );
                              }
                            }
                          }
                          style={{
                            opacity:
                              draggedActionId ===
                                action.id
                                ? 0.35
                                : 1,
                          }}
                        >
                          <Group
                            justify="space-between"
                            wrap="nowrap"
                            className="movement-action-card-header"
                            draggable
                            onDragStart={
                              event =>
                                handleDragStart(
                                  event,
                                  action.id
                                )
                            }
                            onDragEnd={
                              () =>
                                setDraggedActionId(
                                  null
                                )
                            }
                          >
                            <Group
                              gap="xs"
                              wrap="nowrap"
                            >
                              <div
                                className="movement-action-drag-handle"
                                title="Drag to reorder"
                              >
                                <ActionIcon
                                  variant="subtle"
                                  color="gray"
                                  aria-label="Reorder action"
                                  tabIndex={-1}
                                  draggable={false}
                                >
                                  <IconGripVertical
                                    size={17}
                                  />
                                </ActionIcon>
                              </div>

                              <Badge
                                size="sm"
                                variant="light"
                                color="gray"
                              >
                                {
                                  WHAT_OPTIONS.find(
                                    option =>
                                      option.value ===
                                      action.kind
                                  )?.label ??
                                  action.kind
                                }
                              </Badge>
                            </Group>

                            <Group
                              gap={4}
                              wrap="nowrap"
                            >
                              <Tooltip
                                withArrow
                                label="Move up"
                              >
                                <ActionIcon
                                  size="sm"
                                  color="gray"
                                  variant="light"
                                  disabled={
                                    actionIndex ===
                                    0
                                  }
                                  onClick={
                                    () =>
                                      moveActionByOffset(
                                        sequence,
                                        action.id,
                                        -1
                                      )
                                  }
                                >
                                  <IconArrowUp
                                    size={14}
                                  />
                                </ActionIcon>
                              </Tooltip>

                              <Tooltip
                                withArrow
                                label="Move down"
                              >
                                <ActionIcon
                                  size="sm"
                                  color="gray"
                                  variant="light"
                                  disabled={
                                    actionIndex >=
                                    sequence.actions.length -
                                      1
                                  }
                                  onClick={
                                    () =>
                                      moveActionByOffset(
                                        sequence,
                                        action.id,
                                        1
                                      )
                                  }
                                >
                                  <IconArrowDown
                                    size={14}
                                  />
                                </ActionIcon>
                              </Tooltip>

                              <ActionIcon
                                size="sm"
                                variant="light"
                                color="red"
                                onClick={
                                  () =>
                                    deleteAction(
                                      sequence.id,
                                      action.id
                                    )
                                }
                              >
                                <IconTrash
                                  size={14}
                                />
                              </ActionIcon>
                            </Group>
                          </Group>

                          <Stack
                            gap={6}
                            className="movement-action-card-body"
                          >
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
                                    updateAction(
                                      sequence.id,
                                      action.id,
                                      {
                                        kind:
                                          value as MovementActionKind,
                                      }
                                    );
                                  }
                                }
                              }
                            />

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
                                      updateAction(
                                        sequence.id,
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
                                        updateAction(
                                          sequence.id,
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
                                        updateAction(
                                          sequence.id,
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
                                        updateAction(
                                          sequence.id,
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
                                        updateAction(
                                          sequence.id,
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
                                      updateAction(
                                        sequence.id,
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
                                        updateAction(
                                          sequence.id,
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
                                        updateAction(
                                          sequence.id,
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
                                  <AudioFileInput
                                    label="Audio file"
                                    description="Choose an audio file from the Hub SD card."
                                    value={
                                      action.audioName
                                    }
                                    allowManualInput={
                                      false
                                    }
                                    onChange={
                                      audioName =>
                                        updateAction(
                                          sequence.id,
                                          action.id,
                                          {
                                            audioName,
                                          }
                                        )
                                    }
                                    onTest={
                                      () => {
                                        const source =
                                          action.audioName.trim();

                                        if (
                                          source
                                        ) {
                                          audioManager.play(
                                            source
                                          );
                                        }
                                      }
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
                                        updateAction(
                                          sequence.id,
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
                                      updateAction(
                                        sequence.id,
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
                        </Card>
                      </div>
                    )
                  )
                }
              </Stack>
            </Card>
          )
        )
      }
    </Stack>
  );
}
