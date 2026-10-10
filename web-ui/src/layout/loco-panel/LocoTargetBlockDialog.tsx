import { Alert, Button, Group, Modal, Select, Slider, Stack, Text } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import type { Loco } from "@domain/types";
import { createMovementPage } from "../../domain/movement";
import { loadAutomationMovement } from "../../services/automationApi";
import { startMovement } from "../../services/movementEngine";
import { getTrainTrackingState, subscribeTrainTrackingState } from "../../services/trainTrackingRuntime";
import { loadMovementRouteCandidates, applyMovementRouteCandidate, type MovementRouteCandidate } from "../../services/movementRouteCatalog";

const SPEED_KEY = "dccexpresshub.loco-target-block.speed";
const readSpeed = () => {
  try {
    const speed = Number(localStorage.getItem(SPEED_KEY) ?? 20);
    return Number.isFinite(speed) ? Math.max(1, Math.min(126, Math.round(speed))) : 20;
  } catch {
    return 20;
  }
};

type Props = { loco: Loco; opened: boolean; onClose: () => void };

export default function LocoTargetBlockDialog({ loco, opened, onClose }: Props) {
  const [tracking, setTracking] = useState(getTrainTrackingState);
  const [candidates, setCandidates] = useState<MovementRouteCandidate[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [speed, setSpeed] = useState(readSpeed);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeTrainTrackingState(setTracking), []);

  const current = tracking.locos.find(item => item.locoAddress === loco.address);
  const sourceId = current?.currentBlockId ?? null;
  const validSource = tracking.enabled && tracking.active && tracking.ready
    && current?.confidence === "certain" && sourceId !== null;

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setError(null);
    setCandidates([]);
    setSelectedKey(null);
    if (!validSource) return;
    setLoading(true);
    void loadAutomationMovement().then(document => loadMovementRouteCandidates(document))
      .then(routes => {
        if (cancelled) return;
        setCandidates(routes.filter(route =>
          route.fromBlockId === sourceId &&
          route.toBlockId !== sourceId &&
          route.locoDirection !== "unknown" &&
          route.blockPath.length >= 2
        ));
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [opened, sourceId, validSource]);

  const byTarget = useMemo(() => {
    const map = new Map<number, MovementRouteCandidate>();
    for (const candidate of candidates) {
      const current = map.get(candidate.toBlockId);
      if (!current || candidate.blockPath.length < current.blockPath.length) {
        map.set(candidate.toBlockId, candidate);
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.toBlockName.localeCompare(b.toBlockName, undefined, { numeric: true }));
  }, [candidates]);

  const selected = byTarget.find(route => route.key === selectedKey);
  const close = () => { if (!starting) onClose(); };

  const start = async () => {
    if (!selected || !validSource || selected.fromBlockId !== sourceId || starting) return;
    setStarting(true);
    setError(null);
    try {
      // Re-check the train's live location before committing a route.
      const live = getTrainTrackingState();
      const tracked = live.locos.find(item => item.locoAddress === loco.address);
      if (!live.enabled || !live.active || !live.ready ||
          tracked?.confidence !== "certain" || tracked.currentBlockId !== sourceId) {
        throw new Error("The locomotive's current block changed. Reopen the dialog.");
      }
      const page = applyMovementRouteCandidate(createMovementPage(), selected);
      if (!page.routeRef) throw new Error("Selected route has no valid direction.");
      // Reuse one persisted quick-movement slot per locomotive rather than accumulating entries.
      page.id = `quick-route-loco-${loco.address}`;
      page.name = `Quick route · #${loco.address} · ${selected.fromBlockName} → ${selected.toBlockName}`;
      page.speed = speed;
      page.expectedLocoAddress = loco.address;
      await startMovement(page);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Modal opened={opened} onClose={close} title={`Drive locomotive #${loco.address} to block`} centered>
      <Stack gap="md">
        <Text size="sm">Locomotive: <strong>{loco.name || `#${loco.address}`}</strong></Text>
        <Text size="sm">Current block: <strong>{current?.currentBlockName ?? "Unknown"}</strong></Text>
        {!validSource && <Alert color="orange">A confirmed current block and active train tracking are required. Automatic movement is not allowed while position is unknown.</Alert>}
        {validSource && !loading && byTarget.length === 0 && !error &&
          <Alert color="orange">No reachable destination was found in the generated route topology. Check the route network.</Alert>}
        {error && <Alert color="red">{error}</Alert>}
        <Select
          label="Destination block"
          placeholder={loading ? "Loading routes…" : "Select a reachable block"}
          data={byTarget.map(route => ({
            value: route.key,
            label: `${route.toBlockName} (#${route.toBlockId})`,
          }))}
          searchable
          clearable
          nothingFoundMessage="No reachable blocks"
          value={selectedKey}
          onChange={setSelectedKey}
          disabled={!validSource || loading || starting}
        />
        {selected && <Text size="xs" c="dimmed">Route: {selected.blockPath.map(b => b.name).join(" → ")} · {selected.locoDirection}</Text>}
        <div>
          <Group justify="space-between" mb={8}><Text size="sm" fw={500}>Movement speed</Text><Text size="sm">{speed} / 126</Text></Group>
          <Slider min={1} max={126} step={1} value={speed}
            onChange={value => { setSpeed(value); try { localStorage.setItem(SPEED_KEY, String(value)); } catch { /* browser storage unavailable */ } }}
            disabled={starting} />
        </div>
        <Group justify="flex-end">
          <Button variant="default" onClick={close} disabled={starting}>Cancel</Button>
          <Button color="teal" onClick={() => void start()} loading={starting} disabled={!selected || !validSource || loading}>Start</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
