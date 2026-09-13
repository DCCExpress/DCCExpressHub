import {
  TrackSignalElement,
} from "../../models/editor/elements/TrackSignalElement";

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
        new TrackSignalElement(0, 0);

      preview.signalOutput =
        cloneSignalOutputConfiguration(
          signal.signalOutput
        );

      preview.currentStateIndex =
        stateIndex;

      return preview;
    }
  );
}
