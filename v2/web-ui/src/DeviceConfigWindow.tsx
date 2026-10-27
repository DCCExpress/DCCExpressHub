import { useEffect, useState } from "react";
import { Button, Group, NumberInput, Select, Stack, Text } from "@mantine/core";
import AppWindow from "./AppWindow";

export type FeedbackConfig = {
  mode: "optimistic" | "delayed" | "station" | "one" | "two";
  delayMs: number;
  timeoutMs: number;
  thrownSensorId: string;
  closedSensorId: string;
};
export const defaultFeedback: FeedbackConfig = {
  mode: "optimistic", delayMs: 300, timeoutMs: 2000, thrownSensorId: "", closedSensorId: "",
};
export type DeviceAdvancedConfig = { feedback: FeedbackConfig };
type SensorChoice = { value: string; label: string };

export default function DeviceConfigWindow({ opened, onClose, onApply, deviceName, category, config, sensors }: {
  opened: boolean; onClose: () => void; onApply: (value: DeviceAdvancedConfig) => void;
  deviceName: string; category: string; config?: DeviceAdvancedConfig; sensors: SensorChoice[];
}) {
  const [draft, setDraft] = useState<DeviceAdvancedConfig>({ feedback: { ...defaultFeedback } });
  useEffect(() => {
    if (opened) setDraft({ feedback: { ...defaultFeedback, ...config?.feedback } });
  }, [opened, config]);
  const fb = draft.feedback;
  const patch = (changes: Partial<FeedbackConfig>) => setDraft(prev => ({
    ...prev, feedback: { ...prev.feedback, ...changes },
  }));
  const numeric = (value: string | number, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const invalidSensors = (fb.mode === "one" && !fb.thrownSensorId) ||
    (fb.mode === "two" && (!fb.thrownSensorId || !fb.closedSensorId || fb.thrownSensorId === fb.closedSensorId));
  return (
    <AppWindow opened={opened} onClose={onClose} title={deviceName + " · Configuration"} width={530}
      footer={<>
        <Button variant="default" onClick={onClose}>Cancel</Button>
        <Button disabled={category === "Turnouts" && invalidSensors} onClick={() => { onApply(draft); onClose(); }}>Apply</Button>
      </>}>
      <Stack gap="md">
        <Text c="dimmed" size="sm">{category} · Profile-specific device settings</Text>
        {category === "Turnouts" ? <>
          <Select label="Feedback mode" value={fb.mode} allowDeselect={false}
            comboboxProps={{ withinPortal: false, zIndex: 1200 }}
            data={[
              { value: "optimistic", label: "Optimistic — assume immediately" },
              { value: "delayed", label: "Delayed — assume after delay" },
              { value: "station", label: "Command Station — await acknowledgement" },
              { value: "one", label: "One Sensor — position feedback" },
              { value: "two", label: "Two Sensors — end-position feedback" },
            ]}
            onChange={value => value && patch({ mode: value as FeedbackConfig["mode"] })}/>
          {fb.mode === "delayed" && <NumberInput label="Delay (ms)" min={0} max={60000} allowDecimal={false}
            value={fb.delayMs} onChange={v => patch({ delayMs: numeric(v, 300) })}/>}
          {["station", "one", "two"].includes(fb.mode) && <NumberInput label="Feedback timeout (ms)"
            min={100} max={120000} allowDecimal={false} value={fb.timeoutMs}
            onChange={v => patch({ timeoutMs: numeric(v, 2000) })}/>}
          {["one", "two"].includes(fb.mode) && <Select label={fb.mode === "one" ? "Position sensor (active = Thrown)" : "Thrown position sensor"}
            placeholder="Choose logical sensor" data={sensors} searchable clearable
            comboboxProps={{ withinPortal: false, zIndex: 1200 }}
            value={fb.thrownSensorId || null} onChange={v => patch({ thrownSensorId: v ?? "" })}/>}
          {fb.mode === "two" && <Select label="Closed position sensor" placeholder="Choose logical sensor"
            data={sensors} searchable clearable comboboxProps={{ withinPortal: false, zIndex: 1200 }} value={fb.closedSensorId || null}
            onChange={v => patch({ closedSensorId: v ?? "" })}/>}
          <Text size="xs" c="dimmed">This is configuration only. A command-station acknowledgement does not prove physical turnout position. The V2 Runtime will implement feedback verification later.</Text>
        </> : <Text size="sm" c="dimmed">Advanced settings for this device category will be added with the Runtime adapter. Basic address, invert and test value remain in the mapping table.</Text>}
      </Stack>
    </AppWindow>
  );
}
