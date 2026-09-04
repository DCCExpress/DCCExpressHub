import type {
  IEditableProperty,
} from "../elements/PropertyDescriptor";

import {
  TrackStraightElementView,
} from "../elements/TrackStraightElementView";
import {
  TrackDirectionElementView,
} from "../elements/TrackDirectionElementView";
import {
  TrackEndElementView,
} from "../elements/TrackEndElementView";
import {
  TrackCornerElementView,
} from "../elements/TrackCornerElementView";
import {
  TrackCurveElementView,
} from "../elements/TrackCurveElementView";
import {
  TrackCrossingElementView,
} from "../elements/TrackCrossingElementView";
import {
  TrackLevelCrossingElementView,
} from "../elements/TrackLevelCrossingElementView";
import {
  TrackTurnoutLeftElementView,
} from "../elements/TrackTurnoutLeftElementView";
import {
  TrackTurnoutRightElementView,
} from "../elements/TrackTurnoutRightElementView";
import TrackTurnoutDoubleElementView
  from "../elements/TrackTurnoutDoubleElementView";
import {
  TrackTurnoutTwoWayElementView,
} from "../elements/TrackTurnoutTwoWayElementView";

type EditableElementPrototype = {
  getEditableProperties:
    () => IEditableProperty[];
};

const OCCUPANCY_SENSOR_PROPERTY:
  IEditableProperty = {
    label: "Occupancy sensor address",
    key: "address",
    type: "number",
    readonly: false,
    min: 0,
  };

let installed = false;

function extendEditableProperties(
  prototype: EditableElementPrototype
): void {
  const original =
    prototype.getEditableProperties;

  prototype.getEditableProperties =
    function getEditablePropertiesWithOccupancy():
      IEditableProperty[] {
      const properties =
        original.call(this);

      if (
        properties.some(
          property =>
            property.key ===
            OCCUPANCY_SENSOR_PROPERTY.key
        )
      ) {
        return properties;
      }

      return [
        ...properties,
        {
          ...OCCUPANCY_SENSOR_PROPERTY,
        },
      ];
    };
}

/**
 * Adds the existing TrackElement.address field to the property panel
 * for physical railway track elements only.
 *
 * Persisted JSON remains:
 *   "address": <number>
 *
 * Explicitly excluded:
 * - TrackSensor
 * - Block
 * - Signal
 * - Button / Route button
 * - Label / Tree / Clock / Audio elements
 */
export function installOccupancySensorProperties():
  void {
  if (installed) {
    return;
  }

  installed = true;

  extendEditableProperties(
    TrackStraightElementView.prototype
  );
  extendEditableProperties(
    TrackDirectionElementView.prototype
  );
  extendEditableProperties(
    TrackEndElementView.prototype
  );
  extendEditableProperties(
    TrackCornerElementView.prototype
  );
  extendEditableProperties(
    TrackCurveElementView.prototype
  );
  extendEditableProperties(
    TrackCrossingElementView.prototype
  );
  extendEditableProperties(
    TrackLevelCrossingElementView.prototype
  );
  extendEditableProperties(
    TrackTurnoutLeftElementView.prototype
  );
  extendEditableProperties(
    TrackTurnoutRightElementView.prototype
  );
  extendEditableProperties(
    TrackTurnoutDoubleElementView.prototype
  );
  extendEditableProperties(
    TrackTurnoutTwoWayElementView.prototype
  );
}
