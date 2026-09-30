import type {
  TrainEvent,
} from "../domain/trainEvents";

type TrainEventListener =
  (event: TrainEvent) => void;

const listeners =
  new Set<TrainEventListener>();

let lastEvent:
  TrainEvent | null =
  null;

export function emitTrainEvent(
  event: TrainEvent
): void {
  lastEvent = {
    ...event,
    sensors: [
      ...event.sensors,
    ],
  };

  console.info(
    "[TrainEvent]",
    lastEvent
  );

  for (
    const listener of
    listeners
  ) {
    try {
      listener({
        ...lastEvent,
        sensors: [
          ...lastEvent.sensors,
        ],
      });
    } catch (error) {
      console.error(
        "[TrainEvent] listener failed",
        error
      );
    }
  }
}

export function subscribeTrainEvents(
  listener:
    TrainEventListener
): () => void {
  listeners.add(
    listener
  );

  return () => {
    listeners.delete(
      listener
    );
  };
}

export function getLastTrainEvent():
  TrainEvent | null {
  return lastEvent
    ? {
        ...lastEvent,
        sensors: [
          ...lastEvent.sensors,
        ],
      }
    : null;
}
