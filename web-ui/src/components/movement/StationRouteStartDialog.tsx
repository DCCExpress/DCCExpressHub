import { Alert, Button, Group, Modal, NumberInput, Select, Stack, Text } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import type { Loco } from "@/domain/domainTypes";
import LocoImage from "@/components/loco/LocoImage";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import { BlockElement } from "@/models/editor/elements/BlockElement";
import type { StationRouteDefinition } from "@/domain/layout/stationRoutes";
import { createMovementPage, createEmptyMovementDocument } from "@/domain/movement";
import { applyMovementRouteCandidate, loadMovementRouteCandidates, type MovementRouteCandidate } from "@/services/movementRouteCatalog";
import { getTrainTrackingState, subscribeTrainTrackingState } from "@/services/trainTrackingRuntime";
import { startTransientMovement } from "@/services/movementEngine";

type Props = {
  opened: boolean;
  onClose: () => void;
  layout: LayoutView;
  locomotives: Loco[];
  route: StationRouteDefinition | null;
};

export default function StationRouteStartDialog({ opened, onClose, layout, locomotives, route }: Props) {
  const [tracking, setTracking] = useState(getTrainTrackingState);
  const [candidates, setCandidates] = useState<MovementRouteCandidate[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [destination, setDestination] = useState<string | null>("auto");
  const [reverse, setReverse] = useState(false);
  const [speed, setSpeed] = useState<number | string>(20);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeTrainTrackingState(setTracking), []);
  useEffect(() => {
    if (!opened) return;
    setSource(null);
    setDestination("auto");
    setReverse(false);
    setError(null);
    setLoading(true);
    let cancelled = false;
    void loadMovementRouteCandidates(createEmptyMovementDocument())
      .then(items => { if (!cancelled) setCandidates(items); })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [opened, route?.id]);

  const blocks = layout.blocks.elements.filter((b): b is BlockElement => b instanceof BlockElement);
  const stationBlockIds = (id: string) => new Set(blocks.filter(b => b.stationId === id).map(b => b.id));
  const fromIds = stationBlockIds(reverse ? route?.toStationId ?? "" : route?.fromStationId ?? "");
  const toIds = stationBlockIds(reverse ? route?.fromStationId ?? "" : route?.toStationId ?? "");
  const locos = useMemo(() => tracking.enabled && tracking.active && tracking.ready
    ? tracking.locos.filter(l => l.confidence === "certain" && l.currentBlockId !== null && fromIds.has(l.currentBlockId))
    : [], [tracking, route, reverse, layout]);
  const eligible = candidates.filter(candidate => {
    if (!route || candidate.locoDirection === "unknown" || !fromIds.has(candidate.fromBlockId) || !toIds.has(candidate.toBlockId)) return false;
    const path = candidate.blockPath.map(b => b.id);
    let cursor = 0;
    const vias = reverse ? [...route.via].reverse() : route.via;
    for (const via of vias) {
      const ids = via.type === "block" ? new Set([Number(via.targetId)]) : stationBlockIds(via.targetId);
      const found = path.findIndex((id, i) => i >= cursor && i > 0 && i < path.length - 1 && ids.has(id));
      if (found < 0) return false;
      cursor = found + 1;
    }
    return true;
  });
  const available = eligible.filter(candidate =>
    (!source || candidate.fromBlockId === Number(source)) &&
    (destination === "auto" || !destination || candidate.toBlockId === Number(destination)));
  const destinations = [...new Set(eligible.filter(c => !source || c.fromBlockId === Number(source)).map(c => c.toBlockId))]
    .map(id => ({ value: String(id), label: blocks.find(b => b.id === id)?.name ?? `Block #${id}` }));
  const selectedLoco = locos.find(l => String(l.currentBlockId) === source);
  const selectedCandidate = available[0];
  const canStart = !loading && !starting && !!route?.enabled && !!selectedLoco && !!selectedCandidate &&
    Number.isInteger(Number(speed)) && Number(speed) >= 1 && Number(speed) <= 126;
  const start = async () => {
    if (!canStart || !selectedCandidate || !selectedLoco || !route) return;
    setStarting(true);
    setError(null);
    try {
      const fresh = getTrainTrackingState();
      const tracked = fresh.locos.find(l => l.locoAddress === selectedLoco.locoAddress);
      if (!fresh.enabled || !fresh.active || !fresh.ready || tracked?.confidence !== "certain" ||
          tracked.currentBlockId !== selectedCandidate.fromBlockId)
        throw new Error("Locomotive location changed. Select the source again.");
      const page = applyMovementRouteCandidate(createMovementPage(), selectedCandidate);
      if (!page.routeRef) throw new Error("The selected path has no valid travel direction.");
      page.id = `quick-route-loco-${selectedLoco.locoAddress}`;
      page.name = `Station Route · ${route.name} · #${selectedLoco.locoAddress}`;
      page.speed = Number(speed);
      page.expectedLocoAddress = selectedLoco.locoAddress;
      await startTransientMovement(page);
      onClose();
    } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setStarting(false); }
  };
  return <Modal opened={opened} onClose={() => { if (!starting) onClose(); }} centered size="lg" title={route ? `Start Station Route · ${route.name}` : "Start Station Route"}>
    <Stack gap="sm">
      <Text size="sm" c="dimmed">One locomotive → one temporary Movement Task. Dispatcher and SwitchMan enforce track safety.</Text>
      {route?.allowReverse && <Select label="Direction" allowDeselect={false}
        data={[{value:"forward",label:"From → To"},{value:"reverse",label:"To → From"}]}
        value={reverse ? "reverse" : "forward"} onChange={value => { setReverse(value === "reverse"); setSource(null); setDestination("auto"); }}/>}
      {!tracking.ready && <Alert color="orange">Train Tracking is not ready. Automatic train identification is required.</Alert>}
      <Select label="From block / Locomotive" placeholder="Select confirmed locomotive" searchable
        data={locos.map(l => {
          const loco = locomotives.find(item => item.address === l.locoAddress);
          const blockName = blocks.find(b => b.id === l.currentBlockId)?.name ?? l.currentBlockName ?? "Unknown";
          return { value: String(l.currentBlockId), label: `${blockName} · ${loco?.name || `Loco #${l.locoAddress}`}` };
        })}
        renderOption={({ option }) => {
          const tracked = locos.find(l => String(l.currentBlockId) === option.value);
          const loco = locomotives.find(item => item.address === tracked?.locoAddress);
          return <Group gap="sm" wrap="nowrap">
            <LocoImage locoId={loco?.id ?? ""} image={loco?.image} name={loco?.name} width={88} height={38}/>
            <Stack gap={0}>
              <Text size="sm" fw={500}>{option.label}</Text>
              {tracked && <Text size="xs" c="dimmed">DCC #{tracked.locoAddress}</Text>}
            </Stack>
          </Group>;
        }}
        value={source} onChange={v => {setSource(v);setDestination("auto");}}/>
      <Select label="Destination block" placeholder="Automatic" searchable
        data={[{value:"auto",label:"Automatic — select available destination"},...destinations]}
        value={destination} onChange={setDestination}/>
      <NumberInput label="Speed" min={1} max={126} allowDecimal={false} value={speed} onChange={setSpeed}/>
      {loading && <Text size="sm" c="dimmed">Loading route topology…</Text>}
      {selectedCandidate && <Text size="sm">Planned: {selectedCandidate.blockPath.map(b => b.name).join(" → ")}</Text>}
      {!loading && source && !selectedCandidate && <Alert color="orange">No runnable Movement path matches this locomotive and destination. Check Via and route topology.</Alert>}
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onClose} disabled={starting}>Cancel</Button><Button onClick={() => void start()} loading={starting} disabled={!canStart}>Start Task</Button></Group>
    </Stack>
  </Modal>;
}
