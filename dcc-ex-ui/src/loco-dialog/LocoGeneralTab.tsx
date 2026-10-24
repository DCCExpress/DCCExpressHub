import { useState } from "react";
import {
  Button,
  Checkbox,
  FileButton,
  NumberInput,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";

import { IconPhoto } from "@tabler/icons-react";

import type { Loco } from "../storage";
import LocoImage, { setLocoImageMirrored } from "./LocoImage";


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
  const [imageMirrored,setImageMirroredState]=useState(()=>{
    try{return localStorage.getItem('dcc-ex-ui.imageMirror.'+loco.id)==='true';}catch{return false;}
  });

  return (
    <ScrollArea h="100%">
      <Stack gap="md" maw={520}>
        {loco.image && (
          <LocoImage locoId={loco.id} image={loco.image} name={loco.name} width={260} height={120} />
        )}

        <div>
          <Switch
            label={"Mirror locomotive image on this device"}
            checked={imageMirrored}
            onChange={event => { setImageMirroredState(event.currentTarget.checked); setLocoImageMirrored(loco.id, event.currentTarget.checked); }}
          />
          <Text size="xs" c="dimmed" mt={4}> Saved only in this browser; the original image is unchanged. </Text>
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

        <NumberInput
          label={t("locodialog.loco_max_speed")}
          value={loco.maxSpeed ?? 126}
          min={1}
          max={1000}
          onChange={value => onPatch({ maxSpeed: Number(value) || 0 })}
        />

        <NumberInput
          label={t("locodialog.loco_cruising_speed")}
          description={t("locodialog.loco_cruising_speed_description")}
          value={loco.cruisingSpeed ?? 20}
          min={1}
          max={Math.min(126, Math.max(1, loco.maxSpeed ?? 126))}
          onChange={value => onPatch({ cruisingSpeed: Math.max(1, Math.min(Number(value) || 1, 126, loco.maxSpeed ?? 126)) })}
        />

        <Checkbox
          label={t("locodialog.loco_direction_invert")}
          checked={loco.invert}
          onChange={event => onPatch({ invert: event.currentTarget.checked })}
        />
      </Stack>
    </ScrollArea>
  );
}
