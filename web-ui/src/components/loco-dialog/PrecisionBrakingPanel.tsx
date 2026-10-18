import { Alert, Badge, Button, Card, Checkbox, Group, NumberInput, Stack, Table, Text } from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Loco } from "@domain/types";
import PrecisionBrakingRouteSelector, { type BrakingRouteSelection } from "./PrecisionBrakingRouteSelector";
import PrecisionBrakingDiagram from "./PrecisionBrakingDiagram";

type Point = { dccStep: number; direction: string; millimetersPerSecond: number; estimatedStoppingDistanceMm: number; samples: number; baselineStoppingDistanceMm?: number | null };
type State = { status: string; error: string | null; locoId: string | null; locoAddress: number | null; sensorAddress: number | null; direction: string | null; speedStep: number | null; speedMmPerSecond: number | null; targetDistanceMm: number | null; actualDistanceMm: number | null; profile: Point[]; commandedRampSeconds?: number };
type SavedProfile = { validated: boolean; updatedAt: string | null; samples: number; rawSamples?: number; profile: Point[] };


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

async function loadSavedProfile(locoId: string): Promise<SavedProfile> {
  const response = await fetch("/api/precision-braking/profile", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locoId }),
  });
  const result = await response.json();
  if (!response.ok || result.ok === false)
    throw new Error(result.message ?? "Could not load saved braking profile");
  return result as SavedProfile;
}

export default function PrecisionBrakingPanel({
  loco, onPatch,
}: {
  loco: Loco;
  onPatch: (patch: Partial<Loco>) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<State | null>(null);
  const [savedProfile, setSavedProfile] = useState<SavedProfile | null>(null);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState("");
  useEffect(() => {
    let mounted = true;
    setSavedProfile(null);
    setSavedLoading(true);
    setSavedError("");
    void loadSavedProfile(loco.id)
      .then(profile => { if (mounted) setSavedProfile(profile); })
      .catch(e => { if (mounted) setSavedError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (mounted) setSavedLoading(false); });
    return () => { mounted = false; };
  }, [loco.id]);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<BrakingRouteSelection | null>(null);
  const [speedStep, setSpeedStep] = useState<number | string>(20);
  const [distance, setDistance] = useState<number | string>(200);
  const [measuredOverlap, setMeasuredOverlap] = useState<number | string>("");
  const [confirmed, setConfirmed] = useState(false);
  // Braking trial UI preferences are local to this browser and locomotive.
  // They do not change decoder CVs, speed calibration or saved trial data.
  const prefsKey = `dcc-express-hub:precision-braking:${loco.id}`;
  const savePreference = (key: "speedStep" | "distance", value: number | string) => {
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
      if (typeof prefs.distance === "number" && prefs.distance >= 10 && prefs.distance <= 10000)
        setDistance(prefs.distance);
      else setDistance(200);
    } catch {
      setSpeedStep(20);
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
    try {
      setState(await request(path, data));
      // New training invalidates the approved profile; OK persists it.
      // Refresh from the disk-backed endpoint after either transition.
      if (path === "/start" || path === "/abort" ||
          (path === "/measure" && !!(data as { approve?: boolean } | undefined)?.approve)) {
        setSavedProfile(null);
        setSavedLoading(true);
        try {
          setSavedProfile(await loadSavedProfile(loco.id));
          setSavedError("");
        } catch (e) {
          setSavedError(e instanceof Error ? e.message : String(e));
        } finally {
          setSavedLoading(false);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const active = state?.locoId === loco.id &&
    ["preparing", "armed", "braking", "measure", "saving", "return_preparing", "returning"].includes(state.status);
  const other = state && ["preparing", "armed", "braking", "measure", "saving", "return_preparing", "returning"].includes(state.status) && state.locoId !== loco.id;
  const trainLength = (loco.locomotiveLengthMm ?? loco.length) + (loco.wagonsLengthMm ?? 0);
  const blockLength = selectedRoute?.blockLengthMm ?? 0;
  const desiredFrontGap = Number(distance);
  const targetDistance = blockLength - desiredFrontGap;
  const sourceBlockLength = selectedRoute?.sourceBlockLengthMm ?? 0;
  // The train may start in either endpoint. Both must accommodate the consist.
  const fitsDestination = (length: number) => length > 0 && trainLength > 0 &&
    Number.isFinite(desiredFrontGap) && desiredFrontGap >= 0 &&
    length - desiredFrontGap >= trainLength &&
    length - desiredFrontGap >= 10 && length - desiredFrontGap <= 10000;
  const startBlockers: string[] = [];
  if (!confirmed) startBlockers.push("Confirm that the test track is isolated and supervised.");
  const sensorDistanceMm = loco.precisionBraking?.sensorDistanceMm ?? loco.calibration?.routeLengthMm ?? 0;
  if (!Number.isFinite(sensorDistanceMm) || sensorDistanceMm <= 0)
    startBlockers.push("Enter the physical start OFF → destination ON sensor distance.");
  if (!selectedRoute) startBlockers.push("Select a valid A–C braking route (including its return route).");
  if (selectedRoute && !fitsDestination(sourceBlockLength))
    startBlockers.push(`Block A: ${sourceBlockLength || "unknown"} mm. Train ${trainLength} mm + front clearance ${desiredFrontGap} mm does not fit (or the block length is missing).`);
  if (selectedRoute && !fitsDestination(blockLength))
    startBlockers.push(`Block C: ${blockLength || "unknown"} mm. Train ${trainLength} mm + front clearance ${desiredFrontGap} mm does not fit (or the block length is missing).`);
  if (!Number.isInteger(Number(speedStep)) || Number(speedStep) < 1 || Number(speedStep) > 126)
    startBlockers.push("Approach speed must be a DCC step between 1 and 126.");
  if (other) startBlockers.push("Another locomotive has an active braking trial.");
  if (active) startBlockers.push("This locomotive already has an active braking trial.");
  if (busy) startBlockers.push("A braking request is being processed.");
  const arrivingAtA = state?.locoId === loco.id && !!selectedRoute &&
    state.direction !== null && state.direction !== undefined &&
    state.direction !== selectedRoute.routeRef.direction;
  const measuredBlockLength = arrivingAtA ? sourceBlockLength : blockLength;
  // The single measurement is the train FRONT's positive penetration into the destination block.
  const frontPosition = measuredOverlap === "" ? NaN : Number(measuredOverlap);
  const rearPosition = frontPosition - trainLength;
  const frontGap = measuredBlockLength - frontPosition;
  const rearGap = rearPosition;
  const measurementConsistent = measuredBlockLength > 0 && trainLength > 0 &&
    Number.isFinite(frontPosition) && frontPosition > 0 && frontPosition <= 20000;
  // Display persisted history, or show the previous in-memory session
  // if this Hub process still holds samples that were never approved.
  const showingTraining = active && state?.locoId === loco.id;
  const sessionPreview = !showingTraining && !savedProfile?.samples &&
    state?.locoId === loco.id && (state?.profile.length ?? 0) > 0;
  const displayedProfile = showingTraining || sessionPreview
    ? state?.profile ?? []
    : savedProfile?.profile ?? [];

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
        {other && <Alert color="orange">Another locomotive is being calibrated.</Alert>}
        <PrecisionBrakingDiagram
          mode={loco.trainConsistMode ?? "pull"}
          locomotiveLengthMm={loco.locomotiveLengthMm ?? loco.length}
          wagonsLengthMm={loco.wagonsLengthMm ?? 0}
          blockLengthMm={blockLength}
          sourceBlockLengthMm={selectedRoute?.sourceBlockLengthMm ?? 0}
        />
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
        <NumberInput
          label="Distance between start and destination sensors (mm)"
          description="Physical travel distance from start sensor OFF to destination sensor ON. Initially uses the value entered in Speed Calibration; saved separately with Precision Braking."
          min={1}
          max={100000}
          value={loco.precisionBraking?.sensorDistanceMm ?? loco.calibration?.routeLengthMm ?? 1000}
          disabled={!!active || !!other || busy}
          onChange={value => {
            const sensorDistanceMm = Number(value);
            if (!Number.isFinite(sensorDistanceMm) || sensorDistanceMm <= 0) return;
            onPatch({
              precisionBraking: {
                ...loco.precisionBraking,
                sensorDistanceMm,
                updatedAt: new Date().toISOString(),
              },
            });
          }}
        />
        <NumberInput label="Cruise speed (DCC step)" value={speedStep}
          onChange={v => { setSpeedStep(v); savePreference("speedStep", v); }}
          min={1} max={126} disabled={!!active} />
        <Text size="xs">A block: {sourceBlockLength || "—"} mm · C block: {blockLength || "—"} mm · Train: {trainLength} mm</Text>
        <NumberInput label="Desired front clearance to block end (mm)" value={distance}
          onChange={v => { setDistance(v); savePreference("distance", v); }}
          min={0} max={10000} disabled={!!active} />
        {selectedRoute && fitsDestination(sourceBlockLength) && fitsDestination(blockLength) && <Text size="xs" c="dimmed">The backend detects whether the locomotive is in A or C, selects the corresponding travel direction and learned braking curve, and measures toward the opposite block.</Text>}
        <Checkbox checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)}
          label="I confirm the track is physically isolated, clear and supervised." disabled={!!active} />
        {startBlockers.length > 0 && <Alert color="orange" title="Why Start Trial is disabled">
          <Stack gap={4}>
            {startBlockers.map(reason => <Text size="sm" key={reason}>• {reason}</Text>)}
          </Stack>
        </Alert>}
        <Group>
          <Button disabled={startBlockers.length > 0}
            loading={busy} onClick={() => void action("/start", {
              locoId: loco.id, locoAddress: loco.address, routeRef: selectedRoute?.routeRef,
              speedStep: Number(speedStep), returnSpeedStep: Number(speedStep),
              targetDistanceMm: targetDistance,
              targetFrontClearanceMm: desiredFrontGap,
              sensorDistanceMm,
              isolatedTestTrackConfirmed: confirmed,
            })}>Start trial</Button>
          <Button color="orange" variant="outline" disabled={busy || !active}
            onClick={() => void action("/stop")}>Stop (speed 0)</Button>
          <Button color="green" disabled={busy || !measurementConsistent || state?.status !== "measure" || state?.locoId !== loco.id}
            onClick={() => void action("/measure", { actualDistanceMm: frontPosition, frontFromSensorMm: frontPosition, approve: true })}>OK — approve measured braking</Button>
          <Button color="red" variant="outline" disabled={busy || (!active && state?.status !== "stopped")}
            onClick={() => void action("/abort")}>Abort — discard training</Button>
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
          <Alert color="blue">{t("precisionBrakingMeasurement.measureHelp")}</Alert>
          <NumberInput label={t("precisionBrakingMeasurement.distance")}
            description={t("precisionBrakingMeasurement.fieldHint")} min={1} max={20000}
            value={measuredOverlap} onChange={setMeasuredOverlap} />
          {measurementConsistent && <Text size="xs" c="dimmed">{t("precisionBrakingMeasurement.positionReport", {rear: rearPosition.toFixed(1), front: frontPosition.toFixed(1), clearance: frontGap.toFixed(1)})}</Text>}
          {measurementConsistent && rearGap < 0 && <Alert color="orange">{t("precisionBrakingMeasurement.rearOutside", {distance: Math.abs(rearGap).toFixed(1)})}</Alert>}
          {measurementConsistent && frontGap < 0 && <Alert color="orange">{t("precisionBrakingMeasurement.frontOutside", {distance: Math.abs(frontGap).toFixed(1)})}</Alert>}
          <Button loading={busy} disabled={busy || !measurementConsistent}
            onClick={() => void action("/measure", {actualDistanceMm: frontPosition, frontFromSensorMm: frontPosition})}>Save measurement — continue training</Button>
        </>}
        {active && state?.status === "return_preparing" &&
          <Alert color="blue">Measurement saved. Setting and checking turnouts for the return trip.</Alert>}
        {active && state?.status === "returning" &&
          <Alert color="blue">Returning toward the starting block. The entry sensor starts adaptive braking; after stopping, measure how far the train front entered the block again.</Alert>}
        {state?.status === "completed" && state.locoId === loco.id &&
          <Alert color="green">Operator approved braking profile is saved.</Alert>}
        {(error || state?.error) && <Alert color="red">{error || state?.error}</Alert>}
      </Stack>
    </Card>
    <Card withBorder p="md">
      <Group justify="space-between" mb="sm">
        <Text fw={700}>Adaptive stopping profile</Text>
        {showingTraining
          ? <Badge color="orange">Training — not approved</Badge>
          : savedProfile?.validated
            ? <Badge color="green">Validated · {savedProfile.samples} trials</Badge>
            : savedProfile && savedProfile.samples > 0
              ? <Badge color="orange">Stored measurements · not validated</Badge>
              : sessionPreview
                ? <Badge color="orange">Previous session · not saved</Badge>
                : null}
      </Group>
      <Text size="xs" c="dimmed" mb="sm">Base stop (0) is the measured stopping distance when speed 0 is commanded immediately at the sensor; it is shown separately for each speed and direction. Adaptive stop is the learned result. Deceleration is estimated as −v²/(2s) from the immediate speed-zero baseline; it is unavailable without that measurement. Not applied to normal Movement runs.</Text>
      {savedError && !showingTraining && <Alert color="red">Cannot load saved stopping profile: {savedError}</Alert>}
      {savedLoading && !showingTraining && <Text size="sm" c="dimmed">Loading saved stopping profile…</Text>}
      {!savedLoading && !savedError && !showingTraining && savedProfile && !savedProfile.validated &&
        (savedProfile.samples > 0
          ? <Alert color="orange">These measurements exist on disk, but were never approved with OK. They are shown for reference only and cannot be used for automatic braking.</Alert>
          : (savedProfile.rawSamples ?? 0) > 0
            ? <Alert color="orange">There are {savedProfile.rawSamples} saved measurements, but they cannot be interpreted as valid braking samples. The original data is preserved.</Alert>
            : <Text c="dimmed" size="sm">No stored braking measurements found for this locomotive. An unfinished training session was not saved as an approved profile.</Text>)}
      {sessionPreview && <Alert color="orange">The previous trial measurements still exist in this running Hub, but were not approved with OK or saved as a validated profile. Do not start another training session if you want to inspect these values.</Alert>}
      {showingTraining && !displayedProfile.length && <Text c="dimmed" size="sm">No training measurements yet.</Text>}
      {displayedProfile.length > 0 &&
        <Table striped><Table.Thead><Table.Tr><Table.Th>Direction</Table.Th><Table.Th>DCC</Table.Th><Table.Th>mm/s</Table.Th><Table.Th>Deceleration (mm/s²)</Table.Th><Table.Th>Base stop (0) mm</Table.Th><Table.Th>Adaptive stop mm</Table.Th><Table.Th>Trials</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{displayedProfile.map(point => <Table.Tr key={point.direction + point.dccStep}>
            <Table.Td>{point.direction}</Table.Td><Table.Td>{point.dccStep}</Table.Td>
            <Table.Td>{point.millimetersPerSecond.toFixed(1)}</Table.Td>
            <Table.Td>{point.baselineStoppingDistanceMm != null && point.baselineStoppingDistanceMm > 0
              ? (-(point.millimetersPerSecond * point.millimetersPerSecond) / (2 * point.baselineStoppingDistanceMm)).toFixed(2)
              : "—"}</Table.Td>
            <Table.Td>{point.baselineStoppingDistanceMm != null ? point.baselineStoppingDistanceMm.toFixed(1) : "—"}</Table.Td>
            <Table.Td>{point.estimatedStoppingDistanceMm.toFixed(1)}</Table.Td>
            <Table.Td>{point.samples}</Table.Td></Table.Tr>)}</Table.Tbody></Table>}
    </Card>
  </Stack>;
}
