import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
} from "@mantine/core";
import {
  IconAdjustments,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import i18next from "i18next";

import AppModal from "@/components/common/AppModal";
import type {
  BlockDirectionEventConfigDto,
  BlockEventConfigDto,
  BlockEventSensorConditionDto,
} from "@domain/layout/layoutDto";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import { TrackElement } from "@/models/editor/core/TrackElement";
import {
  BlockElement,
  emptyBlockEventConfig,
} from "@/models/editor/elements/BlockElement";

type Direction = "forward" | "reverse";
type EventKey =
  | "beforeArrive"
  | "arrived"
  | "beforeLeave"
  | "afterLeave";

type SensorOption = {
  value: string;
  label: string;
};

type Props = {
  block: BlockElement;
  layout: LayoutView;
  onChange: () => void;
};

const EVENT_ORDER: EventKey[] = [
  "beforeArrive",
  "arrived",
  "beforeLeave",
  "afterLeave",
];

function cloneConfig(
  config: BlockEventConfigDto | null | undefined
): BlockEventConfigDto {
  const source = config ?? emptyBlockEventConfig();

  const cloneDirection = (
    direction: BlockDirectionEventConfigDto
  ): BlockDirectionEventConfigDto => ({
    beforeArrive: direction.beforeArrive.map(item => ({ ...item })),
    arrived: direction.arrived.map(item => ({ ...item })),
    beforeLeave: direction.beforeLeave.map(item => ({ ...item })),
    afterLeave: direction.afterLeave.map(item => ({ ...item })),
  });

  return {
    forward: cloneDirection(source.forward),
    reverse: cloneDirection(source.reverse),
  };
}

function language(): "hu" | "de" | "en" {
  const value =
    (
      (i18next.resolvedLanguage ??
        i18next.language ??
        "en")
        .split("-")[0] ??
      "en"
    ).toLowerCase();

  if (value === "hu" || value === "de") return value;
  return "en";
}

const TEXT = {
  hu: {
    title: "Blokk esemény szenzorok",
    property: "Blokk események",
    configure: "Beállítás",
    description:
      "Irányfüggő szenzorfeltételek a blokk érkezési és elhagyási eseményeihez.",
    forward: "Forward",
    reverse: "Reverse",
    beforeArrive: "Before Arrive",
    arrived: "Arrived",
    beforeLeave: "Before Leave",
    afterLeave: "After Leave",
    sensor: "Szenzor",
    addSensor: "Szenzor hozzáadása",
    empty: "Nincs külön feltétel.",
    occupancyFallbackOn:
      "Üresen a blokk occupancy szenzorának ON állapota az alapértelmezett.",
    occupancyFallbackOff:
      "Üresen a blokk occupancy szenzorának OFF állapota az alapértelmezett.",
    noFallback:
      "Üresen ehhez az eseményhez nincs automatikus szenzorfeltétel.",
    allMustMatch: "Az összes felsorolt feltételnek teljesülnie kell (AND).",
    copyToReverse: "Forward → Reverse másolás",
    copyToForward: "Reverse → Forward másolás",
    cancel: "Mégse",
    save: "Mentés",
    on: "ON",
    off: "OFF",
    directionHelpForward:
      "A nyíl a blokk Forward irányát mutatja. A bal oldali érzékelő ebben az irányban érkezés előtti érzékelő lehet.",
    directionHelpReverse:
      "Reverse irányban a fizikai oldalak szerepe felcserélődik: ami Forwardban előtte van, az visszafelé már utána lehet.",
    configured: "beállított feltétel",
    occupancy: "occupancy",
  },
  en: {
    title: "Block event sensors",
    property: "Block events",
    configure: "Configure",
    description:
      "Direction-aware sensor conditions for block arrival and departure events.",
    forward: "Forward",
    reverse: "Reverse",
    beforeArrive: "Before Arrive",
    arrived: "Arrived",
    beforeLeave: "Before Leave",
    afterLeave: "After Leave",
    sensor: "Sensor",
    addSensor: "Add sensor",
    empty: "No explicit condition.",
    occupancyFallbackOn:
      "When empty, the block occupancy sensor ON state is used as the default.",
    occupancyFallbackOff:
      "When empty, the block occupancy sensor OFF state is used as the default.",
    noFallback:
      "When empty, this event has no automatic sensor condition.",
    allMustMatch: "All listed conditions must match (AND).",
    copyToReverse: "Copy Forward → Reverse",
    copyToForward: "Copy Reverse → Forward",
    cancel: "Cancel",
    save: "Save",
    on: "ON",
    off: "OFF",
    directionHelpForward:
      "The arrow shows the block Forward direction. A sensor on the left can act as the approach sensor in this direction.",
    directionHelpReverse:
      "In Reverse the physical sides change roles: what is before the block in Forward can become after it in Reverse.",
    configured: "configured condition",
    occupancy: "occupancy",
  },
  de: {
    title: "Block-Ereignissensoren",
    property: "Block-Ereignisse",
    configure: "Konfigurieren",
    description:
      "Richtungsabhängige Sensorbedingungen für Ankunfts- und Verlassensereignisse.",
    forward: "Forward",
    reverse: "Reverse",
    beforeArrive: "Before Arrive",
    arrived: "Arrived",
    beforeLeave: "Before Leave",
    afterLeave: "After Leave",
    sensor: "Sensor",
    addSensor: "Sensor hinzufügen",
    empty: "Keine explizite Bedingung.",
    occupancyFallbackOn:
      "Leer: standardmäßig wird der ON-Zustand des Block-Belegtmelders verwendet.",
    occupancyFallbackOff:
      "Leer: standardmäßig wird der OFF-Zustand des Block-Belegtmelders verwendet.",
    noFallback:
      "Leer: für dieses Ereignis gibt es keine automatische Sensorbedingung.",
    allMustMatch: "Alle aufgeführten Bedingungen müssen erfüllt sein (AND).",
    copyToReverse: "Forward → Reverse kopieren",
    copyToForward: "Reverse → Forward kopieren",
    cancel: "Abbrechen",
    save: "Speichern",
    on: "ON",
    off: "OFF",
    directionHelpForward:
      "Der Pfeil zeigt die Forward-Richtung des Blocks. Ein Sensor links kann in dieser Richtung als Annäherungssensor dienen.",
    directionHelpReverse:
      "In Reverse tauschen die physischen Seiten ihre Rolle: was in Forward vor dem Block liegt, kann rückwärts danach liegen.",
    configured: "konfigurierte Bedingung",
    occupancy: "Belegtmelder",
  },
} as const;

function SensorConditionMarker({
  conditions,
  x,
  y,
  align = "middle",
}: {
  conditions: BlockEventSensorConditionDto[];
  x: number;
  y: number;
  align?: "start" | "middle" | "end";
}) {
  if (conditions.length === 0) {
    return null;
  }

  const textAnchor =
    align === "start"
      ? "start"
      : align === "end"
        ? "end"
        : "middle";

  const labelX =
    align === "start"
      ? x + 11
      : align === "end"
        ? x - 11
        : x;

  return (
    <>
      {conditions.map(
        (
          condition,
          index
        ) => {
          const yy =
            y + index * 17;

          return (
            <g
              key={`${condition.sensor}-${condition.state}-${index}`}
            >
              <circle
                cx={x}
                cy={yy}
                r="5.5"
                fill={
                  condition.state
                    ? "var(--mantine-color-blue-filled)"
                    : "var(--mantine-color-gray-3)"
                }
                stroke={
                  condition.state
                    ? "var(--mantine-color-blue-8)"
                    : "var(--mantine-color-gray-6)"
                }
                strokeWidth="1.2"
              />

              {!condition.state && (
                <circle
                  cx={x}
                  cy={yy}
                  r="2.2"
                  fill="var(--mantine-color-body)"
                />
              )}

              <text
                x={labelX}
                y={yy + 3.5}
                textAnchor={textAnchor}
                fontSize="10"
                fontWeight="700"
                fill="var(--mantine-color-text)"
              >
                {condition.sensor}
              </text>
            </g>
          );
        }
      )}
    </>
  );
}

function DirectionDiagram({
  direction,
  blockName,
  occupancySensor,
  events,
}: {
  direction: Direction;
  blockName: string;
  occupancySensor: number;
  events: BlockDirectionEventConfigDto;
}) {
  const text =
    TEXT[language()];

  const reverse =
    direction ===
    "reverse";

  const arrowX1 =
    reverse
      ? 314
      : 46;

  const arrowX2 =
    reverse
      ? 46
      : 314;

  const marker =
    reverse
      ? "url(#block-event-arrow-left)"
      : "url(#block-event-arrow-right)";

  return (
    <div>
      <svg
        viewBox="0 0 360 176"
        role="img"
        aria-label={
          reverse
            ? text.directionHelpReverse
            : text.directionHelpForward
        }
        style={{
          width: "100%",
          maxHeight: 195,
          display: "block",
        }}
      >
        <defs>
          <marker
            id="block-event-arrow-right"
            markerWidth="6"
            markerHeight="6"
            refX="5.5"
            refY="3"
            orient="auto"
          >
            <path
              d="M0,0 L6,3 L0,6 z"
              fill="currentColor"
            />
          </marker>

          <marker
            id="block-event-arrow-left"
            markerWidth="6"
            markerHeight="6"
            refX="5.5"
            refY="3"
            orient="auto"
          >
            <path
              d="M0,0 L6,3 L0,6 z"
              fill="currentColor"
            />
          </marker>
        </defs>

        <line
          x1="20"
          y1="62"
          x2="340"
          y2="62"
          stroke="currentColor"
          strokeWidth="3"
          opacity="0.5"
        />

        <circle
          cx="55"
          cy="62"
          r="7"
          fill="var(--mantine-color-blue-filled)"
        />

        <circle
          cx="305"
          cy="62"
          r="7"
          fill="var(--mantine-color-blue-filled)"
        />

        <rect
          x="125"
          y="42"
          width="110"
          height="38"
          rx="6"
          fill="var(--mantine-color-body)"
          stroke="var(--mantine-color-gray-6)"
          strokeWidth="1.5"
        />

        <text
          x="180"
          y="57"
          textAnchor="middle"
          fontSize="12"
          fontWeight="700"
          fill="var(--mantine-color-text)"
        >
          {blockName || "BLOCK"}
        </text>

        <text
          x="180"
          y="72"
          textAnchor="middle"
          fontSize="10"
          fill="var(--mantine-color-dimmed)"
        >
          {text.occupancy}: {occupancySensor > 0 ? occupancySensor : "—"}
        </text>

        <line
          x1={arrowX1}
          y1="20"
          x2={arrowX2}
          y2="20"
          stroke="currentColor"
          strokeWidth="2"
          markerEnd={marker}
        />

        <text
          x="180"
          y="14"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="currentColor"
        >
          {reverse ? "REVERSE" : "FORWARD"}
        </text>

        <text
          x="55"
          y="94"
          textAnchor="middle"
          fontSize="9"
          fontWeight="700"
          fill="var(--mantine-color-dimmed)"
        >
          {reverse ? "AFTER" : "BEFORE"}
        </text>

        <text
          x="55"
          y="105"
          textAnchor="middle"
          fontSize="10"
          fontWeight="800"
          fill="currentColor"
          opacity="0.84"
        >
          LEFT
        </text>

        <text
          x="305"
          y="94"
          textAnchor="middle"
          fontSize="9"
          fontWeight="700"
          fill="var(--mantine-color-dimmed)"
        >
          {reverse ? "BEFORE" : "AFTER"}
        </text>

        <text
          x="305"
          y="105"
          textAnchor="middle"
          fontSize="10"
          fontWeight="800"
          fill="currentColor"
          opacity="0.84"
        >
          RIGHT
        </text>

        <text
          x="180"
          y="99"
          textAnchor="middle"
          fontSize="9"
          fontWeight="700"
          fill="var(--mantine-color-dimmed)"
        >
          ARRIVED
        </text>

        <SensorConditionMarker
          conditions={events.beforeArrive}
          x={reverse ? 305 : 55}
          y={116}
          align={reverse ? "end" : "start"}
        />

        <SensorConditionMarker
          conditions={events.arrived}
          x={180}
          y={116}
          align="start"
        />

        <SensorConditionMarker
          conditions={events.beforeLeave}
          x={reverse ? 55 : 305}
          y={116}
          align={reverse ? "start" : "end"}
        />

        {events.afterLeave.length > 0 && (
          <>
            <text
              x="180"
              y="145"
              textAnchor="middle"
              fontSize="9"
              fontWeight="700"
              fill="var(--mantine-color-dimmed)"
            >
              AFTER LEAVE
            </text>

            <SensorConditionMarker
              conditions={events.afterLeave}
              x={180}
              y={156}
              align="start"
            />
          </>
        )}
      </svg>

      <Text
        size="xs"
        c="dimmed"
        ta="center"
      >
        {reverse
          ? text.directionHelpReverse
          : text.directionHelpForward}
      </Text>
    </div>
  );
}

export default function BlockEventConfigPropertyEditor({
  block,
  layout,
  onChange,
}: Props) {
  const text = TEXT[language()];
  const [opened, setOpened] = useState(false);
  const [direction, setDirection] = useState<Direction>("forward");
  const [draft, setDraft] = useState<BlockEventConfigDto>(() =>
    cloneConfig(block.eventConfig)
  );

  const sensorOptions = useMemo(() => {
    const byAddress = new Map<number, SensorOption>();

    const add = (address: number, name: string) => {
      if (!Number.isInteger(address) || address <= 0 || address > 65535) return;
      if (byAddress.has(address)) return;

      byAddress.set(address, {
        value: String(address),
        label: name.trim()
          ? `Sensor ${address} · ${name.trim()}`
          : `Sensor ${address}`,
      });
    };

    for (const element of layout.getAllElements()) {
      if (element instanceof BlockElement) {
        add(element.sensorAddress, element.name);
        continue;
      }

      if (element instanceof TrackElement && element.hasOccupancySensor) {
        add(element.address, element.name);
      }
    }

    for (const dir of ["forward", "reverse"] as const) {
      for (const event of EVENT_ORDER) {
        for (const condition of block.eventConfig[dir][event]) {
          add(condition.sensor, "");
        }
      }
    }

    return [...byAddress.values()].sort(
      (a, b) => Number(a.value) - Number(b.value)
    );
  }, [block, layout, opened]);



  const configuredCount = EVENT_ORDER.reduce(
    (sum, event) =>
      sum +
      block.eventConfig.forward[event].length +
      block.eventConfig.reverse[event].length,
    0
  );

  const openEditor = () => {
    setDraft(cloneConfig(block.eventConfig));
    setDirection("forward");
    setOpened(true);
  };

  const updateEvent = (
    targetDirection: Direction,
    event: EventKey,
    conditions: BlockEventSensorConditionDto[]
  ) => {
    setDraft(current => ({
      ...current,
      [targetDirection]: {
        ...current[targetDirection],
        [event]: conditions,
      },
    }));
  };

  const copyDirection = (from: Direction, to: Direction) => {
    setDraft(current => ({
      ...current,
      [to]: {
        beforeArrive: current[from].beforeArrive.map(item => ({ ...item })),
        arrived: current[from].arrived.map(item => ({ ...item })),
        beforeLeave: current[from].beforeLeave.map(item => ({ ...item })),
        afterLeave: current[from].afterLeave.map(item => ({ ...item })),
      },
    }));
  };

  const renderEvent = (event: EventKey) => {
    const conditions = draft[direction][event];
    const used = new Set(conditions.map(item => item.sensor));
    const available = sensorOptions.filter(option => !used.has(Number(option.value)));
    const next = available[0] ?? null;

    const fallbackText =
      event === "arrived"
        ? text.occupancyFallbackOn
        : event === "afterLeave"
          ? text.occupancyFallbackOff
          : text.noFallback;

    return (
      <Card key={event} withBorder padding="sm">
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <Text fw={700} size="sm">
                {text[event]}
              </Text>
              <Badge size="xs" variant="light">
                {conditions.length}
              </Badge>
            </Group>

            <Button
              size="compact-xs"
              variant="light"
              leftSection={<IconPlus size={13} />}
              disabled={!next}
              onClick={() => {
                if (!next) return;
                updateEvent(direction, event, [
                  ...conditions,
                  {
                    sensor: Number(next.value),
                    state: true,
                  },
                ]);
              }}
            >
              {text.addSensor}
            </Button>
          </Group>

          {conditions.length === 0 ? (
            <Stack gap={2}>
              <Text size="xs" c="dimmed">
                {text.empty}
              </Text>
              <Text size="xs" c="dimmed">
                {fallbackText}
              </Text>
            </Stack>
          ) : (
            <>
              {conditions.map((condition, index) => (
                <Group key={`${event}-${condition.sensor}-${index}`} gap="xs" wrap="nowrap">
                  <Select
                    size="xs"
                    style={{ flex: 1 }}
                    label={index === 0 ? text.sensor : undefined}
                    value={String(condition.sensor)}
                    allowDeselect={false}
                    searchable
                    data={[
                      ...(sensorOptions.some(option => Number(option.value) === condition.sensor)
                        ? []
                        : [{
                            value: String(condition.sensor),
                            label: `Sensor ${condition.sensor}`,
                          }]),
                      ...sensorOptions.filter(
                        option =>
                          Number(option.value) === condition.sensor ||
                          !used.has(Number(option.value))
                      ),
                    ]}
                    onChange={value => {
                      if (!value) return;
                      updateEvent(
                        direction,
                        event,
                        conditions.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, sensor: Number(value) }
                            : item
                        )
                      );
                    }}
                  />

                  <Switch
                    mt={index === 0 ? 22 : 0}
                    checked={condition.state}
                    label={condition.state ? text.on : text.off}
                    onChange={ev =>
                      updateEvent(
                        direction,
                        event,
                        conditions.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, state: ev.currentTarget.checked }
                            : item
                        )
                      )
                    }
                  />

                  <ActionIcon
                    mt={index === 0 ? 22 : 0}
                    variant="light"
                    color="red"
                    onClick={() =>
                      updateEvent(
                        direction,
                        event,
                        conditions.filter((_, itemIndex) => itemIndex !== index)
                      )
                    }
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))}

              {conditions.length > 1 && (
                <Text size="xs" c="dimmed">
                  {text.allMustMatch}
                </Text>
              )}
            </>
          )}
        </Stack>
      </Card>
    );
  };

  return (
    <>
      <Stack gap={6}>
        <Group justify="space-between" align="center">
          <div>
            <Text size="sm" fw={600}>
              {text.property}
            </Text>
            <Text size="xs" c="dimmed">
              {text.description}
            </Text>
          </div>

          <Badge variant="light" color={configuredCount > 0 ? "blue" : "gray"}>
            {configuredCount}
          </Badge>
        </Group>

        <Button
          size="xs"
          variant="light"
          leftSection={<IconAdjustments size={14} />}
          onClick={openEditor}
        >
          {text.configure}
        </Button>
      </Stack>

      <AppModal
        opened={opened}
        onClose={() => setOpened(false)}
        title={`${text.title} · ${block.name || `#${block.id}`}`}
        size="lg"
        centered
        draggable
        styles={{
          content: {
            height: "82vh",
            maxHeight: "82vh",
            overflow: "hidden",
          },
          body: {
            height: "calc(82vh - 48px)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          },
        }}
      >
        <Stack
          gap="sm"
          h="100%"
          style={{
            minHeight: 0,
          }}
        >
          <Tabs
            value={direction}
            onChange={value => setDirection(value === "reverse" ? "reverse" : "forward")}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
            }}
          >
            <Tabs.List grow>
              <Tabs.Tab value="forward">{text.forward} →</Tabs.Tab>
              <Tabs.Tab value="reverse">← {text.reverse}</Tabs.Tab>
            </Tabs.List>

            <Stack
              gap="sm"
              mt="sm"
              style={{
                flex: 1,
                minHeight: 0,
              }}
            >
              <DirectionDiagram
                direction={direction}
                blockName={block.name}
                occupancySensor={block.sensorAddress}
                events={draft[direction]}
              />

              <Group justify="flex-end">
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() =>
                    copyDirection(
                      direction,
                      direction === "forward" ? "reverse" : "forward"
                    )
                  }
                >
                  {direction === "forward"
                    ? text.copyToReverse
                    : text.copyToForward}
                </Button>
              </Group>

              <ScrollArea
                style={{
                  flex: 1,
                  minHeight: 0,
                }}
                type="auto"
                offsetScrollbars
              >
                <Stack gap="xs" pr="xs">
                  {EVENT_ORDER.map(renderEvent)}
                </Stack>
              </ScrollArea>
            </Stack>
          </Tabs>

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpened(false)}>
              {text.cancel}
            </Button>
            <Button
              onClick={() => {
                block.eventConfig = cloneConfig(draft);
                onChange();
                setOpened(false);
              }}
            >
              {text.save}
            </Button>
          </Group>
        </Stack>
      </AppModal>
    </>
  );
}
