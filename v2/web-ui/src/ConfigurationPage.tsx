import { DeleteConfirmWindow } from "./AppWindow";
import { useState } from "react";
import { ActionIcon, Badge, Box, Button, Card, Divider, Group, Modal, Select, SimpleGrid, Stack, Switch, Text, TextInput, ThemeIcon, Title, Tooltip } from "@mantine/core";
import { IconPlugConnected, IconPlus, IconRouter, IconTrash } from "@tabler/icons-react";
import HardwareProfilesPage from "./HardwareProfilesPage";

type Protocol = "Z21" | "DCC-EX" | "LocoNet TCP" | "ESP32";
type Connection = { id: string; name: string; protocol: Protocol; host: string; port: string; enabled: boolean };
const protocols: Protocol[] = ["Z21", "DCC-EX", "LocoNet TCP", "ESP32"];
const ports: Record<Protocol, string> = { Z21: "21105", "DCC-EX": "2560", "LocoNet TCP": "1234", ESP32: "8080" };
const initialConnections: Connection[] = [
  { id: "main", name: "Main Command Station", protocol: "Z21", host: "192.168.1.120", port: "21105", enabled: true },
  { id: "feedback", name: "Feedback Bus", protocol: "LocoNet TCP", host: "192.168.1.130", port: "1234", enabled: true },
  { id: "station", name: "Station Controller", protocol: "DCC-EX", host: "192.168.1.140", port: "2560", enabled: false },
];
const uid = () => "conn-" + Math.random().toString(36).slice(2, 10);

export default function ConfigurationPage() {
  const [connections, setConnections] = useState<Connection[]>(initialConnections);
  const [selectedId, setSelectedId] = useState("main");
  const [section, setSection] = useState<"connections" | "profiles">("connections");
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [connectionName, setConnectionName] = useState("");
  const connection = connections.find(c => c.id === selectedId);
  const deleting = connections.find(c => c.id === deletingId);
  // Starter profiles reference these connections. Do not remove them until mappings can be migrated.
  const referencedConnections = new Set(["main", "feedback", "station"]);

  function selectConnection(id: string) { setSelectedId(id); setSection("connections"); }
  function patch(patch: Partial<Connection>) {
    setConnections(items => items.map(c => c.id === selectedId ? { ...c, ...patch } : c));
  }
  function deleteConnection() {
    if (!deletingId || referencedConnections.has(deletingId)) return;
    setConnections(items => {
      const remaining = items.filter(c => c.id !== deletingId);
      if (selectedId === deletingId) setSelectedId(remaining[0]?.id ?? "");
      return remaining;
    });
    setDeletingId(null);
  }
  function addConnection() {
    const id = uid();
    setConnections(items => [...items, { id, name: connectionName.trim() || "New connection", protocol: "Z21", host: "", port: ports.Z21, enabled: false }]);
    selectConnection(id);
    setConnectionName("");
    setAdding(false);
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Title order={2}>Configuration</Title>
          <Text c="dimmed" size="sm">Connections, logical devices and hardware profiles</Text>
        </div>
        <Badge color="gray" variant="light">Local UI draft · Not saved to backend</Badge>
      </Group>
      <div className="configuration-grid">
        <Card withBorder radius="md" p="sm" className="connections-panel">
          <Group justify="space-between" px="xs" py="xs">
            <Text fw={700} size="sm">Connections</Text>
            <Tooltip label="Add connection">
              <ActionIcon variant="light" aria-label="Add connection" onClick={() => setAdding(true)}>
                <IconPlus size={18}/>
              </ActionIcon>
            </Tooltip>
          </Group>
          <Divider my="xs"/>
          <Stack gap={6}>
            {connections.map(c => (
              <div key={c.id} className={"connection-item connection-row" + (section === "connections" && selectedId === c.id ? " connection-item-active" : "")}>
                <button type="button" className="connection-select" onClick={() => selectConnection(c.id)}>
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon color={c.enabled ? "blue" : "gray"} variant="light" size="lg" radius="md"><IconRouter size={20}/></ThemeIcon>
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Text size="sm" fw={600} truncate>{c.name}</Text>
                      <Text size="xs" c="dimmed">{c.protocol}</Text>
                    </Box>
                  </Group>
                </button>
                <Tooltip label={"Delete " + c.name}>
                  <ActionIcon color="red" variant="subtle" size="sm" aria-label={"Delete " + c.name} onClick={() => setDeletingId(c.id)}>
                    <IconTrash size={16}/>
                  </ActionIcon>
                </Tooltip>
              </div>
            ))}
          </Stack>
          <Divider my="md"/>
          <button type="button" className={"connection-item" + (section === "profiles" ? " connection-item-active" : "")}
            onClick={() => setSection("profiles")}>
            <Group gap="sm">
              <ThemeIcon variant="light" color="blue" size="lg"><IconPlugConnected size={20}/></ThemeIcon>
              <Box><Text fw={600} size="sm">Hardware Profiles</Text><Text size="xs" c="dimmed">Logical devices & mappings</Text></Box>
            </Group>
          </button>
          <Divider my="xs"/>
          <Text size="xs" c="dimmed" px="xs">{connections.length} configured connections</Text>
        </Card>

        <Card withBorder radius="md" p="md" className="devices-panel">
          {section === "profiles" ? (
            <HardwareProfilesPage connections={connections.map(c => ({ id: c.id, name: c.name, protocol: c.protocol }))}/>
          ) : connection ? (
            <Stack gap="lg">
              <Group justify="space-between" align="start">
                <div>
                  <Title order={3}>{connection.name}</Title>
                  <Group gap="xs" mt={5}>
                    <Badge variant="light" color="blue">{connection.protocol}</Badge>
                    <Badge variant="light" color={connection.enabled ? "blue" : "gray"}>{connection.enabled ? "Enabled" : "Disabled"}</Badge>
                  </Group>
                </div>
                <ThemeIcon size={42} variant="light" color="blue"><IconPlugConnected size={24}/></ThemeIcon>
              </Group>
              <Divider/>
              <Stack gap="md" maw={620}>
                <Text fw={600}>Device / Connection settings</Text>
                <TextInput label="Connection name" value={connection.name} onChange={e => patch({ name: e.currentTarget.value })}/>
                <Select label="Protocol" data={protocols} value={connection.protocol} onChange={v => {
                  if (v) patch({ protocol: v as Protocol, port: ports[v as Protocol] });
                }}/>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <TextInput label="Host / IP address" value={connection.host} onChange={e => patch({ host: e.currentTarget.value })}/>
                  <TextInput label="Port" value={connection.port} onChange={e => patch({ port: e.currentTarget.value })}/>
                </SimpleGrid>
                <Switch label="Connection enabled" checked={connection.enabled} onChange={e => patch({ enabled: e.currentTarget.checked })}/>
                <Text size="sm" c="dimmed">
                  This page configures communication only. Logical devices and their per-profile hardware mappings
                  are managed in Hardware Profiles. Changing the protocol does not delete logical devices.
                  Existing mappings must be validated before operating hardware.
                </Text>
              </Stack>
            </Stack>
          ) : <Text c="dimmed">Select a connection.</Text>}
        </Card>
      </div>
      <DeleteConfirmWindow opened={!!deleting} onClose={() => setDeletingId(null)}
        name={deleting?.name ?? ""} onConfirm={deleteConnection}
        disabledReason={deleting && referencedConnections.has(deleting.id)
          ? "This connection is referenced by a hardware profile. Remove or reassign its mappings before deleting it."
          : undefined}/>
      <Modal opened={adding} onClose={() => setAdding(false)} title="Add connection" centered>
        <Stack>
          <TextInput label="Connection name" placeholder="Main Command Station" value={connectionName} onChange={e => setConnectionName(e.currentTarget.value)}/>
          <Button leftSection={<IconPlus size={16}/>} onClick={addConnection}>Create connection</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
