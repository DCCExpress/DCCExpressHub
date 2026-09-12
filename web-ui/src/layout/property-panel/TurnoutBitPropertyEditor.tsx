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
  BaseElementView,
} from "../../models/editor/core/BaseElementView";
import {
  ButtonElementView,
} from "../../models/editor/elements/ButtonElementView";
import type {
  IEditableProperty,
} from "../../models/editor/elements/PropertyDescriptor";
import TrackTurnoutDoubleElementView from "../../models/editor/elements/TrackTurnoutDoubleElementView";
import {
  TrackTurnoutLeftElementView,
} from "../../models/editor/elements/TrackTurnoutLeftElementView";
import {
  TrackTurnoutRightElementView,
} from "../../models/editor/elements/TrackTurnoutRightElementView";
import {
  TrackTurnoutTwoWayElementView,
} from "../../models/editor/elements/TrackTurnoutTwoWayElementView";
import {
  TrackTurnoutThreeWayElementView,
} from "../../models/editor/elements/TrackTurnoutThreeWayElementView";
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
  selectedElement: BaseElementView;
  onChange: PropertyChangeHandler;
};

type SingleTurnoutElement =
  | TrackTurnoutLeftElementView
  | TrackTurnoutRightElementView
  | TrackTurnoutTwoWayElementView;

type MultiTurnoutPosition = {
  label: string;
  firstClosed: boolean;
  secondClosed: boolean;
};

const DOUBLE_TURNOUT_POSITIONS: MultiTurnoutPosition[] = [
  {
    label: "O-O",
    firstClosed: false,
    secondClosed: false,
  },
  {
    label: "O-C",
    firstClosed: false,
    secondClosed: true,
  },
  {
    label: "C-O",
    firstClosed: true,
    secondClosed: false,
  },
  {
    label: "C-C",
    firstClosed: true,
    secondClosed: true,
  },
];

const THREE_WAY_TURNOUT_POSITIONS: MultiTurnoutPosition[] = [
  {
    label: "Left",
    firstClosed: true,
    secondClosed: false,
  },
  {
    label: "Straight",
    firstClosed: false,
    secondClosed: false,
  },
  {
    label: "Right",
    firstClosed: false,
    secondClosed: true,
  },
];

function isSingleTurnoutElement(
  element: BaseElementView
): element is SingleTurnoutElement {
  return (
    element instanceof
      TrackTurnoutLeftElementView ||
    element instanceof
      TrackTurnoutRightElementView ||
    element instanceof
      TrackTurnoutTwoWayElementView
  );
}

function isDoubleTurnoutElement(
  element: BaseElementView
): element is TrackTurnoutDoubleElementView {
  return (
    element instanceof
    TrackTurnoutDoubleElementView
  );
}

function isThreeWayTurnoutElement(
  element: BaseElementView
): element is TrackTurnoutThreeWayElementView {
  return (
    element instanceof
    TrackTurnoutThreeWayElementView
  );
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

function closedValueProperty(
  label: string,
  key:
    | "turnout1ClosedValue"
    | "turnout2ClosedValue"
): IEditableProperty {
  return {
    label,
    key,
    type: "bittoggle",
    readonly: false,
    validate: () => true,
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
      <IconPlayerPlayFilled
        size={17}
      />
    </ActionIcon>
  );
}

function renderButtonBasicEditor(
  selectedElement: ButtonElementView,
  onChange: PropertyChangeHandler
) {
  const onValueProperty:
    IEditableProperty = {
      label: "ON value",
      key: "activeValue",
      type: "bittoggle",
      readonly: false,
    };

  const offValueProperty:
    IEditableProperty = {
      label: "OFF value",
      key: "offValue",
      type: "bittoggle",
      readonly: false,
    };

  return (
    <Stack gap="xs">
      <Text
        size="sm"
        fw={500}
      >
        Basic accessory values
      </Text>

      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
      >
        <Text
          size="sm"
          fw={600}
          w={44}
        >
          ON
        </Text>

        <Group
          gap="xs"
          wrap="nowrap"
        >
          <BitToggleElement
            value={
              selectedElement.activeValue
            }
            onChange={value => {
              onChange(
                onValueProperty,
                value
              );

              if (
                selectedElement.offValue ===
                value
              ) {
                onChange(
                  offValueProperty,
                  !value
                );
              }
            }}
          />

          <TestButton
            title="Test ON"
            onClick={() =>
              selectedElement.sendConfiguredState(
                true
              )
            }
          />
        </Group>
      </Group>

      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
      >
        <Text
          size="sm"
          fw={600}
          w={44}
        >
          OFF
        </Text>

        <Group
          gap="xs"
          wrap="nowrap"
        >
          <BitToggleElement
            value={
              selectedElement.offValue
            }
            onChange={value => {
              onChange(
                offValueProperty,
                value
              );

              if (
                selectedElement.activeValue ===
                value
              ) {
                onChange(
                  onValueProperty,
                  !value
                );
              }
            }}
          />

          <TestButton
            title="Test OFF"
            onClick={() =>
              selectedElement.sendConfiguredState(
                false
              )
            }
          />
        </Group>
      </Group>
    </Stack>
  );
}

function renderButtonExtendedEditor(
  selectedElement: ButtonElementView,
  onChange: PropertyChangeHandler
) {
  const onAspectProperty =
    numberProperty(
      "ON aspect",
      "onAspect"
    );

  const offAspectProperty =
    numberProperty(
      "OFF aspect",
      "offAspect"
    );

  return (
    <Stack gap="xs">
      <Text
        size="sm"
        fw={500}
      >
        Extended accessory aspects
      </Text>

      <Group
        justify="space-between"
        align="flex-end"
        wrap="nowrap"
      >
        <Text
          size="sm"
          fw={600}
          w={44}
          pb={9}
        >
          ON
        </Text>

        <Group
          gap="xs"
          align="flex-end"
          wrap="nowrap"
        >
          <NumberInput
            aria-label="ON aspect"
            min={0}
            max={255}
            allowDecimal={false}
            allowNegative={false}
            value={
              selectedElement.onAspect
            }
            onChange={value =>
              onChange(
                onAspectProperty,
                value
              )
            }
            w={110}
          />

          <TestButton
            title="Test ON aspect"
            onClick={() =>
              selectedElement.sendConfiguredState(
                true
              )
            }
          />
        </Group>
      </Group>

      <Group
        justify="space-between"
        align="flex-end"
        wrap="nowrap"
      >
        <Text
          size="sm"
          fw={600}
          w={44}
          pb={9}
        >
          OFF
        </Text>

        <Group
          gap="xs"
          align="flex-end"
          wrap="nowrap"
        >
          <NumberInput
            aria-label="OFF aspect"
            min={0}
            max={255}
            allowDecimal={false}
            allowNegative={false}
            value={
              selectedElement.offAspect
            }
            onChange={value =>
              onChange(
                offAspectProperty,
                value
              )
            }
            w={110}
          />

          <TestButton
            title="Test OFF aspect"
            onClick={() =>
              selectedElement.sendConfiguredState(
                false
              )
            }
          />
        </Group>
      </Group>
    </Stack>
  );
}

function renderButtonOutputEditor(
  selectedElement: ButtonElementView,
  onChange: PropertyChangeHandler
) {
  return (
    selectedElement.outputMode ===
      "extended"
      ? renderButtonExtendedEditor(
          selectedElement,
          onChange
        )
      : renderButtonBasicEditor(
          selectedElement,
          onChange
        )
  );
}

function sendSingleTurnoutState(
  element: SingleTurnoutElement,
  logicalClosed: boolean
): void {
  sendTurnoutOutput(
    String(
      (element as any).outputMode
    ),
    element.turnoutAddress,
    getPhysicalValueForLogicalState(
      element.turnoutClosedValue,
      logicalClosed
    ),
    {
      closedValue:
        element.turnoutClosedValue,
      closedAspect:
        getTurnoutClosedAspect(
          element
        ),
      openedAspect:
        getTurnoutOpenedAspect(
          element
        ),
    }
  );
}

function sendDoubleTurnoutPosition(
  element:
    TrackTurnoutDoubleElementView,
  position: MultiTurnoutPosition
): void {
  sendTurnoutOutput(
    String(
      (element as any).outputMode
    ),
    element.turnout1Address,
    getPhysicalValueForLogicalState(
      element.turnout1ClosedValue,
      position.firstClosed
    ),
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
    String(
      (element as any).outputMode
    ),
    element.turnout2Address,
    getPhysicalValueForLogicalState(
      element.turnout2ClosedValue,
      position.secondClosed
    ),
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

function sendThreeWayTurnoutPosition(
  element:
    TrackTurnoutThreeWayElementView,
  position: MultiTurnoutPosition
): void {
  const firstPhysical =
    getPhysicalValueForLogicalState(
      element.turnout1ClosedValue,
      position.firstClosed
    );

  const secondPhysical =
    getPhysicalValueForLogicalState(
      element.turnout2ClosedValue,
      position.secondClosed
    );

  element.turnout1Closed =
    firstPhysical;

  element.turnout2Closed =
    secondPhysical;

  sendTurnoutOutput(
    String(element.outputMode),
    element.turnout1Address,
    firstPhysical,
    {
      closedValue:
        element.turnout1ClosedValue,
    }
  );

  sendTurnoutOutput(
    String(element.outputMode),
    element.turnout2Address,
    secondPhysical,
    {
      closedValue:
        element.turnout2ClosedValue,
    }
  );
}

function renderSingleExtendedEditor(
  selectedElement:
    SingleTurnoutElement,
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
      <Text
        size="sm"
        fw={500}
      >
        Turnout positions
      </Text>

      <Group
        justify="space-between"
        align="flex-end"
        wrap="nowrap"
      >
        <Box className="route-turnout-preview-button">
          <ElementPreview
            element={
              createTurnoutPreview(
                selectedElement,
                true
              )
            }
            label="Closed"
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
          label="Closed aspect"
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

      <Group
        justify="space-between"
        align="flex-end"
        wrap="nowrap"
      >
        <Box className="route-turnout-preview-button">
          <ElementPreview
            element={
              createTurnoutPreview(
                selectedElement,
                false
              )
            }
            label="Opened"
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
          label="Opened aspect"
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
  selectedElement:
    SingleTurnoutElement,
  prop: IEditableProperty,
  propValue: boolean,
  onChange: PropertyChangeHandler
) {
  return (
    <Stack gap="xs">
      <Text
        size="sm"
        fw={500}
      >
        {prop.label}
      </Text>

      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
      >
        <Box className="route-turnout-preview-button">
          <ElementPreview
            element={
              createTurnoutPreview(
                selectedElement,
                true
              )
            }
            label="Closed"
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
          onChange={value =>
            onChange(
              prop,
              value
            )
          }
        />
      </Group>

      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
      >
        <Box className="route-turnout-preview-button">
          <ElementPreview
            element={
              createTurnoutPreview(
                selectedElement,
                false
              )
            }
            label="Opened"
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
          onChange={value =>
            onChange(
              prop,
              !value
            )
          }
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
  selectedElement:
    TrackTurnoutThreeWayElementView,
  position: MultiTurnoutPosition
): {
  first: boolean;
  second: boolean;
  firstProperty: IEditableProperty;
  secondProperty: IEditableProperty;
} {
  if (position.label === "Left") {
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
  }

  if (position.label === "Right") {
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
  }

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

function sendConfiguredThreeWayPosition(
  element:
    TrackTurnoutThreeWayElementView,
  position: MultiTurnoutPosition
): void {
  const values =
    threeWayPositionValues(
      element,
      position
    );

  element.turnout1Closed =
    values.first;

  element.turnout2Closed =
    values.second;

  sendTurnoutOutput(
    String(element.outputMode),
    element.turnout1Address,
    values.first,
    {
      closedValue:
        element.turnout1ClosedValue,
    }
  );

  sendTurnoutOutput(
    String(element.outputMode),
    element.turnout2Address,
    values.second,
    {
      closedValue:
        element.turnout2ClosedValue,
    }
  );
}

function renderThreeWayBasicEditor(
  selectedElement:
    TrackTurnoutThreeWayElementView,
  onChange: PropertyChangeHandler
) {
  return (
    <Stack gap="xs">
      <Text
        size="sm"
        fw={500}
      >
        Three-way turnout positions
      </Text>

      <Text
        size="xs"
        c="dimmed"
      >
        Each position stores its own two
        physical output bits. Changing one
        row never changes another row.
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
              key={position.label}
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
                  label={
                    position.label
                  }
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

              <Group
                gap="xs"
                wrap="nowrap"
              >
                <BitToggleElement
                  value={
                    values.first
                  }
                  onChange={value =>
                    onChange(
                      values.firstProperty,
                      value
                    )
                  }
                />

                <BitToggleElement
                  value={
                    values.second
                  }
                  onChange={value =>
                    onChange(
                      values.secondProperty,
                      value
                    )
                  }
                />
              </Group>
            </Group>
          );
        }
      )}
    </Stack>
  );
}

function renderDoubleBasicEditor(
  selectedElement:
    TrackTurnoutDoubleElementView,
  onChange: PropertyChangeHandler
) {
  const firstClosedValueProperty =
    closedValueProperty(
      "Turnout 1 Closed Value",
      "turnout1ClosedValue"
    );

  const secondClosedValueProperty =
    closedValueProperty(
      "Turnout 2 Closed Value",
      "turnout2ClosedValue"
    );

  return (
    <Stack gap="xs">
      <Text
        size="sm"
        fw={500}
      >
        Double turnout positions
      </Text>

      {DOUBLE_TURNOUT_POSITIONS.map(
        position => {
          const firstPhysicalValue =
            getPhysicalValueForLogicalState(
              selectedElement
                .turnout1ClosedValue,
              position.firstClosed
            );

          const secondPhysicalValue =
            getPhysicalValueForLogicalState(
              selectedElement
                .turnout2ClosedValue,
              position.secondClosed
            );

          return (
            <Group
              key={position.label}
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
                  label={
                    position.label
                  }
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

              <Group
                gap="xs"
                wrap="nowrap"
              >
                <BitToggleElement
                  value={
                    firstPhysicalValue
                  }
                  onChange={value =>
                    onChange(
                      firstClosedValueProperty,
                      position.firstClosed
                        ? value
                        : !value
                    )
                  }
                />

                <BitToggleElement
                  value={
                    secondPhysicalValue
                  }
                  onChange={value =>
                    onChange(
                      secondClosedValueProperty,
                      position.secondClosed
                        ? value
                        : !value
                    )
                  }
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
  selectedElement:
    TrackTurnoutDoubleElementView,
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
      <Text
        size="sm"
        fw={500}
      >
        Extended accessory aspects
      </Text>

      <SimpleGrid cols={2}>
        <NumberInput
          label="Turnout 1 closed"
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
            onChange(
              t1Closed,
              value
            )
          }
        />

        <NumberInput
          label="Turnout 1 opened"
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
            onChange(
              t1Opened,
              value
            )
          }
        />

        <NumberInput
          label="Turnout 2 closed"
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
            onChange(
              t2Closed,
              value
            )
          }
        />

        <NumberInput
          label="Turnout 2 opened"
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
            onChange(
              t2Opened,
              value
            )
          }
        />
      </SimpleGrid>

      <Text
        size="xs"
        c="dimmed"
      >
        Test positions
      </Text>

      <Group gap="xs">
        {DOUBLE_TURNOUT_POSITIONS.map(
          position => (
            <Box
              key={position.label}
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
                label={
                  position.label
                }
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

export default function TurnoutBitPropertyEditor({
  prop,
  selectedElement,
  onChange,
}: TurnoutBitPropertyEditorProps) {
  if (
    selectedElement instanceof
    ButtonElementView
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
    Boolean(
      values[prop.key]
    );

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

    return mode ===
      "extended"
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
        <Text
          size="sm"
          fw={500}
        >
          {prop.label}
        </Text>

        <BitToggleElement
          value={propValue}
          onChange={value =>
            onChange(
              prop,
              value
            )
          }
        />
      </Group>
    );
  }

  return mode ===
    "extended"
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
