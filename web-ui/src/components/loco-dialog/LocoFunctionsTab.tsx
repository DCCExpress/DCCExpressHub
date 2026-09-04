import {
  useEffect,
  useState,
} from "react";

import {
  ActionIcon,
  Button,
  Card,
  Checkbox,
  Group,
  NumberInput,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";

import {
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

import type {
  LocoFunction,
} from "@domain/types";

type LocoFunctionsTabProps = {
  functions: LocoFunction[];
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
  onAddFunction,
  onUpdateFunction,
  onDeleteFunction,
  onFunctionTest,
  t,
}: LocoFunctionsTabProps) {
  const [
    activeTestFunctions,
    setActiveTestFunctions,
  ] = useState<Set<string>>(
    () => new Set()
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
        <Stack gap="sm">
          {functions.map(fn => {
            const testActive =
              activeTestFunctions.has(
                fn.id
              );

            return (
              <Card
                key={fn.id}
                withBorder
                p="sm"
              >
                <Group
                  className="loco-function-editor-row"
                  align="flex-start"
                  wrap="nowrap"
                >
                  <NumberInput
                    label={t(
                      "locodialog.function_number"
                    )}
                    value={fn.number}
                    min={0}
                    w={110}
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

                  <TextInput
                    label={t(
                      "locodialog.functionname"
                    )}
                    value={fn.name}
                    style={{
                      flex: 1,
                    }}
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

                  <TextInput
                    label="Ikon"
                    value={fn.icon}
                    w={90}
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

                  <Checkbox
                    mt={30}
                    label={t(
                      "locodialog.function_momentary"
                    )}
                    checked={
                      fn.momentary
                    }
                    onChange={
                      event => {
                        const momentary =
                          event
                            .currentTarget
                            .checked;

                        // If a normal test function was left ON and the
                        // user converts it to momentary, switch it OFF
                        // before changing its behavior.
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
                          }
                        );
                      }
                    }
                  />

                  <Button
                    mt={24}
                    size="xs"
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

                    // Normal functions toggle on each click.
                    onClick={() => {
                      if (
                        !fn.momentary
                      ) {
                        toggleTestState(
                          fn
                        );
                      }
                    }}

                    // Momentary functions are active only while held.
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

                  <ActionIcon
                    mt={28}
                    color="red"
                    variant="light"
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
                      size={16}
                    />
                  </ActionIcon>
                </Group>
              </Card>
            );
          })}

          {functions.length ===
            0 && (
            <Text
              size="sm"
              c="dimmed"
            >
              {t(
                "locodialog.functions_empty"
              )}
            </Text>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
