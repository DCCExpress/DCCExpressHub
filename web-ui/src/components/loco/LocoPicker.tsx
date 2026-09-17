import {
  Button,
  Card,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconTrash,
  IconTrashFilled,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import type { Loco } from "@domain/types";
import LocoImage from "./LocoImage";

type LocoPickerProps = {
  opened: boolean;
  locos: Loco[];
  selectedLocoId?: string | undefined;
  title?: string | undefined;
  onClose: () => void;
  onRemoveLoco?: (loco: Loco) => void;
  onRemoveAllLoco?: () => void;
  onSelect: (loco: Loco) => void;
};

export default function LocoPicker({
  opened,
  locos,
  selectedLocoId,
  title,
  onClose,
  onSelect,
  onRemoveLoco,
  onRemoveAllLoco,
}: LocoPickerProps) {
  const { t } = useTranslation();

  const selectedLoco =
    selectedLocoId
      ? locos.find(
          loco => loco.id === selectedLocoId
        )
      : undefined;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Text fw={700}>
          {title ?? t("locodialog.mozdonylista")}
        </Text>
      }
      centered
      size="md"
      zIndex={3000}
      overlayProps={{
        backgroundOpacity: 0.55,
        blur: 2,
      }}
      closeOnClickOutside
      closeOnEscape
      trapFocus
      lockScroll
      returnFocus
      withCloseButton
      closeButtonProps={{
        "aria-label": t("common.close"),
      }}
      styles={{
        content: {
          maxHeight: "calc(100dvh - 24px)",
          display: "flex",
          flexDirection: "column",
        },
        body: {
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          flex: 1,
        },
      }}
    >
      <Stack
        gap="sm"
        style={{
          minHeight: 0,
          flex: 1,
        }}
      >
        {(onRemoveLoco || onRemoveAllLoco) && (
          <Group
            justify="flex-end"
            gap="xs"
            wrap="wrap"
            style={{
              flexShrink: 0,
            }}
          >
            {onRemoveLoco && (
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<IconTrash size={14} />}
                disabled={!selectedLoco}
                onClick={() => {
                  if (!selectedLoco) return;
                  onRemoveLoco(selectedLoco);
                }}
              >
                {t("common.remove")}
              </Button>
            )}

            {onRemoveAllLoco && (
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<IconTrashFilled size={14} />}
                onClick={onRemoveAllLoco}
              >
                {t("common.removeAll")}
              </Button>
            )}
          </Group>
        )}

        <ScrollArea
          type="hover"
          offsetScrollbars
          style={{
            minHeight: 0,
            flex: 1,
          }}
          viewportProps={{
            style: {
              maxHeight: "min(70dvh, 680px)",
            },
          }}
        >
          <Stack gap="sm" pr="xs">
            {locos.map(loco => (
              <Card
                key={loco.id}
                withBorder
                radius="sm"
                p="sm"
                style={{
                  cursor: "pointer",
                  borderColor:
                    loco.id === selectedLocoId
                      ? "var(--mantine-color-blue-5)"
                      : undefined,
                }}
                onClick={() => onSelect(loco)}
              >
                <Group wrap="nowrap" align="center">
                  <LocoImage
                    locoId={loco.id}
                    image={loco.image}
                    name={loco.name}
                    width={120}
                    height={60}
                  />

                  <div style={{ minWidth: 0 }}>
                    <Text fw={600} truncate>
                      {loco.name || t("loco.unnamed")}
                    </Text>

                    <Text size="sm" c="dimmed">
                      {t("loco.dccAddress")}: {loco.address}
                    </Text>

                    <Text size="sm" c="dimmed">
                      {t("loco.maxSpeedShort")}: {loco.maxSpeed}
                    </Text>
                  </div>
                </Group>
              </Card>
            ))}

            {locos.length === 0 && (
              <Text size="sm" c="dimmed">
                {t("loco.noSelectable")}
              </Text>
            )}
          </Stack>
        </ScrollArea>
      </Stack>
    </Modal>
  );
}
