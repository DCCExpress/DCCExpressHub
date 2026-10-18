import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  SegmentedControl,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";

import {
  IconDots,
} from "@tabler/icons-react";

import type {
  FunctionBinding,
  LocoFunction,
} from "@domain/types";

import FunctionBindingsDialog from "./FunctionBindingsDialog";
import FunctionIconPicker from "./FunctionIconPicker";
import { useFunctionButtonDisplayMode, setFunctionButtonDisplayMode } from "../../services/functionButtonDisplayMode";
import FunctionIconAsset from "../loco/FunctionIconAsset";


type LocoFunctionsTabProps = {
  functions: LocoFunction[];
  /** Legacy callbacks retained for existing dialog callers; fixed slots cannot be added/removed. */
  onAddFunction?: () => void;
  onDeleteFunction?: (fnId: string) => void;
  functionBindings: FunctionBinding[];
  onFunctionBindingsChange: (
    bindings: FunctionBinding[]
  ) => void;
  onUpdateFunction: (
    fnId: string,
    patch: Partial<LocoFunction>
  ) => void;
  onFunctionTest: (
    fn: LocoFunction,
    active: boolean
  ) => void;
  t: (key: string) => string;
};

export default function LocoFunctionsTab({
  functions,
  functionBindings,
  onFunctionBindingsChange,
  onUpdateFunction,
  onFunctionTest,
  t,
}: LocoFunctionsTabProps) {
  useTranslation();
  const displayMode = useFunctionButtonDisplayMode();
  const cardFunctionCount = functions.filter(fn => fn.showOnLocoCard ?? fn.number < 5).length;
  const [iconFunctionId, setIconFunctionId] = useState<string | null>(null);
  const iconFunction = functions.find(fn => fn.id === iconFunctionId);
  const [
    activeTestFunctions,
    setActiveTestFunctions,
  ] = useState<Set<string>>(
    () => new Set()
  );

  const [
    bindingFunctionId,
    setBindingFunctionId,
  ] =
    useState<string | null>(
      null
    );

  const bindingFunction =
    useMemo(
      () =>
        functions.find(
          fn =>
            fn.id ===
            bindingFunctionId
        ) ??
        null,
      [
        functions,
        bindingFunctionId,
      ]
    );

  const bindingNameById =
    useMemo(
      () =>
        new Map(
          functionBindings.map(
            binding => [
              binding.id,
              binding.name,
            ] as const
          )
        ),
      [
        functionBindings,
      ]
    );

  // Drop stale editor-only test states when functions are
  // deleted or another locomotive is selected.
  useEffect(() => {
    const validIds =
      new Set(
        functions.map(fn => fn.id)
      );

    setActiveTestFunctions(
      previous => {
        const next =
          new Set(
            [...previous].filter(
              id => validIds.has(id)
            )
          );

        if (
          next.size ===
          previous.size
        ) {
          return previous;
        }

        return next;
      }
    );
  }, [functions]);

  const setTestState = (
    fn: LocoFunction,
    active: boolean
  ): void => {
    setActiveTestFunctions(
      previous => {
        const next =
          new Set(previous);

        if (active) {
          next.add(fn.id);
        } else {
          next.delete(fn.id);
        }

        return next;
      }
    );

    onFunctionTest(
      fn,
      active
    );
  };

  const toggleTestState = (
    fn: LocoFunction
  ): void => {
    const nextActive =
      !activeTestFunctions.has(
        fn.id
      );

    setTestState(
      fn,
      nextActive
    );
  };

  return (
    <Stack h="100%">
      <Group gap="xs" wrap="wrap">
        <Text size="xs" fw={600}>LocoPanel function buttons</Text>
        <SegmentedControl size="xs" value={displayMode} onChange={value => setFunctionButtonDisplayMode(value as typeof displayMode)}
          data={[{ label: "Default (F0–F28)", value: "default" }, { label: "Icon", value: "icon" },
            { label: "Icon + text", value: "icon-text" }, { label: "Text", value: "text" }]} />
      </Group>
      <Group
        justify="space-between"
      >
        <Text fw={600}>
          {t(
            "locodialog.loco_functions"
          )}
        </Text>
        <Text size="xs" c="dimmed">Loco Card: {cardFunctionCount} / 5</Text>


      </Group>

      <ScrollArea
        style={{
          flex: 1,
          minHeight: 0,
        }}
      >
        <Table
          stickyHeader
          striped
          highlightOnHover
          withTableBorder
          withColumnBorders
          verticalSpacing="xs"
          horizontalSpacing="sm"
          style={{
            minWidth: 810,
            tableLayout: "fixed",
          }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={44}>#</Table.Th>
              <Table.Th>
                {t(
                  "locodialog.functionname"
                )}
              </Table.Th>
              <Table.Th w={210}>
                {i18next.t(
                  "ui.functionBinding"
                )}
              </Table.Th>
              <Table.Th w={90}>
                {i18next.t(
                  "ui.icon"
                )}
              </Table.Th>
              <Table.Th w={88} ta="center">Loco Card</Table.Th>
              <Table.Th
                w={120}
                ta="center"
              >
                <Tooltip
                  label={t(
                    "locodialog.function_startup_tooltip"
                  )}
                  withArrow
                >
                  <Text
                    span
                    size="sm"
                    fw={600}
                  >
                    {t(
                      "locodialog.function_startup"
                    )}
                  </Text>
                </Tooltip>
              </Table.Th>
              <Table.Th
                w={110}
                ta="center"
              >
                {t(
                  "locodialog.function_momentary"
                )}
              </Table.Th>
              <Table.Th
                w={95}
                ta="center"
              >
                {t(
                  "locodialog.function_test"
                )}
              </Table.Th>
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {functions.map(fn => {
              const testActive =
                activeTestFunctions.has(
                  fn.id
                );

              return (
                <Table.Tr
                  key={fn.id}
                >
                  <Table.Td>
                    <Text size="sm" fw={600}>F{fn.number}</Text>
                  </Table.Td>

                  <Table.Td>
                    <TextInput
                      size="xs"
                      value={fn.name}
                      onChange={
                        event =>
                          onUpdateFunction(
                            fn.id,
                            {
                              name:
                                event
                                  .currentTarget
                                  .value,
                            }
                          )
                      }
                    />
                  </Table.Td>

                  <Table.Td>
                    <TextInput
                      size="xs"
                      value={
                        fn.bindingId ===
                          undefined ||
                        fn.bindingId ===
                          null
                          ? ""
                          : (
                              bindingNameById.get(
                                fn.bindingId
                              ) ??
                              `#${fn.bindingId}`
                            )
                      }
                      readOnly
                      rightSection={
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          aria-label={i18next.t(
                            "ui.functionBindings"
                          )}
                          onClick={
                            () =>
                              setBindingFunctionId(
                                fn.id
                              )
                          }
                        >
                          <IconDots
                            size={16}
                          />
                        </ActionIcon>
                      }
                    />
                  </Table.Td>

                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      {(() => {
                        return <ActionIcon size="lg" variant="light" color="gray"
                          title="Select function icon" aria-label="Select function icon"
                          onClick={() => setIconFunctionId(fn.id)}>
                          {fn.icon ? <FunctionIconAsset fn={fn} size={22} /> : <IconDots size={18} />}
                        </ActionIcon>;
                      })()}
                    </Group>
                  </Table.Td>

                  <Table.Td>
                    <Group justify="center">
                      <Checkbox aria-label={`Show F${fn.number} on Loco Card`}
                        checked={fn.showOnLocoCard ?? fn.number < 5}
                        disabled={!(fn.showOnLocoCard ?? fn.number < 5) && cardFunctionCount >= 5}
                        onChange={event => onUpdateFunction(fn.id, { showOnLocoCard: event.currentTarget.checked })} />
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Group
                      justify="center"
                      wrap="nowrap"
                    >
                      <Tooltip
                        label={
                          fn.momentary
                            ? t(
                                "locodialog.function_startup_unavailable_momentary"
                              )
                            : t(
                                "locodialog.function_startup_tooltip"
                              )
                        }
                        withArrow
                      >
                        <Checkbox
                          checked={
                            Boolean(
                              fn.startupActive
                            )
                          }
                          disabled={
                            fn.momentary
                          }
                          aria-label={t(
                            "locodialog.function_startup_tooltip"
                          )}
                          onChange={
                            event =>
                              onUpdateFunction(
                                fn.id,
                                {
                                  startupActive:
                                    event
                                      .currentTarget
                                      .checked,
                                }
                              )
                          }
                        />
                      </Tooltip>
                    </Group>
                  </Table.Td>

                  <Table.Td>
                    <Group
                      justify="center"
                      wrap="nowrap"
                    >
                      <Checkbox
                        checked={
                          fn.momentary
                        }
                        onChange={
                          event => {
                            const momentary =
                              event
                                .currentTarget
                                .checked;

                            if (
                              momentary &&
                              testActive
                            ) {
                              setTestState(
                                fn,
                                false
                              );
                            }

                            onUpdateFunction(
                              fn.id,
                              {
                                momentary,
                                ...(momentary
                                  ? {
                                      startupActive:
                                        false,
                                    }
                                  : {}),
                              }
                            );
                          }
                        }
                      />
                    </Group>
                  </Table.Td>

                  <Table.Td>
                    <Group
                      justify="center"
                      wrap="nowrap"
                    >
                      <Button
                        size="compact-xs"
                        {...(
                          testActive
                            ? {
                                color:
                                  "green" as const,
                                variant:
                                  "filled" as const,
                              }
                            : {
                                variant:
                                  "light" as const,
                              }
                        )}
                        onClick={() => {
                          if (
                            !fn.momentary
                          ) {
                            toggleTestState(
                              fn
                            );
                          }
                        }}
                        onPointerDown={
                          event => {
                            if (
                              !fn.momentary
                            ) {
                              return;
                            }

                            event
                              .preventDefault();

                            setTestState(
                              fn,
                              true
                            );
                          }
                        }
                        onPointerUp={
                          event => {
                            if (
                              !fn.momentary
                            ) {
                              return;
                            }

                            event
                              .preventDefault();

                            setTestState(
                              fn,
                              false
                            );
                          }
                        }
                        onPointerCancel={
                          event => {
                            if (
                              !fn.momentary
                            ) {
                              return;
                            }

                            event
                              .preventDefault();

                            setTestState(
                              fn,
                              false
                            );
                          }
                        }
                        onPointerLeave={
                          event => {
                            if (
                              fn.momentary &&
                              event.buttons === 1
                            ) {
                              setTestState(
                                fn,
                                false
                              );
                            }
                          }
                        }
                      >
                        {t(
                          "locodialog.function_test"
                        )}
                      </Button>
                    </Group>
                  </Table.Td>

                </Table.Tr>
              );
            })}

            {functions.length ===
              0 && (
              <Table.Tr>
                <Table.Td
                  colSpan={8}
                >
                  <Text
                    size="sm"
                    c="dimmed"
                    ta="center"
                    py="md"
                  >
                    {t(
                      "locodialog.functions_empty"
                    )}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <FunctionIconPicker opened={iconFunction !== undefined} value={iconFunction?.icon ?? ""}
        onClose={() => setIconFunctionId(null)}
        onSelect={(icon, mode, color) => { if (iconFunction) onUpdateFunction(iconFunction.id, { icon, iconTintMode: mode, iconColor: color }); }} />
      <FunctionBindingsDialog
        opened={
          bindingFunction !==
          null
        }
        bindings={
          functionBindings
        }
        selectedBindingId={
          bindingFunction?.bindingId ??
          null
        }
        onClose={
          () =>
            setBindingFunctionId(
              null
            )
        }
        onCommit={
          (
            bindings,
            selectedBindingId
          ) => {
            onFunctionBindingsChange(
              bindings
            );

            if (
              bindingFunction
            ) {
              onUpdateFunction(
                bindingFunction.id,
                selectedBindingId ===
                  null
                  ? {
                      bindingId:
                        null,
                    }
                  : {
                      bindingId:
                        selectedBindingId,
                    }
              );
            }

            setBindingFunctionId(
              null
            );
          }
        }
      />
    </Stack>
  );
}
