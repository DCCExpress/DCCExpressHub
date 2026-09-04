import {
  TrackSignalElementView,
} from "../../models/editor/elements/TrackSignalElementView";

import {
  cloneSignalOutputConfiguration,
} from "@/domain/layout/signalOutput";

export type SignalAspectPreviews =
  TrackSignalElementView[];

export function createSignalAspectPreviews(
  signal: TrackSignalElementView
): SignalAspectPreviews {
  return signal.signalOutput.states.map(
    (_, stateIndex) => {
      const preview =
        new TrackSignalElementView(0, 0);

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
