import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  Button,
  Checkbox,
  FileButton,
  NumberInput,
  ScrollArea,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";

import { IconPhoto } from "@tabler/icons-react";

import type { Loco } from "@domain/types";
import { useLocoImageMirrored } from "../../hooks/useLocoImageMirrored";
import { setLocoImageMirrored } from "../../services/locoImageMirror";

type LocoGeneralTabProps = {
  loco: Loco;
  onPatch: (patch: Partial<Loco>) => void;
  onImageFile: (file: File | null) => void;
  t: (key: string) => string;
};

export default function LocoGeneralTab({
  loco,
  onPatch,
  onImageFile,
  t,
}: LocoGeneralTabProps) {
  useTranslation();
  const imageMirrored = useLocoImageMirrored(loco.id);

  return (
    <ScrollArea h="100%">
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
        <Stack gap="md">
        {loco.image && (
          <img
            src={loco.image}
            alt={loco.name}
            style={{
              maxHeight: 120,
              maxWidth: 260,
              objectFit: "contain",
              transform: imageMirrored ? "scaleX(-1)" : undefined,
            }}
          />
        )}

        <div>
          <Switch
            label={i18next.t("ui.mirrorLocomotiveImageOnThisDevice")}
            checked={imageMirrored}
            onChange={event => setLocoImageMirrored(loco.id, event.currentTarget.checked)}
          />
          <Text size="xs" c="dimmed" mt={4}> {i18next.t("ui.savedOnlyInThisBrowserItDoesNotChangeThe")} </Text>
        </div>

        <FileButton onChange={onImageFile} accept="image/png,image/jpeg,image/webp">
          {props => (
            <Button {...props} variant="light" leftSection={<IconPhoto size={16} />}>
              {t("locodialog.selectimage")}
            </Button>
          )}
        </FileButton>

        <TextInput
          label={t("locodialog.loconame")}
          value={loco.name}
          onChange={event => onPatch({ name: event.currentTarget.value })}
        />

        <NumberInput
          label={t("locodialog.locoaddress")}
          value={loco.address}
          min={1}
          onChange={value => onPatch({ address: Number(value) || 0 })}
        />

        <Checkbox
          label={t("locodialog.loco_direction_invert")}
          checked={loco.invert}
          onChange={event => onPatch({ invert: event.currentTarget.checked })}
        />
        </Stack>
        <Stack gap="md">
          <Text fw={600}>Speed profile</Text>
          <Text c="dimmed" size="xs">All four speed values are saved in the locomotive profile (DCC steps). No new speed-profile control behavior is enabled yet.</Text>
          <NumberInput
            label="Minimum speed"
            description="Lowest stable running speed · DCC step"
            value={loco.minimumSpeed ?? 8}
            min={1}
            max={126}
            onChange={value => onPatch({ minimumSpeed: Math.max(1, Math.min(126, Number(value) || 1)) })}
          />
          <NumberInput
            label="Medium speed"
            description="Reduced running speed · DCC step"
            value={loco.mediumSpeed ?? 24}
            min={1}
            max={126}
            onChange={value => onPatch({ mediumSpeed: Math.max(1, Math.min(126, Number(value) || 1)) })}
          />
        <NumberInput
          label={t("locodialog.loco_cruising_speed")}
          description={t("locodialog.loco_cruising_speed_description")}
          value={loco.cruisingSpeed ?? 20}
          min={1}
          max={Math.min(126, Math.max(1, loco.maxSpeed))}
          onChange={value => onPatch({ cruisingSpeed: Math.max(1, Math.min(Number(value) || 1, 126, loco.maxSpeed)) })}
        />

        <NumberInput
          label={t("locodialog.loco_max_speed")}
          value={loco.maxSpeed}
          min={1}
          max={1000}
          onChange={value => onPatch({ maxSpeed: Number(value) || 0 })}
        />
        </Stack>
      </SimpleGrid>
    </ScrollArea>
  );
}
