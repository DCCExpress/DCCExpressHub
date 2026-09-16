import {
  TrackSignalElement,
} from "../../models/editor/elements/TrackSignalElement";

import {
  TrackLevelCrossingElement,
} from "../../models/editor/elements/TrackLevelCrossingElement";

import {
  cloneSignalOutputConfiguration,
} from "@/domain/layout/signalOutput";

export type SignalAspectPreviews =
  TrackSignalElement[];

export function createSignalAspectPreviews(
  signal: TrackSignalElement
): SignalAspectPreviews {
  return signal.signalOutput.states.map(
    (_, stateIndex) => {
      const preview =
        signal instanceof TrackLevelCrossingElement
          ? new TrackLevelCrossingElement(0, 0)
          : new TrackSignalElement(0, 0);

      preview.signalOutput =
        cloneSignalOutputConfiguration(
          signal.signalOutput
        );

      preview.currentStateIndex =
        stateIndex;

      if (
        preview instanceof TrackLevelCrossingElement &&
        signal instanceof TrackLevelCrossingElement
      ) {
        preview.barrierType =
          signal.barrierType;
        preview.roadColor =
          signal.roadColor;
        preview.lightsEnabled =
          signal.lightsEnabled;

        // Keep popup previews stable instead of blinking independently.
        preview.blinkingEnabled = false;
      }

      return preview;
    }
  );
}
