/** Read-only, best-effort descriptions of standard LocoNet packets.
 * Addresses are displayed 1-based; slot numbers are not locomotive addresses.
 * The decoder never participates in control or occupancy updates.
 */
export function decodeLocoNetHex(input: string): string | null {
  const hex = input.replace(/\s+/g, "").toUpperCase();
  if (!/^(?:[0-9A-F]{2}){2,}$/.test(hex)) return null;
  const bytes = hex.match(/.{2}/g)!.map(part => Number.parseInt(part, 16));
  const op = bytes[0]!;
  const expected = (op & 0x60) === 0 ? 2 : (op & 0x60) === 0x20 ? 4 : (op & 0x60) === 0x40 ? 6 : bytes[1];
  if (expected !== bytes.length) return `Opcode 0x${hex.slice(0, 2)} · unexpected packet length (${bytes.length}, expected ${expected})`;
  const xor = bytes.reduce((sum, value) => sum ^ value, 0);
  if (xor !== 0xFF) return `Opcode 0x${hex.slice(0, 2)} · invalid LocoNet checksum`;

  const slot = bytes[1]!;
  const data = bytes[2] ?? 0;
  switch (op) {
    case 0x81: return "OPC_BUSY · command station busy";
    case 0x82: return "OPC_GPOFF · track power OFF";
    case 0x83: return "OPC_GPON · track power ON";
    case 0x85: return "OPC_IDLE · emergency stop / idle";
    case 0xA0:
      return `OPC_LOCO_SPD · slot ${slot} · speed command ${data}${data === 0 ? " (STOP)" : data === 1 ? " (E-STOP)" : ""} · slot is not a DCC address`;
    case 0xA1:
      return `OPC_LOCO_DIRF · slot ${slot} · ${(data & 0x20) !== 0 ? "reverse" : "forward"} · F0–F4 bits 0x${(data & 0x1F).toString(16).toUpperCase().padStart(2, "0")}`;
    case 0xA2:
      return `OPC_LOCO_SND · slot ${slot} · F5–F8 bits 0x${(data & 0x0F).toString(16).toUpperCase()}`;
    case 0xB0:
    case 0xBD: {
      const address = (slot & 0x7F) + ((data & 0x0F) << 7) + 1;
      const direction = (data & 0x20) !== 0 ? "CLOSED" : "THROWN";
      const output = (data & 0x10) !== 0 ? "ON" : "OFF";
      return `${op === 0xB0 ? "OPC_SW_REQ" : "OPC_SW_ACK"} · turnout #${address} · ${direction} · output ${output} (command, not feedback)`;
    }
    case 0xB2: {
      const address = ((slot & 0x7F) << 1) + ((data & 0x0F) << 8) + ((data & 0x20) >> 5) + 1;
      return `OPC_INPUT_REP · sensor #${address} · ${(data & 0x10) !== 0 ? "OCCUPIED / HIGH" : "FREE / LOW"} (raw LocoNet address, before Hub offset)`;
    }
    case 0xB1:
      return `OPC_SW_REP · turnout feedback · raw address ${(slot & 0x7F) + ((data & 0x0F) << 7) + 1} · data 0x${data.toString(16).toUpperCase().padStart(2, "0")}`;
    case 0xB4:
      return `OPC_LONG_ACK · response to opcode 0x${(slot | 0x80).toString(16).toUpperCase()} · status 0x${data.toString(16).toUpperCase().padStart(2, "0")}`;
    case 0xBA: return `OPC_MOVE_SLOTS · source slot ${slot} · destination slot ${data}`;
    case 0xBB: return `OPC_RQ_SL_DATA · request slot ${slot}`;
    case 0xBC: return "OPC_SW_STATE · request turnout state";
    case 0xBF: return "OPC_LOCO_ADR · request locomotive address";
    case 0xE7: return "OPC_SL_RD_DATA · slot data response";
    case 0xED: return "OPC_IMM_PACKET · immediate DCC packet";
    case 0xEF: return "OPC_WR_SL_DATA · write slot data";
    default: return `LocoNet opcode 0x${op.toString(16).toUpperCase().padStart(2, "0")} · detailed decoding not implemented`;
  }
}

export function decodeLocoNetRawInfo(raw: string): string | null {
  // Only decode a verified four/two/etc-byte HEX payload, never arbitrary logs.
  const match = raw.match(/(?:^|\s)(?:RX|TX):\s*([0-9A-Fa-f\s]+)\s*$/);
  if (match && /LocoNet/i.test(raw)) return decodeLocoNetHex(match[1]!);
  return /^\s*(?:[\da-fA-F]{2}){2,}\s*$/.test(raw) ? decodeLocoNetHex(raw) : null;
}
