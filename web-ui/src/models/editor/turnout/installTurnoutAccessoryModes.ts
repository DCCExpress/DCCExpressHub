import type {
  IEditableProperty,
} from "../elements/PropertyDescriptor";
import {
  TrackTurnoutLeftElementView,
} from "../elements/TrackTurnoutLeftElementView";
import {
  TrackTurnoutRightElementView,
} from "../elements/TrackTurnoutRightElementView";
import TrackTurnoutDoubleElementView
  from "../elements/TrackTurnoutDoubleElementView";
import {
  getBaseEditableProperties,
} from "../core/view/support/BaseElementViewSupport";
import {
  TURNOUT_OUTPUT_MODE_OPTIONS,
} from "../../../services/layoutOutput";
import {
  getDoubleTurnoutAspect,
  getTurnoutClosedAspect,
  getTurnoutOpenedAspect,
  normalizeTurnoutAspect,
  normalizeTurnoutOutputMode,
} from "./turnoutAccessoryHelpers";

let installed = false;

function installSingleTurnoutClass(
  TurnoutClass: any
): void {
  const originalFromJSON =
    TurnoutClass.fromJSON.bind(TurnoutClass);
  const originalToJSON =
    TurnoutClass.prototype.toJSON;
  const originalClone =
    TurnoutClass.prototype.clone;

  TurnoutClass.fromJSON =
    (data: any) => {
      const element =
        originalFromJSON(data);

      element.outputMode =
        normalizeTurnoutOutputMode(
          data.outputMode
        );
      element.turnoutClosedAspect =
        normalizeTurnoutAspect(
          data.turnoutClosedAspect,
          0
        );
      element.turnoutOpenedAspect =
        normalizeTurnoutAspect(
          data.turnoutOpenedAspect,
          1
        );

      return element;
    };

  TurnoutClass.prototype.toJSON =
    function () {
      const data =
        originalToJSON.call(this);

      return {
        ...data,
        outputMode:
          normalizeTurnoutOutputMode(
            this.outputMode
          ),
        turnoutClosedAspect:
          getTurnoutClosedAspect(this),
        turnoutOpenedAspect:
          getTurnoutOpenedAspect(this),
      };
    };

  TurnoutClass.prototype.clone =
    function () {
      const copy =
        originalClone.call(this);

      copy.outputMode =
        normalizeTurnoutOutputMode(
          this.outputMode
        );
      copy.turnoutClosedAspect =
        getTurnoutClosedAspect(this);
      copy.turnoutOpenedAspect =
        getTurnoutOpenedAspect(this);

      return copy;
    };
}

function installDoubleTurnoutClass():
  void {
  const TurnoutClass: any =
    TrackTurnoutDoubleElementView;

  const originalFromJSON =
    TurnoutClass.fromJSON.bind(TurnoutClass);
  const originalToJSON =
    TurnoutClass.prototype.toJSON;
  const originalClone =
    TurnoutClass.prototype.clone;

  TurnoutClass.fromJSON =
    (data: any) => {
      const element =
        originalFromJSON(data);

      element.outputMode =
        normalizeTurnoutOutputMode(
          data.outputMode
        );
      element.turnout1ClosedAspect =
        normalizeTurnoutAspect(
          data.turnout1ClosedAspect,
          0
        );
      element.turnout1OpenedAspect =
        normalizeTurnoutAspect(
          data.turnout1OpenedAspect,
          1
        );
      element.turnout2ClosedAspect =
        normalizeTurnoutAspect(
          data.turnout2ClosedAspect,
          0
        );
      element.turnout2OpenedAspect =
        normalizeTurnoutAspect(
          data.turnout2OpenedAspect,
          1
        );

      return element;
    };

  TurnoutClass.prototype.toJSON =
    function () {
      const data =
        originalToJSON.call(this);

      return {
        ...data,
        outputMode:
          normalizeTurnoutOutputMode(
            this.outputMode
          ),
        turnout1ClosedAspect:
          getDoubleTurnoutAspect(
            this,
            1,
            true
          ),
        turnout1OpenedAspect:
          getDoubleTurnoutAspect(
            this,
            1,
            false
          ),
        turnout2ClosedAspect:
          getDoubleTurnoutAspect(
            this,
            2,
            true
          ),
        turnout2OpenedAspect:
          getDoubleTurnoutAspect(
            this,
            2,
            false
          ),
      };
    };

  TurnoutClass.prototype.clone =
    function () {
      const copy =
        originalClone.call(this);

      copy.outputMode =
        normalizeTurnoutOutputMode(
          this.outputMode
        );
      copy.turnout1ClosedAspect =
        getDoubleTurnoutAspect(
          this,
          1,
          true
        );
      copy.turnout1OpenedAspect =
        getDoubleTurnoutAspect(
          this,
          1,
          false
        );
      copy.turnout2ClosedAspect =
        getDoubleTurnoutAspect(
          this,
          2,
          true
        );
      copy.turnout2OpenedAspect =
        getDoubleTurnoutAspect(
          this,
          2,
          false
        );

      return copy;
    };

  TurnoutClass.prototype
    .getEditableProperties =
    function (): IEditableProperty[] {
      return [
        ...getBaseEditableProperties(),
        {
          label: "Output type",
          key: "outputMode",
          type: "select",
          readonly: false,
          options:
            TURNOUT_OUTPUT_MODE_OPTIONS,
        },
        {
          label:
            "Turnout 1 accessory address",
          key: "turnout1Address",
          type: "number",
          readonly: false,
          min: 1,
          max: 2048,
          validate: () => true,
        },
        {
          label:
            "Turnout 2 accessory address",
          key: "turnout2Address",
          type: "number",
          readonly: false,
          min: 1,
          max: 2048,
          validate: () => true,
        },
        {
          label:
            "Double Turnout Positions",
          key: "turnout1ClosedValue",
          type: "bittoggle",
          readonly: false,
          validate: () => true,
        },
        {
          label:
            "Turnout 2 Closed Value",
          key: "turnout2ClosedValue",
          type: "bittoggle",
          readonly: false,
          validate: () => true,
        },
      ];
    };
}

export function
installTurnoutAccessoryModes(): void {
  if (installed) {
    return;
  }

  installed = true;

  installSingleTurnoutClass(
    TrackTurnoutLeftElementView
  );
  installSingleTurnoutClass(
    TrackTurnoutRightElementView
  );
  installDoubleTurnoutClass();
}
