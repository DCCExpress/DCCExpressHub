import {
  Badge,
  Card,
  Group,
  Stack,
  Text,
} from "@mantine/core";

import type {
  MovementAction,
  MovementBlockRule,
} from "../../domain/movement";

import type {
  AutomationSensorOption,
} from "../../services/automationSensorCatalog";

import type {
  MovementPlanResource,
} from "../../services/movementPlan";

import CollapsiblePanelCard from "../common/CollapsiblePanelCard";
import MovementActionEditor from "./MovementActionEditor";
import MovementBlockConditionsEditor from "./MovementBlockConditionsEditor";

type Props = {
  pageId: string;
  resource:
    MovementPlanResource;
  index: number;
  isSource: boolean;
  isDestination: boolean;
  rule:
    MovementBlockRule | null;
  sensorCatalog:
    AutomationSensorOption[];
  actions:
    MovementAction[];
  onRuleChange: (
    rule:
      MovementBlockRule
  ) => void;
  onActionsChange: (
    actions:
      MovementAction[]
  ) => void;
};

function resourceColor(
  resource:
    MovementPlanResource,
  isSource: boolean,
  isDestination: boolean
): string {
  if (isSource) {
    return "blue";
  }

  if (isDestination) {
    return "green";
  }

  if (
    resource.kind ===
    "turnout"
  ) {
    return "orange";
  }

  if (
    resource.kind ===
    "segment"
  ) {
    return "cyan";
  }

  return "violet";
}

function resourceBadge(
  resource:
    MovementPlanResource,
  isSource: boolean,
  isDestination: boolean
): string {
  if (isSource) {
    return "FROM";
  }

  if (isDestination) {
    return "TO";
  }

  if (
    resource.kind ===
    "block"
  ) {
    return "VIA";
  }

  if (
    resource.kind ===
    "turnout"
  ) {
    return "TURNOUT";
  }

  return "SEGMENT";
}

function routeRoleClass(
  resource:
    MovementPlanResource,
  isSource: boolean,
  isDestination: boolean
): string {
  if (resource.kind === "segment") {
    return "is-segment";
  }

  if (resource.kind === "turnout") {
    return "is-turnout";
  }

  if (isSource) {
    return "is-from";
  }

  if (isDestination) {
    return "is-to";
  }

  return "is-via";
}

export default function MovementRouteRow({
  pageId,
  resource,
  index,
  isSource,
  isDestination,
  rule,
  sensorCatalog,
  actions,
  onRuleChange,
  onActionsChange,
}: Props) {
  const roleClass =
    routeRoleClass(
      resource,
      isSource,
      isDestination
    );

  const conditionCount =
    (
      rule?.departWhen.length ??
      0
    ) +
    (
      rule?.leaveWhen.length ??
      0
    ) +
    (
      rule?.arrivedWhen.length ??
      0
    );

  return (
    <div
      className="movement-route-row"
    >
      <div
        className="movement-route-spine"
      >
        <div
          className={
            "movement-route-dot " +
            roleClass
          }
        >
          {
            index + 1
          }
        </div>

        <div
          className="movement-route-line"
        />
      </div>

      <Card
        withBorder
        p={0}
        className={
          "movement-physical-route-card " +
          roleClass
        }
      >
        <div
          className={
            "movement-physical-route-header " +
            roleClass
          }
        >
          <Stack
            gap={6}
          >
            <Group
              gap="xs"
              wrap="wrap"
            >
              <Text
                fw={700}
              >
                {
                  resource.label
                }
              </Text>

              <Badge
                size="sm"
                variant="light"
                color={
                  resourceColor(
                    resource,
                    isSource,
                    isDestination
                  )
                }
              >
                {
                  resourceBadge(
                    resource,
                    isSource,
                    isDestination
                  )
                }
              </Badge>
            </Group>

            {
              resource.kind ===
                "block" && (
                <Text
                  size="xs"
                  c="dimmed"
                >
                  Block ID #{resource.blockId}
                  {
                    resource.sensorAddress
                      ? ` · occupancy sensor ${resource.sensorAddress}`
                      : ""
                  }
                </Text>
              )
            }

            {
              resource.kind ===
                "segment" && (
                <Text
                  size="xs"
                  c="dimmed"
                >
                  {
                    resource.detectors.length >
                      0
                      ? `Detectors: ${resource.detectors.join(", ")}`
                      : "No detector in this segment"
                  }
                </Text>
              )
            }

            {
              resource.kind ===
                "turnout" && (
                <Text
                  size="xs"
                  c="dimmed"
                >
                  {
                    resource.turnoutStates.length >
                      0
                      ? resource.turnoutStates
                          .map(
                            state =>
                              `#${state.address} ${state.closed ? "CLOSED" : "THROWN"}`
                          )
                          .join(" · ")
                      : "Physical turnout passage"
                  }
                </Text>
              )
            }
          </Stack>
        </div>

        <Stack
          gap="sm"
          className="movement-physical-route-body"
        >
          <CollapsiblePanelCard
            title="Condition / Event"
            collapsedStorageKey={
              "movement:" +
              pageId +
              ":" +
              resource.key +
              ":condition"
            }
            expandTooltip="Expand condition / event"
            collapseTooltip="Collapse condition / event"
            clickableHeader
            defaultCollapsed={
              resource.kind !==
              "block"
            }
            rightSection={
              resource.kind ===
                "block"
                ? (
                  <Badge
                    size="xs"
                    variant="light"
                    color={
                      conditionCount >
                        0
                        ? "blue"
                        : "gray"
                    }
                  >
                    {
                      conditionCount
                    } condition{
                      conditionCount ===
                        1
                        ? ""
                        : "s"
                    }
                  </Badge>
                )
                : undefined
            }
            cardPadding="xs"
            headerClassName="movement-collapsible-header movement-collapsible-header-condition"
            bodyClassName="movement-collapsible-body movement-collapsible-body-condition"
          >
            {
              resource.kind ===
                "block" &&
              resource.blockId !==
                null
                ? (
                  <MovementBlockConditionsEditor
                    blockId={
                      resource.blockId
                    }
                    isSource={
                      isSource
                    }
                    isDestination={
                      isDestination
                    }
                    rule={
                      rule
                    }
                    sensorCatalog={
                      sensorCatalog
                    }
                    onChange={
                      onRuleChange
                    }
                  />
                )
                : (
                  <Stack
                    gap={4}
                  >
                    <Text
                      size="sm"
                      fw={600}
                    >
                      Runtime event source
                    </Text>

                    <Text
                      size="xs"
                      c="dimmed"
                    >
                      {
                        resource.kind ===
                        "segment"
                          ? "Segment ENTER / LEAVE actions are tied to this physical route section."
                          : "The engine sets and locks the route-required turnout state automatically. APPROACH / LEAVE actions are only train/audio/timing actions."
                      }
                    </Text>
                  </Stack>
                )
            }
          </CollapsiblePanelCard>

          <CollapsiblePanelCard
            title="Actions"
            collapsedStorageKey={
              "movement:" +
              pageId +
              ":" +
              resource.key +
              ":actions"
            }
            expandTooltip="Expand actions"
            collapseTooltip="Collapse actions"
            clickableHeader
            defaultCollapsed={
              actions.length ===
              0
            }
            rightSection={
              <Badge
                size="xs"
                variant="light"
                color={
                  actions.length >
                    0
                    ? "violet"
                    : "gray"
                }
              >
                {
                  actions.length
                }
              </Badge>
            }
            cardPadding="xs"
            headerClassName="movement-collapsible-header movement-collapsible-header-actions"
            bodyClassName="movement-collapsible-body movement-collapsible-body-actions"
          >
            <MovementActionEditor
              resourceKey={
                resource.key
              }
              resourceKind={
                resource.kind
              }
              actions={
                actions
              }
              onChange={
                onActionsChange
              }
            />
          </CollapsiblePanelCard>
        </Stack>
      </Card>
    </div>
  );
}
