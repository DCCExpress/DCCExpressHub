import {
  Alert,
  Badge,
  Card,
  Divider,
  Group,
  Loader,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";

import {
  IconClock,
  IconRoute,
} from "@tabler/icons-react";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import AppModal from "@/components/common/AppModal";

import type {
  LayoutView,
} from "@/models/editor/core/LayoutView";

import {
  BlockElement,
} from "@/models/editor/elements/BlockElement";

import type {
  MovementPage,
  MovementSensorCondition,
} from "@/domain/movement";

import {
  createCurrentClientLayoutSnapshot,
} from "@/services/clientRouteGraphCache";

import {
  loadMovementPlan,
  type MovementPlan,
  type MovementPlanResource,
} from "@/services/movementPlan";

import {
  defaultMovementResourceEventRule,
  resourceEventNames,
} from "@/services/movementResourceEvents";

import MovementRouteVectorPreview from "@/components/movement/MovementRouteVectorPreview";

import type {
  MovementRouteVectorItem,
} from "@/services/movementRouteVector";

type Props = {
  opened: boolean;
  onClose: () => void;
  page: MovementPage | null;
  layout: LayoutView;
};

type EventRow = {
  name: string;
  match: "all" | "any";
  conditions: MovementSensorCondition[];
  delayMs: number;
  defaultSensor?: boolean;
  note?: string | undefined;
};

function conditionText(
  condition: MovementSensorCondition
): string {
  return `#${condition.sensor} ${condition.state ? "ON" : "OFF"}`;
}

function configuredBlockConditions(
  layout: LayoutView,
  blockId: number,
  direction:
    | "unknown"
    | "forward"
    | "reverse",
  event:
    | "arrival"
    | "arrived"
    | "leave"
): MovementSensorCondition[] {
  if (
    direction ===
      "unknown"
  ) {
    return [];
  }

  const block =
    layout
      .getAllElements()
      .find(
        element =>
          element instanceof
            BlockElement &&
          element.id ===
            blockId
      );

  if (
    !(block instanceof
      BlockElement)
  ) {
    return [];
  }

  return block.eventConfig[
    direction
  ][
    event
  ].map(
    (
      condition,
      index
    ) => ({
      id:
        `preview-block-event-${blockId}-${direction}-${event}-${index}`,
      sensor:
        condition.sensor,
      state:
        condition.state,
    })
  );
}

function configuredBlockDelay(
  layout: LayoutView,
  blockId: number,
  direction:
    | "unknown"
    | "forward"
    | "reverse",
  event:
    | "arrival"
    | "arrived"
    | "leave"
): number {
  if (
    direction ===
      "unknown"
  ) {
    return 0;
  }

  const block =
    layout
      .getAllElements()
      .find(
        element =>
          element instanceof
            BlockElement &&
          element.id ===
            blockId
      );

  if (
    !(block instanceof
      BlockElement)
  ) {
    return 0;
  }

  const raw =
    event === "arrival"
      ? block.eventConfig[
          direction
        ].arrivalDelayMs
      : event === "arrived"
        ? block.eventConfig[
            direction
          ].arrivedDelayMs
        : block.eventConfig[
            direction
          ].leaveDelayMs;

  return Math.max(
    0,
    Math.min(
      600000,
      Math.round(
        raw
      )
    )
  );
}

function blockEvents(
  plan: MovementPlan,
  resource: MovementPlanResource,
  layout: LayoutView
): EventRow[] {
  if (
    resource.kind !== "block" ||
    resource.blockId === null
  ) {
    return [];
  }

  const incoming =
    plan.legs.find(
      leg =>
        leg.to.key === resource.key
    ) ??
    null;

  const outgoing =
    plan.legs.find(
      leg =>
        leg.from.key === resource.key
    ) ??
    null;

  const configuredArrival =
    configuredBlockConditions(
      layout,
      resource.blockId,
      plan.direction,
      "arrival"
    );

  const configuredArrived =
    configuredBlockConditions(
      layout,
      resource.blockId,
      plan.direction,
      "arrived"
    );

  const configuredLeave =
    configuredBlockConditions(
      layout,
      resource.blockId,
      plan.direction,
      "leave"
    );

  const arrivalDelayMs =
    configuredBlockDelay(
      layout,
      resource.blockId,
      plan.direction,
      "arrival"
    );

  const arrivedDelayMs =
    configuredBlockDelay(
      layout,
      resource.blockId,
      plan.direction,
      "arrived"
    );

  const leaveDelayMs =
    configuredBlockDelay(
      layout,
      resource.blockId,
      plan.direction,
      "leave"
    );

  /*
   * Preview always exposes the selected block's current configuration,
   * even when the block is the source or destination of this route.
   * Runtime relevance is route-position dependent, but the inspector must
   * never hide the block's authoritative configuration just because there
   * is no incoming/outgoing leg.
   */
  return [
    {
      name: "APPROACH",
      match: "all",
      conditions:
        configuredArrival.length >
          0
          ? configuredArrival
          : incoming?.approachWhen ??
            [],
      delayMs:
        arrivalDelayMs,
      note:
        configuredArrival.length ===
          0 &&
        (
          incoming?.approachWhen.length ??
          0
        ) ===
          0
          ? "No default sensor · configure Arrival in Block settings"
          : undefined,
    },
    {
      name: "ARRIVED",
      match: "all",
      conditions:
        configuredArrived.length >
          0
          ? configuredArrived
          : resource.sensorAddress !==
              null
            ? [{
                id:
                  `preview-default-arrived-${resource.blockId}`,
                sensor:
                  resource.sensorAddress,
                state:
                  true,
              }]
            : incoming?.arrivedWhen ??
              [],
      delayMs:
        arrivedDelayMs,
      defaultSensor:
        configuredArrived.length ===
          0 &&
        resource.sensorAddress !==
          null,
      note:
        configuredArrived.length ===
          0 &&
        resource.sensorAddress !==
          null
          ? "Default occupancy sensor"
          : undefined,
    },
    {
      name: "DEPART",
      match: "all",
      conditions:
        outgoing?.departWhen ??
        [],
      delayMs: 0,
      note:
        (
          outgoing?.departWhen.length ??
          0
        ) ===
          0
          ? "Derived event · no sensor required"
          : undefined,
    },
    {
      name: "LEAVE",
      match: "all",
      conditions:
        configuredLeave.length >
          0
          ? configuredLeave
          : resource.sensorAddress !==
              null
            ? [{
                id:
                  `preview-default-leave-${resource.blockId}`,
                sensor:
                  resource.sensorAddress,
                state:
                  false,
              }]
            : outgoing?.leaveWhen ??
              [],
      delayMs:
        leaveDelayMs,
      defaultSensor:
        configuredLeave.length ===
          0 &&
        resource.sensorAddress !==
          null,
      note:
        configuredLeave.length ===
          0 &&
        resource.sensorAddress !==
          null
          ? "Default occupancy sensor"
          : undefined,
    },
  ];
}

function resourceEvents(
  resource: MovementPlanResource
): EventRow[] {
  return resourceEventNames(
    resource
  ).map(
    event => {
      const rule =
        defaultMovementResourceEventRule(
          resource,
          event
        );

      return {
        name:
          event.toUpperCase(),
        match:
          rule.match,
        conditions:
          rule.conditions,
        delayMs: 0,
      };
    }
  );
}

function eventRows(
  plan: MovementPlan,
  resource: MovementPlanResource,
  layout: LayoutView
): EventRow[] {
  return resource.kind === "block"
    ? blockEvents(
        plan,
        resource,
        layout
      )
    : resourceEvents(
        resource
      );
}

function resourceKindLabel(
  resource: MovementPlanResource
): string {
  if (resource.kind === "block") {
    return "BLOCK";
  }

  if (resource.kind === "segment") {
    return "SEGMENT";
  }

  return "TURNOUT";
}

export default function RoutePreviewDialog({
  opened,
  onClose,
  page,
  layout,
}: Props) {
  const [
    plan,
    setPlan,
  ] = useState<MovementPlan | null>(
    null
  );

  const [
    selectedKey,
    setSelectedKey,
  ] = useState<string | null>(
    null
  );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<string | null>(
    null
  );

  const [
    planRevision,
    setPlanRevision,
  ] = useState(0);

  useEffect(
    () => {
      let disposed =
        false;

      if (
        !opened ||
        !page
      ) {
        setPlan(
          null
        );
        setSelectedKey(
          null
        );
        setError(
          null
        );
        setLoading(
          false
        );

        return () => {
          disposed =
            true;
        };
      }

      setLoading(
        true
      );
      setError(
        null
      );
      setSelectedKey(
        null
      );

      const snapshot =
        createCurrentClientLayoutSnapshot(
          layout
        );

      void loadMovementPlan(
        page,
        snapshot
      )
        .then(
          next => {
            if (!disposed) {
              setPlan(
                next
              );

              setPlanRevision(
                value =>
                  value + 1
              );
            }
          }
        )
        .catch(
          loadError => {
            if (!disposed) {
              setPlan(
                null
              );
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : String(
                      loadError
                    )
              );
            }
          }
        )
        .finally(
          () => {
            if (!disposed) {
              setLoading(
                false
              );
            }
          }
        );

      return () => {
        disposed =
          true;
      };
    },
    [
      opened,
      page,
      layout,
    ]
  );

  const selectedResource =
    useMemo(
      () =>
        plan?.resources.find(
          resource =>
            resource.key ===
            selectedKey
        ) ??
        null,
      [
        plan,
        selectedKey,
      ]
    );

  const events =
    useMemo(
      () =>
        plan &&
        selectedResource
          ? eventRows(
              plan,
              selectedResource,
              layout
            )
          : [],
      [
        plan,
        selectedResource,
        layout,
      ]
    );

  const onVectorItemClick =
    (
      item:
        MovementRouteVectorItem
    ): void => {
      setSelectedKey(
        item.key
      );
    };

  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconRoute size={18} />
          <Text fw={700}>
            Route Preview
            {
              page
                ? ` · ${page.name}`
                : ""
            }
          </Text>
        </Group>
      }
      size="min(1500px, 96vw)"
      centered
      draggable
      styles={{
        content: {
          height:
            "min(880px, 94dvh)",
          overflow:
            "hidden",
        },
        body: {
          height:
            "calc(100% - 48px)",
          overflow:
            "hidden",
        },
      }}
    >
      <ScrollArea
        h="100%"
        type="auto"
        offsetScrollbars
      >
        <Stack
          gap="md"
          pr="xs"
        >
        {
          loading && (
            <Group gap="xs">
              <Loader size="sm" />
              <Text size="sm">
                Building dynamic route vector…
              </Text>
            </Group>
          )
        }

        {
          error && (
            <Alert
              color="red"
              title="Route preview error"
            >
              {error}
            </Alert>
          )
        }

        {
          page &&
          plan &&
          !error && (
            <>
              <Card
                withBorder
                p="sm"
              >
                <Group
                  justify="flex-end"
                  mb="xs"
                >
                  <Badge
                    variant="light"
                    color={
                      plan.direction ===
                        "forward"
                        ? "blue"
                        : plan.direction ===
                            "reverse"
                          ? "orange"
                          : "gray"
                    }
                  >
                    DIRECTION: {
                      plan.direction.toUpperCase()
                    }
                  </Badge>
                </Group>

                <MovementRouteVectorPreview
                  key={
                    `movement-vector-${planRevision}`
                  }
                  page={page}
                  layout={layout}
                  selectedKey={
                    selectedKey
                  }
                  onItemClick={
                    onVectorItemClick
                  }
                />
              </Card>

              {
                selectedResource
                  ? (
                    <Card
                      withBorder
                      p="md"
                    >
                      <Stack gap="sm">
                        <Group
                          justify="space-between"
                          align="flex-start"
                        >
                          <Stack gap={3}>
                            <Text
                              fw={800}
                              size="lg"
                            >
                              {
                                selectedResource.label
                              }
                            </Text>

                            <Group gap="xs">
                              <Badge variant="light">
                                {
                                  resourceKindLabel(
                                    selectedResource
                                  )
                                }
                              </Badge>

                              {
                                selectedResource.nodeIndex !==
                                  null && (
                                  <Badge
                                    variant="outline"
                                    color="gray"
                                  >
                                    Node {
                                      selectedResource.nodeIndex
                                    }
                                  </Badge>
                                )
                              }
                            </Group>
                          </Stack>

                          {
                            selectedResource.kind ===
                              "block" &&
                            selectedResource.sensorAddress !==
                              null && (
                              <Badge
                                color="teal"
                                variant="light"
                              >
                                OCC #
                                {
                                  selectedResource.sensorAddress
                                }
                              </Badge>
                            )
                          }
                        </Group>

                        {
                          selectedResource.kind ===
                            "turnout" &&
                          selectedResource.turnoutStates.length >
                            0 && (
                            <Text
                              size="sm"
                              c="dimmed"
                            >
                              {
                                selectedResource.turnoutStates
                                  .map(
                                    state =>
                                      `#${state.address} ${state.closed ? "CLOSED" : "THROWN"}`
                                  )
                                  .join(
                                    " · "
                                  )
                              }
                            </Text>
                          )
                        }

                        {
                          selectedResource.detectors.length >
                            0 && (
                            <Text
                              size="sm"
                              c="dimmed"
                            >
                              Sensors: {
                                selectedResource.detectors
                                  .map(
                                    sensor =>
                                      `#${sensor}`
                                  )
                                  .join(
                                    ", "
                                  )
                              }
                            </Text>
                          )
                        }

                        <SimpleGrid
                          cols={{
                            base: 1,
                            sm: 2,
                            lg: 4,
                          }}
                          spacing="sm"
                        >
                          {
                            events.map(
                              event => (
                                <Card
                                  key={
                                    event.name
                                  }
                                  withBorder
                                  p="sm"
                                >
                                  <Stack gap={6}>
                                    <Group
                                      justify="space-between"
                                      gap="xs"
                                    >
                                      <Text
                                        fw={700}
                                        size="sm"
                                      >
                                        {
                                          event.name
                                        }
                                      </Text>

                                      <Group gap={4}>
                                        {
                                          event.defaultSensor && (
                                            <Badge
                                              size="xs"
                                              variant="light"
                                              color="blue"
                                            >
                                              DEFAULT
                                            </Badge>
                                          )
                                        }

                                      </Group>
                                    </Group>

                                    {
                                      event.conditions.length >
                                        0
                                        ? (
                                          <>
                                            {
                                              event.note && (
                                                <Text
                                                  size="xs"
                                                  c="dimmed"
                                                >
                                                  {event.note}
                                                </Text>
                                              )
                                            }

                                            <Group
                                              gap={6}
                                              wrap="wrap"
                                            >
                                              {
                                                event.conditions.map(
                                                  condition => (
                                                    <Badge
                                                      key={
                                                        condition.id
                                                      }
                                                      variant="light"
                                                      color={
                                                        condition.state
                                                          ? "teal"
                                                          : "orange"
                                                      }
                                                    >
                                                      {
                                                        conditionText(
                                                          condition
                                                        )
                                                      }
                                                    </Badge>
                                                  )
                                                )
                                              }
                                            </Group>
                                          </>
                                        )
                                        : (
                                          <Text
                                            size="xs"
                                            c="dimmed"
                                          >
                                            {
                                              event.note ??
                                              "No sensor condition"
                                            }
                                          </Text>
                                        )
                                    }

                                    {
                                      event.delayMs >
                                        0 && (
                                        <>
                                          <Divider
                                            my={2}
                                          />

                                          <Group
                                            gap={6}
                                            wrap="nowrap"
                                            px="xs"
                                            py={6}
                                            style={{
                                              borderRadius: 6,
                                              background:
                                                "var(--mantine-color-violet-light)",
                                              border:
                                                "1px solid var(--mantine-color-violet-light-color)",
                                            }}
                                          >
                                            <IconClock
                                              size={15}
                                              stroke={2.2}
                                            />

                                            <Text
                                              size="xs"
                                              fw={800}
                                            >
                                              DELAY
                                            </Text>

                                            <Badge
                                              size="sm"
                                              variant="filled"
                                              color="violet"
                                            >
                                              +{
                                                event.delayMs
                                              } ms
                                            </Badge>
                                          </Group>

                                          <Text
                                            size="xs"
                                            c="dimmed"
                                          >
                                            Starts after the sensor condition is satisfied.
                                          </Text>
                                        </>
                                      )
                                    }
                                  </Stack>
                                </Card>
                              )
                            )
                          }
                        </SimpleGrid>
                      </Stack>
                    </Card>
                  )
                  : (
                    <Text
                      size="sm"
                      c="dimmed"
                      ta="center"
                    >
                      Click a route-vector node to inspect its events and sensors.
                    </Text>
                  )
              }
            </>
          )
        }
        </Stack>
      </ScrollArea>
    </AppModal>
  );
}
