import type { LocoFunction } from "@domain/types";
import { getBuiltinFunctionIcon } from "./FunctionIconRegistry";
import { customFunctionIconUrl } from "../../api/functionIconApi";

type Props = { fn?: Pick<LocoFunction, "icon" | "iconTintMode" | "iconColor">; size?: number };
export default function FunctionIconAsset({ fn, size = 20 }: Props) {
  const icon = fn?.icon ?? "";
  const Builtin = getBuiltinFunctionIcon(icon);
  const url = customFunctionIconUrl(icon);
  const color = /^#[0-9a-f]{6}$/i.test(fn?.iconColor ?? "") ? fn!.iconColor! : "#ffffff";
  const tint = fn?.iconTintMode === "tint";
  if (Builtin) return <span style={{ display: "inline-flex", color: tint ? color : undefined }}><Builtin size={size}/></span>;
  if (!url) return null;
  if (tint && /\.svg$/i.test(url)) return <span role="img" aria-label="Function icon"
    style={{ display: "inline-block", width: size, height: size, flexShrink: 0, backgroundColor: color,
      WebkitMaskImage: `url("${url}")`, maskImage: `url("${url}")`,
      WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskPosition: "center",
      maskPosition: "center", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" }} />;
  return <img src={url} alt="" width={size} height={size} style={{ objectFit: "contain" }}/>;
}
