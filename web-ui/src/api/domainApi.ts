import type { FunctionBinding, Loco } from "@domain/types";

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


export async function getFunctionBindings(): Promise<FunctionBinding[]> {
  const response = await fetch("/api/function-bindings", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load function bindings: HTTP ${response.status}`);
  return response.json() as Promise<FunctionBinding[]>;
}

export async function saveFunctionBindings(bindings: FunctionBinding[]): Promise<void> {
  const response = await fetch("/api/function-bindings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bindings),
  });
  if (!response.ok) throw new Error(`Could not save function bindings: HTTP ${response.status}`);
}
