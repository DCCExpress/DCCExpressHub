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
  | "railway"
  | "locoBlocks"
  | "sensors"
  | "dcc"
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
    id: "dcc",
    labelKey: "ui.flowGroupDcc",
    fallback: "DCC / Outputs",
    color: "orange",
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
    group: "locoBlocks",
    icon: <IconBolt size={16} />,
    labelKey: "ui.flowNodeSetLoco",
    fallback: "Set Loco",
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
    group: "locoBlocks",
    icon: <IconGitBranch size={16} />,
    labelKey: "ui.flowNodeSetBlock",
    fallback: "Set Block",
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
    kind: "sensorInput",
    group: "sensors",
    icon: <IconAntenna size={16} />,
    labelKey: "ui.flowNodeSensorInput",
    fallback: "Sensor input",
    color: "green",
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
    group: "sensors",
    icon: <IconAntenna size={16} />,
    labelKey: "ui.flowNodeSetSensor",
    fallback: "Set sensor",
    color: "teal",
  },
  {
    kind: "setTurnout",
    group: "dcc",
    icon: <IconGitBranch size={16} />,
    labelKey: "ui.flowNodeSetTurnout",
    fallback: "Set turnout",
    color: "grape",
  },
  {
    kind: "setAccessory",
    group: "dcc",
    icon: <IconBolt size={16} />,
    labelKey: "ui.flowNodeSetAccessory",
    fallback: "Set accessory",
    color: "yellow",
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
