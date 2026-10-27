import { useMemo, useState } from "react";
import {
  ActionIcon, Badge, Box, Button, Card, Divider, Group, Modal, Paper,
  ScrollArea, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text,
  TextInput, ThemeIcon, Title, Tooltip
} from "@mantine/core";
import { IconDeviceDesktop, IconDeviceFloppy, IconPlugConnected, IconPlus, IconRouter, IconTrash } from "@tabler/icons-react";

type Protocol = "Z21" | "DCC-EX" | "LocoNet TCP" | "ESP32";
type Category = "Sensors" | "Turnouts" | "Basic accessories" | "Extended accessories" | "Outputs";
type Connection = { id: string; name: string; protocol: Protocol; host: string; port: string; enabled: boolean };
type Device = { id: string; connectionId: string; category: Category; name: string; address: string; bindingType: string; mapped: boolean };
const categories: Category[] = ["Sensors", "Turnouts", "Basic accessories", "Extended accessories", "Outputs"];
const protocols: Protocol[] = ["Z21", "DCC-EX", "LocoNet TCP", "ESP32"];
const defaults: Record<Protocol, { port: string; supported: Category[] }> = {
  "Z21": { port: "21105", supported: ["Sensors", "Turnouts", "Basic accessories", "Extended accessories"] },
  "DCC-EX": { port: "2560", supported: ["Sensors", "Turnouts", "Basic accessories", "Outputs"] },
  "LocoNet TCP": { port: "1234", supported: ["Sensors", "Turnouts", "Basic accessories"] },
  "ESP32": { port: "8080", supported: ["Sensors", "Turnouts", "Outputs"] },
};
const initialConnections: Connection[] = [
  { id: "main", name: "Main Command Station", protocol: "Z21", host: "192.168.1.120", port: "21105", enabled: true },
  { id: "feedback", name: "Feedback Bus", protocol: "LocoNet TCP", host: "192.168.1.130", port: "1234", enabled: true },
  { id: "station", name: "Station Controller", protocol: "DCC-EX", host: "192.168.1.140", port: "2560", enabled: false },
];
const initialDevices: Device[] = [
  { id: "turnout-20", connectionId: "main", category: "Turnouts", name: "Station West", address: "20", bindingType: "Z21 accessory", mapped: true },
  { id: "turnout-21", connectionId: "main", category: "Turnouts", name: "Station East", address: "21", bindingType: "Z21 accessory", mapped: true },
  { id: "sensor-1001", connectionId: "main", category: "Sensors", name: "Block A1", address: "1001", bindingType: "Z21 R-BUS", mapped: true },
  { id: "sensor-1005", connectionId: "feedback", category: "Sensors", name: "Mid section", address: "1005", bindingType: "LocoNet sensor", mapped: true },
];
const controlTypes: Record<Protocol, Partial<Record<Category, string[]>>> = {
  "Z21": { Sensors: ["R-BUS sensor"], Turnouts: ["DCC Basic Accessory"], "Basic accessories": ["DCC Basic Accessory"], "Extended accessories": ["DCC Extended Accessory"] },
  "DCC-EX": { Sensors: ["DCC-EX Sensor"], Turnouts: ["DCC-EX Turnout ID", "DCC Basic Accessory"], "Basic accessories": ["DCC Basic Accessory"], Outputs: ["DCC-EX VPIN Output"] },
  "LocoNet TCP": { Sensors: ["LocoNet sensor"], Turnouts: ["LocoNet switch"], "Basic accessories": ["LocoNet accessory"] },
  "ESP32": { Sensors: ["Digital input"], Turnouts: ["Servo turnout", "Digital output turnout"], Outputs: ["Digital output", "PWM output"] },
};
const uid = () => "id-" + Math.random().toString(36).slice(2, 10);

export default function ConfigurationPage() {
  const [connections, setConnections] = useState<Connection[]>(initialConnections);
  const [devices, setDevices] = useState<Device[]>(initialDevices);
  const [selectedId, setSelectedId] = useState("main");
  const [tab, setTab] = useState<string>("Device");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<"connection" | "device" | null>(null);
  const [deviceDraft, setDeviceDraft] = useState<Device | null>(null);
  const [connectionName, setConnectionName] = useState("");
  const [message, setMessage] = useState("");
  const connection = connections.find(c => c.id === selectedId);
  const available = connection ? defaults[connection.protocol].supported : [];
  const shown = useMemo(() => devices.filter(d => d.connectionId === selectedId && d.category === tab &&
    (d.name + " " + d.address).toLowerCase().includes(query.toLowerCase())), [devices, selectedId, tab, query]);

  function changeConnection(id: string) {
    setSelectedId(id); setTab("Device"); setQuery(""); setMessage("");
  }
  function patchConnection(patch: Partial<Connection>) {
    setConnections(items => items.map(c => c.id === selectedId ? { ...c, ...patch } : c));
  }
  function changeProtocol(value: Protocol) {
    if (!connection || value === connection.protocol) return;
    patchConnection({ protocol: value, port: defaults[value].port });
    setDevices(items => items.map(d => d.connectionId === connection.id
      ? { ...d, mapped: false, bindingType: "Unmapped" } : d));
    setMessage("Connection type changed. Existing devices have been preserved; review their hardware bindings.");
  }
  function addConnection() {
    const id = uid();
    setConnections(items => [...items, { id, name: connectionName.trim() || "New connection", protocol: "Z21", host: "", port: "21105", enabled: false }]);
    changeConnection(id); setDialog(null); setConnectionName("");
  }
  function saveDevice() {
    if (!deviceDraft || !deviceDraft.name.trim() || !deviceDraft.address.trim()) return;
    setDevices(items => items.some(d => d.id === deviceDraft.id)
      ? items.map(d => d.id === deviceDraft.id ? deviceDraft : d)
      : [...items, deviceDraft]);
    setDialog(null); setDeviceDraft(null);
  }
  function newDevice() {
    if (!connection || tab === "Device") return;
    setDeviceDraft({ id: uid(), connectionId: connection.id, category: tab as Category, name: "", address: "", bindingType: controlTypes[connection.protocol][tab as Category]?.[0] ?? "Unmapped", mapped: !!controlTypes[connection.protocol][tab as Category]?.length });
    setDialog("device");
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div><Title order={2}>Configuration</Title><Text c="dimmed" size="sm">Connections, devices and hardware bindings</Text></div>
        <Badge color="gray" variant="light">Local UI draft · Not saved to backend</Badge>
      </Group>
      <div className="configuration-grid">
        <Card withBorder radius="md" p="sm" className="connections-panel">
          <Group justify="space-between" px="xs" py="xs">
            <Text fw={700} size="sm">Connections</Text>
            <Tooltip label="Add connection">
              <ActionIcon variant="light" aria-label="Add connection" onClick={() => setDialog("connection")}><IconPlus size={18}/></ActionIcon>
            </Tooltip>
          </Group>
          <Divider my="xs"/>
          <Stack gap={6}>
            {connections.map(c => (
              <button key={c.id} type="button" onClick={() => changeConnection(c.id)}
                className={"connection-item" + (selectedId === c.id ? " connection-item-active" : "")}>
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon color={c.enabled ? "teal" : "gray"} variant="light" size="lg" radius="md"><IconRouter size={20}/></ThemeIcon>
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={600} truncate>{c.name}</Text>
                    <Text size="xs" c="dimmed">{c.protocol}</Text>
                  </Box>
                </Group>
              </button>
            ))}
          </Stack>
          <Divider my="md"/>
          <Text size="xs" c="dimmed" px="xs">{connections.length} configured connections</Text>
        </Card>

        <Card withBorder radius="md" p="md" className="devices-panel">
          {!connection ? <Text c="dimmed">Select a connection.</Text> : <>
            <Group justify="space-between" align="start" mb="md">
              <div>
                <Title order={3}>{connection.name}</Title>
                <Group gap="xs" mt={5}>
                  <Badge variant="light" color="blue">{connection.protocol}</Badge>
                  <Badge variant="light" color={connection.enabled ? "teal" : "gray"}>{connection.enabled ? "Enabled" : "Disabled"}</Badge>
                </Group>
              </div>
              <ThemeIcon size={42} variant="light" color="teal"><IconPlugConnected size={24}/></ThemeIcon>
            </Group>
            <Tabs value={tab} onChange={value => { setTab(value || "Device"); setQuery(""); }} variant="outline" keepMounted={false}>
              <ScrollArea scrollbarSize={6} type="auto">
                <Tabs.List style={{ flexWrap: "nowrap" }}>
                  <Tabs.Tab value="Device" leftSection={<IconDeviceDesktop size={16}/>}>Device</Tabs.Tab>
                  {categories.filter(x => available.includes(x) || devices.some(d => d.connectionId === selectedId && d.category === x)).map(x =>
                    <Tabs.Tab value={x} key={x}>{x}</Tabs.Tab>)}
                </Tabs.List>
              </ScrollArea>
              <Tabs.Panel value="Device" pt="lg">
                <Stack gap="md" maw={620}>
                  <TextInput label="Connection name" value={connection.name} onChange={event => patchConnection({ name: event.currentTarget.value })}/>
                  <Select label="Device / protocol" data={protocols} value={connection.protocol}
                    onChange={v => v && changeProtocol(v as Protocol)}/>
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <TextInput label="Host / IP address" value={connection.host} onChange={event => patchConnection({ host: event.currentTarget.value })}/>
                    <TextInput label="Port" value={connection.port} onChange={event => patchConnection({ port: event.currentTarget.value })}/>
                  </SimpleGrid>
                  <Switch label="Connection enabled" checked={connection.enabled} onChange={event => patchConnection({ enabled: event.currentTarget.checked })}/>
                  {message && <Paper withBorder bg="var(--mantine-color-yellow-light)" p="sm"><Text size="sm">{message}</Text></Paper>}
                  <Text size="sm" c="dimmed">Protocol changes preserve device names and IDs. Hardware mappings are reset to Unmapped until reviewed.</Text>
                </Stack>
              </Tabs.Panel>
              {categories.map(category => (
                <Tabs.Panel key={category} value={category} pt="lg">
                  <Stack gap="md">
                    <Group justify="space-between" align="end">
                      <TextInput placeholder={"Search " + category.toLowerCase() + "..."} value={query}
                        onChange={event => setQuery(event.currentTarget.value)} style={{ flex: 1, maxWidth: 340 }}/>
                      <Button leftSection={<IconPlus size={16}/>} onClick={newDevice} disabled={!available.includes(category)}>Add device</Button>
                    </Group>
                    {!available.includes(category) && <Text c="orange" size="sm">This protocol does not currently advertise this device type. Existing records are preserved.</Text>}
                    <Table.ScrollContainer minWidth={420}>
                      <Table striped highlightOnHover withTableBorder verticalSpacing="sm">
                        <Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>Address</Table.Th><Table.Th>Binding</Table.Th><Table.Th></Table.Th></Table.Tr></Table.Thead>
                        <Table.Tbody>
                          {shown.map(d => <Table.Tr key={d.id}>
                            <Table.Td><Text fw={500} size="sm">{d.name}</Text></Table.Td>
                            <Table.Td>{d.address}</Table.Td>
                            <Table.Td><Badge variant="light" color={d.mapped ? "teal" : "orange"}>{d.mapped ? d.bindingType : "Unmapped"}</Badge></Table.Td>
                            <Table.Td><Group gap={4} justify="end" wrap="nowrap">
                              <Button size="compact-xs" variant="subtle" onClick={() => { setDeviceDraft(d); setDialog("device"); }}>Edit</Button>
                              <ActionIcon size="sm" color="red" variant="subtle" aria-label={"Remove " + d.name}
                                onClick={() => setDevices(items => items.filter(x => x.id !== d.id))}><IconTrash size={15}/></ActionIcon>
                            </Group></Table.Td>
                          </Table.Tr>)}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                    {!shown.length && <Paper withBorder p="xl" ta="center"><Text c="dimmed" size="sm">No devices in this category yet.</Text></Paper>}
                  </Stack>
                </Tabs.Panel>
              ))}
            </Tabs>
          </>}
        </Card>
      </div>

      <Modal opened={dialog === "connection"} onClose={() => setDialog(null)} title="Add connection" centered>
        <Stack>
          <TextInput label="Name" placeholder="e.g. Main Command Station" value={connectionName} onChange={e => setConnectionName(e.currentTarget.value)}/>
          <Button onClick={addConnection} leftSection={<IconPlus size={16}/>}>Create connection</Button>
        </Stack>
      </Modal>
      <Modal opened={dialog === "device"} onClose={() => setDialog(null)} title="Device properties" centered>
        {deviceDraft && <Stack>
          <TextInput label="Name" value={deviceDraft.name} onChange={e => setDeviceDraft({ ...deviceDraft, name: e.currentTarget.value })}/>
          <TextInput label="Address / ID" value={deviceDraft.address} onChange={e => setDeviceDraft({ ...deviceDraft, address: e.currentTarget.value })}/>
          <Select label="Control type" data={connection ? (controlTypes[connection.protocol][deviceDraft.category] ?? []) : []}
            placeholder="Select control type"
            value={deviceDraft.mapped ? deviceDraft.bindingType : null}
            onChange={value => setDeviceDraft({ ...deviceDraft, bindingType: value ?? "Unmapped", mapped: !!value })}
            description="Available control types depend on the selected connection protocol."/>
          {!deviceDraft.mapped && <Text size="xs" c="orange">Hardware mapping needs review.</Text>}
          <Group justify="end">
            <Button variant="default" onClick={() => setDialog(null)}>Cancel</Button>
            <Button leftSection={<IconDeviceFloppy size={16}/>} onClick={saveDevice} disabled={!deviceDraft.name.trim() || !deviceDraft.address.trim()}>Apply</Button>
          </Group>
        </Stack>}
      </Modal>
    </Stack>
  );
}
