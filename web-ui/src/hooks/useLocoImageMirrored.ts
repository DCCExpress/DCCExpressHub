import { useSyncExternalStore } from "react";

import {
  isLocoImageMirrored,
  subscribeLocoImageMirror,
} from "../services/locoImageMirror";

export function useLocoImageMirrored(locoId: string): boolean {
  return useSyncExternalStore(
    listener => subscribeLocoImageMirror(locoId, listener),
    () => isLocoImageMirrored(locoId),
    () => false
  );
}
