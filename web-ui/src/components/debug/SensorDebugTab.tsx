import { Badge } from "@mantine/core";
import DebugStateTable from "./DebugStateTable";
import type { SensorDebugState } from "./useRuntimeDebugState";
export default function SensorDebugTab({sensors}:{sensors:SensorDebugState}){return <DebugStateTable values={sensors} valueHeader="State" renderValue={on=><Badge color={on?"green":"gray"} variant={on?"filled":"light"}>{on?"ON / OCCUPIED":"OFF / FREE"}</Badge>}/>;}
