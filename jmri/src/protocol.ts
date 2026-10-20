export type JmriRecord = Record<string, unknown>;
export type JmriEntry = { type?: string; data?: JmriRecord; [key: string]: unknown };
export type LogRecord = { id: number; at: string; channel: "HTTP" | "WS" | "SYSTEM"; direction: "in" | "out" | "info" | "error"; message: string };
export const BASE = "/jmri";
export const DEFAULT_TYPES = ["type", "sensor", "turnout", "light", "block", "layoutBlock", "route", "memory", "reporter", "signalHead", "signalMast", "power", "roster", "throttle", "panel", "metadata"];
export function jsonPath(type: string, name?: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(type)) throw new Error("Invalid JSON object type");
  return `${BASE}/json/${type}${name ? "/" + encodeURIComponent(name) : ""}`;
}
export function format(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value);
}
export function parseIncoming(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}
export function wsUrl(): string {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${BASE}/json/`;
}
export function isReadOnlyCommand(input: unknown): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const v = input as JmriRecord;
  return v.method === undefined || v.method === "get" || v.method === "list" || v.type === "ping" || (v.type === "list" && typeof v.list === "string");
}
export function needsWriteConfirmation(raw: string): boolean {
  const parsed: unknown = JSON.parse(raw);
  return !isReadOnlyCommand(parsed);
}
