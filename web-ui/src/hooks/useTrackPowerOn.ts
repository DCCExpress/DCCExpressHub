import {
  useEffect,
  useState,
} from "react";

import {
  isTrackPowerOn,
  subscribeTrackPower,
} from "@/services/trackPowerRuntime";

export function useTrackPowerOn(): boolean {
  const [
    powerOn,
    setPowerOn,
  ] = useState(
    () => isTrackPowerOn()
  );

  useEffect(
    () =>
      subscribeTrackPower(
        setPowerOn
      ),
    []
  );

  return powerOn;
}
