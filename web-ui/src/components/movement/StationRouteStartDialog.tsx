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
import { wsApi } from "@/services/wsApi";
import { wsClient } from "@/services/wsClient";

type Props = {
  opened: boolean;
  onClose: () => void;
  layout: LayoutView;
  locomotives: Loco[];
  route: StationRouteDefinition | null;
};

export default function StationRouteStartDialog({ opened, onClose, layout, locomotives, route }: Props) {
  const [tracking, setTracking] = useState(getTrainTrackingState);
  const [sensorStates, setSensorStates] = useState<Map<number,boolean>>(new Map());
  const [reserved, setReserved] = useState<{loaded:boolean;blocks:Set<number>}>({loaded:false,blocks:new Set()});
  useEffect(() => {
    const offSensor = wsClient.on("sensorChanged", data => setSensorStates(old => new Map(old).set(data.address,data.on)));
    const offSnapshot = wsClient.on("sensorSnapshot", data => {
      const map = new Map<number,boolean>();
      for (const [base,active,known] of data.groups) for (let i=0;i<16;i++) {
        const bit = 1<<i;
        if (known & bit) map.set(base+i,(active & bit)!==0);
      }
      setSensorStates(map);
    });
    const offDispatcher = wsClient.subscribeMessages(raw => {
      const m = raw as unknown as {type:string;data?:any};
      const snapshot = m.type==="dispatcherResponse" && m.data?.action==="snapshot" && m.data?.ok===true;
      if (!snapshot && m.type!=="dispatcherChanged") return;
      const data = snapshot ? m.data?.extra : m.data;
      if (!Array.isArray(data?.leases) || !Array.isArray(data?.routes)) return;
      const ids = new Set<number>();
      for(const lease of [...data.leases,...data.routes]) for(const id of [lease.fromBlockId,lease.toBlockId,lease.sourceBlockId,lease.destinationBlockId])
        if(Number.isInteger(id) && id>0) ids.add(id);
      setReserved({loaded:true,blocks:ids});
    });
    const requestDispatcher = () => wsClient.send({type:"dispatcherCommand",data:{action:"snapshot",requestId:`station-route-${Date.now()}`}});
    const offStatus = wsClient.subscribeStatus(status => {
      setReserved({loaded:false,blocks:new Set()});
      setSensorStates(new Map());
      if(status==="connected") requestDispatcher();
    });
    if (wsClient.isConnected()) requestDispatcher();
    return () => {offSensor();offSnapshot();offDispatcher();offStatus();};
  }, []);
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

  const stationName = (id: string) => layout.stations?.find(station => station.id === id)?.name ?? id;
  const actualFromStationId = reverse ? route?.toStationId ?? "" : route?.fromStationId ?? "";
  const actualToStationId = reverse ? route?.fromStationId ?? "" : route?.toStationId ?? "";
  const blocks = layout.blocks.elements.filter((b): b is BlockElement => b instanceof BlockElement);
  const stationBlockIds = (id: string) => new Set(blocks.filter(b => b.stationId === id).map(b => b.id));
  const fromIds = stationBlockIds(actualFromStationId);
  const toIds = stationBlockIds(actualToStationId);
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
  const selectedLoco = source === null ? undefined : locos.find(l => String(l.currentBlockId) === source);
  const fromSource = selectedLoco ? candidates.filter(candidate =>
    candidate.fromBlockId === selectedLoco.currentBlockId) : [];
  const fromSourceToStation = fromSource.filter(candidate =>
    toIds.has(candidate.toBlockId));
  const usableToStation = fromSourceToStation.filter(candidate =>
    candidate.locoDirection !== "unknown");
  const directionUnknownToStation = fromSourceToStation.length - usableToStation.length;
  const destinationsInTable = [...new Set(fromSource.map(candidate => candidate.toBlockName))];
  const available = selectedLoco ? eligible.filter(candidate =>
    candidate.fromBlockId === selectedLoco.currentBlockId &&
    (destination === "auto" || !destination || candidate.toBlockId === Number(destination))) : [];
  const confirmedFree = (id:number) => {
    const block = blocks.find(b=>b.id===id);
    return !!block && block.sensorAddress>0 && sensorStates.get(block.sensorAddress)===false &&
      reserved.loaded && !reserved.blocks.has(id) && tracking.ready && tracking.active && tracking.enabled &&
      !tracking.locos.some(l=>l.currentBlockId===id);
  };
  const destinations = [...new Set(available.filter(c => c.fromBlockId === selectedLoco?.currentBlockId).map(c => c.toBlockId))]
    .map(id => {
      const tracked = tracking.locos.filter(l => l.currentBlockId === id);
      const blockName = blocks.find(b => b.id === id)?.name ?? `Block #${id}`;
      const identities = tracked.map(l => {
        const loco = locomotives.find(item => item.address === l.locoAddress);
        return loco?.name ? `${loco.name} (#${l.locoAddress})` : `Loco #${l.locoAddress}`;
      });
      return {
        value: String(id),
        label: tracked.length ? `${blockName} · ${identities.join(", ")}` : `${blockName} · ${confirmedFree(id) ? "Confirmed free" : "Not confirmed free / reserved"}`,
      };
    });
  const selectedCandidate = selectedLoco ? available.find(candidate => confirmedFree(candidate.toBlockId)) : undefined;
  const canStart = !loading && !starting && !!route?.enabled && !!selectedLoco && !!selectedCandidate &&
    Number.isInteger(Number(speed)) && Number(speed) >= 1 && Number(speed) <= 126;
  const start = async () => {
    if (!canStart || !selectedCandidate || !selectedLoco || !route) return;
    setStarting(true);
    setError(null);
    try {
      if (!confirmedFree(selectedCandidate.toBlockId)) throw new Error("Destination is not confirmed free.");
      const fresh = getTrainTrackingState();
      const tracked = fresh.locos.find(l => l.locoAddress === selectedLoco.locoAddress);
      if (!fresh.enabled || !fresh.active || !fresh.ready || tracked?.confidence !== "certain" ||
          tracked.currentBlockId !== selectedCandidate.fromBlockId)
        throw new Error("Locomotive location changed. Select the source again.");
      const page = applyMovementRouteCandidate(createMovementPage(), selectedCandidate);
      if (!page.routeRef) throw new Error("The selected path has no valid travel direction.");
      // Unique per launch: independent TaskMan entries, even for the same station route.
      page.id = `quick-route-loco-${selectedLoco.locoAddress}-station-${route.id}-${Date.now()}`;
      page.name = `Station Route · ${route.name} · #${selectedLoco.locoAddress}`;
      page.speed = Number(speed);
      page.expectedLocoAddress = selectedLoco.locoAddress;
      const driverTaskId = `train-driver-${selectedLoco.locoAddress}-${Date.now()}`;
      const requestId = `train-driver-start-${Date.now()}`;
      const result = await wsApi.request(
        "trainDriverCommand",
        { requestId, action: "start", taskId: driverTaskId, page },
        "trainDriverResponse",
        response => response.requestId === requestId,
        10000
      );
      if (!result.ok) throw new Error(result.error || "Train Driver could not start.");
      onClose();
    } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setStarting(false); }
  };
  return <Modal opened={opened} onClose={() => { if (!starting) onClose(); }} centered size="lg" title={route ? `Start Station Route · ${route.name}` : "Start Station Route"}>
    <Stack gap="sm">
      <Text size="sm" c="dimmed">One locomotive → one temporary Movement Task. Dispatcher and SwitchMan enforce track safety.</Text>
      {route?.allowReverse && <Select label="Station Route direction" allowDeselect={false}
        data={[
          {value:"forward",label:`${stationName(route.fromStationId)} → ${stationName(route.toStationId)} (From → To)`},
          {value:"reverse",label:`${stationName(route.toStationId)} → ${stationName(route.fromStationId)} (To → From)`}
        ]}
        value={reverse ? "reverse" : "forward"} onChange={value => { setReverse(value === "reverse"); setSource(null); setDestination("auto"); }}/>}
      <Text size="sm" fw={600}>Departing: {stationName(actualFromStationId)} → Arriving: {stationName(actualToStationId)}</Text>
      {!tracking.ready && <Alert color="orange">Train Tracking is not ready. Automatic train identification is required.</Alert>}
      <Select label={`Locomotive departing from ${stationName(actualFromStationId)}`} placeholder="Select confirmed locomotive" searchable
        data={locos.map(l => {
          const loco = locomotives.find(item => item.address === l.locoAddress);
          const blockName = blocks.find(b => b.id === l.currentBlockId)?.name ?? l.currentBlockName ?? "Unknown";
          return { value: String(l.currentBlockId), label: `${blockName} · ${loco?.name || `Loco #${l.locoAddress}`}` };
        })}
        renderOption={({ option }) => {
          const tracked = locos.find(l => String(l.currentBlockId) === option.value);
          const loco = locomotives.find(item => item.address === tracked?.locoAddress);
          return <Group gap="sm" wrap="nowrap" style={{ width: "100%" }}>
            <div style={{ flex: "0 0 96px", width: 96, height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <LocoImage locoId={loco?.id ?? ""} image={loco?.image} name={loco?.name} width={88} height={38}/>
            </div>
            <Stack gap={0} style={{ flex: "1 1 0", minWidth: 0 }}>
              <Text size="sm" fw={500}>{option.label}</Text>
              {tracked && <Text size="xs" c="dimmed">DCC #{tracked.locoAddress}</Text>}
            </Stack>
          </Group>;
        }}
        value={source} onChange={v => {setSource(v);setDestination("auto");}}/>
      <Select label="Destination block" placeholder="Automatic" searchable
        data={[{value:"auto",label:"Automatic — dispatcher-checked destination"},...destinations]}
        renderOption={({option}) => {
          if (option.value === "auto") return <Text size="sm">{option.label}</Text>;
          const tracked = tracking.locos.filter(l => String(l.currentBlockId) === option.value);
          const blockName = blocks.find(b => String(b.id) === option.value)?.name ?? `Block #${option.value}`;
          return <Group gap="sm" wrap="nowrap" style={{ width: "100%" }}>
            <div style={{ flex: "0 0 96px", width: 96, height: 40, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {tracked.length ? (() => {
                const first = tracked[0]!;
                const loco = locomotives.find(item => item.address === first.locoAddress);
                return <LocoImage locoId={loco?.id ?? ""} image={loco?.image}
                  name={loco?.name} width={88} height={38}/>;
              })() : <LocoImage width={88} height={38}/>}
            </div>
            <Stack gap={0} style={{ flex: "1 1 0", minWidth: 0 }}>
              <Text size="sm" fw={500}>{blockName}</Text>
              {tracked.length
                ? tracked.map(l => {
                    const loco = locomotives.find(item => item.address === l.locoAddress);
                    return <Text key={l.locoAddress} size="xs" c="orange">
                      {loco?.name || `Locomotive #${l.locoAddress}`} · DCC #{l.locoAddress}
                      {l.confidence !== "certain" ? " · Position uncertain" : ""}
                    </Text>;
                  })
                : <Text size="xs" c="dimmed">{confirmedFree(Number(option.value)) ? "Confirmed free" : "Not confirmed free / reserved"}</Text>}
            </Stack>
          </Group>;
        }}
        value={destination} onChange={setDestination}/>
      <NumberInput label="Speed" min={1} max={126} allowDecimal={false} value={speed} onChange={setSpeed}/>
      {loading && <Text size="sm" c="dimmed">Loading route topology…</Text>}
      {selectedLoco && selectedCandidate && <Text size="sm">Planned: {selectedCandidate.blockPath.map(b => b.name).join(" → ")}</Text>}
      {!loading && source && !selectedCandidate && <Alert color="orange">
        {available.length === 0
          ? `No executable route found from the selected source to ${destination === "auto" ? "the destination station" : "the selected destination block"}. Route table: ${fromSource.length} outgoing route(s), ${fromSourceToStation.length} reaching destination station, ${directionUnknownToStation} with unknown direction, ${usableToStation.length} direction-known. Reachable targets: ${destinationsInTable.slice(0,12).join(", ") || "none"}. ${route?.via.length ? "Via checkpoints may exclude some alternatives. " : ""}Check graph direction and topology; a FREE sensor does not establish physical reachability.`
          : `${available.length} route candidate(s) exist (${[...new Set(available.map(item => item.toBlockName))].join(", ")}), but no destination is confirmed free. ${!reserved.loaded ? "Dispatcher snapshot missing. " : ""}Check target sensor OFF/FREE, current locomotive assignments and reservations.`}
      </Alert>}
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onClose} disabled={starting}>Cancel</Button><Button onClick={() => void start()} loading={starting} disabled={!canStart}>Start Task</Button></Group>
    </Stack>
  </Modal>;
}
