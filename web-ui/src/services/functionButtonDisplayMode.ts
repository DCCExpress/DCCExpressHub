import { useEffect, useState } from "react";

export type FunctionButtonDisplayMode = "default" | "icon" | "icon-text" | "text";
const KEY = "dccexpresshub.loco-function-button-display";
const listeners = new Set<() => void>();
export function getFunctionButtonDisplayMode(): FunctionButtonDisplayMode {
  try {
    const value = window.localStorage.getItem(KEY);
    if (value === "icon" || value === "icon-text" || value === "text") return value;
  } catch { /* storage unavailable */ }
  return "default";
}
export function setFunctionButtonDisplayMode(value: FunctionButtonDisplayMode): void {
  try { window.localStorage.setItem(KEY, value); } catch { /* storage unavailable */ }
  for (const listener of listeners) listener();
}
export function useFunctionButtonDisplayMode(): FunctionButtonDisplayMode {
  const [value, setValue] = useState(getFunctionButtonDisplayMode);
  useEffect(() => {
    const update = () => setValue(getFunctionButtonDisplayMode());
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);
  return value;
}
