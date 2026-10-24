import {
  ActionIcon,
  Badge,
  Card,
  Collapse,
  Group,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";

import {
  IconChevronDown,
} from "@tabler/icons-react";

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

import {
  usePersistentCollapsedState,
} from "../../hooks/usePersistentCollapsedState";
import MovementActionEditor from "./MovementActionEditor";
import MovementBlockConditionsEditor from "./MovementBlockConditionsEditor";
import {
  movementText,
  useMovementTranslation,
} from "./movementI18n";

type Props = {
  pageId: string;
  resource:
    MovementPlanResource;
  index: number;
  isSource: boolean;
  isDestination: boolean;
  isCurrent: boolean;
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
    return "gray";
  }

  return "pink";
}

function resourceBadge(
  resource:
    MovementPlanResource,
  isSource: boolean,
  isDestination: boolean
): string {
  if (isSource) {
    return movementText("movementFrom");
  }

  if (isDestination) {
    return movementText("movementTo");
  }

  if (
    resource.kind ===
    "block"
  ) {
    return movementText("movementVia");
  }

  if (
    resource.kind ===
    "turnout"
  ) {
    return movementText("movementTurnoutUpper");
  }

  return movementText("movementSegmentUpper");
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
  isCurrent,
  rule,
  sensorCatalog,
  actions,
  onRuleChange,
  onActionsChange,
}: Props) {
  const mt =
    useMovementTranslation();

  const roleClass =
    routeRoleClass(
      resource,
      isSource,
      isDestination
    );

  const {
    collapsed:
      routeCollapsed,
    toggleCollapsed:
      toggleRouteCollapsed,
  } =
    usePersistentCollapsedState(
      "movement:" +
        pageId +
        ":" +
        resource.key +
        ":route-card",
      false
    );

  const conditionCount =
    (
      rule?.approachWhen.length ??
      0
    ) +
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
      className={
        "movement-route-row" +
        (
          isCurrent
            ? " is-current"
            : ""
        )
      }
    >
      <div
        className="movement-route-spine"
      >
        <div
          className={
            "movement-route-dot " +
            roleClass +
            (
              isCurrent
                ? " is-current"
                : ""
            )
          }
        >
          {
            index + 1
          }
        </div>

        <div
          className={
            "movement-route-line " +
            roleClass
          }
        />
      </div>

      <Card
        withBorder
        p={0}
        className={
          "movement-physical-route-card " +
          roleClass +
          (
            isCurrent
              ? " is-current"
              : ""
          )
        }
      >
        <div
          className={
            "movement-physical-route-header " +
            roleClass
          }
          role="button"
          tabIndex={0}
          aria-expanded={
            !routeCollapsed
          }
          onClick={
            toggleRouteCollapsed
          }
          onKeyDown={
            event => {
              if (
                event.key ===
                  "Enter" ||
                event.key ===
                  " "
              ) {
                event.preventDefault();
                toggleRouteCollapsed();
              }
            }
          }
          style={{
            cursor:
              "pointer",
          }}
        >
          <Group
            justify="space-between"
            align="flex-start"
            wrap="nowrap"
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
                  {
                    mt(
                      "movementBlockId",
                      {
                        id:
                          resource.blockId ??
                          0,
                      }
                    )
                  }
                  {
                    resource.sensorAddress
                      ? " " +
                        mt(
                          "movementOccupancySensorSuffix",
                          {
                            sensor:
                              resource.sensorAddress,
                          }
                        )
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
                      ? `${resource.detectors.length === 1 ? mt("movementSensorWord") : mt("movementSensorsWord")}: ${resource.detectors.join(", ")}`
                      : mt("movementNoSensorInSegment")
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
                              `#${state.address} ${state.closed ? mt("movementClosed") : mt("movementThrown")}`
                          )
                          .join(" · ")
                      : mt("movementPhysicalTurnoutPassage")
                  }
                  {
                    resource.detectors.length >
                      0
                      ? ` · ${resource.detectors.length === 1 ? mt("movementSensorWord") : mt("movementSensorsWord")}: ${resource.detectors.join(", ")}`
                      : ""
                  }
                </Text>
              )
            }
          </Stack>

          <Tooltip
            label={
              routeCollapsed
                ? mt("movementExpandRouteCard")
                : mt("movementCollapseRouteCard")
            }
          >
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={
                event => {
                  event.stopPropagation();
                  toggleRouteCollapsed();
                }
              }
            >
              <IconChevronDown
                size={17}
                style={{
                  transform:
                    routeCollapsed
                      ? "rotate(-90deg)"
                      : "rotate(0deg)",
                  transition:
                    "transform 150ms ease",
                }}
              />
            </ActionIcon>
          </Tooltip>
          </Group>
        </div>

        <Collapse
          expanded={
            !routeCollapsed
          }
        >
        <Stack
          gap="sm"
          className="movement-physical-route-body"
        >
          <CollapsiblePanelCard
            title={mt("movementConditionEvent")}
            collapsedStorageKey={
              "movement:" +
              pageId +
              ":" +
              resource.key +
              ":condition"
            }
            expandTooltip={mt("movementExpandConditionEvent")}
            collapseTooltip={mt("movementCollapseConditionEvent")}
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
                      mt(
                        "movementConditionCount",
                        {
                          count:
                            conditionCount,
                        }
                      )
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
                      {mt("movementRuntimeEventSource")}
                    </Text>

                    <Text
                      size="xs"
                      c="dimmed"
                    >
                      {
                        resource.kind ===
                        "segment"
                          ? mt("movementSegmentActionsHint")
                          : mt("movementTurnoutActionsHint")
                      }
                    </Text>
                  </Stack>
                )
            }
          </CollapsiblePanelCard>

          <CollapsiblePanelCard
            title={mt("movementActionsLabel")}
            collapsedStorageKey={
              "movement:" +
              pageId +
              ":" +
              resource.key +
              ":actions"
            }
            expandTooltip={mt("movementExpandActions")}
            collapseTooltip={mt("movementCollapseActions")}
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
              isSource={
                isSource
              }
              isDestination={
                isDestination
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
        </Collapse>
      </Card>
    </div>
  );
}
