import { useEffect, useState } from "react";
import { loadIconStyles, readIconStyle, subscribeIconStyles } from "../../services/functionIconStyles";
import { IconX } from "@tabler/icons-react";
import type { LocoFunction } from "@domain/types";
import { getBuiltinFunctionIcon } from "./FunctionIconRegistry";
import { customFunctionIconUrl } from "../../api/functionIconApi";

type Props = { fn?: Pick<LocoFunction, "icon" | "iconTintMode" | "iconColor">; size?: number; preview?: boolean };
export default function FunctionIconAsset({ fn, size = 20, preview = false }: Props) {
  const icon = fn?.icon ?? "";
  const [, refresh] = useState(0);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [icon]);
  useEffect(() => { void loadIconStyles().catch(() => {}); return subscribeIconStyles(() => refresh(v => v + 1)); }, []);
  const preset = readIconStyle(icon);
  const Builtin = getBuiltinFunctionIcon(icon);
  const url = customFunctionIconUrl(icon);
  const wanted = (preview ? fn?.iconColor : preset?.color ?? fn?.iconColor) ?? "#ffffff";
  const color = /^#[0-9a-f]{6}$/i.test(wanted) ? wanted : "#ffffff";
  const tint = (preview ? fn?.iconTintMode : preset?.mode ?? fn?.iconTintMode) === "tint";
  if (broken) return <IconX size={size} color="red" aria-label="Missing icon" />;
  if (Builtin) return <span style={{ display: "inline-flex", color: tint ? color : undefined }}><Builtin size={size}/></span>;
  if (!url) return null;
  if (tint && /\.svg$/i.test(url)) return <span role="img" aria-label="Function icon"
    style={{ display: "inline-block", width: size, height: size, flexShrink: 0, backgroundColor: color,
      WebkitMaskImage: `url("${url}")`, maskImage: `url("${url}")`,
      WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskPosition: "center",
      maskPosition: "center", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" }} />;
  return <img src={url} alt="" width={size} height={size} onError={() => setBroken(true)} style={{ objectFit: "contain" }}/>;
}
