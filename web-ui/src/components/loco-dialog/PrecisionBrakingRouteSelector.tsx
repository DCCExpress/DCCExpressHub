import {
  Alert, Button, Group, ScrollArea, Stack, Table, Text, TextInput,
} from "@mantine/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MovementRouteRef } from "@domain/movement";
import { createEmptyMovementDocument } from "@domain/movement";
import type { SerializedLayoutDto } from "@domain/layout/layoutDto";
import {
  buildMovementRouteCandidates,
  type MovementRouteCandidate,
} from "@/services/movementRouteCatalog";
import AppModal from "@/components/common/AppModal";

export type BrakingRouteSelection = {
  routeRef: MovementRouteRef;
  label: string;
  fromName: string;
  toName: string;
  sensorAddress: number;
};

type Props = {
  locoId: string;
  savedRouteRef?: MovementRouteRef | undefined;
  selected: BrakingRouteSelection | null;
  disabled: boolean;
  onSelect: (route: BrakingRouteSelection | null) => void;
};

function refFor(candidate: MovementRouteCandidate): MovementRouteRef | null {
  if (candidate.locoDirection !== "forward" &&
      candidate.locoDirection !== "reverse") return null;
  return {
    fromBlockId: candidate.fromBlockId,
    toBlockId: candidate.toBlockId,
    direction: candidate.locoDirection,
    viaBlockIds: candidate.blockPath.slice(1, -1).map(block => block.id),
  };
}

function sameRef(a: MovementRouteRef, b: MovementRouteRef): boolean {
  return a.fromBlockId === b.fromBlockId &&
    a.toBlockId === b.toBlockId &&
    a.direction === b.direction &&
    a.viaBlockIds.length === b.viaBlockIds.length &&
    a.viaBlockIds.every((id, i) => id === b.viaBlockIds[i]);
}

function hasReturn(candidate: MovementRouteCandidate, candidates: MovementRouteCandidate[]): boolean {
  const route = refFor(candidate);
  if (!route) return false;
  const reverse: MovementRouteRef = {
    fromBlockId: route.toBlockId,
    toBlockId: route.fromBlockId,
    direction: route.direction === "forward" ? "reverse" : "forward",
    viaBlockIds: [...route.viaBlockIds].reverse(),
  };
  return candidates.filter(other => {
    const ref = refFor(other);
    return ref !== null && sameRef(ref, reverse);
  }).length === 1;
}

export default function PrecisionBrakingRouteSelector({
  locoId, savedRouteRef, selected, disabled, onSelect,
}: Props) {
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MovementRouteCandidate[]>([]);
  const [sensorByBlock, setSensorByBlock] = useState<Map<number, number>>(new Map());
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");

  const load = useCallback(async (preferred?: MovementRouteRef) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/layout", { cache: "no-store" });
      if (!response.ok) throw new Error(`Layout could not be loaded (${response.status}).`);
      const layout = await response.json() as SerializedLayoutDto;
      const loaded = buildMovementRouteCandidates(layout, createEmptyMovementDocument());
      const sensors = new Map<number, number>();
      for (const layer of layout.layers ?? []) {
        for (const rawElement of layer.elements ?? []) {
          const element = rawElement as unknown as {
            type?: string; id?: number; sensorAddress?: number;
          };
          if (element.type === "trackblock" &&
              Number.isInteger(element.id) &&
              Number.isInteger(element.sensorAddress) &&
              Number(element.sensorAddress) > 0) {
            sensors.set(Number(element.id), Number(element.sensorAddress));
          }
        }
      }
      setCandidates(loaded);
      setSensorByBlock(sensors);
      // A route saved by Precision Braking belongs to this tab only.
      if (preferred) {
        const matches = loaded.filter(candidate => {
          const ref = refFor(candidate);
          return ref !== null && sameRef(ref, preferred);
        });
        const found = matches.length === 1 ? matches[0] : null;
        if (found && hasReturn(found, loaded) && sensors.has(found.toBlockId)) {
          const ref = refFor(found);
          if (ref) onSelect({
            routeRef: ref,
            label: found.blockPath.map(block => block.name).join(" → "),
            fromName: found.fromBlockName,
            toName: found.toBlockName,
            sensorAddress: sensors.get(found.toBlockId)!,
          });
        } else {
          onSelect(null);
          setError("The previously selected route is invalid, lacks a reverse route or target block sensor.");
        }
      }
    } catch (cause) {
      onSelect(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [locoId]);

  useEffect(() => {
    onSelect(null);
    void load(savedRouteRef);
  }, [locoId]);

  const filtered = useMemo(() => candidates.filter(candidate =>
    (!fromFilter || candidate.fromBlockName.toLocaleLowerCase().includes(fromFilter.toLocaleLowerCase())) &&
    (!toFilter || candidate.toBlockName.toLocaleLowerCase().includes(toFilter.toLocaleLowerCase()))
  ), [candidates, fromFilter, toFilter]);

  const choose = (candidate: MovementRouteCandidate) => {
    const ref = refFor(candidate);
    const sensor = sensorByBlock.get(candidate.toBlockId);
    if (!ref || !sensor || !hasReturn(candidate, candidates)) return;
    onSelect({
      routeRef: ref,
      label: candidate.blockPath.map(block => block.name).join(" → "),
      fromName: candidate.fromBlockName,
      toName: candidate.toBlockName,
      sensorAddress: sensor,
    });
    setOpened(false);
    setError(null);
  };

  return <>
    <Group align="center">
      <Button variant="light" onClick={() => {
        setFromFilter(""); setToFilter(""); setOpened(true);
        void load(selected?.routeRef ?? savedRouteRef);
      }} disabled={disabled}>Select Route</Button>
      <Text size="sm">{selected?.label ?? "No braking route selected"}</Text>
    </Group>
    {selected && <Text c="dimmed" size="sm">
      Start: {selected.fromName} · Target: {selected.toName} ·
      Direction: {selected.routeRef.direction} ·
      ARRIVED reference: sensor #{selected.sensorAddress} (target block)
    </Text>}
    {error && <Alert color="red">{error}</Alert>}
    <AppModal
      opened={opened}
      onClose={() => setOpened(false)}
      title="Select Precision Braking route"
      size="min(1200px, 94vw)"
      centered draggable
      styles={{
        content: { height: "min(760px, 90dvh)", overflow: "hidden" },
        body: { height: "calc(100% - 48px)", overflow: "hidden" },
      }}
    >
      <Stack h="100%" gap="sm" style={{ minHeight: 0 }}>
        <Text size="sm" c="dimmed">
          Select the real route, including its direction. A unique reverse
          route and target-block occupancy sensor are required.
        </Text>
        <Group grow align="flex-end">
          <TextInput label="From block" value={fromFilter}
            onChange={event => setFromFilter(event.currentTarget.value)} />
          <TextInput label="To block" value={toFilter}
            onChange={event => setToFilter(event.currentTarget.value)} />
        </Group>
        <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead><Table.Tr>
              <Table.Th>From</Table.Th><Table.Th>Via</Table.Th>
              <Table.Th>To</Table.Th><Table.Th>Direction</Table.Th>
              <Table.Th>ARRIVED sensor</Table.Th><Table.Th>Return</Table.Th>
              <Table.Th />
            </Table.Tr></Table.Thead>
            <Table.Tbody>
              {loading ? <Table.Tr><Table.Td colSpan={7}>Loading routes…</Table.Td></Table.Tr>
                : filtered.map(candidate => {
                  const sensor = sensorByBlock.get(candidate.toBlockId);
                  const reverse = hasReturn(candidate, candidates);
                  return <Table.Tr key={candidate.key}>
                    <Table.Td>{candidate.fromBlockName}</Table.Td>
                    <Table.Td>{candidate.blockPath.slice(1, -1).map(block => block.name).join(" → ") || "—"}</Table.Td>
                    <Table.Td>{candidate.toBlockName}</Table.Td>
                    <Table.Td>{candidate.locoDirection}</Table.Td>
                    <Table.Td>{sensor ? `#${sensor}` : "Missing"}</Table.Td>
                    <Table.Td>{reverse ? "Available" : "Missing"}</Table.Td>
                    <Table.Td><Button size="compact-xs" variant="light"
                      disabled={!reverse || !sensor} onClick={() => choose(candidate)}>
                      Select
                    </Button></Table.Td>
                  </Table.Tr>;
                })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Stack>
    </AppModal>
  </>;
}
