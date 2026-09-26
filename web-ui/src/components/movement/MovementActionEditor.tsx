import {
  type DragEvent,
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
  type MovementAction,
  type MovementActionKind,
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
      options.unshift({
        value:
          "arrived",
        label:
          "ARRIVED",
      });
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
    return "arrived";
  }

  if (
    isSource
  ) {
    return "beforeDepart";
  }

  return "arrived";
}

function moveAction(
  actions:
    MovementAction[],
  fromIndex: number,
  toIndex: number
): MovementAction[] {
  if (
    fromIndex < 0 ||
    fromIndex >=
      actions.length ||
    toIndex < 0 ||
    toIndex >=
      actions.length ||
    fromIndex ===
      toIndex
  ) {
    return actions;
  }

  const next =
    [...actions];

  const [
    moved,
  ] =
    next.splice(
      fromIndex,
      1
    );

  if (!moved) {
    return actions;
  }

  next.splice(
    toIndex,
    0,
    moved
  );

  return next;
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

  const [
    draggedActionId,
    setDraggedActionId,
  ] =
    useState<string | null>(
      null
    );

  const moveActionByOffset =
    (
      actionId: string,
      offset: number
    ): void => {
      const fromIndex =
        actions.findIndex(
          action =>
            action.id ===
            actionId
        );

      const current =
        actions[
          fromIndex
        ];

      if (
        !current
      ) {
        return;
      }

      const sameWhenIndexes =
        actions
          .map(
            (
              action,
              index
            ) => ({
              action,
              index,
            })
          )
          .filter(
            entry =>
              entry.action.when ===
              current.when
          )
          .map(
            entry =>
              entry.index
          );

      const currentGroupIndex =
        sameWhenIndexes.indexOf(
          fromIndex
        );

      const targetGroupIndex =
        Math.max(
          0,
          Math.min(
            currentGroupIndex +
              offset,
            sameWhenIndexes.length -
              1
          )
        );

      const toIndex =
        sameWhenIndexes[
          targetGroupIndex
        ];

      if (
        toIndex ===
        undefined
      ) {
        return;
      }

      const next =
        moveAction(
          actions,
          fromIndex,
          toIndex
        );

      if (
        next !==
        actions
      ) {
        onChange(
          next
        );
      }
    };

  const moveDraggedActionToIndex =
    (
      targetIndex:
        number
    ): void => {
      if (
        !draggedActionId
      ) {
        return;
      }

      const fromIndex =
        actions.findIndex(
          action =>
            action.id ===
            draggedActionId
        );

      const dragged =
        actions[
          fromIndex
        ];

      const target =
        actions[
          targetIndex
        ];

      if (
        !dragged ||
        !target ||
        dragged.when !==
          target.when
      ) {
        return;
      }

      const next =
        moveAction(
          actions,
          fromIndex,
          targetIndex
        );

      if (
        next !==
        actions
      ) {
        onChange(
          next
        );
      }
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
        className="movement-action-editor-toolbar"
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
                    resourceKind,
                    isSource,
                    isDestination
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
          (
            action,
            actionIndex
          ) => {
            const phaseActions =
              actions.filter(
                current =>
                  current.when ===
                  action.when
              );

            const phaseIndex =
              phaseActions.findIndex(
                current =>
                  current.id ===
                  action.id
              );

            const phaseLabel =
              options.find(
                option =>
                  option.value ===
                  action.when
              )?.label ??
              action.when;

            return (
            <Card
              key={
                action.id
              }
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
                      action.id
                  ) {
                    moveDraggedActionToIndex(
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
                transition:
                  "opacity 120ms ease, transform 120ms ease, border-color 120ms ease, background-color 120ms ease",
              }}
            >
              <Group
                justify="space-between"
                wrap="nowrap"
                className="movement-action-card-header"
              >
                <Group
                  gap="xs"
                  wrap="nowrap"
                >
                  <div
                    draggable
                    className="movement-action-drag-handle"
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
                    title="Drag to reorder"
                  >
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label="Reorder action"
                      tabIndex={-1}
                    >
                      <IconGripVertical
                        size={17}
                      />
                    </ActionIcon>
                  </div>

                  <Badge
                    size="sm"
                    variant="filled"
                    color={
                      draggedActionId ===
                        action.id
                        ? "orange"
                        : "gray"
                    }
                  >
                    #{phaseIndex + 1}
                  </Badge>

                  <Text
                    size="xs"
                    c="dimmed"
                  >
                    {phaseLabel} order
                  </Text>
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
                        phaseIndex ===
                        0
                      }
                      onClick={
                        () =>
                          moveActionByOffset(
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
                        phaseIndex >=
                        phaseActions.length -
                          1
                      }
                      onClick={
                        () =>
                          moveActionByOffset(
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
                </Group>
              </Group>

              <Stack
                gap={6}
                className="movement-action-card-body"
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
                          update(
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
            </Card>
            );
          }
        )
      }
    </Stack>
  );
}
