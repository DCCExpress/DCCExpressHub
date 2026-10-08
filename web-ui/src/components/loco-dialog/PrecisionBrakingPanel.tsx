import { Alert, Badge, Button, Card, Checkbox, Group, NumberInput, Stack, Table, Text } from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import type { Loco } from "@domain/types";
import PrecisionBrakingRouteSelector, { type BrakingRouteSelection } from "./PrecisionBrakingRouteSelector";

type Point = { dccStep: number; direction: string; millimetersPerSecond: number; estimatedStoppingDistanceMm: number; samples: number; baselineStoppingDistanceMm?: number | null };
type State = { status: string; error: string | null; locoId: string | null; locoAddress: number | null; sensorAddress: number | null; direction: string | null; speedStep: number | null; speedMmPerSecond: number | null; targetDistanceMm: number | null; actualDistanceMm: number | null; profile: Point[]; commandedRampSeconds?: number };

async function request(path: string, data?: unknown): Promise<State> {
  const init: RequestInit = {
    cache: "no-store",
    method: path ? "POST" : "GET",
  };
  if (data !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(data);
  }
  const response = await fetch("/api/precision-braking" + path, init);
  const value = await response.json();
  if (!response.ok || value.ok === false) throw new Error(value.message ?? "Precision braking request failed");
  return value as State;
}

export default function PrecisionBrakingPanel({
  loco, onPatch,
}: {
  loco: Loco;
  onPatch: (patch: Partial<Loco>) => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<BrakingRouteSelection | null>(null);
  const [speedStep, setSpeedStep] = useState<number | string>(20);
  const [distance, setDistance] = useState<number | string>(200);
  const [measured, setMeasured] = useState<number | string>(200);
  const [returnSpeed, setReturnSpeed] = useState<number | string>(30);
  const [confirmed, setConfirmed] = useState(false);
  // Braking trial UI preferences are local to this browser and locomotive.
  // They do not change decoder CVs, speed calibration or saved trial data.
  const prefsKey = `dcc-express-hub:precision-braking:${loco.id}`;
  const savePreference = (key: "speedStep" | "returnSpeed" | "distance", value: number | string) => {
    try {
      const previous = JSON.parse(window.localStorage.getItem(prefsKey) ?? "{}") as Record<string, unknown>;
      window.localStorage.setItem(prefsKey, JSON.stringify({ ...previous, [key]: value }));
    } catch { /* Storage can be blocked; keep the live setting. */ }
  };
  useEffect(() => {
    try {
      const prefs = JSON.parse(window.localStorage.getItem(prefsKey) ?? "{}") as Record<string, unknown>;
      if (typeof prefs.speedStep === "number" && prefs.speedStep >= 1 && prefs.speedStep <= 126)
        setSpeedStep(prefs.speedStep);
      else setSpeedStep(20);
      if (typeof prefs.returnSpeed === "number" && prefs.returnSpeed >= 1 && prefs.returnSpeed <= 126)
        setReturnSpeed(prefs.returnSpeed);
      else setReturnSpeed(30);
      if (typeof prefs.distance === "number" && prefs.distance >= 10 && prefs.distance <= 10000)
        setDistance(prefs.distance);
      else setDistance(200);
    } catch {
      setSpeedStep(20);
      setReturnSpeed(30);
      setDistance(200);
    }
  }, [prefsKey]);
  const refresh = useCallback(async () => {
    try { setState(await request("")); } catch { /* backend may be offline */ }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const action = async (path: string, data?: unknown) => {
    setBusy(true); setError("");
    try { setState(await request(path, data)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const active = state?.locoId === loco.id &&
    ["preparing", "armed", "braking", "measure", "saving", "return_preparing", "returning"].includes(state.status);
  const other = state && ["preparing", "armed", "braking", "measure", "saving", "return_preparing", "returning"].includes(state.status) && state.locoId !== loco.id;
  const hasSpeedProfile = (loco.calibration?.results.length ?? 0) > 0;
  return <Stack gap="md">
    <Group justify="flex-end">
      <Button component="a" variant="subtle" size="xs"
        href="https://github.com/DCCExpress/DCCExpressHub/blob/alpha3/docs/precision-braking-decoder-hu.md"
        target="_blank" rel="noopener noreferrer">
        Fékezési CV beállítási útmutató ↗
      </Button>
    </Group>
    <Alert color="orange" title="Isolated test track only">
      Trials issue physical locomotive speed commands directly. They do not reserve routes,
      check turnout locks or replace Dispatcher safety. Use only on a clear, physically isolated test track.
      Select the braking route; its destination-block sensor is the reference.
      Position the locomotive in the selected route's start block. Keep an emergency stop available.
    </Alert>
    <Card withBorder p="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={700}>Precision Braking trial</Text>
          <Badge color={active ? "orange" : "gray"}>{state?.status ?? "offline"}</Badge>
        </Group>
        {!hasSpeedProfile && <Alert color="orange">Complete Speed Calibration for this locomotive first.</Alert>}
        {other && <Alert color="orange">Another locomotive is being calibrated.</Alert>}
        <PrecisionBrakingRouteSelector locoId={loco.id} savedRouteRef={loco.precisionBraking?.routeRef}
          selected={selectedRoute} disabled={!!active || !!other || busy}
          onSelect={route => {
            setSelectedRoute(route);
            if (route) {
              onPatch({
                precisionBraking: {
                  ...loco.precisionBraking,
                  routeRef: route.routeRef,
                  updatedAt: new Date().toISOString(),
                },
              });
            }
          }} />
        <NumberInput label="Approach speed (DCC step)" value={speedStep}
          onChange={v => { setSpeedStep(v); savePreference("speedStep", v); }}
          min={1} max={126} disabled={!!active} />
        <NumberInput label="Return speed (DCC step)" value={returnSpeed}
          onChange={v => { setReturnSpeed(v); savePreference("returnSpeed", v); }}
          min={1} max={126} disabled={!!active}
          description="Speed for returning to the starting block; stops on the starting-block sensor." />
        <NumberInput label="Target stopping distance after sensor (mm)" value={distance}
          onChange={v => { setDistance(v); savePreference("distance", v); }}
          min={10} max={10000} disabled={!!active} />
        <Checkbox checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)}
          label="I confirm the track is physically isolated, clear and supervised." disabled={!!active} />
        <Group>
          <Button disabled={!confirmed || !hasSpeedProfile || !!active || !!other || busy ||
            !selectedRoute || !Number(speedStep) || !Number(returnSpeed) || !Number(distance) ||
            Number(returnSpeed) > 126 || Number(returnSpeed) < 1}
            loading={busy} onClick={() => void action("/start", {
              locoId: loco.id, locoAddress: loco.address, routeRef: selectedRoute?.routeRef,
              speedStep: Number(speedStep), returnSpeedStep: Number(returnSpeed),
              targetDistanceMm: Number(distance),
              isolatedTestTrackConfirmed: confirmed,
            })}>Start trial</Button>
          <Button color="orange" variant="outline" disabled={busy || !active}
            onClick={() => void action("/stop")}>Stop (speed 0)</Button>
          <Button color="red" onClick={() => void action("/estop")}>E-STOP</Button>
        </Group>
        {active && <Text size="sm">Reference sensor: {state?.sensorAddress} ·
          Approach: {state?.speedMmPerSecond?.toFixed(1) ?? "—"} mm/s ·
          Target: {state?.targetDistanceMm} mm · Hold before speed 0: {state?.commandedRampSeconds?.toFixed(2) ?? "—"} s</Text>}
        {state?.status === "preparing" && active &&
          <Alert color="blue">Validating selected route, locomotive and turnout positions…</Alert>}
        {state?.status === "armed" && active && <Alert color="blue">Locomotive moving. Braking begins on sensor ON.</Alert>}
        {state?.status === "braking" && active && <Alert color="blue">Applying braking ramp. Do not measure yet.</Alert>}
        {state?.status === "measure" && active && <>
          <Alert color="blue">Speed 0 commanded. After the locomotive has physically stopped, measure from the sensor to the actual stopping point.</Alert>
          <NumberInput label="Actual stopping distance after sensor (mm)" min={0} max={20000}
            value={measured} onChange={setMeasured} />
          <Button loading={busy} disabled={busy || measured === "" || Number(measured) < 0}
            onClick={() => void action("/measure", {actualDistanceMm: Number(measured)})}>OK — save and return to start</Button>
        </>}
        {active && state?.status === "return_preparing" &&
          <Alert color="blue">Measurement saved. Setting and checking turnouts for the return trip.</Alert>}
        {active && state?.status === "returning" &&
          <Alert color="blue">Returning to the starting block. The locomotive will stop on its starting-block sensor.</Alert>}
        {state?.status === "completed" && state.locoId === loco.id &&
          <Alert color="green">Returned to the starting block. Ready for the next braking trial.</Alert>}
        {(error || state?.error) && <Alert color="red">{error || state?.error}</Alert>}
      </Stack>
    </Card>
    <Card withBorder p="md">
      <Group justify="space-between" mb="sm">
        <Text fw={700}>Adaptive stopping profile</Text>
        <Button color="red" variant="light" size="xs" disabled={busy || !!active}
          onClick={() => {
            if (!window.confirm("Delete ALL saved adaptive braking measurements for this locomotive? Speed calibration and decoder CV profiles will be preserved.")) return;
            void action("/reset", { locoId: loco.id });
          }}>Reset profile</Button>
      </Group>
      <Text size="xs" c="dimmed" mb="sm">Base stop (0) is the measured stopping distance when speed 0 is commanded immediately at the sensor; it is shown separately for each speed and direction. Adaptive stop is the learned result. Not applied to normal Movement runs.</Text>
      {state?.locoId !== loco.id || !state.profile.length
        ? <Text c="dimmed" size="sm">No trial data in the current session.</Text>
        : <Table striped><Table.Thead><Table.Tr><Table.Th>Direction</Table.Th><Table.Th>DCC</Table.Th><Table.Th>mm/s</Table.Th><Table.Th>Base stop (0) mm</Table.Th><Table.Th>Adaptive stop mm</Table.Th><Table.Th>Trials</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{state.profile.map(point => <Table.Tr key={point.direction + point.dccStep}>
            <Table.Td>{point.direction}</Table.Td><Table.Td>{point.dccStep}</Table.Td>
            <Table.Td>{point.millimetersPerSecond.toFixed(1)}</Table.Td>
            <Table.Td>{point.estimatedStoppingDistanceMm.toFixed(1)}</Table.Td>
            <Table.Td>{point.samples}</Table.Td></Table.Tr>)}</Table.Tbody></Table>}
    </Card>
  </Stack>;
}
