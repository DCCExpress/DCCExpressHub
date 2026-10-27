import { useEffect, useState } from "react";
import { Button, Group, NumberInput, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import AppWindow from "./AppWindow";
import { defaultFeedback, type DeviceAdvancedConfig, type FeedbackConfig } from "./DeviceConfigWindow";

export type DeviceFormData = {
  id: string; name: string; category: string; connectionId: string;
  controlType: string; address: string; inverted?: boolean; testValue?: number;
  advanced?: DeviceAdvancedConfig;
};
type ConnectionOption = { id: string; name: string; protocol: string };
export default function HardwareDeviceDialog({ opened, device, isNew, connections, typesFor, sensors, onClose, onSave }: {
  opened: boolean; device: DeviceFormData | null; isNew: boolean;
  connections: ConnectionOption[]; typesFor: (id: string, category: string) => string[];
  sensors: { value: string; label: string }[];
  onClose: () => void; onSave: (data: DeviceFormData) => void;
}) {
  const [draft, setDraft] = useState<DeviceFormData | null>(null);
  useEffect(() => { if (opened) setDraft(device ? structuredClone(device) : null); }, [opened, device]);
  if (!draft) return null;
  const typeOptions = typesFor(draft.connectionId, draft.category);
  const feedback = { ...defaultFeedback, ...draft.advanced?.feedback };
  const change = (patch: Partial<DeviceFormData>) => setDraft(current => current ? { ...current, ...patch } : null);
  const setFeedback = (patch: Partial<FeedbackConfig>) => change({ advanced: {
    feedback: { ...feedback, ...patch },
  } });
  const isTurnout = draft.category === "Turnouts";
  const isExtended = draft.category === "Extended accessories";
  const canInvert = ["Turnouts", "Sensors", "Basic accessories"].includes(draft.category);
  const hasSensorError = isTurnout && ((feedback.mode === "one" && !feedback.thrownSensorId) ||
    (feedback.mode === "two" && (!feedback.thrownSensorId || !feedback.closedSensorId || feedback.thrownSensorId === feedback.closedSensorId)));
  const valid = !!draft.name.trim() && !!draft.connectionId && !!draft.address.trim() &&
    typeOptions.includes(draft.controlType) && !hasSensorError;
  const number = (x: number | string, fallback: number) => typeof x === "number" && Number.isFinite(x) ? x : fallback;
  const selectPopover = { withinPortal: false, zIndex: 1200 };
  return (
    <AppWindow opened={opened} onClose={onClose} width={590}
      title={(isNew ? "New " : "Edit ") + draft.category.slice(0, -1)}
      footer={<><Button variant="default" onClick={onClose}>Cancel</Button>
        <Button disabled={!valid} onClick={() => onSave(draft)}>{isNew ? "Create" : "Apply"}</Button></>}>
      <Stack gap="md">
        <TextInput label="Name" value={draft.name} onChange={e => change({ name: e.currentTarget.value })}/>
        <Select label="Connection" placeholder="Choose connection" searchable
          comboboxProps={selectPopover} data={connections.filter(c => typesFor(c.id, draft.category).length).map(c => ({ value:c.id, label:c.name + " · " + c.protocol }))}
          value={draft.connectionId || null} onChange={v => {
            const available = typesFor(v ?? "", draft.category);
            change({ connectionId: v ?? "", controlType: available.includes(draft.controlType) ? draft.controlType : (available[0] ?? "") });
          }}/>
        <Group grow align="start">
          <Select label="Control type" placeholder="Select control type" comboboxProps={selectPopover}
            disabled={!draft.connectionId} data={typeOptions} value={draft.controlType || null}
            onChange={v => change({ controlType: v ?? "" })}/>
          <TextInput label="Address / ID" value={draft.address} onChange={e => change({ address:e.currentTarget.value })}/>
        </Group>
        {canInvert && <Switch label="Invert state" checked={!!draft.inverted} onChange={e => change({ inverted:e.currentTarget.checked })}/>}
        {isExtended && <NumberInput label="Test value (byte)" description="0–255; reserved for the Runtime Test command" min={0} max={255}
          clampBehavior="strict" allowDecimal={false} allowNegative={false} value={draft.testValue ?? 0}
          onChange={v => typeof v === "number" && change({ testValue:v })}/>}
        {isTurnout && <>
          <Text fw={600} size="sm">Turnout feedback</Text>
          <Select label="Feedback mode" value={feedback.mode} allowDeselect={false} comboboxProps={selectPopover}
            data={[
              { value:"optimistic", label:"Optimistic — assume immediately" },
              { value:"delayed", label:"Delayed — assume after delay" },
              { value:"station", label:"Command Station — await acknowledgement" },
              { value:"one", label:"One Sensor — position feedback" },
              { value:"two", label:"Two Sensors — end-position feedback" },
            ]}
            onChange={v => v && setFeedback({ mode:v as FeedbackConfig["mode"] })}/>
          {feedback.mode === "delayed" && <NumberInput label="Delay (ms)" min={0} max={60000} allowDecimal={false}
            value={feedback.delayMs} onChange={v => setFeedback({ delayMs:number(v,300) })}/>}
          {["station","one","two"].includes(feedback.mode) && <NumberInput label="Feedback timeout (ms)"
            min={100} max={120000} allowDecimal={false} value={feedback.timeoutMs}
            onChange={v => setFeedback({ timeoutMs:number(v,2000) })}/>}
          {["one","two"].includes(feedback.mode) && <Select
            label={feedback.mode === "one" ? "Position sensor (active = Thrown)" : "Thrown position sensor"}
            placeholder="Choose sensor" searchable clearable comboboxProps={selectPopover}
            data={sensors} value={feedback.thrownSensorId || null}
            onChange={v => setFeedback({ thrownSensorId:v ?? "" })}/>}
          {feedback.mode === "two" && <Select label="Closed position sensor" searchable clearable
            placeholder="Choose sensor" data={sensors} comboboxProps={selectPopover}
            value={feedback.closedSensorId || null} onChange={v => setFeedback({ closedSensorId:v ?? "" })}/>}
        </>}
        <Text size="xs" c="dimmed">Settings are currently a UI prototype. Physical hardware control and live feedback are not yet connected.</Text>
      </Stack>
    </AppWindow>
  );
}
