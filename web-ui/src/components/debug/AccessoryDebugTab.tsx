import { Badge, Stack, Text } from "@mantine/core";
import DebugStateTable from "./DebugStateTable";
import type { BasicAccessoryDebugState,ExtendedAccessoryDebugState } from "./useRuntimeDebugState";
type Props={basicAccessories:BasicAccessoryDebugState;extendedAccessories:ExtendedAccessoryDebugState};
export default function AccessoryDebugTab({basicAccessories,extendedAccessories}:Props){return <Stack gap="lg">
  <div><Text fw={700} mb="xs">Basic accessories</Text><DebugStateTable values={basicAccessories} valueHeader="Value" renderValue={active=><Badge color={active?"green":"gray"} variant="light">{active?"1 / ON":"0 / OFF"}</Badge>}/></div>
  <div><Text fw={700} mb="xs">Extended accessories</Text><DebugStateTable values={extendedAccessories} valueHeader="Aspect" renderValue={aspect=><Badge color="violet" variant="light">{aspect}</Badge>}/></div>
</Stack>;}
