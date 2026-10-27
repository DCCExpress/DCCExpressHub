import HardwareDeviceDialog, { type DeviceFormData } from "./HardwareDeviceDialog";
import type { DeviceAdvancedConfig } from "./DeviceConfigWindow";
import { useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Card, Divider, Group, Modal, Stack, Table, Tabs, Text, TextInput, Title } from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconCopy, IconPlus, IconTrash } from "@tabler/icons-react";

export type ProfileConnection = { id: string; name: string; protocol: string };
export type LogicalDevice = { id: string; name: string; category: "Turnouts" | "Sensors" | "Basic accessories" | "Extended accessories" | "Signals" | "Outputs" };
type Mapping = { connectionId: string; controlType: string; address: string; inverted?: boolean; testValue?: number; advanced?: DeviceAdvancedConfig };
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
  "Z21": { Turnouts: ["DCC Basic Accessory"], Sensors: ["R-BUS sensor"], "Basic accessories": ["DCC Basic Accessory"], "Extended accessories": ["DCC Extended Accessory"], Signals: ["DCC Extended Accessory"], Outputs: ["DCC Basic Accessory"] },
  "DCC-EX": { Turnouts: ["DCC-EX Turnout ID", "DCC Basic Accessory"], Sensors: ["DCC-EX Sensor"], "Basic accessories": ["DCC Basic Accessory"], Signals: ["DCC-EX VPIN Output"], Outputs: ["DCC-EX VPIN Output"] },
  "LocoNet TCP": { Turnouts: ["LocoNet switch"], Sensors: ["LocoNet sensor"], "Basic accessories": ["LocoNet accessory"], "Extended accessories": ["LocoNet extended accessory"], Outputs: ["LocoNet accessory"] },
  "ESP32": { Turnouts: ["Servo turnout", "Digital output turnout"], Sensors: ["Digital input"], "Basic accessories": ["Digital output"], "Extended accessories": ["Digital output"], Signals: ["Digital output"], Outputs: ["Digital output", "PWM output"] },
  "C/MRI (RS-485)": { Turnouts: ["C/MRI output"], Sensors: ["C/MRI input"], "Basic accessories": ["C/MRI output"], Signals: ["C/MRI output"], Outputs: ["C/MRI output"] },
  "Arduino (Serial)": { Turnouts: ["Arduino digital output", "Arduino servo"], Sensors: ["Arduino digital input"], "Basic accessories": ["Arduino digital output"], Signals: ["Arduino digital output"], Outputs: ["Arduino digital output", "Arduino PWM output"] },
};

export default function HardwareProfilesPage({ connections, profiles, setProfiles }: { connections: ProfileConnection[]; profiles: Profile[]; setProfiles: React.Dispatch<React.SetStateAction<Profile[]>> }) {
  const [logical, setLogical] = useState<LogicalDevice[]>(initialLogical);
  const [activeId, setActiveId] = useState("z21");
  const [editingId, setEditingId] = useState("z21");
  const [category, setCategory] = useState<string>("Turnouts");
  const [addingProfile, setAddingProfile] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [warning, setWarning] = useState("");
  const [deviceDraft, setDeviceDraft] = useState<DeviceFormData | null>(null);
  const [deviceNew, setDeviceNew] = useState(false);
  const [deleteDeviceId, setDeleteDeviceId] = useState<string | null>(null);
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

  const issuesByCategory = useMemo(() => {
    const counts: Record<string, { invalid: number; unmapped: number }> = {};
    if (!profile) return counts;
    for (const device of logical) {
      const m = profile.mappings[device.id];
      const entry = counts[device.category] ?? { invalid: 0, unmapped: 0 };
      if (!m?.connectionId || !m.address.trim() || !m.controlType) entry.unmapped++;
      else if (!availableTypes(m.connectionId, device.category).includes(m.controlType)) entry.invalid++;
      counts[device.category] = entry;
    }
    return counts;
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
  function openEditor(device: LogicalDevice) {
    const mapping = profile?.mappings[device.id];
    setDeviceNew(false);
    setDeviceDraft({ id:device.id, name:device.name, category:device.category, connectionId:mapping?.connectionId ?? "",
      controlType:mapping?.controlType ?? "", address:mapping?.address ?? "", inverted:mapping?.inverted,
      testValue:mapping?.testValue, advanced:mapping?.advanced });
  }
  function createDevice() {
    setDeviceNew(true);
    setDeviceDraft({ id:makeId(), name:"", category, connectionId:"", controlType:"", address:"", testValue:0 });
  }
  function saveEditor(draft: DeviceFormData) {
    if (deviceNew) setLogical(items => [...items, { id:draft.id, name:draft.name, category:draft.category as LogicalDevice["category"] }]);
    else setLogical(items => items.map(d => d.id === draft.id ? { ...d, name:draft.name } : d));
    updateMapping(draft.id, { connectionId:draft.connectionId, controlType:draft.controlType, address:draft.address,
      inverted:draft.inverted, testValue:draft.testValue, advanced:draft.advanced });
    setDeviceDraft(null);
  }
  function deleteLogicalDevice() {
    if (!deleteDeviceId) return;
    setLogical(items => items.filter(d => d.id !== deleteDeviceId));
    setProfiles(items => items.map(p => {
      const mappings = { ...p.mappings };
      delete mappings[deleteDeviceId];
      return { ...p, mappings };
    }));
    setDeleteDeviceId(null);
  }
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
              <Text size="xs" c="dimmed">Profiles reference stable logical device IDs. The layout never stores connection addresses. C/MRI and Arduino adapters are configuration placeholders.</Text>
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
            <Button variant="light" size="xs" leftSection={<IconPlus size={14}/>} onClick={createDevice}>New device</Button>
          </Group>
          <Tabs value={category} onChange={x => setCategory(x || "Turnouts")}>
            <Tabs.List>{(["Turnouts", "Sensors", "Basic accessories", "Extended accessories", "Signals", "Outputs"] as const).map(t =>
              <Tabs.Tab key={t} value={t}>
                <Group gap={6} wrap="nowrap">
                  <span>{t}</span>
                  {(issuesByCategory[t]?.invalid ?? 0) > 0 && (
                    <Badge size="xs" color="red" variant="filled" circle title="Invalid" aria-label={issuesByCategory[t].invalid + " invalid devices"}>
                      {issuesByCategory[t].invalid}
                    </Badge>
                  )}
                  {(issuesByCategory[t]?.unmapped ?? 0) > 0 && (
                    <Badge size="xs" color="orange" variant="filled" circle title="Unmapped" aria-label={issuesByCategory[t].unmapped + " unmapped devices"}>
                      {issuesByCategory[t].unmapped}
                    </Badge>
                  )}
                </Group>
              </Tabs.Tab>
            )}</Tabs.List>
          </Tabs>
          <Table.ScrollContainer minWidth={770}>
            <Table striped highlightOnHover verticalSpacing="md">
              <Table.Thead><Table.Tr><Table.Th>Logical device</Table.Th><Table.Th>Connection</Table.Th><Table.Th>Address / ID</Table.Th><Table.Th>Current state</Table.Th><Table.Th>Mapping</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{deviceRows.map(device => {
                const m = profile.mappings[device.id];
                const mapped = !!m?.connectionId && !!m?.address.trim() && !!m?.controlType;
                const valid = mapped && availableTypes(m.connectionId, category).includes(m.controlType);
                return <Table.Tr key={device.id}>
                  <Table.Td><Text fw={500} size="sm">{device.name}</Text><Text size="xs" c="dimmed">{device.id}</Text></Table.Td>
                  <Table.Td><Text size="sm" fw={500}>{connById(m?.connectionId ?? "")?.name ?? "Unassigned"}</Text>
                    <Text size="xs" c="dimmed">{m?.controlType || "No control type"}</Text></Table.Td>
                  <Table.Td>{m?.address || "—"}</Table.Td>
                  <Table.Td><Badge color="gray" variant="outline">Unknown</Badge></Table.Td>
                  <Table.Td><Badge color={valid ? "blue" : mapped ? "red" : "orange"} variant="light">{valid ? "Mapped" : mapped ? "Invalid" : "Unmapped"}</Badge></Table.Td>
                  <Table.Td><Group gap={6} wrap="nowrap">
                    <Button size="compact-xs" variant="light" onClick={() => openEditor(device)}>Edit</Button>
                    <ActionIcon size="sm" color="red" variant="subtle" aria-label={"Delete " + device.name}
                      onClick={() => setDeleteDeviceId(device.id)}><IconTrash size={15}/></ActionIcon>
                  </Group></Table.Td>
                </Table.Tr>;
              })}</Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {!deviceRows.length && <Text ta="center" c="dimmed" py="lg" size="sm">No logical devices in this category.</Text>}
        </Card>
        <Text size="xs" c="dimmed">Prototype only: device settings and mappings are not yet persisted to the backend. Live Current state is Unknown until Runtime integration.</Text>
      </>}
      <HardwareDeviceDialog opened={!!deviceDraft} device={deviceDraft} isNew={deviceNew}
        connections={connections} typesFor={availableTypes}
        sensors={logical.filter(d => d.category === "Sensors" && d.id !== deviceDraft?.id).map(d => ({ value:d.id, label:d.name + " (" + d.id + ")" }))}
        onClose={() => setDeviceDraft(null)} onSave={saveEditor}/>
      <Modal opened={!!deleteDeviceId} onClose={() => setDeleteDeviceId(null)} title="Delete logical device?" centered>
        <Stack gap="md">
          <Text size="sm">Delete <strong>{logical.find(d => d.id === deleteDeviceId)?.name}</strong> from every hardware profile? This also removes its physical mappings.</Text>
          <Group justify="end"><Button variant="default" onClick={() => setDeleteDeviceId(null)}>Cancel</Button>
            <Button color="red" onClick={deleteLogicalDevice}>Delete device</Button></Group>
        </Stack>
      </Modal>
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

    </Stack>
  );
}
