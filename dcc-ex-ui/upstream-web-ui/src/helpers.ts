import {
  notifications,
} from "@mantine/notifications";

import {
  notificationLogStore,
} from "./services/notificationLogStore";

let fallbackIdCounter = 0;

/**
 * Compact stable ID for persisted UI/domain objects.
 *
 * Older IDs remain valid strings. New IDs are ~13 base36 characters instead
 * of the old ~28-character pseudo UUID.
 */
export function generateId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const words =
      new Uint32Array(2);

    crypto.getRandomValues(words);

    return (
      (words[0] ?? 0).toString(36) +
      (words[1] ?? 0).toString(36)
    );
  }

  fallbackIdCounter =
    (fallbackIdCounter + 1) & 0xffff;

  return (
    Date.now().toString(36) +
    fallbackIdCounter.toString(36) +
    Math.floor(
      Math.random() * 0xffffff
    ).toString(36)
  );
}

function isNoisyTaskWaitingMessage(
  title: string,
  message: string
): boolean {
  return (
    title === "Task waiting" &&
    message.includes(
      "No loco assigned to task start block"
    )
  );
}

export function showOkMessage(
  title: string,
  message: string,
  autoClose: number = 5000
) {
  const finalTitle =
    title == ""
      ? "SUCCESSFUL"
      : title;

  notificationLogStore.add({
    level: "success",
    title: finalTitle,
    message,
  });

  notifications.show({
    title: finalTitle,
    message,
    color: "green",
    autoClose,
  });
}

export function showErrorMessage(
  title: string,
  message: string,
  autoClose: number = 5000
) {
  notificationLogStore.add({
    level: "error",
    title,
    message,
  });

  notifications.show({
    title,
    message,
    color: "red",
    autoClose,
  });
}

export function showWarningMessage(
  title: string,
  message: string,
  autoClose: number = 5000
) {
  if (
    isNoisyTaskWaitingMessage(
      title,
      message
    )
  ) {
    return;
  }

  notificationLogStore.add({
    level: "warning",
    title,
    message,
  });

  notifications.show({
    title,
    message,
    color: "yellow",
    autoClose,
  });
}

export function isTouchDevice(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    window
      .matchMedia(
        "(pointer: coarse)"
      )
      .matches
  );
}

export function errorToString(
  error: unknown
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export const sleep = (ms: number) =>
  new Promise<void>(
    resolve =>
      window.setTimeout(
        resolve,
        ms
      )
  );

export function measure<T>(
  label: string,
  fn: () => T
): T {
  const start =
    performance.now();

  try {
    return fn();
  } finally {
    const end =
      performance.now();

    console.log(
      `⏱️ ${label}: ${(end - start).toFixed(2)} ms`
    );
  }
}

export async function measureAsync<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const start =
    performance.now();

  try {
    return await fn();
  } finally {
    const end =
      performance.now();

    console.log(
      `⏱️ ${label}: ${(end - start).toFixed(2)} ms`
    );
  }
}
