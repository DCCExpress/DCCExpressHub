import { ActionIcon, Button, ColorInput, FileButton, Group, ScrollArea, SegmentedControl, Select, Stack, Table, Text, Tooltip } from "@mantine/core";
import { IconPhoto, IconTrash, IconUpload, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import AppModal from "../common/AppModal";
import FunctionIconAsset from "../loco/FunctionIconAsset";
import { BUILTIN_FUNCTION_ICONS } from "../loco/FunctionIconRegistry";
import { listCustomFunctionIcons, uploadCustomFunctionIcon, type CustomFunctionIcon } from "../../api/functionIconApi";
import { getLocos } from "../../api/domainApi";
import { loadIconStyles, readIconStyle, saveIconStyle, forgetIconStyle, type IconStyle } from "../../services/functionIconStyles";

type Props = {
  opened: boolean;
  value: string;
  onClose: () => void;
  onSelect: (value: string, mode: IconStyle["mode"], color: string) => void;
};
const DEFAULT_STYLE: IconStyle = { mode: "original", color: "#ffffff" };
export default function FunctionIconPicker({ opened, value, onClose, onSelect }: Props) {
  const [tab, setTab] = useState("builtin");
  const [selection, setSelection] = useState("");
  const [custom, setCustom] = useState<CustomFunctionIcon[]>([]);
  const [usedIcons, setUsedIcons] = useState<Set<string>>(new Set());
  const [brokenIcons, setBrokenIcons] = useState<Set<string>>(new Set());
  const [styles, setStyles] = useState<Record<string, IconStyle>>({});
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setSelection(value);
    setTab(value.startsWith("custom:") ? "custom" : "builtin");
    setError(null);
    setBrokenIcons(new Set());
    setEdited(new Set());
    void Promise.all([listCustomFunctionIcons(), getLocos(), loadIconStyles()])
      .then(([icons, locos]) => {
        if (cancelled) return;
        setCustom(icons);
        setUsedIcons(new Set(locos.flatMap(loco => loco.functions.map(fn => fn.icon)).filter(Boolean)));
        const next: Record<string, IconStyle> = {};
        for (const key of [...BUILTIN_FUNCTION_ICONS.map(([id]) => `builtin:${id}`), ...icons.map(icon => icon.value)]) {
          next[key] = readIconStyle(key) ?? { ...DEFAULT_STYLE };
        }
        setStyles(next);
      }).catch(err => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [opened, value]);

  const changeStyle = (key: string, patch: Partial<IconStyle>) => {
    setStyles(previous => ({ ...previous, [key]: { ...(previous[key] ?? DEFAULT_STYLE), ...patch } }));
    setEdited(previous => new Set(previous).add(key));
  };
  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const icon = await uploadCustomFunctionIcon(file);
      setCustom(previous => [...previous, icon]);
      setSelection(icon.value);
      setTab("custom");
      setStyles(previous => ({ ...previous, [icon.value]: { ...DEFAULT_STYLE } }));
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };
  const remove = async (icon: CustomFunctionIcon) => {
    if (usedIcons.has(icon.value) || busy) return;
    setBusy(true); setError(null);
    try {
      // Use the virtual path from /list, not a reconstructed URL.
      const response = await fetch(`/delete?path=${encodeURIComponent(icon.path)}`, { method: "DELETE" });
      if (!response.ok) {
        const details = await response.text().catch(() => "");
        throw Error(`Delete failed HTTP ${response.status}: ${details.slice(0, 180)} (path ${icon.path})`);
      }
      setCustom(previous => previous.filter(item => item.value !== icon.value));
      setEdited(previous => { const next = new Set(previous); next.delete(icon.value); return next; });
      if (selection === icon.value) setSelection("");
      try { await forgetIconStyle(icon.value); } catch (error) { setError(`Icon deleted; color preset cleanup failed: ${String(error)}`); }
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true); setError(null);
    try {
      for (const icon of edited) await saveIconStyle(icon, styles[icon] ?? DEFAULT_STYLE);
      const style = styles[selection] ?? DEFAULT_STYLE;
      onSelect(selection, style.mode, style.color);
      onClose();
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };
  const rows = tab === "builtin"
    ? BUILTIN_FUNCTION_ICONS.map(([id, label]) => ({ key: `builtin:${id}`, label, custom: null as CustomFunctionIcon | null }))
    : custom.map(icon => ({ key: icon.value, label: icon.name, custom: icon }));

  return <AppModal opened={opened} onClose={onClose} draggable centered headerHeight={40}
    title="Function icon" size="min(610px, calc(100vw - 24px))" zIndex={4000}
    styles={{ content: { height: 530, maxHeight: "calc(100dvh - 24px)", display: "flex", flexDirection: "column" },
      body: { flex: 1, minHeight: 0, overflow: "hidden" } }}>
    <Stack gap="xs" h="100%" style={{ minHeight: 0 }}>
      <SegmentedControl fullWidth value={tab} onChange={setTab}
        data={[{ label: "Built-in", value: "builtin" }, { label: "My icons", value: "custom" }]}/>
      {tab === "custom" && <Group gap="xs">
        <FileButton accept="image/png,image/webp,image/svg+xml,.svg" onChange={file => void upload(file)}>
          {props => <Button {...props} loading={busy} size="xs" variant="light" leftSection={<IconUpload size={14}/>}>Upload icon</Button>}
        </FileButton>
        <Text size="xs" c="dimmed">PNG / WebP / SVG · max. 256 KB</Text>
      </Group>}
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
        <Table striped highlightOnHover stickyHeader verticalSpacing={5} horizontalSpacing="xs">
          <Table.Thead>
            <Table.Tr><Table.Th>Icon</Table.Th><Table.Th w={230}>Colors</Table.Th><Table.Th w={44} ta="center"><IconTrash size={15}/></Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(row => {
              const style = styles[row.key] ?? DEFAULT_STYLE;
              const canTint = !row.custom || /\.svg$/i.test(row.key);
              return <Table.Tr key={row.key} style={{ backgroundColor: selection === row.key ? "var(--mantine-color-blue-light)" : undefined }}>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <ActionIcon size={38} variant="filled" color="dark"
                      onClick={() => setSelection(row.key)} aria-label={`Select ${row.label}`}>
                      {brokenIcons.has(row.key) ? <IconX size={22} color="red"/> :
                        <span style={{ display: "inline-flex", pointerEvents: "none" }}>
                          <FunctionIconAsset fn={{ icon: row.key, iconTintMode: style.mode, iconColor: style.color }} size={23} preview/>
                        </span>}
                    </ActionIcon>
                    <Text size="xs" truncate style={{ maxWidth: 155, cursor: "pointer" }} onClick={() => setSelection(row.key)}>{row.label}</Text>
                  </Group>
                </Table.Td>
                <Table.Td>
                  {canTint && <Group gap={5} wrap="nowrap">
                    <Select size="xs" w={105} comboboxProps={{ withinPortal: true, zIndex: 5500 }}
                      value={style.mode} data={[{ value: "original", label: "Original" }, { value: "tint", label: "Tint" }]}
                      onChange={v => changeStyle(row.key, { mode: v === "tint" ? "tint" : "original" })}/>
                    {style.mode === "tint" && <ColorInput size="xs" w={110} value={style.color} onChange={color => changeStyle(row.key, { color })}
                      format="hex" withEyeDropper={false} popoverProps={{ withinPortal: true, zIndex: 5500 }}/>}
                  </Group>}
                </Table.Td>
                <Table.Td ta="center">
                  {row.custom && <Tooltip label={usedIcons.has(row.key) ? "Icon in use" : "Delete icon"}>
                    <span><ActionIcon color="red" size="sm" variant="light" disabled={busy || usedIcons.has(row.key)}
                      onClick={() => void remove(row.custom!)} aria-label={`Delete ${row.label}`}><IconTrash size={16}/></ActionIcon></span>
                  </Tooltip>}
                </Table.Td>
              </Table.Tr>;
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Group gap="xs"><IconPhoto size={17}/><Text size="xs" c="dimmed" truncate style={{ flex: 1 }}>{selection || "No icon selected"}</Text></Group>
      {error && <Text c="red" size="xs">{error}</Text>}
      <Group justify="flex-end" gap="xs">
        <Button size="xs" color="gray" variant="light" onClick={onClose}>Cancel</Button>
        <Button size="xs" color="red" variant="light" disabled={busy || !value} onClick={() => { onSelect("", "original", "#ffffff"); onClose(); }}>Clear icon</Button>
        <Button size="xs" loading={busy} onClick={() => void commit()}>OK</Button>
      </Group>
    </Stack>
  </AppModal>;
}
