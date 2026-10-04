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
  NumberInput,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";

import {
  IconDots,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

import type {
  FunctionBinding,
  LocoFunction,
} from "@domain/types";

import FunctionBindingsDialog from "./FunctionBindingsDialog";

type LocoFunctionsTabProps = {
  functions: LocoFunction[];
  functionBindings: FunctionBinding[];
  onFunctionBindingsChange: (
    bindings: FunctionBinding[]
  ) => void;
  onAddFunction: () => void;
  onUpdateFunction: (
    fnId: string,
    patch: Partial<LocoFunction>
  ) => void;
  onDeleteFunction: (
    fnId: string
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
  onAddFunction,
  onUpdateFunction,
  onDeleteFunction,
  onFunctionTest,
  t,
}: LocoFunctionsTabProps) {
  useTranslation();
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
      <Group
        justify="space-between"
      >
        <Text fw={600}>
          {t(
            "locodialog.loco_functions"
          )}
        </Text>

        <Button
          size="xs"
          leftSection={
            <IconPlus size={14} />
          }
          onClick={
            onAddFunction
          }
        >
          {t(
            "locodialog.new_function"
          )}
        </Button>
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
            minWidth: 940,
            tableLayout: "fixed",
          }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={90}>
                {t(
                  "locodialog.function_number"
                )}
              </Table.Th>
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
              <Table.Th
                w={110}
                ta="center"
              >
                {t(
                  "locodialog.function_momentary"
                )}
              </Table.Th>
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
                w={95}
                ta="center"
              >
                {t(
                  "locodialog.function_test"
                )}
              </Table.Th>
              <Table.Th w={52} />
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
                    <NumberInput
                      size="xs"
                      value={fn.number}
                      min={0}
                      onChange={
                        value =>
                          onUpdateFunction(
                            fn.id,
                            {
                              number:
                                Number(
                                  value
                                ) || 0,
                            }
                          )
                      }
                    />
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
                    <TextInput
                      size="xs"
                      value={fn.icon}
                      onChange={
                        event =>
                          onUpdateFunction(
                            fn.id,
                            {
                              icon:
                                event
                                  .currentTarget
                                  .value,
                            }
                          )
                      }
                    />
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

                  <Table.Td>
                    <Group
                      justify="center"
                      wrap="nowrap"
                    >
                      <ActionIcon
                        size="sm"
                        color="red"
                        variant="light"
                        aria-label={t(
                          "locodialog.delete"
                        )}
                        onClick={() => {
                          if (
                            testActive
                          ) {
                            setTestState(
                              fn,
                              false
                            );
                          }

                          onDeleteFunction(
                            fn.id
                          );
                        }}
                      >
                        <IconTrash
                          size={15}
                        />
                      </ActionIcon>
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
