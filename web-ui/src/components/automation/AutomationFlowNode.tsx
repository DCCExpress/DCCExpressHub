import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";

import {
  IconPlayerPlay,
} from "@tabler/icons-react";

import {
  Handle,
  Position,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";

import type {
  AutomationFlowNodeData,
  AutomationFlowNodeKind,
} from "../../domain/automationFlow";

import {
  dispatchAutomationFlowInject,
} from "./automationFlowEvents";

type AutomationReactFlowNode =
  Node<
    AutomationFlowNodeData,
    "automationNode"
  >;

type AutomationNodeProps =
  NodeProps<
    AutomationReactFlowNode
  >;

const NODE_META:
  Record<
    AutomationFlowNodeKind,
    {
      icon: string;
      color: string;
      title: string;
    }
  > = {
    trigger: {
      icon: "▶",
      color: "green",
      title:
        "Trigger",
    },
    sensorInput: {
      icon: "📡",
      color: "green",
      title:
        "Sensor input",
    },
    smartDispatcher: {
      icon: "🚂",
      color: "violet",
      title:
        "SmartDispatcher",
    },
    setSpeed: {
      icon: "⚡",
      color: "blue",
      title:
        "Set speed",
    },
    waitForBlock: {
      icon: "🧱",
      color: "cyan",
      title:
        "Wait block",
    },
    waitForSensor: {
      icon: "📡",
      color: "teal",
      title:
        "Wait sensor",
    },
    setSensor: {
      icon: "🧪",
      color: "teal",
      title:
        "Set sensor",
    },
    setTurnout: {
      icon: "↪",
      color: "grape",
      title:
        "Set turnout",
    },
    setAccessory: {
      icon: "⚡",
      color: "yellow",
      title:
        "Set accessory",
    },
    setLoco: {
      icon: "🚂",
      color: "blue",
      title:
        "Set Loco",
    },
    getBlock: {
      icon: "🧱",
      color: "cyan",
      title:
        "Get Block",
    },
    setBlock: {
      icon: "🧱",
      color: "cyan",
      title:
        "Set Block",
    },
    clearBlock: {
      icon: "🧱",
      color: "gray",
      title:
        "Clear Block",
    },
    getBlockTargetLoco: {
      icon: "🎯",
      color: "indigo",
      title:
        "Get Target",
    },
    setBlockTargetLoco: {
      icon: "🎯",
      color: "indigo",
      title:
        "Set Target",
    },
    clearBlockTargetLoco: {
      icon: "🎯",
      color: "gray",
      title:
        "Clear Target",
    },
    locoFunction: {
      icon: "ƒ",
      color: "pink",
      title:
        "Loco Function",
    },
    horn: {
      icon: "📣",
      color: "orange",
      title:
        "Horn",
    },
    delay: {
      icon: "⏱",
      color: "gray",
      title:
        "Delay",
    },
    playAudio: {
      icon: "🔊",
      color: "grape",
      title:
        "Play Audio",
    },
    log: {
      icon: "📝",
      color: "lime",
      title:
        "Log",
    },
  };

function summary(
  data: AutomationFlowNodeData
): string {
  switch (data.kind) {
    case "trigger": {
      const mode =
        data.triggerMode ===
        "interval"
          ? `Every ${data.intervalMs ?? 60000} ms`
          : "Manual";

      const payloadType =
        (
          data.triggerPayloadType ??
          "json"
        ).toUpperCase();

      return (
        `${mode} · ${payloadType} payload`
      );
    }

    case "sensorInput":
      return (
        `#${data.sensorAddress ?? 1} → ` +
        (
          data.sensorState !==
          false
            ? "ON"
            : "OFF"
        )
      );

    case "smartDispatcher": {
      const route =
        Array.isArray(
          data.route
        )
          ? data.route
          : [];

      return route.length >= 2
        ? route.join(
            " → "
          )
        : "FROM → TO";
    }

    case "setSpeed":
      return `${data.speed ?? 20}`;

    case "waitForBlock":
      return (
        data.blockName ||
        "Block"
      );

    case "waitForSensor":
      return (
        `#${data.sensorAddress ?? 0} = ` +
        (
          data.sensorState !==
          false
            ? "ON"
            : "OFF"
        )
      );

    case "setSensor":
      return (
        `#${data.sensorAddress ?? 1} = ` +
        (
          data.sensorState !== false
            ? "ON"
            : "OFF"
        )
      );

    case "setTurnout":
      if (
        data.turnoutLabel
      ) {
        return (
          `${data.turnoutLabel} · ` +
          (
            data.turnoutStateLabel ||
            data.turnoutStateKey ||
            "State"
          )
        );
      }

      return (
        data.turnoutAddress
          ? `#${data.turnoutAddress} · ${data.turnoutClosed !== false ? "Closed" : "Thrown"}`
          : "Select turnout"
      );

    case "setAccessory":
      return (
        `#${data.accessoryAddress ?? 1} = ` +
        (
          data.accessoryActive !== false
            ? "ON"
            : "OFF"
        )
      );

    case "setLoco":
      return (
        `payload.locoAddress · ${data.speed ?? 20} · ` +
        `${data.locoDirection === "reverse" ? "reverse" : "forward"}`
      );

    case "getBlock":
      return (
        `${data.blockLabel || data.blockName || "Select block"} → payload.locoAddress`
      );

    case "setBlock":
      return (
        `${data.blockLabel || data.blockName || "Select block"} ← payload.locoAddress`
      );

    case "clearBlock":
      return (
        `${data.blockLabel || data.blockName || "Select block"} · clear`
      );

    case "getBlockTargetLoco":
      return (
        `${data.blockLabel || data.blockName || "Select block"} target → payload.locoAddress`
      );

    case "setBlockTargetLoco":
      return (
        `${data.blockLabel || data.blockName || "Select block"} target ← payload.locoAddress`
      );

    case "clearBlockTargetLoco":
      return (
        `${data.blockLabel || data.blockName || "Select block"} · clear target`
      );

    case "locoFunction":
      return (
        `payload.locoAddress · F${data.functionNumber ?? 2} · ` +
        `${data.pulseMs ?? 700} ms`
      );

    case "horn":
      return (
        `F${data.functionNumber ?? 2} · ` +
        `${data.pulseMs ?? 700} ms`
      );

    case "delay":
      return (
        `${data.delayMs ?? 500} ms`
      );

    case "playAudio": {
      const source =
        String(
          data.audioName ??
          ""
        ).trim();

      const displaySource =
        source
          ? (
              source.startsWith("/") ||
              source.includes(".")
                ? source
                : `/sd/audio/${source}.mp3`
            )
          : "Select audio";

      return (
        displaySource +
        (
          data.audioWaitForEnd ===
          true
            ? " · await"
            : " · continue"
        )
      );
    }

    case "log":
      return (
        data.message ||
        "message"
      );

    default:
      return "";
  }
}

export default function AutomationFlowNode({
  id,
  data,
  selected,
}: AutomationNodeProps) {
  const meta =
    NODE_META[
      data.kind
    ];

  const isWide =
    data.kind ===
      "smartDispatcher" ||
    data.kind ===
      "trigger" ||
    data.kind ===
      "sensorInput";

  const hasTarget =
    data.kind !==
      "trigger" &&
    data.kind !==
      "sensorInput";

  return (
    <Card
      withBorder
      p="sm"
      radius="md"
      className={
        isWide
          ? "automation-flow-node automation-flow-node-smart"
          : "automation-flow-node"
      }
      style={{
        borderColor:
          selected
            ? "var(--mantine-color-violet-5)"
            : undefined,
        boxShadow:
          selected
            ? "0 0 0 2px rgba(121, 80, 242, 0.18)"
            : undefined,
      }}
    >
      {hasTarget && (
        <Handle
          type="target"
          position={
            Position.Top
          }
          className="automation-flow-handle"
        />
      )}

      <Stack gap={5}>
        <Group
          gap={6}
          wrap="nowrap"
        >
          <Text
            size="lg"
            lh={1}
          >
            {meta.icon}
          </Text>

          <Text
            size="sm"
            fw={700}
            truncate
            style={{
              flex: 1,
            }}
          >
            {
              data.label ||
              meta.title
            }
          </Text>

          {data.kind ===
            "trigger" && (
            <Tooltip
              label="Inject now"
            >
              <ActionIcon
                size="sm"
                variant="light"
                color="green"
                className="nodrag nopan"
                aria-label="Inject trigger payload now"
                onPointerDown={
                  event =>
                    event.stopPropagation()
                }
                onClick={
                  event => {
                    event.stopPropagation();

                    dispatchAutomationFlowInject({
                      pageId:
                        data.pageId,
                      triggerNodeId:
                        id,
                    });
                  }
                }
              >
                <IconPlayerPlay
                  size={15}
                />
              </ActionIcon>
            </Tooltip>
          )}

          <Badge
            size="xs"
            variant="light"
            color={
              meta.color
            }
          >
            {
              isWide
                ? "FLOW"
                : data.kind
            }
          </Badge>
        </Group>

        <Text
          size="xs"
          c="dimmed"
          truncate
        >
          {summary(data)}
        </Text>

        {data.kind ===
          "smartDispatcher" &&
          (
            data.arrivalRules?.length ??
            0
          ) >
            0 && (
          <Text
            size="xs"
            c="violet"
          >
            {
              data.arrivalRules
                ?.length
            } arrival rule
            {
              data.arrivalRules
                ?.length ===
              1
                ? ""
                : "s"
            }
          </Text>
        )}
      </Stack>

      <Handle
        type="source"
        position={
          Position.Bottom
        }
        className="automation-flow-handle"
      />
    </Card>
  );
}

export const automationFlowNodeTypes: NodeTypes = {
  // React Flow's NodeTypes registry deliberately erases the concrete node-data
  // generic. Keep the component strongly typed above and erase it only at the
  // registry boundary, matching the upstream/Next editor pattern.
  automationNode:
    AutomationFlowNode as never,
};
