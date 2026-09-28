import {
  Badge,
  Card,
  Group,
  Stack,
  Tabs,
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

import MovementActionEditor from "./MovementActionEditor";
import MovementBlockConditionsEditor from "./MovementBlockConditionsEditor";

type Props = {
  resource:
    MovementPlanResource;
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

function resourceBadge(
  resource:
    MovementPlanResource,
  isSource: boolean,
  isDestination: boolean
): string {
  if (isSource) {
    return "SOURCE BLOCK";
  }

  if (isDestination) {
    return "DESTINATION";
  }

  return resource.kind ===
    "block"
    ? "BLOCK"
    : resource.kind ===
        "segment"
      ? "SEGMENT"
      : "TURNOUT";
}

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
      "block"
  ) {
    return "violet";
  }

  if (
    resource.kind ===
      "segment"
  ) {
    return "gray";
  }

  return "orange";
}

export default function MovementSelectedResourceEditor({
  resource,
  isSource,
  isDestination,
  rule,
  sensorCatalog,
  actions,
  onRuleChange,
  onActionsChange,
}: Props) {
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
    <Card
      withBorder
      p={0}
      className="movement-selected-resource-editor"
    >
      <div
        className="movement-selected-resource-header"
      >
        <Group
          justify="space-between"
          align="flex-start"
          wrap="wrap"
          gap="sm"
        >
          <Stack
            gap={4}
          >
            <Group
              gap="xs"
              wrap="wrap"
            >
              <Text
                fw={800}
                size="lg"
              >
                {
                  resource.label
                }
              </Text>

              <Badge
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

            <Text
              size="xs"
              c="dimmed"
            >
              {
                resource.kind ===
                  "block"
                  ? (
                    resource.sensorAddress
                      ? `Block #${resource.blockId} · occupancy sensor ${resource.sensorAddress}`
                      : `Block #${resource.blockId} · no occupancy sensor`
                  )
                  : resource.kind ===
                      "turnout"
                    ? [
                        resource.turnoutStates.length >
                          0
                          ? resource.turnoutStates
                              .map(
                                state =>
                                  `#${state.address} ${state.closed ? "CLOSED" : "THROWN"}`
                              )
                              .join(
                                " · "
                              )
                          : "Physical turnout passage",
                        resource.detectors.length >
                          0
                          ? `${resource.detectors.length === 1 ? "Sensor" : "Sensors"}: ${resource.detectors.join(", ")}`
                          : null,
                      ]
                        .filter(
                          value =>
                            value !==
                            null
                        )
                        .join(
                          " · "
                        )
                    : resource.detectors.length >
                        0
                      ? `${resource.detectors.length === 1 ? "Sensor" : "Sensors"}: ${resource.detectors.join(", ")}`
                      : "No sensor in this segment"
              }
            </Text>
          </Stack>
        </Group>
      </div>

      <Tabs
        defaultValue="conditions"
        className="movement-selected-resource-tabs"
      >
        <Tabs.List>
          <Tabs.Tab
            value="conditions"
            rightSection={
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
                  resource.kind ===
                    "block"
                    ? conditionCount
                    : "EVENT"
                }
              </Badge>
            }
          >
            Conditions / Events
          </Tabs.Tab>

          <Tabs.Tab
            value="actions"
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
          >
            Actions
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel
          value="conditions"
          p="md"
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
                  gap={6}
                >
                  <Text
                    fw={700}
                    size="sm"
                  >
                    Runtime event source
                  </Text>

                  <Text
                    size="sm"
                    c="dimmed"
                  >
                    {
                      resource.kind ===
                        "segment"
                        ? "This physical segment exposes ENTER and LEAVE events. Configure the actions that react to those events on the Actions tab."
                        : "This route resource exposes runtime movement events."
                    }
                  </Text>
                </Stack>
              )
          }
        </Tabs.Panel>

        <Tabs.Panel
          value="actions"
          p="md"
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
        </Tabs.Panel>
      </Tabs>
    </Card>
  );
}
