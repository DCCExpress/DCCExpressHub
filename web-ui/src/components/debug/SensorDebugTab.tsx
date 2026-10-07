import { Badge } from "@mantine/core";

import DebugStateTable from "./DebugStateTable";
import type {
  DebugLayoutOwners,
  SensorDebugState,
} from "./useRuntimeDebugState";

type Props = {
  sensors: SensorDebugState;
  layoutOwners: DebugLayoutOwners;
};

export default function SensorDebugTab({
  sensors,
  layoutOwners,
}: Props) {
  return (
    <DebugStateTable
      values={sensors}
      layoutOwners={layoutOwners}
      valueHeader="State"
      renderValue={on => (
        <Badge
          color={on ? "green" : "gray"}
          variant={on ? "filled" : "light"}
        >
          {on ? "ON / OCCUPIED" : "OFF / FREE"}
        </Badge>
      )}
    />
  );
}
