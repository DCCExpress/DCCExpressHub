import { ActionIcon, Badge, Card, Group, ScrollArea, Slider, Stack, Text, Tooltip } from "@mantine/core";
import { IconArrowBigLeft, IconArrowBigRight, IconPlayerStopFilled } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { Direction, Loco } from "@domain/types";
import LocoImage from "../../components/loco/LocoImage";
import { wsApi } from "../../services/wsApi";
import { wsClient } from "../../services/wsClient";
import { getMovementTaskStates, subscribeMovementTaskStates } from "../../services/movementEngine";

type LiveState = { speed: number; direction: Direction; functionsMask: number };
type Props = { locos: Loco[]; selectedLocoId: string; onSelect: (loco: Loco) => void; disabled: boolean };

export default function LocoCardsView({ locos, selectedLocoId, onSelect, disabled }: Props) {
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
    if (disabled || blocked(loco.address)) return;
    const value = Math.max(0, Math.min(126, loco.maxSpeed > 0 ? loco.maxSpeed : 126, Math.round(speed)));
    if (wsApi.setLoco(loco.address, value, direction))
      setLive(old => ({ ...old, [loco.address]: { ...old[loco.address], speed: value, direction, functionsMask: old[loco.address]?.functionsMask ?? 0 } }));
  };

  const toggleFunction = (loco: Loco, number: number) => {
    if (disabled || blocked(loco.address)) return;
    const current = live[loco.address] ?? wsClient.getLatestLocoState(loco.address);
    if (!current) return;
    const active = ((current.functionsMask ?? 0) & (1 << number)) !== 0;
    if (wsApi.setLocoFunction(loco.address, number, !active))
      setLive(old => {
        const previous = old[loco.address] ?? { speed: current.speed, direction: current.direction, functionsMask: current.functionsMask ?? 0 };
        return { ...old, [loco.address]: { ...previous,
          functionsMask: active ? previous.functionsMask & ~(1 << number) : previous.functionsMask | (1 << number) } };
      });
  };

  return <ScrollArea h="100%" type="auto" offsetScrollbars>
    <Stack gap="xs" p="xs">
      {locos.map(loco => {
        const state = live[loco.address] ?? { speed: 0, direction: "forward" as Direction, functionsMask: 0 };
        const locked = disabled || blocked(loco.address);
        return <Card key={loco.id} withBorder radius="sm" padding="xs"
          style={{ borderColor: selectedLocoId === loco.id ? "var(--mantine-color-lime-6)" : undefined }}>
          <Group gap="xs" wrap="nowrap" onClick={() => onSelect(loco)} style={{ cursor: "pointer" }}>
            <LocoImage locoId={loco.id} image={loco.image} name={loco.name} width={94} height={48} />
            <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
              <Text size="sm" fw={600} truncate>{loco.name || `#${loco.address}`}</Text>
              <Text size="xs" c="dimmed">#{loco.address}</Text>
              <Group gap={3} wrap="nowrap" mt={3} onClick={event => event.stopPropagation()}>
                {[0, 1, 2, 3, 4].map(number => (
                  <Tooltip key={number} label={`Function F${number}`}>
                    <ActionIcon size="sm" radius="sm" variant={(state.functionsMask & (1 << number)) !== 0 ? "filled" : "light"}
                      color={(state.functionsMask & (1 << number)) !== 0 ? "lime" : "gray"}
                      disabled={locked} aria-label={`Function F${number}`}
                      onClick={event => { event.stopPropagation(); toggleFunction(loco, number); }}>
                      <Text size="10px" fw={700}>F{number}</Text>
                    </ActionIcon>
                  </Tooltip>
                ))}
              </Group>
            </Stack>
            <Badge color="dark" variant="filled" radius="sm" size="lg" styles={{ root: { backgroundColor: "#111", minWidth: 40 }, label: { fontVariantNumeric: "tabular-nums" } }}>{state.speed}</Badge>
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
          {blocked(loco.address) && <Text size="xs" c="dimmed">Managed by Train Driver / Movement</Text>}
        </Card>;
      })}
    </Stack>
  </ScrollArea>;
}
