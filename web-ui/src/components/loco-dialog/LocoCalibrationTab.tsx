import { ScrollArea } from "@mantine/core";
import type { Loco } from "@domain/types";
import PrecisionBrakingPanel from "./PrecisionBrakingPanel";

// Speed Calibration is retired from the locomotive editor.
// Precision Braking measures its own approach speed using the two sensors.
export default function LocoCalibrationTab({
  loco,
  onPatch,
}: {
  loco: Loco;
  onPatch: (patch: Partial<Loco>) => void;
}) {
  return (
    <ScrollArea h="100%" type="auto" offsetScrollbars>
      <PrecisionBrakingPanel loco={loco} onPatch={onPatch} />
    </ScrollArea>
  );
}
