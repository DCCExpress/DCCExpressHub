import type { Loco, LocoFunction } from "./domainTypes";

// DCC function addresses F0–F28 are fixed slots (29 buttons).
// Preserve existing configuration and identities; fill only missing slots.
export function ensureLocoFunctions(loco: Loco): Loco {
  const slots = new Map<number, LocoFunction>();
  for (const fn of loco.functions ?? []) {
    if (Number.isInteger(fn.number) && fn.number >= 0 && fn.number <= 28 && !slots.has(fn.number))
      slots.set(fn.number, { ...fn, showOnLocoCard: fn.showOnLocoCard ?? (fn.number < 5) });
  }
  const functions = Array.from({ length: 29 }, (_, number) =>
    slots.get(number) ?? {
      id: `${loco.id}-function-${number}`,
      number,
      name: `F${number}`,
      icon: "",
      momentary: false,
      showOnLocoCard: number < 5,
      startupActive: false,
    });
  return { ...loco, functions };
}
