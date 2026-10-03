import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
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
import { showNotification } from "@mantine/notifications";
import i18next from "i18next";

import AppModal from "@/components/common/AppModal";
import type {
  BlockDirectionEventConfigDto,
  BlockEventConfigDto,
  BlockEventSensorConditionDto,
} from "@domain/layout/layoutDto";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import {
  createCurrentClientLayoutSnapshot,
  ensureClientRouteGraph,
} from "@/services/clientRouteGraphCache";
import { TrackElement } from "@/models/editor/core/TrackElement";
import {
  BlockElement,
  emptyBlockEventConfig,
} from "@/models/editor/elements/BlockElement";

type Direction = "forward" | "reverse";
type SensorGroupKey =
  | "arrival"
  | "arrived"
  | "leave";

type SensorOption = {
  value: string;
  label: string;
};

type Props = {
  block: BlockElement;
  layout: LayoutView;
  onChange: () => void;
};

const SENSOR_GROUP_ORDER: SensorGroupKey[] = [
  "arrival",
  "arrived",
  "leave",
];

function cloneConfig(
  config: BlockEventConfigDto | null | undefined
): BlockEventConfigDto {
  const source = config ?? emptyBlockEventConfig();

  const cloneDirection = (
    direction: BlockDirectionEventConfigDto
  ): BlockDirectionEventConfigDto => ({
    arrival: direction.arrival.map(item => ({ ...item })),
    arrivalDelayMs: direction.arrivalDelayMs,
    arrived: direction.arrived.map(item => ({ ...item })),
    arrivedDelayMs: direction.arrivedDelayMs,
    leave: direction.leave.map(item => ({ ...item })),
    leaveDelayMs: direction.leaveDelayMs,
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
    directionGroup: "Menetirány csoport",
    arrival: "Érkezés",
    arrived: "Arrived",
    leave: "Elhagyás",
    sensor: "Szenzor",
    delayMs: "Késleltetés (ms)",
    delayHelp:
      "A késleltetés a teljes szenzorfeltétel teljesülése után indul.",
    addSensor: "Szenzor hozzáadása",
    empty: "Nincs külön feltétel.",
    occupancyFallbackOn:
      "Üresen a blokk occupancy szenzorának ON állapota az alapértelmezett.",
    occupancyFallbackOff:
      "Üresen a blokk occupancy szenzorának OFF állapota az alapértelmezett.",
    noFallback:
      "Üresen ehhez az eseményhez nincs automatikus szenzorfeltétel.",
    allMustMatch: "A felsorolt szenzorfeltételek ÉS kapcsolatban vannak.",
    copyToReverse: "Forward → Reverse másolás",
    copyToForward: "Reverse → Forward másolás",
    cancel: "Mégse",
    save: "Mentés",
    on: "ON",
    off: "OFF",
    directionHelpForward:
      "A Forward csoport Arrival, Arrived és Leave szenzorait mutatja.",
    directionHelpReverse:
      "A Reverse csoport Arrival, Arrived és Leave szenzorait mutatja.",
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
    directionGroup: "Direction group",
    arrival: "Arrival",
    arrived: "Arrived",
    leave: "Leave",
    sensor: "Sensor",
    delayMs: "Delay (ms)",
    delayHelp:
      "The delay starts after the complete sensor condition has been satisfied.",
    addSensor: "Add sensor",
    empty: "No explicit condition.",
    occupancyFallbackOn:
      "When empty, the block occupancy sensor ON state is used as the default.",
    occupancyFallbackOff:
      "When empty, the block occupancy sensor OFF state is used as the default.",
    noFallback:
      "When empty, this event has no automatic sensor condition.",
    allMustMatch: "The listed sensor conditions are combined with AND.",
    copyToReverse: "Copy Forward → Reverse",
    copyToForward: "Copy Reverse → Forward",
    cancel: "Cancel",
    save: "Save",
    on: "ON",
    off: "OFF",
    directionHelpForward:
      "Shows the Forward group's Arrival, Arrived and Leave sensors.",
    directionHelpReverse:
      "Shows the Reverse group's Arrival, Arrived and Leave sensors.",
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
    directionGroup: "Fahrtrichtungsgruppe",
    arrival: "Ankunft",
    arrived: "Arrived",
    leave: "Verlassen",
    sensor: "Sensor",
    delayMs: "Verzögerung (ms)",
    delayHelp:
      "Die Verzögerung beginnt, nachdem die gesamte Sensorbedingung erfüllt wurde.",
    addSensor: "Sensor hinzufügen",
    empty: "Keine explizite Bedingung.",
    occupancyFallbackOn:
      "Leer: standardmäßig wird der ON-Zustand des Block-Belegtmelders verwendet.",
    occupancyFallbackOff:
      "Leer: standardmäßig wird der OFF-Zustand des Block-Belegtmelders verwendet.",
    noFallback:
      "Leer: für dieses Ereignis gibt es keine automatische Sensorbedingung.",
    allMustMatch: "Die aufgeführten Sensorbedingungen sind mit UND verknüpft.",
    copyToReverse: "Forward → Reverse kopieren",
    copyToForward: "Reverse → Forward kopieren",
    cancel: "Abbrechen",
    save: "Speichern",
    on: "ON",
    off: "OFF",
    directionHelpForward:
      "Zeigt die Arrival-, Arrived- und Leave-Sensoren der Forward-Gruppe.",
    directionHelpReverse:
      "Zeigt die Arrival-, Arrived- und Leave-Sensoren der Reverse-Gruppe.",
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

  const itemWidth = 48;
  const badgeWidth = 42;
  const badgeHeight = 18;
  const totalWidth =
    conditions.length * itemWidth;

  const startX =
    align === "start"
      ? x
      : align === "end"
        ? x - totalWidth
        : x - totalWidth / 2;

  return (
    <>
      {conditions.map(
        (
          condition,
          index
        ) => {
          const badgeX =
            startX +
            index * itemWidth +
            (itemWidth - badgeWidth) / 2;

          return (
            <g
              key={`${condition.sensor}-${index}`}
            >
              <rect
                x={badgeX}
                y={y - badgeHeight / 2}
                width={badgeWidth}
                height={badgeHeight}
                rx="9"
                fill={
                  condition.state
                    ? "var(--mantine-color-green-7)"
                    : "#000000"
                }
                stroke={
                  condition.state
                    ? "var(--mantine-color-green-9)"
                    : "var(--mantine-color-gray-7)"
                }
                strokeWidth="1"
              />

              <text
                x={badgeX + badgeWidth / 2}
                y={y + 3.5}
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                fill="var(--mantine-color-white)"
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
  hasForwardExit,
  hasReverseExit,
}: {
  direction: Direction;
  blockName: string;
  occupancySensor: number;
  events: BlockDirectionEventConfigDto;
  hasForwardExit: boolean;
  hasReverseExit: boolean;
}) {
  const text =
    TEXT[language()];

  const reverse =
    direction ===
    "reverse";

  /*
   * The diagram renders only the currently selected direction group.
   * Forward and Reverse are independent configurations.
   *
   * Physical placement for the active direction:
   *   Forward: ARRIVAL side on the left, DEPARTURE side on the right.
   *   Reverse: DEPARTURE side on the left, ARRIVAL side on the right.
   */
  const leftSideConditions =
    reverse
      ? events.leave
      : events.arrival;

  const rightSideConditions =
    reverse
      ? events.arrival
      : events.leave;

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

  /*
   * Diagram coordinates are fixed to the physical Forward orientation:
   *   left  = Reverse departure side
   *   right = Forward departure side
   *
   * A terminal/dead-end side is therefore hidden in BOTH direction tabs.
   * Only the labels swap between Arrival and Leave when direction changes.
   */
  const showLeftSide =
    hasReverseExit;

  const showRightSide =
    hasForwardExit;

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
          maxHeight: 185,
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

        {showLeftSide && (
          <>
            <line
              x1="20"
              y1="62"
              x2="125"
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
          </>
        )}

        {showRightSide && (
          <>
            <line
              x1="235"
              y1="62"
              x2="340"
              y2="62"
              stroke="currentColor"
              strokeWidth="3"
              opacity="0.5"
            />

            <circle
              cx="305"
              cy="62"
              r="7"
              fill="var(--mantine-color-blue-filled)"
            />
          </>
        )}

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

        {showLeftSide && (
          <text
            x="55"
            y="94"
            textAnchor="middle"
            fontSize="9"
            fontWeight="700"
            fill="var(--mantine-color-dimmed)"
          >
            {reverse ? text.leave : text.arrival}
          </text>
        )}

        {showRightSide && (
          <text
            x="305"
            y="94"
            textAnchor="middle"
            fontSize="9"
            fontWeight="700"
            fill="var(--mantine-color-dimmed)"
          >
            {reverse ? text.arrival : text.leave}
          </text>
        )}

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

        {showLeftSide && (
          <SensorConditionMarker
            conditions={leftSideConditions}
            x={55}
            y={122}
            align="middle"
          />
        )}

        <SensorConditionMarker
          conditions={events.arrived}
          x={180}
          y={114}
          align="middle"
        />

        {showRightSide && (
          <SensorConditionMarker
            conditions={rightSideConditions}
            x={305}
            y={122}
            align="middle"
          />
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
  const [saving, setSaving] = useState(false);

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

      if (
        element instanceof TrackElement &&
        Number.isInteger(
          element.address
        ) &&
        element.address >
          0
      ) {
        add(
          element.address,
          element.name
        );
      }
    }

    for (const dir of ["forward", "reverse"] as const) {
      for (const group of SENSOR_GROUP_ORDER) {
        for (const condition of block.eventConfig[dir][group]) {
          add(condition.sensor, "");
        }
      }
    }

    return [...byAddress.values()].sort(
      (a, b) => Number(a.value) - Number(b.value)
    );
  }, [block, layout, opened]);




  const diagramTopology =
    useMemo(
      () => {
        if (!opened) {
          return {
            hasForwardExit: true,
            hasReverseExit: true,
          };
        }

        try {
          const graph =
            ensureClientRouteGraph(
              layout
            ).result;

          const outgoingRoutes =
            graph.routes.filter(
              route =>
                route.fromBlock.id ===
                block.id
            );

          /*
           * An UNKNOWN route does not tell us which physical side is the
           * continuation, so keep both sides visible rather than drawing a
           * false terminal.
           */
          if (
            outgoingRoutes.length === 0 ||
            outgoingRoutes.some(
              route =>
                route.solution.locoDirection ===
                "unknown"
            )
          ) {
            return {
              hasForwardExit: true,
              hasReverseExit: true,
            };
          }

          const hasForwardExit =
            outgoingRoutes.some(
              route =>
                route.solution.locoDirection ===
                "forward"
            );

          const hasReverseExit =
            outgoingRoutes.some(
              route =>
                route.solution.locoDirection ===
                "reverse"
            );

          if (
            !hasForwardExit &&
            !hasReverseExit
          ) {
            return {
              hasForwardExit: true,
              hasReverseExit: true,
            };
          }

          return {
            hasForwardExit,
            hasReverseExit,
          };
        } catch {
          /*
           * The event editor must remain usable even when the physical graph
           * itself is temporarily invalid. In that case use the old neutral
           * through-block drawing instead of guessing a dead-end side.
           */
          return {
            hasForwardExit: true,
            hasReverseExit: true,
          };
        }
      },
      [
        opened,
        layout,
        block.id,
      ]
    );

  const configuredCount =
    SENSOR_GROUP_ORDER.reduce(
      (sum, group) =>
        sum +
        block.eventConfig.forward[group].length +
        block.eventConfig.reverse[group].length,
      0
    ) +
    [
      block.eventConfig.forward.arrivalDelayMs,
      block.eventConfig.forward.arrivedDelayMs,
      block.eventConfig.forward.leaveDelayMs,
      block.eventConfig.reverse.arrivalDelayMs,
      block.eventConfig.reverse.arrivedDelayMs,
      block.eventConfig.reverse.leaveDelayMs,
    ].filter(
      delayMs =>
        delayMs >
        0
    ).length;

  const openEditor = () => {
    setDraft(
      cloneConfig(
        block.eventConfig
      )
    );
    setDirection("forward");
    setOpened(true);
  };

  const updateGroup = (
    targetDirection: Direction,
    group: SensorGroupKey,
    conditions: BlockEventSensorConditionDto[]
  ) => {
    setDraft(current => ({
      ...current,
      [targetDirection]: {
        ...current[targetDirection],
        [group]:
          conditions.map(
            item => ({
              ...item,
            })
          ),
      },
    }));
  };

  const copyDirection = (from: Direction, to: Direction) => {
    setDraft(current => ({
      ...current,
      [to]: {
        arrival: current[from].arrival.map(item => ({ ...item })),
        arrivalDelayMs: current[from].arrivalDelayMs,
        arrived: current[from].arrived.map(item => ({ ...item })),
        arrivedDelayMs: current[from].arrivedDelayMs,
        leave: current[from].leave.map(item => ({ ...item })),
        leaveDelayMs: current[from].leaveDelayMs,
      },
    }));
  };

  const delayKey = (
    group: SensorGroupKey
  ):
    | "arrivalDelayMs"
    | "arrivedDelayMs"
    | "leaveDelayMs" =>
    group === "arrival"
      ? "arrivalDelayMs"
      : group === "arrived"
        ? "arrivedDelayMs"
        : "leaveDelayMs";

  const updateDelay = (
    targetDirection: Direction,
    group: SensorGroupKey,
    delayMs: number
  ) => {
    const key =
      delayKey(
        group
      );

    setDraft(current => ({
      ...current,
      [targetDirection]: {
        ...current[targetDirection],
        [key]:
          Math.max(
            0,
            Math.min(
              600000,
              Math.round(
                delayMs
              )
            )
          ),
      },
    }));
  };

  const renderGroup = (group: SensorGroupKey) => {
    const conditions = draft[direction][group];
    const delayMs =
      draft[direction][
        delayKey(
          group
        )
      ];
    const used = new Set(conditions.map(item => item.sensor));
    const available = sensorOptions.filter(option => !used.has(Number(option.value)));
    const next = available[0] ?? null;

    const fallbackText =
      group === "arrived"
        ? text.occupancyFallbackOn
        : group === "leave"
          ? text.occupancyFallbackOff
          : text.noFallback;

    return (
      <Card key={group} withBorder padding="sm">
        <Stack gap="xs">
          <Group justify="space-between" align="center" wrap="wrap">
            <Group gap="xs">
              <Text fw={700} size="sm">
                {text[group]}
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
                updateGroup(direction, group, [
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
                <Group key={`${group}-${condition.sensor}-${index}`} gap="xs" wrap="nowrap">
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
                      updateGroup(
                        direction,
                        group,
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
                      updateGroup(
                        direction,
                        group,
                        conditions.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                state:
                                  ev.currentTarget.checked,
                              }
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
                      updateGroup(
                        direction,
                        group,
                        conditions.filter((_, itemIndex) => itemIndex !== index)
                      )
                    }
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))}

              <Text size="xs" c="dimmed">
                {text.allMustMatch}
              </Text>
            </>
          )}

          <Divider />

          <Group
            justify="space-between"
            align="flex-end"
            wrap="wrap"
            gap="sm"
          >
            <Text
              size="xs"
              c="dimmed"
              style={{
                flex: 1,
                minWidth: 220,
              }}
            >
              {text.delayHelp}
            </Text>

            <NumberInput
              size="xs"
              label={text.delayMs}
              value={delayMs}
              min={0}
              max={600000}
              step={100}
              allowDecimal={false}
              clampBehavior="strict"
              w={150}
              onChange={
                value =>
                  updateDelay(
                    direction,
                    group,
                    typeof value === "number"
                      ? value
                      : Number(value) || 0
                  )
              }
            />
          </Group>
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
          <DirectionDiagram
            direction={direction}
            blockName={block.name}
            occupancySensor={block.sensorAddress}
            events={draft[direction]}
            hasForwardExit={
              diagramTopology.hasForwardExit
            }
            hasReverseExit={
              diagramTopology.hasReverseExit
            }
          />

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
              <Group justify="space-between" align="center">
                <Text size="sm" fw={800}>
                  {text.directionGroup}: {direction === "forward" ? text.forward : text.reverse}
                </Text>

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
                  {renderGroup("arrival")}
                  {renderGroup("arrived")}
                  {renderGroup("leave")}
                </Stack>
              </ScrollArea>
            </Stack>
          </Tabs>

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpened(false)}>
              {text.cancel}
            </Button>
            <Button
              loading={saving}
              onClick={async () => {
                const previous =
                  cloneConfig(
                    block.eventConfig
                  );

                block.eventConfig =
                  cloneConfig(
                    draft
                  );

                onChange();
                setSaving(true);

                try {
                  const snapshot =
                    createCurrentClientLayoutSnapshot(
                      layout
                    );

                  const response =
                    await fetch(
                      "/api/layout",
                      {
                        method: "POST",
                        headers: {
                          "Content-Type":
                            "application/json",
                        },
                        body:
                          JSON.stringify(
                            snapshot
                          ),
                      }
                    );

                  if (!response.ok) {
                    const message =
                      await response.text();

                    throw new Error(
                      message.trim() ||
                      "Block event configuration could not be saved."
                    );
                  }

                  setOpened(false);
                } catch (error) {
                  block.eventConfig =
                    previous;

                  onChange();

                  showNotification({
                    color: "red",
                    title:
                      text.title,
                    message:
                      error instanceof Error
                        ? error.message
                        : String(
                            error
                          ),
                  });
                } finally {
                  setSaving(false);
                }
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
