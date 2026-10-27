import { useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Card, Divider, Group, Modal, Select, Stack, Switch, Table, Tabs, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconCopy, IconPlayerPlay, IconPlus, IconTrash } from "@tabler/icons-react";

export type ProfileConnection = { id: string; name: string; protocol: string };
export type LogicalDevice = { id: string; name: string; category: "Turnouts" | "Sensors" | "Basic accessories" | "Signals" | "Outputs" };
type Mapping = { connectionId: string; controlType: string; address: string; inverted?: boolean };
export type Profile = { id: string; name: string; mappings: Record<string, Mapping> };
const makeId = () => "item-" + Math.random().toString(36).slice(2, 10);
const initialLogical: LogicalDevice[] = [
  { id: "turnout-20", name: "Station West", category: "Turnouts" },
  { id: "turnout-21", name: "Station East", category: "Turnouts" },
  { id: "sensor-1001", name: "Block A1", category: "Sensors" },
  { id: "sensor-1005", name: "Mid section", category: "Sensors" },
];
export const initialProfiles: Profile[] = [
  { id: "z21", name: "Z21 Setup", mappings: {
    "turnout-20": { connectionId: "main", controlType: "DCC Basic Accessory", address: "20" },
    "turnout-21": { connectionId: "main", controlType: "DCC Basic Accessory", address: "21" },
    "sensor-1001": { connectionId: "main", controlType: "R-BUS sensor", address: "1001" },
    "sensor-1005": { connectionId: "feedback", controlType: "LocoNet sensor", address: "1005" },
  }},
  { id: "dcc", name: "DCC-EX Setup", mappings: {
    "turnout-20": { connectionId: "station", controlType: "DCC-EX Turnout ID", address: "20" },
    "turnout-21": { connectionId: "station", controlType: "DCC-EX Turnout ID", address: "21" },
    "sensor-1005": { connectionId: "feedback", controlType: "LocoNet sensor", address: "1005" },
  }},
];
const supported: Record<string, Record<string, string[]>> = {
  "Z21": { Turnouts: ["DCC Basic Accessory"], Sensors: ["R-BUS sensor"], "Basic accessories": ["DCC Basic Accessory"], Signals: ["DCC Extended Accessory"], Outputs: ["DCC Basic Accessory"] },
  "DCC-EX": { Turnouts: ["DCC-EX Turnout ID", "DCC Basic Accessory"], Sensors: ["DCC-EX Sensor"], "Basic accessories": ["DCC Basic Accessory"], Signals: ["DCC-EX VPIN Output"], Outputs: ["DCC-EX VPIN Output"] },
  "LocoNet TCP": { Turnouts: ["LocoNet switch"], Sensors: ["LocoNet sensor"], "Basic accessories": ["LocoNet accessory"], Outputs: ["LocoNet accessory"] },
  "ESP32": { Turnouts: ["Servo turnout", "Digital output turnout"], Sensors: ["Digital input"], "Basic accessories": ["Digital output"], Signals: ["Digital output"], Outputs: ["Digital output", "PWM output"] },
};

export default function HardwareProfilesPage({ connections, profiles, setProfiles }: { connections: ProfileConnection[]; profiles: Profile[]; setProfiles: React.Dispatch<React.SetStateAction<Profile[]>> }) {
  const [logical, setLogical] = useState<LogicalDevice[]>(initialLogical);
  const [activeId, setActiveId] = useState("z21");
  const [editingId, setEditingId] = useState("z21");
  const [category, setCategory] = useState<string>("Turnouts");
  const [addingProfile, setAddingProfile] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [addingLogical, setAddingLogical] = useState(false);
  const [logicalName, setLogicalName] = useState("");
  const [draftCategory, setDraftCategory] = useState<LogicalDevice["category"]>("Turnouts");
  const [warning, setWarning] = useState("");
  const profile = profiles.find(p => p.id === editingId);
  const connById = (id: string) => connections.find(c => c.id === id);
  const updateMapping = (id: string, value: Mapping | null) =>
    setProfiles(items => items.map(p => p.id !== editingId ? p : (() => {
      const mappings = { ...p.mappings };
      if (value) mappings[id] = value; else delete mappings[id];
      return { ...p, mappings };
    })()));
  const availableTypes = (connId: string, cat: string) =>
    supported[connById(connId)?.protocol ?? ""]?.[cat] ?? [];
  const validation = useMemo(() => {
    if (!profile) return { missing: 0, invalid: 0, valid: 0 };
    return logical.reduce((result, device) => {
      const m = profile.mappings[device.id];
      if (!m || !m.connectionId || !m.address.trim() || !m.controlType) result.missing++;
      else if (!availableTypes(m.connectionId, device.category).includes(m.controlType)) result.invalid++;
      else result.valid++;
      return result;
    }, { missing: 0, invalid: 0, valid: 0 });
  }, [profile, logical, connections]);

  function addProfile() {
    if (!profileName.trim()) return;
    const id = makeId();
    setProfiles(items => [...items, { id, name: profileName.trim(), mappings: {} }]);
    setEditingId(id); setProfileName(""); setAddingProfile(false);
  }
  function cloneProfile() {
    if (!profile) return;
    const id = makeId();
    setProfiles(items => [...items, { id, name: profile.name + " (copy)", mappings: structuredClone(profile.mappings) }]);
    setEditingId(id);
  }
  function deleteProfile() {
    if (!profile || profile.id === activeId) return;
    setProfiles(items => items.filter(p => p.id !== profile.id));
    setEditingId(activeId);
    setDeletingProfile(false);
    setWarning("");
  }
  function activate() {
    if (validation.missing || validation.invalid) {
      setWarning("Complete and validate all device mappings before activating this profile.");
      return;
    }
    setActiveId(editingId);
    setWarning("");
  }
  const deviceRows = logical.filter(x => x.category === category);
  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <div><Title order={3}>Hardware Profiles</Title><Text c="dimmed" size="sm">One layout, multiple hardware configurations</Text></div>
        <Button leftSection={<IconPlus size={16}/>} variant="light" onClick={() => setAddingProfile(true)}>New profile</Button>
      </Group>
      <Group gap="xs" wrap="wrap">
        {profiles.map(p => (
          <Button key={p.id} variant={editingId === p.id ? "filled" : "light"} color={editingId === p.id ? "blue" : "gray"} onClick={() => { setEditingId(p.id); setWarning(""); }}>
            {p.name}{activeId === p.id ? " · Active" : ""}
          </Button>
        ))}
      </Group>
      {profile && <>
        <Card withBorder radius="md" p="md">
          <Group justify="space-between" align="center" wrap="wrap">
            <Stack gap={4}>
              <Group gap="xs"><Title order={4}>{profile.name}</Title>{activeId === profile.id && <Badge color="blue">Active profile</Badge>}</Group>
              <Text size="xs" c="dimmed">Profiles reference stable logical device IDs. The layout never stores connection addresses.</Text>
            </Stack>
            <Group gap="xs">
              <Button variant="default" leftSection={<IconCopy size={16}/>} onClick={cloneProfile}>Duplicate</Button>
              <Button color="red" variant="light" leftSection={<IconTrash size={16}/>}
                disabled={profile.id === activeId} title={profile.id === activeId ? "Switch to another profile before deleting this one" : "Delete profile"}
                onClick={() => setDeletingProfile(true)}>Delete</Button>
              <Button leftSection={<IconCheck size={16}/>} disabled={activeId === profile.id || validation.missing > 0 || validation.invalid > 0} onClick={activate}>Set active</Button>
            </Group>
          </Group>
          <Divider my="sm"/>
          <Group gap="xs">
            <Badge color="blue" variant="light">{validation.valid} mapped</Badge>
            <Badge color={validation.missing ? "orange" : "gray"} variant="light">{validation.missing} unmapped</Badge>
            <Badge color={validation.invalid ? "red" : "gray"} variant="light">{validation.invalid} invalid</Badge>
          </Group>
        </Card>
        {warning && <Alert color="orange" icon={<IconAlertTriangle size={18}/>} onClose={() => setWarning("")} withCloseButton>{warning}</Alert>}
        <Card withBorder radius="md" p="md">
          <Group justify="space-between" mb="sm">
            <Text fw={600}>Logical devices → physical bindings</Text>
            <Button variant="light" size="xs" leftSection={<IconPlus size={14}/>} onClick={() => setAddingLogical(true)}>Logical device</Button>
          </Group>
          <Tabs value={category} onChange={x => setCategory(x || "Turnouts")}>
            <Tabs.List>{(["Turnouts", "Sensors", "Basic accessories", "Signals", "Outputs"] as const).map(t => <Tabs.Tab key={t} value={t}>{t}</Tabs.Tab>)}</Tabs.List>
          </Tabs>
          <Table.ScrollContainer minWidth={800}>
            <Table striped highlightOnHover verticalSpacing="md">
              <Table.Thead><Table.Tr><Table.Th>Logical device</Table.Th><Table.Th>Connection</Table.Th><Table.Th>Control type</Table.Th><Table.Th>Address / ID</Table.Th><Table.Th>Invert</Table.Th><Table.Th>Test</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{deviceRows.map(device => {
                const m = profile.mappings[device.id];
                const mapped = !!m?.connectionId && !!m?.address.trim() && !!m?.controlType;
                const valid = mapped && availableTypes(m.connectionId, category).includes(m.controlType);
                const candidateConnections = connections.filter(c => availableTypes(c.id, category).length > 0);
                return <Table.Tr key={device.id}>
                  <Table.Td><Text fw={500} size="sm">{device.name}</Text><Text size="xs" c="dimmed">{device.id}</Text></Table.Td>
                  <Table.Td><Select size="xs" placeholder="Unassigned" clearable w={150}
                    data={candidateConnections.map(c => ({ value: c.id, label: c.name }))}
                    value={m?.connectionId || null}
                    onChange={value => {
                      if (!value) { updateMapping(device.id, null); return; }
                      const choices = availableTypes(value, category);
                      updateMapping(device.id, { connectionId: value, controlType: choices.includes(m?.controlType ?? "") ? m!.controlType : choices[0] ?? "", address: m?.address ?? "" });
                    }}/></Table.Td>
                  <Table.Td><Select size="xs" w={170} placeholder="Select type" disabled={!m?.connectionId}
                    data={availableTypes(m?.connectionId ?? "", category)}
                    value={m?.controlType && availableTypes(m.connectionId, category).includes(m.controlType) ? m.controlType : null}
                    onChange={value => m && updateMapping(device.id, { ...m, controlType: value ?? "" })}/></Table.Td>
                  <Table.Td><TextInput size="xs" w={100} placeholder="Address" disabled={!m?.connectionId}
                    value={m?.address ?? ""} onChange={e => m && updateMapping(device.id, { ...m, address: e.currentTarget.value })}/></Table.Td>
                  <Table.Td>
                    {(["Turnouts", "Sensors", "Basic accessories"] as string[]).includes(category) ? (
                      <Switch size="sm" aria-label={"Invert " + device.name} checked={m?.inverted ?? false}
                        disabled={!m?.connectionId}
                        onChange={event => m && updateMapping(device.id, { ...m, inverted: event.currentTarget.checked })}/>
                    ) : <Text c="dimmed" size="xs">—</Text>}
                  </Table.Td>
                  <Table.Td>
                    {(["Turnouts", "Sensors", "Basic accessories"] as string[]).includes(category) ? (
                      <Tooltip label="Hardware test will be available after the V2 Runtime device API is implemented.">
                        <span style={{ display: "inline-block" }}>
                          <Button size="compact-xs" leftSection={<IconPlayerPlay size={13}/>} disabled>Test</Button>
                        </span>
                      </Tooltip>
                    ) : <Text c="dimmed" size="xs">—</Text>}
                  </Table.Td>
                  <Table.Td><Badge color={valid ? "blue" : mapped ? "red" : "orange"} variant="light">{valid ? "Mapped" : mapped ? "Invalid" : "Unmapped"}</Badge></Table.Td>
                </Table.Tr>;
              })}</Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {!deviceRows.length && <Text ta="center" c="dimmed" py="lg" size="sm">No logical devices in this category.</Text>}
        </Card>
        <Text size="xs" c="dimmed">Prototype only: Invert is stored per hardware-profile mapping in UI state. Test is disabled until the Runtime device API exists; no hardware commands are sent. Mappings are not yet persisted to the backend.</Text>
      </>}
      <Modal opened={deletingProfile} onClose={() => setDeletingProfile(false)} title="Delete hardware profile?" centered>
        <Stack gap="md">
          <Text size="sm">Delete <strong>{profile?.name}</strong> and all of its hardware mappings? Logical devices and connections will be preserved.</Text>
          <Group justify="end">
            <Button variant="default" onClick={() => setDeletingProfile(false)}>Cancel</Button>
            <Button color="red" leftSection={<IconTrash size={16}/>} onClick={deleteProfile}>Delete profile</Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={addingProfile} onClose={() => setAddingProfile(false)} title="New hardware profile" centered>
        <Stack><TextInput label="Profile name" placeholder="e.g. DCC-EX Setup" value={profileName} onChange={e => setProfileName(e.currentTarget.value)}/>
          <Button disabled={!profileName.trim()} onClick={addProfile}>Create profile</Button></Stack>
      </Modal>
      <Modal opened={addingLogical} onClose={() => setAddingLogical(false)} title="New logical device" centered>
        <Stack><TextInput label="Name" placeholder="e.g. Station turnout" value={logicalName} onChange={e => setLogicalName(e.currentTarget.value)}/>
          <Select label="Type" value={draftCategory} data={["Turnouts", "Sensors", "Basic accessories", "Signals", "Outputs"]} onChange={v => v && setDraftCategory(v as LogicalDevice["category"])}/>
          <Button disabled={!logicalName.trim()} onClick={() => { const id = makeId(); setLogical(items => [...items, { id, name: logicalName.trim(), category: draftCategory }]); setCategory(draftCategory); setLogicalName(""); setAddingLogical(false); }}>Add logical device</Button></Stack>
      </Modal>
    </Stack>
  );
}
