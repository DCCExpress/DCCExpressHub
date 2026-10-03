import {
  type DragEvent,
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  NumberInput,
  Select,
  Stack,
  Tabs,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";

import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconGripVertical,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

import type {
  FunctionBinding,
} from "@domain/types";

import {
  getFunctionBindings,
} from "../../api/domainApi";

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

import {
  movementText,
  useMovementTranslation,
} from "./movementI18n";

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
            movementText("movementEventApproach"),
        },
        {
          value:
            "arrived",
          label:
            movementText("movementEventArrived"),
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
            movementText("movementEventBeforeDepart"),
        },
        {
          value:
            "depart",
          label:
            movementText("movementEventDepart"),
        },
        {
          value:
            "leave",
          label:
            movementText("movementEventLeave"),
        },
        {
          value:
            "afterLeave",
          label:
            movementText("movementEventAfterLeave"),
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
            movementText("movementEventArrived"),
        }
      );

      options.unshift(
        {
          value:
            "approach",
          label:
            movementText("movementEventApproach"),
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
          movementText("movementEventApproach"),
      },
      {
        value:
          "leave",
        label:
          movementText("movementEventLeave"),
      },
    ];
  }

  return [
    {
      value:
        "enter",
      label:
        movementText("movementEventEnter"),
    },
    {
      value:
        "leave",
      label:
        movementText("movementEventLeave"),
    },
  ];
}

function eventHelpKey(
  when:
    MovementWhen
): string {
  switch (
    when
  ) {
    case "approach":
      return "movementEventHelpApproach";
    case "arrived":
      return "movementEventHelpArrived";
    case "beforeDepart":
      return "movementEventHelpBeforeDepart";
    case "depart":
      return "movementEventHelpDepart";
    case "enter":
      return "movementEventHelpEnter";
    case "leave":
      return "movementEventHelpLeave";
    case "afterLeave":
      return "movementEventHelpAfterLeave";
    default:
      return "movementEventHelpArrived";
  }
}

function whatOptions():
  Array<{
    value:
      MovementActionKind;
    label: string;
  }> {
  return [
    {
      value:
        "speed",
      label:
        movementText("movementActionSetSpeed"),
    },
    {
      value:
        "function",
      label:
        movementText("movementActionLocoFunction"),
    },
    {
      value:
        "horn",
      label:
        movementText("movementActionHornPulse"),
    },
    {
      value:
        "delay",
      label:
        movementText("movementActionDelay"),
    },
    {
      value:
        "randomDelay",
      label:
        movementText("movementActionRandomDelay"),
    },
    {
      value:
        "playAudio",
      label:
        movementText("movementActionPlayAudio"),
    },
    {
      value:
        "randomPlay",
      label:
        movementText("movementActionRandomPlay"),
    },
    {
      value:
        "setAccessory",
      label:
        movementText("movementActionSetBasicAccessory"),
    },
    {
      value:
        "setExtendedAccessory",
      label:
        movementText("movementActionSetExtendedAccessory"),
    },
    {
      value:
        "log",
      label:
        movementText("movementActionLog"),
    },
  ];
}

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
  const mt =
    useMovementTranslation();

  const [
    functionBindings,
    setFunctionBindings,
  ] =
    useState<FunctionBinding[]>([]);

  useEffect(
    () => {
      let active =
        true;

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
              "[Movement] Could not load function bindings",
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
    selectedWhen,
    setSelectedWhen,
  ] =
    useState<MovementWhen>(
      () =>
        options[0]?.value ??
        "arrived"
    );

  useEffect(
    () => {
      setSelectedWhen(
        options[0]?.value ??
        "arrived"
      );
    },
    [
      resourceKey,
      resourceKind,
      isSource,
      isDestination,
    ]
  );

  const visibleSequences =
    sequences.filter(
      sequence =>
        sequence.when ===
        selectedWhen
    );

  const hasBlockingSequence =
    visibleSequences.some(
      sequence =>
        sequence.mode ===
        "blocking"
    );

  const hasBackgroundSequence =
    visibleSequences.some(
      sequence =>
        sequence.mode ===
        "background"
    );

  const [
    draggedActionId,
    setDraggedActionId,
  ] =
    useState<string | null>(
      null
    );


  const [
    collapsedSequenceIds,
    setCollapsedSequenceIds,
  ] =
    useState<
      Set<string>
    >(
      () =>
        new Set<string>()
    );

  const [
    collapsedActionIds,
    setCollapsedActionIds,
  ] =
    useState<
      Set<string>
    >(
      () =>
        new Set<string>()
    );

  const toggleCollapsedId =
    (
      setter:
        Dispatch<
          SetStateAction<
            Set<string>
          >
        >,
      id: string
    ): void => {
      setter(
        current => {
          const next =
            new Set(
              current
            );

          if (
            next.has(
              id
            )
          ) {
            next.delete(
              id
            );
          } else {
            next.add(
              id
            );
          }

          return next;
        }
      );
    };

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

  const addSequence =
    (
      mode:
        MovementSequenceMode
    ): void => {
      const alreadyExists =
        sequences.some(
          sequence =>
            sequence.when ===
              selectedWhen &&
            sequence.mode ===
              mode
        );

      if (
        alreadyExists
      ) {
        return;
      }

      const sequenceId =
        createMovementId(
          "movement-sequence"
        );

      const action =
        createMovementAction(
          resourceKey,
          selectedWhen,
          "log",
          sequenceId,
          mode
        );

      commitSequences([
        ...sequences,
        {
          id:
            sequenceId,
          when:
            selectedWhen,
          mode,
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
                      "log",
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
      sequenceId:
        string,
      offset:
        number
    ): void => {
      const currentIndex =
        sequences.findIndex(
          sequence =>
            sequence.id ===
            sequenceId
        );

      if (
        currentIndex <
        0
      ) {
        return;
      }

      const current =
        sequences[
          currentIndex
        ]!;

      const siblingIndexes =
        sequences
          .map(
            (
              sequence,
              index
            ) => ({
              sequence,
              index,
            })
          )
          .filter(
            item =>
              item.sequence.when ===
              current.when
          )
          .map(
            item =>
              item.index
          );

      const siblingIndex =
        siblingIndexes.indexOf(
          currentIndex
        );

      const targetSiblingIndex =
        siblingIndex +
        offset;

      if (
        siblingIndex <
          0 ||
        targetSiblingIndex <
          0 ||
        targetSiblingIndex >=
          siblingIndexes.length
      ) {
        return;
      }

      const targetIndex =
        siblingIndexes[
          targetSiblingIndex
        ]!;

      const next =
        [...sequences];

      [
        next[currentIndex],
        next[targetIndex],
      ] = [
        next[targetIndex]!,
        next[currentIndex]!,
      ];

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
      <Stack
        gap={6}
      >
        <Text
          size="sm"
          fw={700}
        >
          {mt("movementActionEvent")}
        </Text>

        <Tabs
          className="movement-action-event-tabs"
          value={
            selectedWhen
          }
          onChange={
            value => {
              if (
                value
              ) {
                setSelectedWhen(
                  value as MovementWhen
                );
              }
            }
          }
          variant="outline"
          radius="md"
        >
          <Tabs.List>
            {
              options.map(
                option => {
                  const count =
                    sequences.filter(
                      sequence =>
                        sequence.when ===
                        option.value
                    ).length;

                  return (
                    <Tabs.Tab
                      key={
                        option.value
                      }
                      value={
                        option.value
                      }
                      rightSection={
                        count >
                          0
                          ? (
                            <Badge
                              size="xs"
                              variant="light"
                            >
                              {
                                count
                              }
                            </Badge>
                          )
                          : undefined
                      }
                    >
                      {
                        option.label
                      }
                    </Tabs.Tab>
                  );
                }
              )
            }
          </Tabs.List>
        </Tabs>

        <Text
          size="xs"
          c="dimmed"
        >
          {
            mt(
              eventHelpKey(
                selectedWhen
              )
            )
          }
        </Text>

        <Text
          size="xs"
          c="dimmed"
        >
          {mt("movementActionSequencesHelp")}
        </Text>

        <Group
          gap="xs"
          wrap="wrap"
        >
          <Button
            size="compact-xs"
            variant="light"
            color="violet"
            leftSection={
              <IconPlus
                size={13}
              />
            }
            disabled={
              hasBlockingSequence
            }
            onClick={
              () =>
                addSequence(
                  "blocking"
                )
            }
          >
            {mt("movementAddBlockingSequence")}
          </Button>

          <Button
            size="compact-xs"
            variant="light"
            color="cyan"
            leftSection={
              <IconPlus
                size={13}
              />
            }
            disabled={
              hasBackgroundSequence
            }
            onClick={
              () =>
                addSequence(
                  "background"
                )
            }
          >
            {mt("movementAddBackgroundSequence")}
          </Button>
        </Group>
      </Stack>

      {
        visibleSequences.length ===
          0 && (
          <Text
            size="xs"
            c="dimmed"
          >
            {mt("movementNoSequencesForEvent")}
          </Text>
        )
      }

      {
        visibleSequences.map(
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
                    {
                      sequence.mode ===
                        "background"
                        ? mt("movementBackgroundSequence")
                        : mt("movementBlockingSequence")
                    }
                  </Badge>
                </Group>

                <Group
                  gap={4}
                  wrap="nowrap"
                >
                  <Tooltip
                    withArrow
                    label={
                      collapsedSequenceIds.has(
                        sequence.id
                      )
                        ? mt("movementExpandSequence")
                        : mt("movementCollapseSequence")
                    }
                  >
                    <ActionIcon
                      size="sm"
                      color="gray"
                      variant="subtle"
                      onClick={
                        () =>
                          toggleCollapsedId(
                            setCollapsedSequenceIds,
                            sequence.id
                          )
                      }
                    >
                      <IconChevronDown
                        size={14}
                        style={{
                          transform:
                            collapsedSequenceIds.has(
                              sequence.id
                            )
                              ? "rotate(-90deg)"
                              : "rotate(0deg)",
                          transition:
                            "transform 150ms ease",
                        }}
                      />
                    </ActionIcon>
                  </Tooltip>

                  <Tooltip
                    withArrow
                    label={mt("movementMoveSequenceUp")}
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
                            sequence.id,
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
                    label={mt("movementMoveSequenceDown")}
                  >
                    <ActionIcon
                      size="sm"
                      color="gray"
                      variant="light"
                      disabled={
                        sequenceIndex >=
                        visibleSequences.length -
                          1
                      }
                      onClick={
                        () =>
                          moveSequence(
                            sequence.id,
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
                    label={mt("movementAddAction")}
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
                    label={mt("movementDeleteSequence")}
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

              <Collapse
                expanded={
                  !collapsedSequenceIds.has(
                    sequence.id
                  )
                }
              >
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
                                title={mt("movementDragToReorder")}
                              >
                                <ActionIcon
                                  variant="subtle"
                                  color="gray"
                                  aria-label={mt("movementReorderAction")}
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
                                  whatOptions().find(
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
                                label={
                                  collapsedActionIds.has(
                                    action.id
                                  )
                                    ? mt("movementExpandAction")
                                    : mt("movementCollapseAction")
                                }
                              >
                                <ActionIcon
                                  size="sm"
                                  color="gray"
                                  variant="subtle"
                                  onClick={
                                    event => {
                                      event.stopPropagation();
                                      toggleCollapsedId(
                                        setCollapsedActionIds,
                                        action.id
                                      );
                                    }
                                  }
                                >
                                  <IconChevronDown
                                    size={14}
                                    style={{
                                      transform:
                                        collapsedActionIds.has(
                                          action.id
                                        )
                                          ? "rotate(-90deg)"
                                          : "rotate(0deg)",
                                      transition:
                                        "transform 150ms ease",
                                    }}
                                  />
                                </ActionIcon>
                              </Tooltip>

                              <Tooltip
                                withArrow
                                label={mt("movementMoveUp")}
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
                                label={mt("movementMoveDown")}
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

                          <Collapse
                            expanded={
                              !collapsedActionIds.has(
                                action.id
                              )
                            }
                          >
                          <Stack
                            gap={6}
                            className="movement-action-card-body"
                          >
                            <Select
                              label={mt("movementWhat")}
                              size="xs"
                              allowDeselect={
                                false
                              }
                              data={
                                whatOptions()
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
                                  label={mt("movementSpeed")}
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
                                  <Select
                                    size="xs"
                                    label={mt("flowFunctionBinding")}
                                    data={
                                      functionBindingOptions
                                    }
                                    value={
                                      action.functionBindingId ===
                                        null
                                        ? null
                                        : String(
                                            action.functionBindingId
                                          )
                                    }
                                    searchable
                                    clearable
                                    onChange={
                                      value =>
                                        updateAction(
                                          sequence.id,
                                          action.id,
                                          {
                                            functionBindingId:
                                              value ===
                                                null
                                                ? null
                                                : Number(
                                                    value
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
                                        ? mt("movementOn")
                                        : mt("movementOff")
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
                                  <Select
                                    size="xs"
                                    label={mt("flowFunctionBinding")}
                                    data={
                                      functionBindingOptions
                                    }
                                    value={
                                      action.functionBindingId ===
                                        null
                                        ? null
                                        : String(
                                            action.functionBindingId
                                          )
                                    }
                                    searchable
                                    clearable
                                    onChange={
                                      value =>
                                        updateAction(
                                          sequence.id,
                                          action.id,
                                          {
                                            functionBindingId:
                                              value ===
                                                null
                                                ? null
                                                : Number(
                                                    value
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
                                    label={mt("movementPulseMs")}
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
                                  label={mt("movementDelayMs")}
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
                                    label={mt("movementMinMs")}
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
                                    label={mt("movementMaxMs")}
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
                              (
                                action.kind ===
                                  "playAudio" ||
                                action.kind ===
                                  "randomPlay"
                              ) && (
                                <>
                                  <AudioFileInput
                                    label={mt("movementAudioFile")}
                                    description={mt("movementAudioFileDescription")}
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
                                      previewSource => {
                                        const source =
                                          (
                                            previewSource ??
                                            action.audioName
                                          ).trim();

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

                                  {
                                    action.kind ===
                                      "randomPlay" && (
                                      <>
                                        <NumberInput
                                          size="xs"
                                          label={mt("movementRandomPlayChance")}
                                          description={mt("movementRandomPlayHelp")}
                                          min={10}
                                          max={90}
                                          step={10}
                                          value={
                                            action.randomPlayChancePercent
                                          }
                                          onChange={
                                            value =>
                                              updateAction(
                                                sequence.id,
                                                action.id,
                                                {
                                                  randomPlayChancePercent:
                                                    Math.max(
                                                      10,
                                                      Math.min(
                                                        90,
                                                        Math.round(
                                                          (
                                                            Number(
                                                              value
                                                            ) ||
                                                            30
                                                          ) /
                                                          10
                                                        ) *
                                                        10
                                                      )
                                                    ),
                                                }
                                              )
                                          }
                                        />
                                      </>
                                    )
                                  }

                                  <Switch
                                    size="sm"
                                    checked={
                                      action.audioWaitForEnd
                                    }
                                    label={mt("movementWaitAudioEnd")}
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
                                "setAccessory" && (
                                <Group
                                  gap="xs"
                                  align="flex-end"
                                >
                                  <NumberInput
                                    size="xs"
                                    label={mt("movementAccessoryAddress")}
                                    min={1}
                                    max={2048}
                                    value={
                                      action.accessoryAddress
                                    }
                                    onChange={
                                      value =>
                                        updateAction(
                                          sequence.id,
                                          action.id,
                                          {
                                            accessoryAddress:
                                              Math.max(
                                                1,
                                                Math.min(
                                                  2048,
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

                                  <Switch
                                    checked={
                                      action.accessoryActive
                                    }
                                    label={
                                      action.accessoryActive
                                        ? mt("movementOn")
                                        : mt("movementOff")
                                    }
                                    onChange={
                                      event =>
                                        updateAction(
                                          sequence.id,
                                          action.id,
                                          {
                                            accessoryActive:
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
                                "setExtendedAccessory" && (
                                <Group
                                  gap="xs"
                                >
                                  <NumberInput
                                    size="xs"
                                    label={mt("movementAccessoryAddress")}
                                    min={1}
                                    max={2048}
                                    value={
                                      action.accessoryAddress
                                    }
                                    onChange={
                                      value =>
                                        updateAction(
                                          sequence.id,
                                          action.id,
                                          {
                                            accessoryAddress:
                                              Math.max(
                                                1,
                                                Math.min(
                                                  2048,
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

                                  <NumberInput
                                    size="xs"
                                    label={mt("movementAccessoryAspect")}
                                    min={0}
                                    max={255}
                                    value={
                                      action.accessoryAspect
                                    }
                                    onChange={
                                      value =>
                                        updateAction(
                                          sequence.id,
                                          action.id,
                                          {
                                            accessoryAspect:
                                              Math.max(
                                                0,
                                                Math.min(
                                                  255,
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
                                "log" && (
                                <TextInput
                                  size="xs"
                                  label={mt("movementMessage")}
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
                          </Collapse>
                        </Card>
                      </div>
                    )
                  )
                }
              </Stack>
              </Collapse>
            </Card>
          )
        )
      }
    </Stack>
  );
}
