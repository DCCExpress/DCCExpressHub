import { ActionIcon, Button, FileButton, Group, Modal, ScrollArea, SegmentedControl, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import { IconPhoto, IconUpload } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { BUILTIN_FUNCTION_ICONS, getBuiltinFunctionIcon } from "../loco/FunctionIconRegistry";
import { customFunctionIconUrl, listCustomFunctionIcons, uploadCustomFunctionIcon, type CustomFunctionIcon } from "../../api/functionIconApi";

type Props = { opened: boolean; value: string; onClose: () => void; onSelect: (value: string) => void };
export default function FunctionIconPicker({ opened, value, onClose, onSelect }: Props) {
  const [tab, setTab] = useState("builtin");
  const [custom, setCustom] = useState<CustomFunctionIcon[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!opened) return;
    setTab(value.startsWith("custom:") ? "custom" : "builtin");
    setError(null);
    let cancelled = false;
    void listCustomFunctionIcons().then(icons => { if (!cancelled) setCustom(icons); })
      .catch(err => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [opened, value]);
  const choose = (icon: string) => { onSelect(icon); onClose(); };
  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const icon = await uploadCustomFunctionIcon(file);
      setCustom(previous => [...previous, icon]);
      choose(icon.value);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const Preview = getBuiltinFunctionIcon(value);
  const customUrl = customFunctionIconUrl(value);
  return <Modal opened={opened} onClose={onClose} title="Function icon" centered zIndex={4000} size="sm">
    <Stack gap="sm">
      <SegmentedControl fullWidth value={tab} onChange={setTab} data={[{ value: "builtin", label: "Built-in" }, { value: "custom", label: "My icons" }]}/>
      {tab === "builtin" ? <ScrollArea.Autosize mah={300}>
        <SimpleGrid cols={5} spacing="xs">
          {BUILTIN_FUNCTION_ICONS.map(([id, label]) => {
            const Icon = getBuiltinFunctionIcon(`builtin:${id}`);
            return <Tooltip label={label} key={id}>
              <ActionIcon size={46} radius="md" variant={value === `builtin:${id}` ? "filled" : "light"}
                color={value === `builtin:${id}` ? "lime" : "gray"}
                aria-label={label} onClick={() => choose(`builtin:${id}`)}>
                {Icon && <Icon size={24}/>}
              </ActionIcon>
            </Tooltip>;
          })}
        </SimpleGrid>
      </ScrollArea.Autosize> : <>
        <FileButton onChange={file => void upload(file)} accept="image/png,image/webp">
          {props => <Button {...props} loading={busy} variant="light" leftSection={<IconUpload size={16}/>}>Upload icon (PNG / WebP)</Button>}
        </FileButton>
        <Text size="xs" c="dimmed">Maximum 256 KB. Icons are stored on the Hub and available to all clients.</Text>
        <ScrollArea.Autosize mah={260}>
          <SimpleGrid cols={5} spacing="xs">
            {custom.map(icon => <Tooltip key={icon.value} label={icon.name}>
              <ActionIcon size={46} variant={value === icon.value ? "filled" : "light"} color={value === icon.value ? "lime" : "gray"}
                onClick={() => choose(icon.value)} aria-label={icon.name}>
                <img src={icon.url} alt="" style={{ width: 28, height: 28, objectFit: "contain" }}/>
              </ActionIcon>
            </Tooltip>)}
          </SimpleGrid>
          {custom.length === 0 && <Text size="sm" c="dimmed">No uploaded icons yet.</Text>}
        </ScrollArea.Autosize>
      </>}
      {error && <Text c="red" size="xs">{error}</Text>}
      <Group justify="space-between">
        <Group gap="xs">
          {Preview ? <Preview size={18}/> : customUrl ? <img src={customUrl} alt="" width={18} height={18}/> : <IconPhoto size={18}/>}
          <Text size="xs">{value || "No icon"}</Text>
        </Group>
        <Button size="xs" variant="light" color="gray" onClick={() => choose("")}>Clear</Button>
      </Group>
    </Stack>
  </Modal>;
}
