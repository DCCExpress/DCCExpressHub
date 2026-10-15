import { ActionIcon, Card, Group, ScrollArea, Slider, Stack, Text, Tooltip } from "@mantine/core";
import { IconArrowBigLeft, IconArrowBigRight, IconPlayerStopFilled } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { Direction, Loco } from "@domain/types";
import LocoImage from "../../components/loco/LocoImage";
import { wsApi } from "../../services/wsApi";
import { wsClient } from "../../services/wsClient";
import { getMovementTaskStates, subscribeMovementTaskStates } from "../../services/movementEngine";

type LiveState = { speed: number; direction: Direction };
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
      const { address, speed, direction } = data.loco;
      setLive(old => ({ ...old, [address]: { speed, direction } }));
    });
    const driverUnsub = wsClient.on("trainDriverState", data => {
      // Task snapshots are authoritative; a running driver owns its throttle.
      const item = data as unknown as { tasks?: Array<{ locoAddress: number; status: string }> };
      if (Array.isArray(item.tasks)) setDrivers(item.tasks);
    });
    for (const loco of locos) {
      const cached = wsClient.getLatestLocoState(loco.address);
      if (cached) setLive(old => ({ ...old, [loco.address]: { speed: cached.speed, direction: cached.direction } }));
      wsApi.getLoco(loco.address);
    }
    return () => { unsub(); driverUnsub(); };
  }, [locos]);
  const blocked = (address: number) =>
    moving.some(item => item.state.locoAddress === address && ["running", "stopping"].includes(item.state.status)) ||
    drivers.some(item => item.locoAddress === address && ["created", "running", "waiting", "paused", "stopping"].includes(item.status));
  const command = (loco: Loco, speed: number, direction: Direction) => {
    if (disabled || blocked(loco.address)) return;
    const value = Math.max(0, Math.min(126, loco.maxSpeed > 0 ? loco.maxSpeed : 126, Math.round(speed)));
    if (wsApi.setLoco(loco.address, value, direction))
      setLive(old => ({ ...old, [loco.address]: { speed: value, direction } }));
  };

  return <ScrollArea h="100%" type="auto" offsetScrollbars>
    <Stack gap="xs" p="xs">
      {locos.map(loco => {
        const state = live[loco.address] ?? { speed: 0, direction: "forward" as Direction };
        const locked = disabled || blocked(loco.address);
        return <Card key={loco.id} withBorder radius="sm" padding="xs"
          style={{ borderColor: selectedLocoId === loco.id ? "var(--mantine-color-lime-6)" : undefined }}>
          <Group gap="xs" wrap="nowrap" onClick={() => onSelect(loco)} style={{ cursor: "pointer" }}>
            <LocoImage locoId={loco.id} image={loco.image} name={loco.name} width={94} height={48} />
            <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
              <Text size="sm" fw={600} truncate>{loco.name || `#${loco.address}`}</Text>
              <Text size="xs" c="dimmed">DCC #{loco.address}</Text>
            </Stack>
            <Text fw={700} size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>{state.speed}</Text>
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
              onChange={value => setLive(old => ({ ...old, [loco.address]: { speed: value, direction: state.direction } }))}
              onChangeEnd={value => command(loco, value, state.direction)} aria-label={`Speed ${loco.name}`} />
          </Group>
          {blocked(loco.address) && <Text size="xs" c="dimmed">Managed by Train Driver / Movement</Text>}
        </Card>;
      })}
    </Stack>
  </ScrollArea>;
}
