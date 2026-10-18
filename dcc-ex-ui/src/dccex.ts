/** Raw DCC-EX ASCII protocol over an actual WebSocket endpoint (not plain TCP). */
export type LocoCommand = { address: number; speed: number; forward: boolean };
export function throttleCommand({ address, speed, forward }: LocoCommand): string {
  if (!Number.isInteger(address) || address < 1 || address > 10239) throw new Error('Invalid DCC address');
  if (!Number.isInteger(speed) || speed < 0 || speed > 126) throw new Error('Speed must be 0–126');
  return `<t ${address} ${speed} ${forward ? 1 : 0}>`;
}
export function functionCommand(address: number, fn: number, on: boolean): string {
  if (!Number.isInteger(address) || address < 1 || address > 10239) throw new Error('Invalid DCC address');
  if (!Number.isInteger(fn) || fn < 0 || fn > 28) throw new Error('Function must be F0–F28');
  return `<F ${address} ${fn} ${on ? 1 : 0}>`;
}
export function parseFrames(text: string): string[] { return text.match(/<[^<>]*>/g) ?? []; }
