import { ActionIcon, Badge, Card, Group, ScrollArea, Slider, Stack, Text, Tooltip } from "@mantine/core";
import { IconArrowBigLeft, IconArrowBigRight, IconPlayerStopFilled } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { Direction, Loco } from "@domain/types";
import LocoImage from "../../components/loco/LocoImage";
import FunctionIconAsset from "../../components/loco/FunctionIconAsset";

import { wsApi } from "../../services/wsApi";
import { wsClient } from "../../services/wsClient";
import { getMovementTaskStates, subscribeMovementTaskStates } from "../../services/movementEngine";
import LocoEmergencyButton from "./LocoEmergencyButton";

type LiveState = { speed: number; direction: Direction; functionsMask: number };
type Props = { locos: Loco[]; selectedLocoId: string; onSelect: (loco: Loco) => void; disabled: boolean; emergencyStop: boolean; onEmergencyToggle: () => void };

export default function LocoCardsView({ locos, selectedLocoId, onSelect, disabled, emergencyStop, onEmergencyToggle }: Props) {
  const [live, setLive] = useState<Record<number, LiveState>>({});
  const [moving, setMoving] = useState(() => getMovementTaskStates());
  const [drivers, setDrivers] = useState<Array<{ locoAddress: number; status: string }>>([]);
  useEffect(() => {
    const update = () => setMoving(getMovementTaskStates());
    return subscribeMovementTaskStates(update);
  }, []);
  useEffect(() => {
    const unsub = wsClient.on("locoState", data => {
      if (!data.loco) return;
      const { address, speed, direction, functionsMask } = data.loco;
      setLive(old => ({ ...old, [address]: { speed, direction, functionsMask: functionsMask ?? 0 } }));
    });
    const driverUnsub = wsClient.subscribeMessages(message => {
      if (message.type === "trainDriverStateChanged") {
        const driver = message.data;
        setDrivers(old => [...old.filter(item => item.locoAddress !== driver.locoAddress), driver]);
      } else if (message.type === "trainDriverResponse" &&
          message.data.action === "snapshot" && message.data.ok && Array.isArray(message.data.states)) {
        setDrivers(message.data.states);
      }
    });
    const connection = wsClient.subscribeStatus(status => {
      if (status !== "connected") { setDrivers([]); return; }
      wsClient.send({ type: "trainDriverCommand", data: {
        requestId: `loco-cards-snapshot-${Date.now()}`, action: "snapshot",
      } });
    });
    for (const loco of locos) {
      const cached = wsClient.getLatestLocoState(loco.address);
      if (cached) setLive(old => ({ ...old, [loco.address]: { speed: cached.speed, direction: cached.direction, functionsMask: cached.functionsMask ?? 0 } }));
      wsApi.getLoco(loco.address);
    }
    return () => { unsub(); driverUnsub(); connection(); };
  }, [locos]);
  const blocked = (address: number) =>
    moving.some(item => item.state.locoAddress === address && ["running", "stopping"].includes(item.state.status)) ||
    drivers.some(item => item.locoAddress === address && ["created", "running", "waiting", "paused", "stopping"].includes(item.status));
  const command = (loco: Loco, speed: number, direction: Direction) => {
    if (disabled) return;
    const value = Math.max(0, Math.min(126, loco.maxSpeed > 0 ? loco.maxSpeed : 126, Math.round(speed)));
    if (wsApi.setLoco(loco.address, value, direction))
      setLive(old => ({ ...old, [loco.address]: { ...old[loco.address], speed: value, direction, functionsMask: old[loco.address]?.functionsMask ?? 0 } }));
  };

  const toggleFunction = (loco: Loco, number: number, nextActive?: boolean) => {
    if (disabled) return;
    const current = live[loco.address] ?? wsClient.getLatestLocoState(loco.address);
    if (!current) return;
    const active = ((current.functionsMask ?? 0) & (1 << number)) !== 0;
    const target = nextActive ?? !active;
    if (wsApi.setLocoFunction(loco.address, number, target))
      setLive(old => {
        const previous = old[loco.address] ?? { speed: current.speed, direction: current.direction, functionsMask: current.functionsMask ?? 0 };
        return { ...old, [loco.address]: { ...previous,
          functionsMask: target ? previous.functionsMask | (1 << number) : previous.functionsMask & ~(1 << number) } };
      });
  };

  return <Stack h="100%" gap={0} style={{ minHeight: 0 }}>
    <div style={{ padding: 8, flexShrink: 0 }}>
      <LocoEmergencyButton emergencyStop={emergencyStop} onToggle={onEmergencyToggle} />
    </div>
    <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
    <Stack gap="xs" p="xs">
      {locos.map(loco => {
        const state = live[loco.address] ?? { speed: 0, direction: "forward" as Direction, functionsMask: 0 };
        // Train Driver / Movement ownership is advisory here: manual override remains available.
        const locked = disabled;
        // The movement cache retains terminal errors for diagnostics. A loco card
        // must show the CURRENT task, not an older failed route that happens to
        // be the first entry in the cache. Active safety stops have their own
        // global indicator; never recycle a previous trip's reason on this card.
        const locoMovements = moving
          .filter(item => item.state.locoAddress === loco.address);
        const newestFirst = (a: typeof locoMovements[number], b: typeof locoMovements[number]) =>
          (b.state.startedAt ?? 0) - (a.state.startedAt ?? 0);
        const activeMovement = locoMovements
          .filter(item => ["running", "stopping"].includes(item.state.status))
          .sort(newestFirst)[0]?.state;
        const movement = activeMovement;
        const driver = drivers.find(item => item.locoAddress === loco.address &&
          ["created", "running", "waiting", "paused", "stopping"].includes(item.status));
        const movementMessage = movement
          ? (movement.error || movement.info ||
            (movement.status === "stopping" ? "Stopping" :
              movement.targetBlockName ? `Moving to ${movement.targetBlockName}` : movement.status))
          : emergencyStop ? "Emergency stop active"
          : driver ? (driver.status === "waiting" ? "Train Driver waiting" :
              driver.status === "paused" ? "Train Driver paused" : `Train Driver: ${driver.status}`) : null;
        const cardFunctions = (loco.functions ?? []).filter(fn => fn.showOnLocoCard ?? fn.number < 5)
          .sort((a, b) => a.number - b.number).slice(0, 5);
        return <Card key={loco.id} withBorder radius="sm" padding="xs"
          style={{ borderColor: selectedLocoId === loco.id ? "var(--mantine-color-lime-6)" : undefined }}>
          <Group gap="xs" wrap="nowrap" onClick={() => onSelect(loco)} style={{ cursor: "pointer" }}>
            <LocoImage locoId={loco.id} image={loco.image} name={loco.name} width={94} height={48} />
            <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
              <Text size="sm" fw={600} truncate>{loco.name || `#${loco.address}`}</Text>
              <Text size="xs" c="dimmed">#{loco.address}</Text>
              <Group gap={3} wrap="nowrap" mt={3} onClick={event => event.stopPropagation()}>
                {cardFunctions.map(fn => {
                  const number = fn.number;

                  return <Tooltip key={number} label={fn?.name ? `F${number} · ${fn.name}` : `Function F${number}`}>
                    <ActionIcon size={30} radius="sm" variant={(state.functionsMask & (1 << number)) !== 0 ? "filled" : "light"}
                      color={(state.functionsMask & (1 << number)) !== 0 ? "blue" : "gray"}
                      disabled={locked} aria-label={`Function F${number}`}
                      onPointerDown={event => {
                        event.stopPropagation();
                        if (fn.momentary) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); toggleFunction(loco, number, true); }
                      }}
                      onPointerUp={event => { if (fn.momentary) { event.stopPropagation(); toggleFunction(loco, number, false); } }}
                      onPointerCancel={() => { if (fn.momentary) toggleFunction(loco, number, false); }}
                      onClick={event => { event.stopPropagation(); if (!fn.momentary) toggleFunction(loco, number); }}>
                      {fn.icon ? <FunctionIconAsset fn={fn} size={20} /> : <Text size="10px" fw={700}>F{number}</Text>}
                    </ActionIcon>
                  </Tooltip>;
                })}
              </Group>
            </Stack>
            <Badge color="dark" variant="filled" radius="sm" size="lg" styles={{ root: { backgroundColor: "#111", minWidth: 40, transform: "translateY(-15px)" }, label: { fontVariantNumeric: "tabular-nums" } }}>{state.speed}</Badge>
          </Group>
          <Group wrap="nowrap" gap={5} mt={5} onClick={event => event.stopPropagation()}>
            <Tooltip label="Reverse"><ActionIcon size="sm" variant={state.direction === "reverse" ? "filled" : "light"}
              disabled={locked} onClick={() => command(loco, state.speed, "reverse")} aria-label="Reverse"><IconArrowBigLeft size={14}/></ActionIcon></Tooltip>
            <Tooltip label="Stop"><ActionIcon size="sm" color="red" variant="light" disabled={locked}
              onClick={() => command(loco, 0, state.direction)} aria-label="Stop"><IconPlayerStopFilled size={14}/></ActionIcon></Tooltip>
            <Tooltip label="Forward"><ActionIcon size="sm" variant={state.direction === "forward" ? "filled" : "light"}
              disabled={locked} onClick={() => command(loco, state.speed, "forward")} aria-label="Forward"><IconArrowBigRight size={14}/></ActionIcon></Tooltip>
            <Slider style={{ flex: 1, minWidth: 35 }} size="xs" min={0} max={Math.max(1, Math.min(126, loco.maxSpeed || 126))}
              value={Math.min(state.speed, Math.max(1, Math.min(126, loco.maxSpeed || 126)))} disabled={locked}
              onChange={value => setLive(old => ({ ...old, [loco.address]: { ...old[loco.address], speed: value, direction: state.direction, functionsMask: old[loco.address]?.functionsMask ?? state.functionsMask } }))}
              onChangeEnd={value => command(loco, value, state.direction)} aria-label={`Speed ${loco.name}`} />
          </Group>
          <Text size="xs" c={movement?.error ? "red" : movementMessage ? "yellow" : "dimmed"} truncate="end" title={movementMessage ?? "Manual"} style={{ height: 18, lineHeight: "18px", width: "100%", minWidth: 0 }}>{movementMessage ?? "Manual"}</Text>
        </Card>;
      })}
    </Stack>
    </ScrollArea>
  </Stack>;
}
