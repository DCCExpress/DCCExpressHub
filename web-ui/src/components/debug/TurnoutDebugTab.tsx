import { Badge } from "@mantine/core";
import DebugStateTable from "./DebugStateTable";
import type { TurnoutDebugState } from "./useRuntimeDebugState";
export default function TurnoutDebugTab({turnouts}:{turnouts:TurnoutDebugState}){return <DebugStateTable values={turnouts} valueHeader="Physical value" renderValue={closed=><Badge color={closed?"blue":"orange"} variant="light">{closed?"1 / CLOSED":"0 / THROWN"}</Badge>}/>;}
