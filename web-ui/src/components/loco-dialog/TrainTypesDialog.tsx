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
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import AppModal from "../common/AppModal";

type DraftRow = {
  key: string;
  original: string | null;
  value: string;
};

type Props = {
  opened: boolean;
  trainTypes: string[];
  usedTrainTypes: Set<string>;
  onClose: () => void;
  onCommit: (
    trainTypes: string[],
    renames: Array<{ from: string; to: string }>
  ) => void;
};

export default function TrainTypesDialog({
  opened,
  trainTypes,
  usedTrainTypes,
  onClose,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const nextKey = useRef(1);

  useEffect(() => {
    if (!opened) return;

    setDraft(
      trainTypes.map((value, index) => ({
        key: `existing:${index}:${value}`,
        original: value,
        value,
      }))
    );
    nextKey.current = 1;
  }, [opened, trainTypes]);

  const addTrainType = (): void => {
    const key = `new:${nextKey.current++}`;
    setDraft(current => [
      ...current,
      { key, original: null, value: "" },
    ]);
  };

  const normalized = draft.map(row => row.value.trim());
  const seen = new Set<string>();
  let hasDuplicate = false;

  for (const value of normalized) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) hasDuplicate = true;
    seen.add(key);
  }

  const invalid =
    normalized.length === 0 ||
    normalized.some(value => !value) ||
    hasDuplicate;

  const commit = (): void => {
    if (invalid) return;

    const renames = draft
      .filter(
        row =>
          row.original !== null &&
          row.original !== row.value.trim()
      )
      .map(row => ({
        from: row.original!,
        to: row.value.trim(),
      }));

    onCommit(normalized, renames);
  };

  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      title={i18next.t("locodialog.trainTypesEditorTitle")}
      size="md"
      centered
      draggable
    >
      <Stack gap="sm">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {i18next.t("locodialog.trainTypesEditorHint")}
          </Text>

          <Button
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={addTrainType}
          >
            {i18next.t("locodialog.trainTypesAdd")}
          </Button>
        </Group>

        <ScrollArea h={340}>
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{i18next.t("locodialog.trainTypesName")}</Table.Th>
                <Table.Th w={56} />
              </Table.Tr>
            </Table.Thead>

            <Table.Tbody>
              {draft.map(row => {
                const isUsed =
                  row.original !== null &&
                  usedTrainTypes.has(row.original);

                return (
                  <Table.Tr key={row.key}>
                    <Table.Td>
                      <TextInput
                        value={row.value}
                        placeholder={i18next.t("locodialog.trainTypesName")}
                        onChange={event =>
                          setDraft(current =>
                            current.map(item =>
                              item.key === row.key
                                ? { ...item, value: event.currentTarget.value }
                                : item
                            )
                          )
                        }
                      />
                    </Table.Td>

                    <Table.Td>
                      <ActionIcon
                        color="red"
                        variant="light"
                        disabled={isUsed}
                        title={
                          isUsed
                            ? i18next.t("locodialog.trainTypesDeleteUsed")
                            : i18next.t("locodialog.delete")
                        }
                        onClick={() =>
                          setDraft(current =>
                            current.filter(item => item.key !== row.key)
                          )
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>

        {invalid && (
          <Text size="xs" c="red">
            {i18next.t("locodialog.trainTypesInvalid")}
          </Text>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {i18next.t("common.cancel")}
          </Button>
          <Button disabled={invalid} onClick={commit}>
            {i18next.t("locodialog.save")}
          </Button>
        </Group>
      </Stack>
    </AppModal>
  );
}
