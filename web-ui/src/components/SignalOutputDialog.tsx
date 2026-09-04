import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  ColorPicker,
  Group,
  NumberInput,
  Paper,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconBolt,
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import AppModal from "@/components/common/AppModal";
import type {
  SignalDccDirection,
  SignalOutputConfiguration,
  SignalOutputProtocol,
  SignalOutputState,
} from "@/domain/layout/signalOutput";
import {
  cloneSignalOutputConfiguration,
  MAX_SIGNAL_LAMPS,
  newSignalOutputStateId,
  resizeDccOutputs,
  resizeSignalLamps,
} from "@/domain/layout/signalOutput";

type Props = {
  opened: boolean;
  value: SignalOutputConfiguration;
  onClose: () => void;
  onApply: (value: SignalOutputConfiguration) => void;
  onTestState?: (
    config: SignalOutputConfiguration,
    state: SignalOutputState
  ) => void;
};

const DCC_DIRECTION_OPTIONS = [
  { value: "R", label: "R" },
  { value: "G", label: "G" },
] satisfies Array<{ value: SignalDccDirection; label: string }>;

const SIGNAL_LAMP_COLORS = [
  //"#000000", // black
  "#fa5252", // red
  "#fab005", // yellow
  "#40c057", // green
  "#ffffff", // white
  "#228be6", // blue
  "#f783ac", // pink
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function commandPreview(
  config: SignalOutputConfiguration,
  state: SignalOutputState
): string {
  if (config.protocol === "dccext") {
    return `<A ${config.address} ${state.aspect}>`;
  }

  return state.dccOutputs
    .slice(0, config.outputCount)
    .map(
      (direction, index) =>
        `<a ${config.address + index} ${direction === "G" ? 1 : 0}>`
    )
    .join("  ");
}

function getLampColors(
  states: SignalOutputState[],
  lampCount: number
): string[] {
  return Array.from({ length: lampCount }, (_, lampIndex) => {
    for (const state of states) {
      const color = state.lamps[lampIndex]?.color;
      if (color) return color;
    }
    return SIGNAL_LAMP_COLORS[lampIndex] ?? "#868e96";
  });
}

function normalizeLampColors(
  config: SignalOutputConfiguration
): SignalOutputConfiguration {
  const colors = getLampColors(config.states, config.lampCount);
  return {
    ...config,
    states: config.states.map(state => ({
      ...state,
      lamps: resizeSignalLamps(state.lamps, config.lampCount).map(
        (lamp, lampIndex) => ({
          ...lamp,
          color: colors[lampIndex] ?? lamp.color,
        })
      ),
    })),
  };
}

function LampPreview({
  state,
  lampCount,
  onLampColorChange,
}: {
  state: SignalOutputState;
  lampCount: number;
  onLampColorChange?: (lampIndex: number, color: string) => void;
}) {
  const lamps = resizeSignalLamps(state.lamps, lampCount);

  return (
    <Group gap={5} wrap="nowrap">
      {lamps.map((lamp, index) => (
        <Popover
          key={index}
          width={210}
          position="bottom"
          withArrow
          shadow="md"
          disabled={!onLampColorChange}
        >
          <Popover.Target>
            <Box
              role={onLampColorChange ? "button" : undefined}
              aria-label={onLampColorChange ? `Change lamp ${index + 1} color` : undefined}
              tabIndex={onLampColorChange ? 0 : undefined}
              w={18}
              h={18}
              style={{
                flex: "0 0 auto",
                borderRadius: "50%",
                background: lamp.active
                  ? lamp.color
                  : "var(--mantine-color-dark-5)",
                border: `2px solid ${lamp.color}`,
                boxShadow: lamp.active ? `0 0 7px ${lamp.color}` : undefined,
                cursor: onLampColorChange ? "pointer" : undefined,
              }}
            />
          </Popover.Target>
          <Popover.Dropdown>
            <ColorPicker
              format="hex"
              value={lamp.color}
              swatches={SIGNAL_LAMP_COLORS}
              swatchesPerRow={6}
              onChange={color => onLampColorChange?.(index, color)}
            />
          </Popover.Dropdown>
        </Popover>
      ))}
    </Group>
  );
}

export default function SignalOutputDialog({
  opened,
  value,
  onClose,
  onApply,
  onTestState,
}: Props) {
  const [draft, setDraft] = useState<SignalOutputConfiguration>(() =>
    cloneSignalOutputConfiguration(value)
  );

  useEffect(() => {
    if (!opened) return;
    setDraft(normalizeLampColors(cloneSignalOutputConfiguration(value)));
  }, [opened, value]);

  const dccAddresses = useMemo(
    () => Array.from({ length: draft.outputCount }, (_, index) => draft.address + index),
    [draft.address, draft.outputCount]
  );

  const updateState = (
    stateId: string,
    updater: (state: SignalOutputState) => SignalOutputState
  ) => {
    setDraft(current => ({
      ...current,
      states: current.states.map(state =>
        state.id === stateId ? updater(state) : state
      ),
    }));
  };

  const updateLampColor = (lampIndex: number, color: string) => {
    setDraft(current => ({
      ...current,
      states: current.states.map(state => {
        const nextLamps = resizeSignalLamps(state.lamps, current.lampCount);
        nextLamps[lampIndex] = {
          ...nextLamps[lampIndex]!,
          color,
        };
        return { ...state, lamps: nextLamps };
      }),
    }));
  };

  const changeProtocol = (raw: string) => {
    setDraft(current => ({
      ...current,
      protocol: raw as SignalOutputProtocol,
    }));
  };

  const changeAddress = (raw: string | number) => {
    const numeric = typeof raw === "number" ? raw : Number(raw);
    setDraft(current => ({
      ...current,
      address: clamp(Number.isFinite(numeric) ? numeric : 1, 1, 2048),
    }));
  };

  const changeLampCount = (raw: string | number) => {
    const numeric = typeof raw === "number" ? raw : Number(raw);
    const lampCount = clamp(
      Number.isFinite(numeric) ? numeric : 1,
      1,
      MAX_SIGNAL_LAMPS
    );

    setDraft(current => {
      const colors = getLampColors(current.states, lampCount);
      return {
        ...current,
        lampCount,
        states: current.states.map(state => ({
          ...state,
          lamps: resizeSignalLamps(state.lamps, lampCount).map(
            (lamp, lampIndex) => ({
              ...lamp,
              color: colors[lampIndex] ?? lamp.color,
            })
          ),
        })),
      };
    });
  };

  const changeOutputCount = (raw: string | number) => {
    const numeric = typeof raw === "number" ? raw : Number(raw);
    const outputCount = clamp(Number.isFinite(numeric) ? numeric : 1, 1, 16);

    setDraft(current => ({
      ...current,
      outputCount,
      states: current.states.map(state => ({
        ...state,
        dccOutputs: resizeDccOutputs(state.dccOutputs, outputCount),
      })),
    }));
  };

  const addState = () => {
    setDraft(current => {
      const colors = getLampColors(current.states, current.lampCount);
      const nextAspect = clamp(
        current.states.reduce((max, state) => Math.max(max, state.aspect), -1) + 1,
        0,
        255
      );

      return {
        ...current,
        states: [
          ...current.states,
          {
            id: newSignalOutputStateId(),
            label: `Aspect ${current.states.length + 1}`,
            aspect: nextAspect,
            lamps: Array.from({ length: current.lampCount }, (_, lampIndex) => ({
              color: colors[lampIndex] ?? "#868e96",
              active: false,
            })),
            dccOutputs: Array.from(
              { length: current.outputCount },
              () => "R" as const
            ),
          },
        ],
      };
    });
  };

  const removeState = (stateId: string) => {
    setDraft(current => {
      if (current.states.length <= 2) return current;
      return {
        ...current,
        states: current.states.filter(state => state.id !== stateId),
      };
    });
  };

  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      title="Signal configuration"
      size="90vw"
      draggable
      centered
      styles={{
        content: { height: "90vh" },
        body: { height: "calc(90vh - 56px)", overflow: "auto" },
      }}
    >
      <Stack gap="md">
        <Paper withBorder p="sm">
          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <Box>
                <Text fw={800}>Signal definition</Text>
                <Text size="xs" c="dimmed">
                  Physical lamps, logical states and DCC mapping are independent.
                </Text>
              </Box>

              <Badge
                variant="light"
                color={draft.protocol === "dccext" ? "violet" : "blue"}
              >
                {draft.protocol === "dccext" ? "DCC Extended" : "DCC"}
              </Badge>
            </Group>

            <SegmentedControl
              fullWidth
              value={draft.protocol}
              onChange={changeProtocol}
              data={[
                { value: "dcc", label: "DCC" },
                { value: "dccext", label: "DCC Extended" },
              ]}
            />

            <Group grow align="flex-start">
              <NumberInput
                label={draft.protocol === "dccext" ? "DCC address" : "Start DCC address"}
                value={draft.address}
                min={1}
                max={2048}
                allowDecimal={false}
                allowNegative={false}
                onChange={changeAddress}
              />

              <Switch
                label="Single lamp display"
                description="Compact layout display; logical states and lamp definitions stay unchanged"
                checked={draft.displayAsSingleLamp}
                mt={26}
                onChange={event => {
                  const checked = event.currentTarget.checked;
                  setDraft(current => ({
                    ...current,
                    displayAsSingleLamp: checked,
                  }));
                }}
              />

              <NumberInput
                label="Physical lamps"
                description={`Number of lamps drawn on the layout (max ${MAX_SIGNAL_LAMPS})`}
                value={draft.lampCount}
                min={1}
                max={MAX_SIGNAL_LAMPS}
                allowDecimal={false}
                allowNegative={false}
                onChange={changeLampCount}
              />

              {draft.protocol === "dcc" && (
                <NumberInput
                  label="DCC output addresses"
                  description="Consecutive accessory addresses"
                  value={draft.outputCount}
                  min={1}
                  max={16}
                  allowDecimal={false}
                  allowNegative={false}
                  onChange={changeOutputCount}
                />
              )}
            </Group>
          </Stack>
        </Paper>

        <Group justify="space-between" align="flex-end">
          <Box>
            <Text fw={800}>Signal states / aspects</Text>
            <Text size="sm" c="dimmed">
              Each row is one logical state. The number of states does not have to
              match the number of lamps.
            </Text>
          </Box>

          <Button variant="light" leftSection={<IconPlus size={16} />} onClick={addState}>
            Add aspect
          </Button>
        </Group>

        <ScrollArea
          type="always"
          scrollbars="x"
          offsetScrollbars
          scrollbarSize={10}
          w="100%"
          style={{ maxWidth: "100%" }}
        >
          <Table
            striped
            highlightOnHover
            withTableBorder
            withColumnBorders
            w={Math.max(
              1050,
              430 +
                draft.lampCount * 75 +
                (draft.protocol === "dcc" ? draft.outputCount * 90 : 120)
            )}
            miw={Math.max(
              1050,
              430 +
                draft.lampCount * 75 +
                (draft.protocol === "dcc" ? draft.outputCount * 90 : 120)
            )}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>State</Table.Th>
                <Table.Th>Preview</Table.Th>

                {Array.from({ length: draft.lampCount }, (_, index) => (
                  <Table.Th key={`lamp-head-${index}`} ta="center">
                    Lamp {index + 1}
                  </Table.Th>
                ))}

                {draft.protocol === "dccext" ? (
                  <Table.Th>Aspect</Table.Th>
                ) : (
                  dccAddresses.map(address => (
                    <Table.Th key={`dcc-head-${address}`} ta="center">
                      {address}
                    </Table.Th>
                  ))
                )}

                <Table.Th ta="center">Test</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>

            <Table.Tbody>
              {draft.states.map(state => {
                const lamps = resizeSignalLamps(state.lamps, draft.lampCount);
                const outputs = resizeDccOutputs(
                  state.dccOutputs,
                  draft.outputCount
                );

                return (
                  <Table.Tr key={state.id}>
                    <Table.Td miw={160}>
                      <TextInput
                        value={state.label}
                        onChange={event => {
                          const label = event.currentTarget.value;
                          updateState(state.id, current => ({ ...current, label }));
                        }}
                      />
                    </Table.Td>

                    <Table.Td miw={150}>
                      <LampPreview
                        state={state}
                        lampCount={draft.lampCount}
                        onLampColorChange={updateLampColor}
                      />
                    </Table.Td>

                    {lamps.map((lamp, lampIndex) => (
                      <Table.Td key={`${state.id}-lamp-${lampIndex}`} miw={75}>
                        <Group justify="center">
                          <Checkbox
                            label="On"
                            checked={lamp.active}
                            onChange={event => {
                              const checked = event.currentTarget.checked;
                              updateState(state.id, current => {
                                const nextLamps = resizeSignalLamps(
                                  current.lamps,
                                  draft.lampCount
                                );
                                nextLamps[lampIndex] = {
                                  ...nextLamps[lampIndex]!,
                                  active: checked,
                                };
                                return { ...current, lamps: nextLamps };
                              });
                            }}
                          />
                        </Group>
                      </Table.Td>
                    ))}

                    {draft.protocol === "dccext" ? (
                      <Table.Td miw={110}>
                        <NumberInput
                          value={state.aspect}
                          min={0}
                          max={255}
                          allowDecimal={false}
                          allowNegative={false}
                          onChange={raw => {
                            const numeric =
                              typeof raw === "number" ? raw : Number(raw);
                            updateState(state.id, current => ({
                              ...current,
                              aspect: clamp(
                                Number.isFinite(numeric) ? numeric : 0,
                                0,
                                255
                              ),
                            }));
                          }}
                        />
                      </Table.Td>
                    ) : (
                      outputs.map((direction, outputIndex) => (
                        <Table.Td key={`${state.id}-out-${outputIndex}`} miw={85}>
                          <Select
                            value={direction}
                            data={DCC_DIRECTION_OPTIONS}
                            allowDeselect={false}
                            onChange={raw =>
                              updateState(state.id, current => {
                                const nextOutputs = resizeDccOutputs(
                                  current.dccOutputs,
                                  draft.outputCount
                                );
                                nextOutputs[outputIndex] = raw === "G" ? "G" : "R";
                                return { ...current, dccOutputs: nextOutputs };
                              })
                            }
                          />
                        </Table.Td>
                      ))
                    )}

                    <Table.Td ta="center">
                      <Tooltip label={commandPreview(draft, state)}>
                        <ActionIcon
                          size="lg"
                          variant="light"
                          color="teal"
                          onClick={() => onTestState?.(draft, state)}
                        >
                          <IconBolt size={18} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>

                    <Table.Td ta="center">
                      <Tooltip
                        label={
                          draft.states.length <= 2
                            ? "At least two states are required"
                            : "Delete aspect"
                        }
                      >
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          disabled={draft.states.length <= 2}
                          onClick={() => removeState(state.id)}
                        >
                          <IconTrash size={18} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>

        <Paper withBorder p="xs">
          <Stack gap={5}>
            <Text size="xs" fw={700} c="dimmed">
              COMMAND PREVIEW
            </Text>

            {draft.states.map(state => (
              <Group key={`preview-${state.id}`} gap="xs" wrap="nowrap">
                <LampPreview
                  state={state}
                  lampCount={draft.lampCount}
                  onLampColorChange={updateLampColor}
                />
                <Text size="xs" w={100} truncate>
                  {state.label}
                </Text>
                <Text size="xs" ff="monospace" c="blue.4">
                  {commandPreview(draft, state)}
                </Text>
              </Group>
            ))}
          </Stack>
        </Paper>

        <Group justify="flex-end">
          <Button variant="default" leftSection={<IconX size={16} />} onClick={onClose}>
            Cancel
          </Button>

          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            onClick={() => onApply(cloneSignalOutputConfiguration(normalizeLampColors(draft)))}
          >
            Apply
          </Button>
        </Group>
      </Stack>
    </AppModal>
  );
}
