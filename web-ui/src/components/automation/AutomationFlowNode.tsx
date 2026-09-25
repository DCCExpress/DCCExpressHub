import {
  Badge,
  Card,
  Group,
  Stack,
  Text,
} from "@mantine/core";

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
      return (
        `#${data.turnoutAddress ?? 1} = ` +
        (
          data.turnoutClosed !== false
            ? "CLOSED"
            : "THROWN"
        )
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

    case "horn":
      return (
        `F${data.functionNumber ?? 2} · ` +
        `${data.pulseMs ?? 700} ms`
      );

    case "delay":
      return (
        `${data.delayMs ?? 500} ms`
      );

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
  data,
  selected,
}: AutomationNodeProps) {
  const meta =
    NODE_META[
      data.kind
    ];

  const isRoot =
    data.kind ===
    "smartDispatcher";

  return (
    <Card
      withBorder
      p="sm"
      radius="md"
      className={
        isRoot
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
      {!isRoot && (
        <Handle
          type="target"
          position={
            Position.Left
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

          <Badge
            size="xs"
            variant="light"
            color={
              meta.color
            }
          >
            {
              isRoot
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

        {isRoot &&
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
          Position.Right
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
