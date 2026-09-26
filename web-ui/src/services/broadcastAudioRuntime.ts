import {
  audioManager,
} from "./audioManager";

import {
  wsApi,
} from "./wsApi";

import {
  wsClient,
} from "./wsClient";

const AUDIO_ENABLED_KEY =
  "dcc-express-audio-enabled";

type AudioEnabledListener =
  (
    enabled: boolean
  ) => void;

type PendingAudioRequest = {
  resolve: (
    ok: boolean
  ) => void;
  echoTimeout:
    number;
};

let enabled =
  readStoredAudioEnabled();

let installed =
  false;

let requestSequence =
  0;

const listeners =
  new Set<
    AudioEnabledListener
  >();

const pendingRequests =
  new Map<
    string,
    PendingAudioRequest
  >();

const activeBroadcastPaths =
  new Set<string>();

function readStoredAudioEnabled():
  boolean {
  try {
    const stored =
      window.localStorage.getItem(
        AUDIO_ENABLED_KEY
      );

    if (
      stored ===
      "false"
    ) {
      return false;
    }

    if (
      stored ===
      "true"
    ) {
      return true;
    }
  } catch {
    // Use the default when localStorage is unavailable.
  }

  return true;
}

function notifyAudioEnabled():
  void {
  for (
    const listener of
    listeners
  ) {
    listener(
      enabled
    );
  }
}

function settlePending(
  requestId: string,
  ok: boolean
): void {
  const pending =
    pendingRequests.get(
      requestId
    );

  if (!pending) {
    return;
  }

  window.clearTimeout(
    pending.echoTimeout
  );

  pendingRequests.delete(
    requestId
  );

  pending.resolve(
    ok
  );
}

export function installBroadcastAudioRuntime():
  void {
  if (installed) {
    return;
  }

  installed =
    true;

  wsClient.on(
    "playAudio",
    data => {
      const pending =
        pendingRequests.get(
          data.requestId
        );

      if (
        pending
      ) {
        window.clearTimeout(
          pending.echoTimeout
        );
      }

      if (
        !enabled
      ) {
        settlePending(
          data.requestId,
          true
        );

        return;
      }

      activeBroadcastPaths.add(
        data.fileName
      );

      const finish = (
        ok: boolean
      ) => {
        activeBroadcastPaths.delete(
          data.fileName
        );

        settlePending(
          data.requestId,
          ok
        );
      };

      audioManager.play(
        data.fileName,
        {
          onEnded:
            () => {
              finish(
                true
              );
            },
          onError:
            () => {
              finish(
                false
              );
            },
          onStopped:
            () => {
              finish(
                false
              );
            },
        }
      );
    }
  );

  wsClient.on(
    "stopAudio",
    data => {
      activeBroadcastPaths.delete(
        data.fileName
      );

      audioManager.stop(
        data.fileName
      );
    }
  );
}

export function isBroadcastAudioEnabled():
  boolean {
  return enabled;
}

export function setBroadcastAudioEnabled(
  value: boolean
): void {
  const next =
    Boolean(
      value
    );

  if (
    enabled ===
    next
  ) {
    return;
  }

  enabled =
    next;

  try {
    window.localStorage.setItem(
      AUDIO_ENABLED_KEY,
      enabled
        ? "true"
        : "false"
    );
  } catch {
    // Audio preference remains valid for this browser session.
  }

  if (
    !enabled
  ) {
    for (
      const path of
      [
        ...activeBroadcastPaths,
      ]
    ) {
      audioManager.stop(
        path
      );
    }

    activeBroadcastPaths.clear();
  }

  notifyAudioEnabled();
}

export function subscribeBroadcastAudioEnabled(
  listener:
    AudioEnabledListener
): () => void {
  listeners.add(
    listener
  );

  listener(
    enabled
  );

  return () => {
    listeners.delete(
      listener
    );
  };
}

export function broadcastAudioPlayback(
  fileName: string
): Promise<boolean> {
  installBroadcastAudioRuntime();

  requestSequence +=
    1;

  const requestId =
    `${wsApi.clientUuid}:audio:${Date.now()}:${requestSequence}`;

  return new Promise<boolean>(
    resolve => {
      const echoTimeout =
        window.setTimeout(
          () => {
            pendingRequests.delete(
              requestId
            );

            resolve(
              false
            );
          },
          5000
        );

      pendingRequests.set(
        requestId,
        {
          resolve,
          echoTimeout,
        }
      );

      const sent =
        wsApi.broadcastPlayAudio(
          requestId,
          fileName
        );

      if (
        !sent
      ) {
        settlePending(
          requestId,
          false
        );
      }
    }
  );
}

export function broadcastAudioPlaybackNoWait(
  fileName: string
): boolean {
  installBroadcastAudioRuntime();

  requestSequence +=
    1;

  return wsApi.broadcastPlayAudio(
    `${wsApi.clientUuid}:audio:${Date.now()}:${requestSequence}`,
    fileName
  );
}

export function broadcastAudioStop(
  fileName: string
): boolean {
  return wsApi.broadcastStopAudio(
    fileName
  );
}
