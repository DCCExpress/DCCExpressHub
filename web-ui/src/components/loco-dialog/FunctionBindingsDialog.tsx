import i18next from "i18next";
import {
  ActionIcon,
  Button,
  Group,
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
        binding.id >
          65535 ||
        !binding.name.trim()
    );

  return (
    <AppModal
      opened={
        opened
      }
      onClose={
        onClose
      }
      title={i18next.t("ui.functionBindings")}
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
            {i18next.t("ui.functionBindingHint")}
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
            {i18next.t("ui.functionBindingAdd")}
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
                  {i18next.t("locodialog.functionname")}
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
                          ...(
                            selected
                              ? {
                                  outline:
                                    "2px solid var(--mantine-color-blue-6)",
                                  outlineOffset:
                                    -2,
                                }
                              : {}
                          ),
                        }}
                      >
                        <Table.Td>
                          <Text
                            size="sm"
                            fw={600}
                          >
                            {binding.id}
                          </Text>
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
              {i18next.t("ui.functionBindingInvalid")}
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
            {i18next.t("common.cancel")}
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
