import {
  useSyncExternalStore,
} from "react";

export type UiBroadcastMessage = {
  target: string;
  locoAddress?: number;
  msg: string;
};

type Listener = () => void;

const messages =
  new Map<string, string>();

const listeners =
  new Map<string, Set<Listener>>();

function normalizeTarget(
  value: unknown
): string {
  const target =
    String(value ?? "").trim();

  if (!target) {
    throw new Error(
      "ui_broadcast: target is required."
    );
  }

  return target;
}

function normalizeLocoAddress(
  value: unknown
): number {
  const address =
    Number(value);

  if (
    !Number.isInteger(address) ||
    address < 1 ||
    address > 10239
  ) {
    throw new Error(
      "ui_broadcast: locoAddress must be an integer between 1 and 10239."
    );
  }

  return address;
}

function messageKey(
  target: string,
  locoAddress?: number
): string {
  return locoAddress === undefined
    ? target
    : `${target}:${locoAddress}`;
}

function emit(
  key: string
): void {
  for (
    const listener of
    listeners.get(key) ?? []
  ) {
    listener();
  }
}

export function uiBroadcast(
  input: UiBroadcastMessage
): void {
  if (
    !input ||
    typeof input !== "object"
  ) {
    throw new Error(
      "ui_broadcast expects an object: { target, locoAddress, msg }."
    );
  }

  const target =
    normalizeTarget(
      input.target
    );

  let locoAddress:
    number | undefined;

  if (
    target === "locoPanel"
  ) {
    locoAddress =
      normalizeLocoAddress(
        input.locoAddress
      );
  } else if (
    input.locoAddress !== undefined
  ) {
    locoAddress =
      normalizeLocoAddress(
        input.locoAddress
      );
  }

  const key =
    messageKey(
      target,
      locoAddress
    );

  const message =
    String(
      input.msg ?? ""
    ).trim();

  if (message) {
    messages.set(
      key,
      message.slice(0, 512)
    );
  } else {
    messages.delete(
      key
    );
  }

  emit(
    key
  );
}

export function getUiBroadcastMessage(
  target: string,
  locoAddress?: number
): string {
  return (
    messages.get(
      messageKey(
        target,
        locoAddress
      )
    ) ?? ""
  );
}

export function subscribeUiBroadcastMessage(
  target: string,
  locoAddress: number | undefined,
  listener: Listener
): () => void {
  const key =
    messageKey(
      target,
      locoAddress
    );

  let set =
    listeners.get(
      key
    );

  if (!set) {
    set =
      new Set<Listener>();

    listeners.set(
      key,
      set
    );
  }

  set.add(
    listener
  );

  return () => {
    const current =
      listeners.get(
        key
      );

    if (!current) {
      return;
    }

    current.delete(
      listener
    );

    if (
      current.size === 0
    ) {
      listeners.delete(
        key
      );
    }
  };
}

export function useUiBroadcastMessage(
  target: string,
  locoAddress?: number
): string {
  return useSyncExternalStore(
    listener =>
      subscribeUiBroadcastMessage(
        target,
        locoAddress,
        listener
      ),
    () =>
      getUiBroadcastMessage(
        target,
        locoAddress
      ),
    () =>
      getUiBroadcastMessage(
        target,
        locoAddress
      )
  );
}

declare global {
  var ui_broadcast:
    (
      input: UiBroadcastMessage
    ) => void;

  interface Window {
    ui_broadcast:
      (
        input: UiBroadcastMessage
      ) => void;
  }
}

globalThis.ui_broadcast =
  uiBroadcast;

if (
  typeof window !== "undefined"
) {
  window.ui_broadcast =
    uiBroadcast;
}
