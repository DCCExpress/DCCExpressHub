import { Card, Group, Kbd, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconHelpCircle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

/**
 * Small, non-interactive reference below Layout Visibility.
 * Keep shortcuts in sync with useLayoutPageShortcuts and trackCanvasKeyboard.
 */
export default function EditorShortcutsHelp() {
  const { t } = useTranslation();

  const shortcuts = [
    { keys: "R", label: t("ui.editorShortcutRotate") },
    { keys: "Esc", label: t("ui.editorShortcutSelect") },
    { keys: "Ctrl+S", label: t("ui.editorShortcutSave") },
    { keys: t("ui.editorShortcutPanKeys"), label: t("ui.editorShortcutPan") },
    { keys: t("ui.editorShortcutZoomKeys"), label: t("ui.editorShortcutZoom") },
    { keys: "F", label: t("ui.editorShortcutFit") },
    { keys: "E", label: t("ui.editorShortcutEditMode") },
    { keys: "Del", label: t("ui.editorShortcutDelete") },
    { keys: "Ctrl+C", label: t("ui.editorShortcutClone") },
    { keys: t("ui.editorShortcutMultiSelectKeys"), label: t("ui.editorShortcutMultiSelect") },
  ];

  return (
    <Card withBorder p="xs">
      <Stack gap={8}>
        <Group gap={6}>
          <IconHelpCircle size={16} />
          <Text fw={600} size="sm">{t("ui.editorShortcutsTitle")}</Text>
        </Group>
        <SimpleGrid cols={1} spacing={6} verticalSpacing={7}>
          {shortcuts.map(item => (
            <Group key={item.keys} wrap="nowrap" gap={6} align="center">
              <Kbd size="xs" style={{ flexShrink: 0 }}>{item.keys}</Kbd>
              <Text size="xs" c="dimmed">{item.label}</Text>
            </Group>
          ))}
        </SimpleGrid>
        <Text size="xs" c="dimmed">{t("ui.editorShortcutsCanvasHint")}</Text>
      </Stack>
    </Card>
  );
}
