
import type {
  LocosCommandAction,
} from "@domain/clientWsCommands";

import type {
  Loco,
} from "@domain/types";

import {
  requestWsCommand,
} from "./wsRequest";

async function sendLocosCommand(
  action: LocosCommandAction,
  locos?: Loco[]
) {
  return requestWsCommand(
    "locosCommand",
    {
      action,
      ...(locos !== undefined
        ? { locos }
        : {}),
    },
    "locosResponse",
    "Locos WebSocket command failed."
  );
}

export async function getLocosWs(): Promise<Loco[]> {
  const response = await sendLocosCommand("load");

  return response.locos ?? [];
}

export async function saveLocosWs(
  locos: Loco[]
): Promise<void> {
  await sendLocosCommand("save", locos);
}
