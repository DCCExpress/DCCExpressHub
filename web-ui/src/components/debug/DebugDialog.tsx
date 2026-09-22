import {
  Badge,
  Button,
  Group,
  Tabs,
  Text,
} from "@mantine/core";

import type {
  CSSProperties,
} from "react";

import {
  IconBug,
  IconRefresh,
  IconRoute,
  IconSwitch3,
  IconTrafficLights,
} from "@tabler/icons-react";

import AppModal from "@/components/common/AppModal";

import AccessoryDebugTab from "./AccessoryDebugTab";
import SensorDebugTab from "./SensorDebugTab";
import TurnoutDebugTab from "./TurnoutDebugTab";
import { useRuntimeDebugState } from "./useRuntimeDebugState";

type Props = {
  opened: boolean;
  onClose: () => void;
};

const panelStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

export default function DebugDialog({
  opened,
  onClose,
}: Props) {
  const runtime =
    useRuntimeDebugState(opened);

  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconBug size={20} />
          <Text fw={700}>
            Runtime Debug
          </Text>
        </Group>
      }
      size="xl"
      centered
      draggable
      styles={{
        body: {
          height: "70vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          paddingBottom: 16,
        },
      }}
    >
      <Group
        justify="space-between"
        mb="md"
        style={{
          flexShrink: 0,
        }}
      >
        <Group gap="xs">
          <Text
            size="sm"
            c="dimmed"
          >
            WebSocket
          </Text>

          <Badge
            color={
              runtime.connected
                ? "green"
                : "red"
            }
            variant="light"
          >
            {runtime.connected
              ? "CONNECTED"
              : "DISCONNECTED"}
          </Badge>
        </Group>

        <Button
          variant="light"
          leftSection={
            <IconRefresh size={16} />
          }
          disabled={
            !runtime.connected
          }
          onClick={
            runtime.refresh
          }
        >
          Refresh snapshot
        </Button>
      </Group>

      <Tabs
        defaultValue="sensors"
        keepMounted={false}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Tabs.List
          mb="md"
          style={{
            flexShrink: 0,
          }}
        >
          <Tabs.Tab
            value="sensors"
            leftSection={
              <IconRoute size={16} />
            }
          >
            Sensors ({
              runtime.sensors.size
            })
          </Tabs.Tab>

          <Tabs.Tab
            value="turnouts"
            leftSection={
              <IconSwitch3 size={16} />
            }
          >
            Turnouts ({
              runtime.turnouts.size
            })
          </Tabs.Tab>

          <Tabs.Tab
            value="accessories"
            leftSection={
              <IconTrafficLights size={16} />
            }
          >
            Accessories ({
              runtime.basicAccessories.size +
              runtime.extendedAccessories.size
            })
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel
          value="sensors"
          style={panelStyle}
        >
          <SensorDebugTab
            sensors={
              runtime.sensors
            }
          />
        </Tabs.Panel>

        <Tabs.Panel
          value="turnouts"
          style={panelStyle}
        >
          <TurnoutDebugTab
            turnouts={
              runtime.turnouts
            }
          />
        </Tabs.Panel>

        <Tabs.Panel
          value="accessories"
          style={panelStyle}
        >
          <AccessoryDebugTab
            basicAccessories={
              runtime.basicAccessories
            }
            extendedAccessories={
              runtime.extendedAccessories
            }
          />
        </Tabs.Panel>
      </Tabs>
    </AppModal>
  );
}
