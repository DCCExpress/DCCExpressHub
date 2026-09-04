import type { Loco } from "@domain/types";

export async function getLocos(): Promise<Loco[]> {
  const response = await fetch("/api/locos", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load locomotives: HTTP ${response.status}`);
  return response.json() as Promise<Loco[]>;
}

export async function saveLocos(locos: Loco[]): Promise<void> {
  const response = await fetch("/api/locos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(locos),
  });
  if (!response.ok) throw new Error(`Could not save locomotives: HTTP ${response.status}`);
}
