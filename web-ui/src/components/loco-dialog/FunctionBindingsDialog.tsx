import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import {
  useEffect,
  useState,
} from "react";

import type {
  FunctionBinding,
} from "@domain/types";

import AppModal from "../common/AppModal";

type Props = {
  opened: boolean;
  bindings: FunctionBinding[];
  selectedBindingId: number | null;
  onClose: () => void;
  onCommit: (
    bindings: FunctionBinding[],
    selectedBindingId: number | null
  ) => void;
};

export default function FunctionBindingsDialog({
  opened,
  bindings,
  selectedBindingId,
  onClose,
  onCommit,
}: Props) {
  const [
    draft,
    setDraft,
  ] =
    useState<FunctionBinding[]>([]);

  const [
    selectedId,
    setSelectedId,
  ] =
    useState<number | null>(
      null
    );

  useEffect(
    () => {
      if (!opened) {
        return;
      }

      setDraft(
        bindings.map(
          binding => ({
            ...binding,
          })
        )
      );

      setSelectedId(
        selectedBindingId
      );
    },
    [
      opened,
      bindings,
      selectedBindingId,
    ]
  );

  const addBinding =
    (): void => {
      const nextId =
        draft.reduce(
          (
            max,
            binding
          ) =>
            Math.max(
              max,
              binding.id
            ),
          0
        ) +
        1;

      setDraft(
        current => [
          ...current,
          {
            id:
              nextId,
            name:
              `Binding ${nextId}`,
          },
        ]
      );

      setSelectedId(
        nextId
      );
    };

  const updateBinding =
    (
      originalId: number,
      patch:
        Partial<FunctionBinding>
    ): void => {
      setDraft(
        current =>
          current.map(
            binding =>
              binding.id ===
                originalId
                ? {
                    ...binding,
                    ...patch,
                  }
                : binding
          )
      );

      if (
        patch.id !==
          undefined &&
        selectedId ===
          originalId
      ) {
        setSelectedId(
          patch.id
        );
      }
    };

  const deleteBinding =
    (
      id: number
    ): void => {
      setDraft(
        current =>
          current.filter(
            binding =>
              binding.id !==
              id
          )
      );

      if (
        selectedId ===
          id
      ) {
        setSelectedId(
          null
        );
      }
    };

  const hasInvalidBinding =
    draft.some(
      binding =>
        !Number.isInteger(
          binding.id
        ) ||
        binding.id <=
          0 ||
        !binding.name.trim() ||
        draft.some(
          other =>
            other !==
              binding &&
            other.id ===
              binding.id
        )
    );

  return (
    <AppModal
      opened={
        opened
      }
      onClose={
        onClose
      }
      title="Function Bindings"
      size="lg"
      centered
      draggable
    >
      <Stack
        gap="sm"
      >
        <Group
          justify="space-between"
        >
          <Text
            size="sm"
            c="dimmed"
          >
            Select the logical function used by automation and Movement.
          </Text>

          <Button
            size="xs"
            leftSection={
              <IconPlus
                size={14}
              />
            }
            onClick={
              addBinding
            }
          >
            Add
          </Button>
        </Group>

        <ScrollArea
          h={360}
        >
          <Table
            striped
            highlightOnHover
            withTableBorder
            withColumnBorders
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th
                  w={130}
                >
                  ID
                </Table.Th>

                <Table.Th>
                  Name
                </Table.Th>

                <Table.Th
                  w={56}
                />
              </Table.Tr>
            </Table.Thead>

            <Table.Tbody>
              {
                draft.map(
                  binding => {
                    const selected =
                      selectedId ===
                      binding.id;

                    return (
                      <Table.Tr
                        key={
                          binding.id
                        }
                        onClick={
                          () =>
                            setSelectedId(
                              binding.id
                            )
                        }
                        style={{
                          cursor:
                            "pointer",
                          outline:
                            selected
                              ? "2px solid var(--mantine-color-blue-6)"
                              : undefined,
                          outlineOffset:
                            -2,
                        }}
                      >
                        <Table.Td>
                          <NumberInput
                            value={
                              binding.id
                            }
                            min={1}
                            allowDecimal={
                              false
                            }
                            allowNegative={
                              false
                            }
                            onClick={
                              event =>
                                event.stopPropagation()
                            }
                            onChange={
                              value => {
                                const next =
                                  Math.round(
                                    Number(
                                      value
                                    ) ||
                                    0
                                  );

                                updateBinding(
                                  binding.id,
                                  {
                                    id:
                                      next,
                                  }
                                );
                              }
                            }
                          />
                        </Table.Td>

                        <Table.Td>
                          <TextInput
                            value={
                              binding.name
                            }
                            onClick={
                              event =>
                                event.stopPropagation()
                            }
                            onChange={
                              event =>
                                updateBinding(
                                  binding.id,
                                  {
                                    name:
                                      event.currentTarget.value,
                                  }
                                )
                            }
                          />
                        </Table.Td>

                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="light"
                            onClick={
                              event => {
                                event.stopPropagation();

                                deleteBinding(
                                  binding.id
                                );
                              }
                            }
                          >
                            <IconTrash
                              size={16}
                            />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    );
                  }
                )
              }
            </Table.Tbody>
          </Table>
        </ScrollArea>

        {
          hasInvalidBinding && (
            <Text
              size="xs"
              c="red"
            >
              Binding IDs must be unique positive integers and names cannot be empty.
            </Text>
          )
        }

        <Group
          justify="flex-end"
        >
          <Button
            variant="default"
            onClick={
              onClose
            }
          >
            Cancel
          </Button>

          <Button
            disabled={
              hasInvalidBinding
            }
            onClick={
              () =>
                onCommit(
                  draft,
                  selectedId
                )
            }
          >
            OK
          </Button>
        </Group>
      </Stack>
    </AppModal>
  );
}
