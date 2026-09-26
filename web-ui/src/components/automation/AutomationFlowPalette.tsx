import type {
  ReactNode,
} from "react";

import {
  Badge,
  Button,
  Group,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";

import {
  IconAntenna,
  IconBolt,
  IconClock,
  IconGitBranch,
  IconNote,
  IconPlayerPlay,
  IconRoute,
  IconVolume,
} from "@tabler/icons-react";

import i18next from "i18next";

import type {
  AutomationFlowNodeData,
  AutomationFlowNodeKind,
} from "../../domain/automationFlow";

import CollapsiblePanelCard from "../common/CollapsiblePanelCard";

type PaletteGroup =
  | "trigger"
  | "output"
  | "railway"
  | "locoBlocks"
  | "sensors"
  | "utility";

type PaletteItem = {
  kind: AutomationFlowNodeKind;
  group: PaletteGroup;
  icon: ReactNode;
  labelKey: string;
  fallback: string;
  color: string;
};

const GROUPS: Array<{
  id: PaletteGroup;
  labelKey: string;
  fallback: string;
  color: string;
  defaultCollapsed?: boolean;
}> = [
  {
    id: "trigger",
    labelKey: "ui.flowGroupTrigger",
    fallback: "Trigger",
    color: "green",
  },
  {
    id: "output",
    labelKey: "ui.flowGroupOutput",
    fallback: "Outputs",
    color: "orange",
  },
  {
    id: "railway",
    labelKey: "ui.flowGroupRailway",
    fallback: "Railway / Movement",
    color: "violet",
  },
  {
    id: "locoBlocks",
    labelKey: "ui.flowGroupLocoBlocks",
    fallback: "Locomotive / Blocks",
    color: "blue",
  },
  {
    id: "sensors",
    labelKey: "ui.flowGroupSensors",
    fallback: "Sensors",
    color: "teal",
  },
  {
    id: "utility",
    labelKey: "ui.flowGroupUtility",
    fallback: "Utility",
    color: "gray",
    defaultCollapsed: true,
  },
];

const ITEMS: PaletteItem[] = [
  {
    kind: "trigger",
    group: "trigger",
    icon: <IconPlayerPlay size={16} />,
    labelKey: "ui.flowNodeTrigger",
    fallback: "Trigger",
    color: "green",
  },
  {
    kind: "sensorInput",
    group: "trigger",
    icon: <IconAntenna size={16} />,
    labelKey: "ui.flowNodeSensorInput",
    fallback: "Sensor event",
    color: "green",
  },
  {
    kind: "blockInput",
    group: "trigger",
    icon: <IconGitBranch size={16} />,
    labelKey: "ui.flowNodeBlockInput",
    fallback: "Block event",
    color: "cyan",
  },
  {
    kind: "turnoutInput",
    group: "trigger",
    icon: <IconGitBranch size={16} />,
    labelKey: "ui.flowNodeTurnoutInput",
    fallback: "Turnout event",
    color: "grape",
  },
  {
    kind: "accessoryInput",
    group: "trigger",
    icon: <IconBolt size={16} />,
    labelKey: "ui.flowNodeAccessoryInput",
    fallback: "Accessory event",
    color: "yellow",
  },
  {
    kind: "locoInput",
    group: "trigger",
    icon: <IconRoute size={16} />,
    labelKey: "ui.flowNodeLocoInput",
    fallback: "Loco event",
    color: "blue",
  },
  {
    kind: "smartDispatcher",
    group: "railway",
    icon: <IconRoute size={16} />,
    labelKey: "ui.flowNodeSmartDispatcher",
    fallback: "SmartDispatcher",
    color: "violet",
  },
  {
    kind: "setSpeed",
    group: "railway",
    icon: <IconBolt size={16} />,
    labelKey: "ui.flowNodeSetSpeed",
    fallback: "Set speed",
    color: "blue",
  },
  {
    kind: "waitForBlock",
    group: "railway",
    icon: <IconGitBranch size={16} />,
    labelKey: "ui.flowNodeWaitBlock",
    fallback: "Wait block",
    color: "cyan",
  },
  {
    kind: "setLoco",
    group: "output",
    icon: <IconBolt size={16} />,
    labelKey: "ui.flowNodeSetLoco",
    fallback: "Loco output",
    color: "blue",
  },
  {
    kind: "getBlock",
    group: "locoBlocks",
    icon: <IconGitBranch size={16} />,
    labelKey: "ui.flowNodeGetBlock",
    fallback: "Get Block",
    color: "cyan",
  },
  {
    kind: "setBlock",
    group: "output",
    icon: <IconGitBranch size={16} />,
    labelKey: "ui.flowNodeSetBlock",
    fallback: "Block output",
    color: "cyan",
  },
  {
    kind: "clearBlock",
    group: "locoBlocks",
    icon: <IconGitBranch size={16} />,
    labelKey: "ui.flowNodeClearBlock",
    fallback: "Clear Block",
    color: "gray",
  },
  {
    kind: "getBlockTargetLoco",
    group: "locoBlocks",
    icon: <IconRoute size={16} />,
    labelKey: "ui.flowNodeGetTarget",
    fallback: "Get Target",
    color: "indigo",
  },
  {
    kind: "setBlockTargetLoco",
    group: "locoBlocks",
    icon: <IconRoute size={16} />,
    labelKey: "ui.flowNodeSetTarget",
    fallback: "Set Target",
    color: "indigo",
  },
  {
    kind: "clearBlockTargetLoco",
    group: "locoBlocks",
    icon: <IconRoute size={16} />,
    labelKey: "ui.flowNodeClearTarget",
    fallback: "Clear Target",
    color: "gray",
  },
  {
    kind: "locoFunction",
    group: "locoBlocks",
    icon: <IconVolume size={16} />,
    labelKey: "ui.flowNodeLocoFunction",
    fallback: "Loco Function",
    color: "pink",
  },
  {
    kind: "horn",
    group: "railway",
    icon: <IconVolume size={16} />,
    labelKey: "ui.flowNodeHorn",
    fallback: "Horn",
    color: "orange",
  },
  {
    kind: "waitForSensor",
    group: "sensors",
    icon: <IconAntenna size={16} />,
    labelKey: "ui.flowNodeWaitSensor",
    fallback: "Wait sensor",
    color: "teal",
  },
  {
    kind: "setSensor",
    group: "output",
    icon: <IconAntenna size={16} />,
    labelKey: "ui.flowNodeSetSensor",
    fallback: "Sensor output",
    color: "teal",
  },
  {
    kind: "setTurnout",
    group: "output",
    icon: <IconGitBranch size={16} />,
    labelKey: "ui.flowNodeSetTurnout",
    fallback: "Turnout output",
    color: "grape",
  },
  {
    kind: "setAccessory",
    group: "output",
    icon: <IconBolt size={16} />,
    labelKey: "ui.flowNodeSetAccessory",
    fallback: "Basic Accessory output",
    color: "yellow",
  },
  {
    kind: "setExtendedAccessory",
    group: "output",
    icon: <IconBolt size={16} />,
    labelKey: "ui.flowNodeSetExtendedAccessory",
    fallback: "Extended Accessory output",
    color: "orange",
  },
  {
    kind: "delay",
    group: "utility",
    icon: <IconClock size={16} />,
    labelKey: "ui.flowNodeDelay",
    fallback: "Delay",
    color: "gray",
  },
  {
    kind: "playAudio",
    group: "utility",
    icon: <IconVolume size={16} />,
    labelKey: "ui.flowNodePlayAudio",
    fallback: "Play Audio",
    color: "grape",
  },
  {
    kind: "log",
    group: "utility",
    icon: <IconNote size={16} />,
    labelKey: "ui.flowNodeLog",
    fallback: "Log",
    color: "lime",
  },
];

function t(
  key: string,
  fallback: string
): string {
  return i18next.t(
    key,
    {
      defaultValue:
        fallback,
    }
  );
}

export function createDefaultAutomationNodeData(
  kind: AutomationFlowNodeKind,
  pageId: string
): AutomationFlowNodeData {
  const item =
    ITEMS.find(
      entry =>
        entry.kind === kind
    );

  const base: AutomationFlowNodeData = {
    kind,
    label:
      item
        ? t(
            item.labelKey,
            item.fallback
          )
        : kind,
    pageId,
  };

  switch (kind) {
    case "trigger":
      return {
        ...base,
        triggerMode:
          "manual",
        intervalMs:
          60000,
        triggerPayloadType:
          "json",
        triggerPayloadValue:
          '{\n  "locoAddress": 18\n}',
      };

    case "smartDispatcher":
      return {
        ...base,
        route: [
          "A1",
          "B1",
        ],
        arrivalRules: [],
      };

    case "setSpeed":
      return {
        ...base,
        speed: 20,
      };

    case "waitForBlock":
      return {
        ...base,
        blockName: "B1",
      };

    case "sensorInput":
      return {
        ...base,
        sensorAddress: 1,
        sensorState: true,
      };

    case "blockInput":
      return {
        ...base,
        blockElementId: 0,
        blockLabel: "",
        blockName: "",
      };

    case "turnoutInput":
      return {
        ...base,
        turnoutAddress: 0,
        turnoutElementId: 0,
        turnoutLabel: "",
        turnoutAddresses: [],
      };

    case "accessoryInput":
      return {
        ...base,
        accessoryAddress: 1,
      };

    case "locoInput":
      return {
        ...base,
        locoAddress: 0,
        locoLabel: "",
      };

    case "waitForSensor":
    case "setSensor":
      return {
        ...base,
        sensorAddress: 1,
        sensorState: true,
      };

    case "setTurnout":
      return {
        ...base,
        turnoutAddress: 0,
        turnoutClosed: true,
        turnoutElementId: 0,
        turnoutLabel: "",
        turnoutStateKey: "",
        turnoutStateLabel: "",
        turnoutCommands: [],
      };

    case "setAccessory":
      return {
        ...base,
        accessoryAddress: 1,
        accessoryActive: true,
      };

    case "setExtendedAccessory":
      return {
        ...base,
        accessoryAddress: 1,
        accessoryAspect: 0,
      };

    case "setLoco":
      return {
        ...base,
        speed: 20,
        locoDirection:
          "forward",
      };

    case "getBlock":
    case "setBlock":
    case "clearBlock":
    case "getBlockTargetLoco":
    case "setBlockTargetLoco":
    case "clearBlockTargetLoco":
      return {
        ...base,
        blockElementId: 0,
        blockLabel: "",
        blockName: "",
      };

    case "locoFunction":
      return {
        ...base,
        functionNumber: 2,
        pulseMs: 700,
      };

    case "horn":
      return {
        ...base,
        functionNumber: 2,
        pulseMs: 700,
      };

    case "delay":
      return {
        ...base,
        delayMs: 500,
      };

    case "playAudio":
      return {
        ...base,
        audioName: "",
        audioWaitForEnd: false,
      };

    case "log":
      return {
        ...base,
        message: "",
      };

    default:
      return base;
  }
}

type Props = {
  onAdd: (
    kind:
      AutomationFlowNodeKind
  ) => void;
};

export default function AutomationFlowPalette({
  onAdd,
}: Props) {
  return (
    <Stack
      gap="xs"
      h="100%"
    >
      <Text
        fw={700}
        size="sm"
      >
        {
          t(
            "ui.flowNodes",
            "Nodes"
          )
        }
      </Text>

      <Text
        size="xs"
        c="dimmed"
      >
        {
          t(
            "ui.flowNodesDescription",
            "Add nodes, then connect them from left to right."
          )
        }
      </Text>

      <ScrollArea
        style={{
          flex: 1,
        }}
      >
        <Stack
          gap="xs"
          pr={4}
        >
          {GROUPS.map(
            group => {
              const items =
                ITEMS.filter(
                  item =>
                    item.group ===
                    group.id
                );

              return (
                <CollapsiblePanelCard
                  key={
                    group.id
                  }
                  title={
                    <Group
                      gap="xs"
                      wrap="nowrap"
                    >
                      <Text
                        size="sm"
                        fw={700}
                      >
                        {
                          t(
                            group.labelKey,
                            group.fallback
                          )
                        }
                      </Text>

                      <Badge
                        size="xs"
                        variant="light"
                        color={
                          group.color
                        }
                      >
                        {
                          items.length
                        }
                      </Badge>
                    </Group>
                  }
                  collapsedStorageKey={
                    `dcc-express-flow-palette-${group.id}-collapsed`
                  }
                  expandTooltip={
                    t(
                      "ui.flowExpandCategory",
                      "Expand category"
                    )
                  }
                  collapseTooltip={
                    t(
                      "ui.flowCollapseCategory",
                      "Collapse category"
                    )
                  }
                  defaultCollapsed={
                    group.defaultCollapsed ===
                    true
                  }
                >
                  <Stack gap={6}>
                    {items.map(
                      item => (
                        <Button
                          key={
                            item.kind
                          }
                          size="xs"
                          variant="light"
                          color={
                            item.color
                          }
                          leftSection={
                            item.icon
                          }
                          className="automation-flow-palette-button"
                          onClick={
                            () =>
                              onAdd(
                                item.kind
                              )
                          }
                        >
                          {
                            t(
                              item.labelKey,
                              item.fallback
                            )
                          }
                        </Button>
                      )
                    )}
                  </Stack>
                </CollapsiblePanelCard>
              );
            }
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
