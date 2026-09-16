import { useTranslation } from "react-i18next";
import i18next from "i18next";
import type { DragEvent } from "react";

import {
  ActionIcon,
  Badge,
  Card,
  Checkbox,
  FileButton,
  Group,
  NumberInput,
  Select,
  Stack,
  TextInput,
  useComputedColorScheme,
} from "@mantine/core";

import {
  IconArrowDown,
  IconArrowUp,
  IconFolderOpen,
  IconGripVertical,
  IconPlayerPlayFilled,
  IconTrash,
} from "@tabler/icons-react";

import type { LocoAction } from "@domain/types";

import { audioManager } from "../../services/audioManager";
import {
  ACTION_TYPE_OPTIONS,
  convertActionType,
  getActionSummary,
  type LocoActionType,
} from "./locoDialogHelpers";

type FunctionOption = { value: string; label: string };

type Props = {
  action: LocoAction;
  actionIndex: number;
  actionCount: number;
  draggedActionId: string | null;
  functionOptions: FunctionOption[];
  onDragStart: (event: DragEvent<HTMLDivElement>, actionId: string) => void;
  onDragEnd: () => void;
  onDragOverAction: (event: DragEvent<HTMLDivElement>, actionId: string, actionIndex: number) => void;
  onMoveByOffset: (actionId: string, offset: number) => void;
  onUpdateAction: (actionId: string, nextAction: LocoAction) => void;
  onDeleteAction: (actionId: string) => void;
};

export default function LocoActionCard({
  action,
  actionIndex,
  actionCount,
  draggedActionId,
  functionOptions,
  onDragStart,
  onDragEnd,
  onDragOverAction,
  onMoveByOffset,
  onUpdateAction,
  onDeleteAction,
}: Props) {
  useTranslation();
  const computedColorScheme = useComputedColorScheme("light");
  const cardBackground = computedColorScheme === "dark"
    ? "var(--mantine-color-dark-5)"
    : "var(--mantine-color-blue-0)";

  const cardBorderColor = computedColorScheme === "dark"
    ? "var(--mantine-color-dark-3)"
    : "var(--mantine-color-blue-2)";

  const updateCurrentAction = (nextAction: LocoAction): void => {
    onUpdateAction(action.id, nextAction);
  };

  return (
    <Card
      key={action.id}
      withBorder
      p="sm"
      draggable
      onDragStart={event => onDragStart(event, action.id)}
      onDragEnd={onDragEnd}
      onDragOver={event => onDragOverAction(event, action.id, actionIndex)}
      style={{
        backgroundColor: cardBackground,
        borderColor: cardBorderColor,
        opacity: draggedActionId === action.id ? 0.35 : 1,
        transition: "opacity 120ms ease, transform 120ms ease, background-color 120ms ease, border-color 120ms ease",
      }}
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ActionIcon variant="subtle" color="gray" style={{ cursor: "grab", touchAction: "none" }}>
              <IconGripVertical size={18} />
            </ActionIcon>

            <Badge variant="filled" color={draggedActionId === action.id ? "orange" : "blue"} miw={draggedActionId === action.id ? 58 : 34} ta="center">
              {draggedActionId === action.id ? `→ #${actionIndex + 1}` : `#${actionIndex + 1}`}
            </Badge>

            <Badge variant="light">{getActionSummary(action)}</Badge>
          </Group>

          <Group gap="xs" wrap="nowrap">
            <ActionIcon color="gray" variant="light" disabled={actionIndex === 0} onClick={() => onMoveByOffset(action.id, -1)}>
              <IconArrowUp size={16} />
            </ActionIcon>

            <ActionIcon color="gray" variant="light" disabled={actionIndex >= actionCount - 1} onClick={() => onMoveByOffset(action.id, 1)}>
              <IconArrowDown size={16} />
            </ActionIcon>

            <ActionIcon color="red" variant="light" onClick={() => onDeleteAction(action.id)}>
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        </Group>

        <Group align="flex-end" wrap="wrap">
          <Select
            label={i18next.t("ui.actionType")}
            value={action.type}
            data={ACTION_TYPE_OPTIONS.map(option => ({ ...option }))}
            w={210}
            allowDeselect={false}
            onChange={value => {
              if (!value) return;
              updateCurrentAction(convertActionType(action, value as LocoActionType));
            }}
          />

          {action.type === "setFunction" && (
            <>
              <Select
                label={i18next.t("ui.function")}
                value={String(action.functionNumber)}
                data={functionOptions}
                w={220}
                searchable
                allowDeselect={false}
                onChange={value => updateCurrentAction({ ...action, functionNumber: Number(value) || 0 })}
              />
              <Checkbox label={i18next.t("ui.active")} checked={action.active} onChange={event => updateCurrentAction({ ...action, active: event.currentTarget.checked })} />
            </>
          )}

          {action.type === "momentaryFunction" && (
            <>
              <Select
                label={i18next.t("ui.function")}
                value={String(action.functionNumber)}
                data={functionOptions}
                w={220}
                searchable
                allowDeselect={false}
                onChange={value => updateCurrentAction({ ...action, functionNumber: Number(value) || 0 })}
              />
              <NumberInput
                label={i18next.t("ui.durationMs")}
                value={action.ms}
                min={1}
                step={100}
                w={150}
                onChange={value => updateCurrentAction({ ...action, ms: Number(value) || 1 })}
              />
            </>
          )}

          {action.type === "playAudio" && (
            <TextInput
              label={i18next.t("ui.audioFile")}
              value={action.fileName}
              placeholder="station.mp3"
              w={320}
              onChange={event => updateCurrentAction({ ...action, fileName: event.currentTarget.value })}
              rightSection={
                <Group gap={2} wrap="nowrap">
                  <FileButton
                    onChange={file => {
                      if (!file) return;
                      updateCurrentAction({ ...action, fileName: file.name });
                    }}
                    accept="audio/*"
                  >
                    {fileButtonProps => (
                      <ActionIcon
                        {...fileButtonProps}
                        size="sm"
                        variant="subtle"
                        title={i18next.t("ui.chooseAudioFile")}
                        onClick={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          fileButtonProps.onClick?.();
                        }}
                      >
                        <IconFolderOpen size={16} />
                      </ActionIcon>
                    )}
                  </FileButton>

                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    title={i18next.t("ui.testAudio")}
                    disabled={!action.fileName.trim()}
                    onClick={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      audioManager.play(action.fileName.trim());
                    }}
                  >
                    <IconPlayerPlayFilled size={16} />
                  </ActionIcon>
                </Group>
              }
              rightSectionWidth={68}
            />
          )}

          {action.type === "wait" && (
            <NumberInput
              label={i18next.t("ui.waitMs")}
              value={action.ms}
              min={1}
              step={100}
              w={150}
              onChange={value => updateCurrentAction({ ...action, ms: Number(value) || 1 })}
            />
          )}
        </Group>
      </Stack>
    </Card>
  );
}
