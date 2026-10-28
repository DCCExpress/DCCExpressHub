import { Button, Group, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import i18next from "i18next";
import AppModal from "./AppModal";

export type AppConfirmDialogProps = {
  opened: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: string;
  confirmDisabled?: boolean;
  loading?: boolean;
};

/** Shared confirmation dialog for destructive and other explicit user actions. */
export default function AppConfirmDialog({
  opened, title, message, onConfirm, onCancel,
  confirmLabel, cancelLabel, confirmColor = "red",
  confirmDisabled = false, loading = false,
}: AppConfirmDialogProps) {
  return (
    <AppModal opened={opened} onClose={onCancel} title={title} centered size="sm">
      <Stack gap="md">
        <Group gap="sm" align="flex-start" wrap="nowrap">
          <IconAlertTriangle size={26} color="var(--mantine-color-red-6)" />
          <Text size="sm">{message}</Text>
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={loading}>
            {cancelLabel ?? i18next.t("ui.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button color={confirmColor} onClick={onConfirm} loading={loading} disabled={confirmDisabled}>
            {confirmLabel ?? i18next.t("ui.confirm", { defaultValue: "Confirm" })}
          </Button>
        </Group>
      </Stack>
    </AppModal>
  );
}
