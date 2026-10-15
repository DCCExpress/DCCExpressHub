import { ActionIcon, Button, ColorInput, FileButton, Group, ScrollArea, SegmentedControl, Select, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import { IconPhoto, IconTrash, IconUpload, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import AppModal from "../common/AppModal";
import FunctionIconAsset from "../loco/FunctionIconAsset";
import { BUILTIN_FUNCTION_ICONS, getBuiltinFunctionIcon } from "../loco/FunctionIconRegistry";
import { listCustomFunctionIcons, uploadCustomFunctionIcon, type CustomFunctionIcon } from "../../api/functionIconApi";
import { getLocos } from "../../api/domainApi";
import { loadIconStyles, readIconStyle, saveIconStyle, forgetIconStyle, type IconStyle } from "../../services/functionIconStyles";

type Props = { opened: boolean; value: string; onClose: () => void;
  onSelect: (value: string, mode: IconStyle["mode"], color: string) => void };
export default function FunctionIconPicker({ opened, value, onClose, onSelect }: Props) {
  const [tab, setTab] = useState("builtin");
  const [selection, setSelection] = useState("");
  const [mode, setMode] = useState<IconStyle["mode"]>("original");
  const [color, setColor] = useState("#ffffff");
  const [custom, setCustom] = useState<CustomFunctionIcon[]>([]);
  const [usedIcons, setUsedIcons] = useState<Set<string>>(new Set());
  const [brokenIcons, setBrokenIcons] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setSelection(value);
    setTab(value.startsWith("custom:") ? "custom" : "builtin");
    setError(null);
    setBrokenIcons(new Set());
    void Promise.all([listCustomFunctionIcons(), getLocos(), loadIconStyles()])
      .then(([icons, locos]) => {
        if (cancelled) return;
        setCustom(icons);
        setUsedIcons(new Set(locos.flatMap(loco => loco.functions.map(fn => fn.icon)).filter(Boolean)));
        const style = readIconStyle(value);
        setMode(style?.mode ?? "original");
        setColor(style?.color ?? "#ffffff");
      }).catch(err => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [opened, value]);

  const pick = (icon: string) => {
    setSelection(icon);
    const style = readIconStyle(icon);
    setMode(style?.mode ?? "original");
    setColor(style?.color ?? "#ffffff");
  };
  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const icon = await uploadCustomFunctionIcon(file);
      setCustom(previous => [...previous, icon]);
      setTab("custom");
      pick(icon.value);
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!selection.startsWith("custom:") || usedIcons.has(selection)) return;
    const name = selection.slice(7);
    const path = `/images/${name}`;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/delete?path=${encodeURIComponent(path)}`, { method: "DELETE" });
      if (!response.ok) throw Error(`Delete failed HTTP ${response.status}`);
      await forgetIconStyle(selection);
      setCustom(previous => previous.filter(item => item.value !== selection));
      setSelection("");
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true); setError(null);
    try {
      if (selection) await saveIconStyle(selection, { mode, color });
      onSelect(selection, mode, color);
      onClose();
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };

  const allowTint = selection.startsWith("builtin:") || /\.svg$/i.test(selection);
  return <AppModal opened={opened} onClose={onClose} draggable centered headerHeight={40}
    title="Function icon" size="min(540px, calc(100vw - 24px))" zIndex={4000}
    styles={{ content: { height: 500, maxHeight: "calc(100dvh - 24px)", display: "flex", flexDirection: "column" },
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
      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <SimpleGrid cols={6} spacing="xs">
          {tab === "builtin" ? BUILTIN_FUNCTION_ICONS.map(([id, label]) => {
            const key = `builtin:${id}`;
            const Icon = getBuiltinFunctionIcon(key);
            return <Tooltip label={label} key={key}>
              <ActionIcon size={58} radius="md" variant={selection === key ? "filled" : "light"}
                color={selection === key ? "lime" : "gray"} onClick={() => pick(key)} aria-label={label}>
                {Icon && <Icon size={28}/>}
              </ActionIcon>
            </Tooltip>;
          }) : custom.map(icon => <Tooltip label={icon.name} key={icon.value}>
            <ActionIcon size={58} radius="md" variant={selection === icon.value ? "filled" : "light"}
              color={selection === icon.value ? "lime" : "gray"} onClick={() => pick(icon.value)} aria-label={icon.name}>
              {brokenIcons.has(icon.value) ? <IconX size={28} color="red"/> :
                <img src={icon.url} alt="" width={32} height={32} style={{ objectFit: "contain" }}
                  onError={() => setBrokenIcons(previous => new Set(previous).add(icon.value))}/>}
            </ActionIcon>
          </Tooltip>)}
        </SimpleGrid>
      </ScrollArea>
      <Group gap="sm" align="center" wrap="nowrap">
        <div style={{ width: 44, height: 44, display: "grid", placeItems: "center" }}>
          {selection ? <FunctionIconAsset fn={{ icon: selection, iconTintMode: mode, iconColor: color }} size={32} preview/> : <IconPhoto size={24}/>}
        </div>
        <Text size="xs" c="dimmed" style={{ minWidth: 0, flex: 1 }} truncate>{selection || "No icon selected"}</Text>
        {selection.startsWith("custom:") && <Tooltip label={usedIcons.has(selection) ? "Icon in use: cannot delete" : "Delete icon"}>
          <ActionIcon color="red" variant="light" disabled={busy || usedIcons.has(selection)} onClick={() => void remove()}>
            <IconTrash size={17}/>
          </ActionIcon>
        </Tooltip>}
      </Group>
      {allowTint && <Group gap="xs" wrap="nowrap">
        <Select size="xs" w={138} value={mode} onChange={v => setMode(v === "tint" ? "tint" : "original")}
          data={[{ label: "Original colors", value: "original" }, { label: "Tint", value: "tint" }]}/>
        {mode === "tint" && <ColorInput size="xs" style={{ flex: 1 }} value={color} onChange={setColor}
          format="hex" withEyeDropper={false}/>}
      </Group>}
      {error && <Text c="red" size="xs">{error}</Text>}
      <Group justify="flex-end" gap="xs">
        <Button size="xs" color="gray" variant="light" onClick={onClose}>Cancel</Button>
        <Button size="xs" onClick={() => void commit()} loading={busy}>OK</Button>
      </Group>
    </Stack>
  </AppModal>;
}
