import {
  Badge,
  Button,
  Group,
  Tabs,
  Text,
} from "@mantine/core";

import type { CSSProperties } from "react";

import {
  IconBug,
  IconActivity,
  IconRefresh,
  IconRoute,
  IconBroadcast,
  IconSwitch3,
  IconToggleLeft,
  IconTrafficLights,
} from "@tabler/icons-react";

import AppModal from "@/components/common/AppModal";

import BasicAccessoryDebugTab from "./BasicAccessoryDebugTab";
import SystemDiagnosticsTab from "./SystemDiagnosticsTab";
import ExtendedAccessoryDebugTab from "./ExtendedAccessoryDebugTab";
import SensorDebugTab from "./SensorDebugTab";
import RailComDebugTab from "./RailComDebugTab";
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

export default function DebugDialog({ opened, onClose }: Props) {
  const runtime = useRuntimeDebugState(opened);

  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconBug size={20} />
          <Text fw={700}>Runtime Debug</Text>
        </Group>
      }
      size="50vw"
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
      <Group justify="space-between" mb="md" style={{ flexShrink: 0 }}>
        <Group gap="xs">
          <Text size="sm" c="dimmed">WebSocket</Text>
          <Badge color={runtime.connected ? "green" : "red"} variant="light">
            {runtime.connected ? "CONNECTED" : "DISCONNECTED"}
          </Badge>
        </Group>

        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          disabled={!runtime.connected}
          onClick={runtime.refresh}
        >
          Refresh snapshot
        </Button>
      </Group>

      <Tabs
        defaultValue="system"
        keepMounted={false}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Tabs.List mb="md" style={{ flexShrink: 0 }}>
          <Tabs.Tab value="system" leftSection={<IconActivity size={16} />}>System</Tabs.Tab>
          <Tabs.Tab value="sensors" leftSection={<IconRoute size={16} />}>
            Sensors ({runtime.sensors.size})
          </Tabs.Tab>

          <Tabs.Tab value="railcom" leftSection={<IconBroadcast size={16} />}>
            RailCom
          </Tabs.Tab>

          <Tabs.Tab value="turnouts" leftSection={<IconSwitch3 size={16} />}>
            Turnouts ({runtime.turnouts.size})
          </Tabs.Tab>

          <Tabs.Tab value="basic-accessories" leftSection={<IconToggleLeft size={16} />}>
            Basic ({runtime.basicAccessories.size})
          </Tabs.Tab>

          <Tabs.Tab value="extended-accessories" leftSection={<IconTrafficLights size={16} />}>
            Extended ({runtime.extendedAccessories.size})
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="system" style={panelStyle}>
          <SystemDiagnosticsTab opened={opened} />
        </Tabs.Panel>

        <Tabs.Panel value="sensors" style={panelStyle}>
          <SensorDebugTab
            sensors={runtime.sensors}
            layoutOwners={runtime.sensorLayoutOwners}
          />
        </Tabs.Panel>

        <Tabs.Panel value="railcom" style={panelStyle}>
          <RailComDebugTab opened={opened} />
        </Tabs.Panel>

        <Tabs.Panel value="turnouts" style={panelStyle}>
          <TurnoutDebugTab
            turnouts={runtime.turnouts}
            layoutOwners={runtime.turnoutLayoutOwners}
            connected={runtime.connected}
          />
        </Tabs.Panel>

        <Tabs.Panel value="basic-accessories" style={panelStyle}>
          <BasicAccessoryDebugTab
            accessories={runtime.basicAccessories}
            layoutOwners={runtime.basicAccessoryLayoutOwners}
            connected={runtime.connected}
          />
        </Tabs.Panel>

        <Tabs.Panel value="extended-accessories" style={panelStyle}>
          <ExtendedAccessoryDebugTab
            accessories={runtime.extendedAccessories}
            layoutOwners={runtime.extendedAccessoryLayoutOwners}
            connected={runtime.connected}
          />
        </Tabs.Panel>
      </Tabs>
    </AppModal>
  );
}
