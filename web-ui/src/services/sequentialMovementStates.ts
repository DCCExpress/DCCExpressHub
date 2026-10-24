import type { SequentialMovementStatePayload } from "@/domain/wsTypes";
import { wsClient } from "./wsClient";

const states = new Map<string, SequentialMovementStatePayload>();
const listeners = new Set<() => void>();
let installed = false;

function publish(): void {
  for (const listener of listeners) listener();
}

function install(): void {
  if (installed) return;
  installed = true;

  wsClient.subscribeMessages(message => {
    if (message.type === "sequentialMovementStateChanged") {
      const state = message.data as SequentialMovementStatePayload;
      if (!state?.sequenceId) return;
      states.set(state.sequenceId, state);
      publish();
    } else if (
      message.type === "movementResponse" &&
      message.data?.action === "sequenceSnapshot" &&
      message.data.ok === true
    ) {
      const snapshot = (message.data.extra as
        { states?: SequentialMovementStatePayload[] } | undefined)?.states;
      if (!Array.isArray(snapshot)) return;
      states.clear();
      for (const state of snapshot) {
        if (state?.sequenceId) states.set(state.sequenceId, state);
      }
      publish();
    }
  });

  wsClient.subscribeStatus(status => {
    if (status !== "connected") {
      states.clear();
      publish();
      return;
    }
    wsClient.send({
      type: "movementCommand",
      data: {
        action: "sequenceSnapshot",
        requestId: `sequence-status-${Date.now()}`,
      },
    });
  });
}

export function getSequentialMovementStates(): SequentialMovementStatePayload[] {
  install();
  return [...states.values()];
}

export function subscribeSequentialMovementStates(listener: () => void): () => void {
  install();
  listeners.add(listener);
  listener();
  return () => { listeners.delete(listener); };
}
