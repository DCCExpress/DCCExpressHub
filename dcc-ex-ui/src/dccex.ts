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

/** DCC-EX <t address> is read-only: query a command-station throttle slot without driving. */
export function locoStatusQuery(address:number):string{
 if(!Number.isInteger(address)||address<1||address>10293)throw new Error('Invalid DCC address');
 return `<t ${address}>`;
}
export type LocoLiveState={
 address:number;speed:number;forward:boolean;functionsMask:number;
 emergencyStop:boolean;known:boolean;
};
/** Decode the broadcast <l address slot speedByte functionMap> (NOT raw throttle speed). */
export function parseLocoStatus(frame:string):LocoLiveState|null{
 const match=/^<l\s+(\d+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s*>$/.exec(frame.trim());
 if(!match)return null;
 const address=Number(match[1]),slot=Number(match[2]),speedByte=Number(match[3]);
 if(!Number.isInteger(address)||address<1||address>10293||!Number.isInteger(slot)||
    !Number.isInteger(speedByte)||speedByte<0||speedByte>255)return null;
 // DCC speed packets encode direction in bit 7; values 0 and 1 are stop / ESTOP.
 const rawSpeed=speedByte&0x7f;
 const mask=BigInt.asUintN(32,BigInt(match[4]!));
 return {
  address,known:slot>=0,
  speed:rawSpeed<=1?0:rawSpeed-1,forward:(speedByte&0x80)!==0,
  emergencyStop:rawSpeed===1,functionsMask:Number(mask&0x1fffffffn),
 };
}

// Unlike power-off, DCC-EX global E-STOP stops all locomotive reminder slots.
export const emergencyStopCommand=()=> '<!>';
export const trackPowerCommand=(on:boolean)=>on?'<1>':'<0>';
