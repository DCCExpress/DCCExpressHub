import i18next from "i18next";
import {
  ActionIcon,
  Box,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconPlayerPlayFilled,
} from "@tabler/icons-react";

import BitToggleElement from "../../components/editor/BitToggleElement";
import type {
  BaseElement,
} from "../../models/editor/core/BaseElement";
import {
  ButtonElement,
} from "../../models/editor/elements/ButtonElement";
import type {
  IEditableProperty,
} from "../../models/editor/elements/PropertyDescriptor";
import TrackTurnoutDoubleElement from "../../models/editor/elements/TrackTurnoutDoubleElement";
import {
  TrackTurnoutLeftElement,
} from "../../models/editor/elements/TrackTurnoutLeftElement";
import {
  TrackTurnoutRightElement,
} from "../../models/editor/elements/TrackTurnoutRightElement";
import {
  TrackTurnoutTwoWayElement,
} from "../../models/editor/elements/TrackTurnoutTwoWayElement";
import {
  TrackTurnoutThreeWayElement,
} from "../../models/editor/elements/TrackTurnoutThreeWayElement";
import {
  getDoubleTurnoutAspect,
  getTurnoutClosedAspect,
  getTurnoutOpenedAspect,
  normalizeTurnoutOutputMode,
} from "../../models/editor/turnout/turnoutAccessoryHelpers";
import ElementPreview from "../../models/editor/rendering/ElementPreviewRenderer";
import {
  sendTurnoutOutput,
} from "../../services/layoutOutput";
import {
  createDoubleTurnoutPreview,
  createThreeWayTurnoutPreview,
  createTurnoutPreview,
} from "./previewFactories";
import type {
  PropertyChangeHandler,
} from "./propertyPanelTypes";

type TurnoutBitPropertyEditorProps = {
  prop: IEditableProperty;
  selectedElement: BaseElement;
  onChange: PropertyChangeHandler;
};

type SingleTurnoutElement =
  | TrackTurnoutLeftElement
  | TrackTurnoutRightElement
  | TrackTurnoutTwoWayElement;

type DoubleTurnoutPositionId =
  | "oo"
  | "oc"
  | "co"
  | "cc";

type DoubleTurnoutPosition = {
  id: DoubleTurnoutPositionId;
  label: string;
  firstClosed: boolean;
  secondClosed: boolean;
};

type ThreeWayTurnoutPositionId =
  | "left"
  | "straight"
  | "right";

type ThreeWayTurnoutPosition = {
  id: ThreeWayTurnoutPositionId;
  readonly label: string;
  firstClosed: boolean;
  secondClosed: boolean;
};

/*
 * IMPORTANT I18N RULE
 * -------------------
 * `id` is application state / logic and MUST NEVER be translated.
 * `label` is presentation only and MUST NEVER be used in comparisons,
 * switch statements, persistence or React identity.
 */
const DOUBLE_TURNOUT_POSITIONS: readonly DoubleTurnoutPosition[] = [
  {
    id: "oo",
    label: "O-O",
    firstClosed: false,
    secondClosed: false,
  },
  {
    id: "oc",
    label: "O-C",
    firstClosed: false,
    secondClosed: true,
  },
  {
    id: "co",
    label: "C-O",
    firstClosed: true,
    secondClosed: false,
  },
  {
    id: "cc",
    label: "C-C",
    firstClosed: true,
    secondClosed: true,
  },
];

const THREE_WAY_TURNOUT_POSITIONS: readonly ThreeWayTurnoutPosition[] = [
  {
    id: "left",
    get label() {
      return i18next.t("ui.left");
    },
    firstClosed: true,
    secondClosed: false,
  },
  {
    id: "straight",
    get label() {
      return i18next.t("ui.straight");
    },
    firstClosed: false,
    secondClosed: false,
  },
  {
    id: "right",
    get label() {
      return i18next.t("ui.right");
    },
    firstClosed: false,
    secondClosed: true,
  },
];

function isSingleTurnoutElement(
  element: BaseElement
): element is SingleTurnoutElement {
  return (
    element instanceof TrackTurnoutLeftElement ||
    element instanceof TrackTurnoutRightElement ||
    element instanceof TrackTurnoutTwoWayElement
  );
}

function isDoubleTurnoutElement(
  element: BaseElement
): element is TrackTurnoutDoubleElement {
  return element instanceof TrackTurnoutDoubleElement;
}

function isThreeWayTurnoutElement(
  element: BaseElement
): element is TrackTurnoutThreeWayElement {
  return element instanceof TrackTurnoutThreeWayElement;
}

function isMultiTurnoutClosedValueProperty(
  prop: IEditableProperty
): boolean {
  return (
    prop.key === "turnout1ClosedValue" ||
    prop.key === "turnout2ClosedValue"
  );
}

function getPhysicalValueForLogicalState(
  closedValue: boolean,
  logicalClosed: boolean
): boolean {
  return logicalClosed
    ? closedValue
    : !closedValue;
}

function numberProperty(
  label: string,
  key: string
): IEditableProperty {
  return {
    label,
    key,
    type: "number",
    readonly: false,
    min: 0,
    max: 255,
    validate: value =>
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 255,
  };
}

function TestButton({
  title,
  onClick,
}: {
  title: string;
  onClick: () => void;
}) {
  return (
    <ActionIcon
      size="lg"
      variant="light"
      color="teal"
      title={title}
      aria-label={title}
      onClick={event => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <IconPlayerPlayFilled size={17} />
    </ActionIcon>
  );
}

function renderButtonBasicEditor(
  selectedElement: ButtonElement,
  onChange: PropertyChangeHandler
) {
  const onValueProperty: IEditableProperty = {
    label: i18next.t("ui.onValue"),
    key: "activeValue",
    type: "bittoggle",
    readonly: false,
  };

  const offValueProperty: IEditableProperty = {
    label: i18next.t("ui.offValue"),
    key: "offValue",
    type: "bittoggle",
    readonly: false,
  };

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        {i18next.t("ui.basicAccessoryValues")}
      </Text>

      <Group justify="space-between" align="center" wrap="nowrap">
        <Text size="sm" fw={600} w={44}>
          {i18next.t("ui.on")}
        </Text>

        <Group gap="xs" wrap="nowrap">
          <BitToggleElement
            value={selectedElement.activeValue}
            onChange={value => {
              onChange(onValueProperty, value);
              if (selectedElement.offValue === value) {
                onChange(offValueProperty, !value);
              }
            }}
          />

          <TestButton
            title={i18next.t("ui.testOn")}
            onClick={() =>
              selectedElement.sendConfiguredState(true)
            }
          />
        </Group>
      </Group>

      <Group justify="space-between" align="center" wrap="nowrap">
        <Text size="sm" fw={600} w={44}>
          {i18next.t("ui.off")}
        </Text>

        <Group gap="xs" wrap="nowrap">
          <BitToggleElement
            value={selectedElement.offValue}
            onChange={value => {
              onChange(offValueProperty, value);
              if (selectedElement.activeValue === value) {
                onChange(onValueProperty, !value);
              }
            }}
          />

          <TestButton
            title={i18next.t("ui.testOff")}
            onClick={() =>
              selectedElement.sendConfiguredState(false)
            }
          />
        </Group>
      </Group>
    </Stack>
  );
}

function renderButtonExtendedEditor(
  selectedElement: ButtonElement,
  onChange: PropertyChangeHandler
) {
  const onAspectProperty =
    numberProperty("ON aspect", "onAspect");

  const offAspectProperty =
    numberProperty("OFF aspect", "offAspect");

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        {i18next.t("ui.extendedAccessoryAspects")}
      </Text>

      <Group justify="space-between" align="flex-end" wrap="nowrap">
        <Text size="sm" fw={600} w={44} pb={9}>
          {i18next.t("ui.on")}
        </Text>

        <Group gap="xs" align="flex-end" wrap="nowrap">
          <NumberInput
            aria-label={i18next.t("ui.onAspect")}
            min={0}
            max={255}
            allowDecimal={false}
            allowNegative={false}
            value={selectedElement.onAspect}
            onChange={value =>
              onChange(onAspectProperty, value)
            }
            w={110}
          />

          <TestButton
            title={i18next.t("ui.testOnAspect")}
            onClick={() =>
              selectedElement.sendConfiguredState(true)
            }
          />
        </Group>
      </Group>

      <Group justify="space-between" align="flex-end" wrap="nowrap">
        <Text size="sm" fw={600} w={44} pb={9}>
          {i18next.t("ui.off")}
        </Text>

        <Group gap="xs" align="flex-end" wrap="nowrap">
          <NumberInput
            aria-label={i18next.t("ui.offAspect")}
            min={0}
            max={255}
            allowDecimal={false}
            allowNegative={false}
            value={selectedElement.offAspect}
            onChange={value =>
              onChange(offAspectProperty, value)
            }
            w={110}
          />

          <TestButton
            title={i18next.t("ui.testOffAspect")}
            onClick={() =>
              selectedElement.sendConfiguredState(false)
            }
          />
        </Group>
      </Group>
    </Stack>
  );
}

function renderButtonOutputEditor(
  selectedElement: ButtonElement,
  onChange: PropertyChangeHandler
) {
  return selectedElement.outputMode === "extended"
    ? renderButtonExtendedEditor(
        selectedElement,
        onChange
      )
    : renderButtonBasicEditor(
        selectedElement,
        onChange
      );
}

function sendSingleTurnoutState(
  element: SingleTurnoutElement,
  logicalClosed: boolean,
  closedValueOverride?: boolean
): void {
  const closedValue =
    closedValueOverride ??
    element.turnoutClosedValue;

  sendTurnoutOutput(
    String((element as any).outputMode),
    element.turnoutAddress,
    getPhysicalValueForLogicalState(
      closedValue,
      logicalClosed
    ),
    {
      closedValue,
      closedAspect:
        getTurnoutClosedAspect(element),
      openedAspect:
        getTurnoutOpenedAspect(element),
    }
  );
}

function doubleStateProperty(
  label: string,
  key:
    | "ooMotor1Value"
    | "ooMotor2Value"
    | "ocMotor1Value"
    | "ocMotor2Value"
    | "coMotor1Value"
    | "coMotor2Value"
    | "ccMotor1Value"
    | "ccMotor2Value"
): IEditableProperty {
  return {
    label,
    key,
    type: "bittoggle",
    readonly: false,
    validate: () => true,
  };
}

function doublePositionValues(
  selectedElement: TrackTurnoutDoubleElement,
  position: DoubleTurnoutPosition
): {
  first: boolean;
  second: boolean;
  firstProperty: IEditableProperty;
  secondProperty: IEditableProperty;
} {
  switch (position.id) {
    case "oc":
      return {
        first: selectedElement.ocMotor1Value,
        second: selectedElement.ocMotor2Value,
        firstProperty: doubleStateProperty(
          "O-C motor 1",
          "ocMotor1Value"
        ),
        secondProperty: doubleStateProperty(
          "O-C motor 2",
          "ocMotor2Value"
        ),
      };

    case "co":
      return {
        first: selectedElement.coMotor1Value,
        second: selectedElement.coMotor2Value,
        firstProperty: doubleStateProperty(
          "C-O motor 1",
          "coMotor1Value"
        ),
        secondProperty: doubleStateProperty(
          "C-O motor 2",
          "coMotor2Value"
        ),
      };

    case "cc":
      return {
        first: selectedElement.ccMotor1Value,
        second: selectedElement.ccMotor2Value,
        firstProperty: doubleStateProperty(
          "C-C motor 1",
          "ccMotor1Value"
        ),
        secondProperty: doubleStateProperty(
          "C-C motor 2",
          "ccMotor2Value"
        ),
      };

    case "oo":
    default:
      return {
        first: selectedElement.ooMotor1Value,
        second: selectedElement.ooMotor2Value,
        firstProperty: doubleStateProperty(
          "O-O motor 1",
          "ooMotor1Value"
        ),
        secondProperty: doubleStateProperty(
          "O-O motor 2",
          "ooMotor2Value"
        ),
      };
  }
}

function sendDoubleTurnoutValues(
  element: TrackTurnoutDoubleElement,
  first: boolean,
  second: boolean
): void {
  sendTurnoutOutput(
    String((element as any).outputMode),
    element.turnout1Address,
    first,
    {
      closedValue:
        element.turnout1ClosedValue,
      closedAspect:
        getDoubleTurnoutAspect(
          element,
          1,
          true
        ),
      openedAspect:
        getDoubleTurnoutAspect(
          element,
          1,
          false
        ),
    }
  );

  sendTurnoutOutput(
    String((element as any).outputMode),
    element.turnout2Address,
    second,
    {
      closedValue:
        element.turnout2ClosedValue,
      closedAspect:
        getDoubleTurnoutAspect(
          element,
          2,
          true
        ),
      openedAspect:
        getDoubleTurnoutAspect(
          element,
          2,
          false
        ),
    }
  );
}

function sendDoubleTurnoutBitClick(
  element: TrackTurnoutDoubleElement,
  position: DoubleTurnoutPosition,
  motor: 1 | 2,
  clickedValue: boolean
): void {
  const current =
    doublePositionValues(
      element,
      position
    );

  const first =
    motor === 1
      ? clickedValue
      : current.first;

  const second =
    motor === 2
      ? clickedValue
      : current.second;

  sendDoubleTurnoutValues(
    element,
    first,
    second
  );
}

function sendDoubleTurnoutPosition(
  element: TrackTurnoutDoubleElement,
  position: DoubleTurnoutPosition
): void {
  const values =
    doublePositionValues(
      element,
      position
    );

  sendDoubleTurnoutValues(
    element,
    values.first,
    values.second
  );
}

function renderSingleExtendedEditor(
  selectedElement: SingleTurnoutElement,
  onChange: PropertyChangeHandler
) {
  const closedProperty =
    numberProperty(
      "Closed aspect",
      "turnoutClosedAspect"
    );

  const openedProperty =
    numberProperty(
      "Opened aspect",
      "turnoutOpenedAspect"
    );

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        {i18next.t("ui.turnoutPositions")}
      </Text>

      <Group justify="space-between" align="flex-end" wrap="nowrap">
        <Box className="route-turnout-preview-button">
          <ElementPreview
            element={
              createTurnoutPreview(
                selectedElement,
                true
              )
            }
            label={i18next.t("ui.closed")}
            width={46}
            height={46}
            onClick={() =>
              sendSingleTurnoutState(
                selectedElement,
                true
              )
            }
          />
        </Box>

        <NumberInput
          label={i18next.t("ui.closedAspect")}
          min={0}
          max={255}
          allowDecimal={false}
          allowNegative={false}
          value={
            getTurnoutClosedAspect(
              selectedElement
            )
          }
          onChange={value =>
            onChange(
              closedProperty,
              value
            )
          }
          w={130}
        />
      </Group>

      <Group justify="space-between" align="flex-end" wrap="nowrap">
        <Box className="route-turnout-preview-button">
          <ElementPreview
            element={
              createTurnoutPreview(
                selectedElement,
                false
              )
            }
            label={i18next.t("ui.opened")}
            width={46}
            height={46}
            onClick={() =>
              sendSingleTurnoutState(
                selectedElement,
                false
              )
            }
          />
        </Box>

        <NumberInput
          label={i18next.t("ui.openedAspect")}
          min={0}
          max={255}
          allowDecimal={false}
          allowNegative={false}
          value={
            getTurnoutOpenedAspect(
              selectedElement
            )
          }
          onChange={value =>
            onChange(
              openedProperty,
              value
            )
          }
          w={130}
        />
      </Group>
    </Stack>
  );
}

function renderSingleBasicEditor(
  selectedElement: SingleTurnoutElement,
  prop: IEditableProperty,
  propValue: boolean,
  onChange: PropertyChangeHandler
) {
  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        {prop.label}
      </Text>

      <Group justify="space-between" align="center" wrap="nowrap">
        <Box className="route-turnout-preview-button">
          <ElementPreview
            element={
              createTurnoutPreview(
                selectedElement,
                true
              )
            }
            label={i18next.t("ui.closed")}
            width={46}
            height={46}
            onClick={() =>
              sendSingleTurnoutState(
                selectedElement,
                true
              )
            }
          />
        </Box>

        <BitToggleElement
          value={propValue}
          onChange={value => {
            onChange(prop, value);
          }}
          onValueClick={value => {
            sendSingleTurnoutState(
              selectedElement,
              true,
              value
            );
          }}
        />
      </Group>

      <Group justify="space-between" align="center" wrap="nowrap">
        <Box className="route-turnout-preview-button">
          <ElementPreview
            element={
              createTurnoutPreview(
                selectedElement,
                false
              )
            }
            label={i18next.t("ui.opened")}
            width={46}
            height={46}
            onClick={() =>
              sendSingleTurnoutState(
                selectedElement,
                false
              )
            }
          />
        </Box>

        <BitToggleElement
          value={!propValue}
          onChange={value => {
            onChange(prop, !value);
          }}
          onValueClick={value => {
            sendSingleTurnoutState(
              selectedElement,
              false,
              !value
            );
          }}
        />
      </Group>
    </Stack>
  );
}

function threeWayStateProperty(
  label: string,
  key:
    | "leftMotor1Value"
    | "leftMotor2Value"
    | "straightMotor1Value"
    | "straightMotor2Value"
    | "rightMotor1Value"
    | "rightMotor2Value"
): IEditableProperty {
  return {
    label,
    key,
    type: "bittoggle",
    readonly: false,
    validate: () => true,
  };
}

function threeWayPositionValues(
  selectedElement: TrackTurnoutThreeWayElement,
  position: ThreeWayTurnoutPosition
): {
  first: boolean;
  second: boolean;
  firstProperty: IEditableProperty;
  secondProperty: IEditableProperty;
} {
  switch (position.id) {
    case "left":
      return {
        first:
          selectedElement.leftMotor1Value,
        second:
          selectedElement.leftMotor2Value,
        firstProperty:
          threeWayStateProperty(
            "Left motor 1",
            "leftMotor1Value"
          ),
        secondProperty:
          threeWayStateProperty(
            "Left motor 2",
            "leftMotor2Value"
          ),
      };

    case "right":
      return {
        first:
          selectedElement.rightMotor1Value,
        second:
          selectedElement.rightMotor2Value,
        firstProperty:
          threeWayStateProperty(
            "Right motor 1",
            "rightMotor1Value"
          ),
        secondProperty:
          threeWayStateProperty(
            "Right motor 2",
            "rightMotor2Value"
          ),
      };

    case "straight":
    default:
      return {
        first:
          selectedElement.straightMotor1Value,
        second:
          selectedElement.straightMotor2Value,
        firstProperty:
          threeWayStateProperty(
            "Straight motor 1",
            "straightMotor1Value"
          ),
        secondProperty:
          threeWayStateProperty(
            "Straight motor 2",
            "straightMotor2Value"
          ),
      };
  }
}

function sendConfiguredThreeWayValues(
  element: TrackTurnoutThreeWayElement,
  first: boolean,
  second: boolean
): void {
  sendTurnoutOutput(
    String(element.outputMode),
    element.turnout1Address,
    first,
    {
      closedValue:
        element.turnout1ClosedValue,
    }
  );

  sendTurnoutOutput(
    String(element.outputMode),
    element.turnout2Address,
    second,
    {
      closedValue:
        element.turnout2ClosedValue,
    }
  );
}

function sendThreeWayTurnoutBitClick(
  element: TrackTurnoutThreeWayElement,
  position: ThreeWayTurnoutPosition,
  motor: 1 | 2,
  clickedValue: boolean
): void {
  const current =
    threeWayPositionValues(
      element,
      position
    );

  const first =
    motor === 1
      ? clickedValue
      : current.first;

  const second =
    motor === 2
      ? clickedValue
      : current.second;

  sendConfiguredThreeWayValues(
    element,
    first,
    second
  );
}

function sendConfiguredThreeWayPosition(
  element: TrackTurnoutThreeWayElement,
  position: ThreeWayTurnoutPosition
): void {
  const values =
    threeWayPositionValues(
      element,
      position
    );

  sendConfiguredThreeWayValues(
    element,
    values.first,
    values.second
  );
}

function renderThreeWayBasicEditor(
  selectedElement: TrackTurnoutThreeWayElement,
  onChange: PropertyChangeHandler
) {
  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        {i18next.t("ui.threeWayTurnoutPositions")}
      </Text>

      <Text size="xs" c="dimmed">
        {i18next.t("ui.eachPositionStoresItsOwnTwoPhysicalOutputBitsChanging")}
      </Text>

      {THREE_WAY_TURNOUT_POSITIONS.map(
        position => {
          const values =
            threeWayPositionValues(
              selectedElement,
              position
            );

          return (
            <Group
              key={position.id}
              justify="space-between"
              align="center"
              wrap="nowrap"
            >
              <Box className="route-turnout-preview-button">
                <ElementPreview
                  element={
                    createThreeWayTurnoutPreview(
                      selectedElement,
                      position.firstClosed,
                      position.secondClosed
                    )
                  }
                  label={position.label}
                  width={54}
                  height={54}
                  onClick={() =>
                    sendConfiguredThreeWayPosition(
                      selectedElement,
                      position
                    )
                  }
                />
              </Box>

              <Group gap="xs" wrap="nowrap">
                <BitToggleElement
                  value={values.first}
                  onChange={value => {
                    onChange(
                      values.firstProperty,
                      value
                    );
                  }}
                  onValueClick={value => {
                    sendThreeWayTurnoutBitClick(
                      selectedElement,
                      position,
                      1,
                      value
                    );
                  }}
                />

                <BitToggleElement
                  value={values.second}
                  onChange={value => {
                    onChange(
                      values.secondProperty,
                      value
                    );
                  }}
                  onValueClick={value => {
                    sendThreeWayTurnoutBitClick(
                      selectedElement,
                      position,
                      2,
                      value
                    );
                  }}
                />
              </Group>
            </Group>
          );
        }
      )}
    </Stack>
  );
}

function renderDoubleExtendedEditor(
  selectedElement: TrackTurnoutDoubleElement,
  onChange: PropertyChangeHandler
) {
  const t1Closed =
    numberProperty(
      "Turnout 1 closed aspect",
      "turnout1ClosedAspect"
    );

  const t1Opened =
    numberProperty(
      "Turnout 1 opened aspect",
      "turnout1OpenedAspect"
    );

  const t2Closed =
    numberProperty(
      "Turnout 2 closed aspect",
      "turnout2ClosedAspect"
    );

  const t2Opened =
    numberProperty(
      "Turnout 2 opened aspect",
      "turnout2OpenedAspect"
    );

  return (
    <Stack gap="sm">
      <Text size="sm" fw={500}>
        {i18next.t("ui.extendedAccessoryAspects")}
      </Text>

      <SimpleGrid cols={2}>
        <NumberInput
          label={i18next.t("ui.turnout1Closed")}
          min={0}
          max={255}
          allowDecimal={false}
          allowNegative={false}
          value={
            getDoubleTurnoutAspect(
              selectedElement,
              1,
              true
            )
          }
          onChange={value =>
            onChange(t1Closed, value)
          }
        />

        <NumberInput
          label={i18next.t("ui.turnout1Opened")}
          min={0}
          max={255}
          allowDecimal={false}
          allowNegative={false}
          value={
            getDoubleTurnoutAspect(
              selectedElement,
              1,
              false
            )
          }
          onChange={value =>
            onChange(t1Opened, value)
          }
        />

        <NumberInput
          label={i18next.t("ui.turnout2Closed")}
          min={0}
          max={255}
          allowDecimal={false}
          allowNegative={false}
          value={
            getDoubleTurnoutAspect(
              selectedElement,
              2,
              true
            )
          }
          onChange={value =>
            onChange(t2Closed, value)
          }
        />

        <NumberInput
          label={i18next.t("ui.turnout2Opened")}
          min={0}
          max={255}
          allowDecimal={false}
          allowNegative={false}
          value={
            getDoubleTurnoutAspect(
              selectedElement,
              2,
              false
            )
          }
          onChange={value =>
            onChange(t2Opened, value)
          }
        />
      </SimpleGrid>

      <Text size="xs" c="dimmed">
        {i18next.t("ui.testPositions")}
      </Text>

      <Group gap="xs">
        {DOUBLE_TURNOUT_POSITIONS.map(
          position => (
            <Box
              key={position.id}
              className="route-turnout-preview-button"
            >
              <ElementPreview
                element={
                  createDoubleTurnoutPreview(
                    selectedElement,
                    position.firstClosed,
                    position.secondClosed
                  )
                }
                label={position.label}
                width={42}
                height={42}
                onClick={() =>
                  sendDoubleTurnoutPosition(
                    selectedElement,
                    position
                  )
                }
              />
            </Box>
          )
        )}
      </Group>
    </Stack>
  );
}

function renderDoubleBasicEditor(
  selectedElement: TrackTurnoutDoubleElement,
  onChange: PropertyChangeHandler
) {
  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        {i18next.t("ui.doubleTurnoutPositions")}
      </Text>

      <Text size="xs" c="dimmed">
        {i18next.t("ui.eachPreviewRowStoresItsOwnTwoPhysicalOutputBits")}
      </Text>

      {DOUBLE_TURNOUT_POSITIONS.map(
        position => {
          const values =
            doublePositionValues(
              selectedElement,
              position
            );

          return (
            <Group
              key={position.id}
              justify="space-between"
              align="center"
              wrap="nowrap"
            >
              <Box className="route-turnout-preview-button">
                <ElementPreview
                  element={
                    createDoubleTurnoutPreview(
                      selectedElement,
                      position.firstClosed,
                      position.secondClosed
                    )
                  }
                  label={position.label}
                  width={46}
                  height={46}
                  onClick={() =>
                    sendDoubleTurnoutPosition(
                      selectedElement,
                      position
                    )
                  }
                />
              </Box>

              <Group gap="xs" wrap="nowrap">
                <BitToggleElement
                  value={values.first}
                  onChange={value => {
                    onChange(
                      values.firstProperty,
                      value
                    );
                  }}
                  onValueClick={value => {
                    sendDoubleTurnoutBitClick(
                      selectedElement,
                      position,
                      1,
                      value
                    );
                  }}
                />

                <BitToggleElement
                  value={values.second}
                  onChange={value => {
                    onChange(
                      values.secondProperty,
                      value
                    );
                  }}
                  onValueClick={value => {
                    sendDoubleTurnoutBitClick(
                      selectedElement,
                      position,
                      2,
                      value
                    );
                  }}
                />
              </Group>
            </Group>
          );
        }
      )}
    </Stack>
  );
}

export default function TurnoutBitPropertyEditor({
  prop,
  selectedElement,
  onChange,
}: TurnoutBitPropertyEditorProps) {
  if (
    selectedElement instanceof
    ButtonElement
  ) {
    return renderButtonOutputEditor(
      selectedElement,
      onChange
    );
  }

  const values =
    selectedElement as unknown as
      Record<string, unknown>;

  const propValue =
    Boolean(values[prop.key]);

  const mode =
    normalizeTurnoutOutputMode(
      (selectedElement as any)
        .outputMode
    );

  if (
    isThreeWayTurnoutElement(
      selectedElement
    ) &&
    isMultiTurnoutClosedValueProperty(
      prop
    )
  ) {
    if (
      prop.key !==
      "turnout1ClosedValue"
    ) {
      return null;
    }

    return renderThreeWayBasicEditor(
      selectedElement,
      onChange
    );
  }

  if (
    isDoubleTurnoutElement(
      selectedElement
    ) &&
    isMultiTurnoutClosedValueProperty(
      prop
    )
  ) {
    if (
      prop.key !==
      "turnout1ClosedValue"
    ) {
      return null;
    }

    return mode === "extended"
      ? renderDoubleExtendedEditor(
          selectedElement,
          onChange
        )
      : renderDoubleBasicEditor(
          selectedElement,
          onChange
        );
  }

  if (
    !isSingleTurnoutElement(
      selectedElement
    )
  ) {
    return (
      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
      >
        <Text size="sm" fw={500}>
          {prop.label}
        </Text>

        <BitToggleElement
          value={propValue}
          onChange={value =>
            onChange(prop, value)
          }
        />
      </Group>
    );
  }

  return mode === "extended"
    ? renderSingleExtendedEditor(
        selectedElement,
        onChange
      )
    : renderSingleBasicEditor(
        selectedElement,
        prop,
        propValue,
        onChange
      );
}
