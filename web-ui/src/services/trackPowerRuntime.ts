import {
  wsClient,
} from "./wsClient";

type TrackPowerListener =
  (
    on: boolean
  ) => void;

let trackPowerOn =
  false;

let initialized =
  false;

const listeners =
  new Set<
    TrackPowerListener
  >();

function emit(): void {
  for (
    const listener of
    listeners
  ) {
    listener(
      trackPowerOn
    );
  }
}

function install(): void {
  if (
    initialized
  ) {
    return;
  }

  initialized =
    true;

  wsClient.on(
    "powerInfo",
    data => {
      const next =
        data.trackVoltageOn ===
        true;

      if (
        next ===
        trackPowerOn
      ) {
        return;
      }

      trackPowerOn =
        next;

      emit();
    }
  );

  wsClient.on(
    "commandCenterInfo",
    data => {
      if (
        data.alive
      ) {
        return;
      }

      if (
        !trackPowerOn
      ) {
        return;
      }

      trackPowerOn =
        false;

      emit();
    }
  );

  wsClient.subscribeStatus(
    status => {
      if (
        status ===
          "connected"
      ) {
        return;
      }

      if (
        !trackPowerOn
      ) {
        return;
      }

      trackPowerOn =
        false;

      emit();
    }
  );
}

export function isTrackPowerOn(): boolean {
  install();

  return trackPowerOn;
}

export function subscribeTrackPower(
  listener:
    TrackPowerListener
): () => void {
  install();

  listeners.add(
    listener
  );

  listener(
    trackPowerOn
  );

  return () => {
    listeners.delete(
      listener
    );
  };
}

install();
