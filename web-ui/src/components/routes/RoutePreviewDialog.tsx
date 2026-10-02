import {
  Alert,
  Badge,
  Card,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";

import {
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
};

function conditionText(
  condition: MovementSensorCondition
): string {
  return `#${condition.sensor} ${condition.state ? "ON" : "OFF"}`;
}

function blockEvents(
  plan: MovementPlan,
  resource: MovementPlanResource
): EventRow[] {
  if (
    resource.kind !== "block" ||
    resource.blockId === null
  ) {
    return [];
  }

  const result: EventRow[] = [];

  const incoming =
    plan.legs.find(
      leg =>
        leg.to.key === resource.key
    );

  if (incoming) {
    result.push({
      name: "APPROACH",
      match: "all",
      conditions:
        incoming.approachWhen,
    });

    result.push({
      name: "ARRIVED",
      match: "all",
      conditions:
        incoming.arrivedWhen,
    });
  }

  const outgoing =
    plan.legs.find(
      leg =>
        leg.from.key === resource.key
    );

  if (outgoing) {
    result.push({
      name: "DEPART",
      match: "all",
      conditions:
        outgoing.departWhen,
    });

    result.push({
      name: "LEAVE",
      match: "all",
      conditions:
        outgoing.leaveWhen,
    });
  }

  return result;
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
      };
    }
  );
}

function eventRows(
  plan: MovementPlan,
  resource: MovementPlanResource
): EventRow[] {
  return resource.kind === "block"
    ? blockEvents(
        plan,
        resource
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
              selectedResource
            )
          : [],
      [
        plan,
        selectedResource,
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
        },
        body: {
          height:
            "calc(100% - 48px)",
          overflow:
            "auto",
        },
      }}
    >
      <Stack gap="md">
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
                <MovementRouteVectorPreview
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

                                      <Badge
                                        size="xs"
                                        variant="outline"
                                        color="gray"
                                      >
                                        {
                                          event.match.toUpperCase()
                                        }
                                      </Badge>
                                    </Group>

                                    {
                                      event.conditions.length >
                                        0
                                        ? event.conditions.map(
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
                                        : (
                                          <Text
                                            size="xs"
                                            c="dimmed"
                                          >
                                            No sensor condition
                                          </Text>
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
    </AppModal>
  );
}
