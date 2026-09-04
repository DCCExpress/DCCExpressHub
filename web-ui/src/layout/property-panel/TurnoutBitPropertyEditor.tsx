import {
  Box,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";

import BitToggleElement from "../../components/editor/BitToggleElement";
import type { BaseElementView } from "../../models/editor/core/BaseElementView";
import type { IEditableProperty } from "../../models/editor/elements/PropertyDescriptor";
import TrackTurnoutDoubleElementView from "../../models/editor/elements/TrackTurnoutDoubleElementView";
import { TrackTurnoutLeftElementView } from "../../models/editor/elements/TrackTurnoutLeftElementView";
import { TrackTurnoutRightElementView } from "../../models/editor/elements/TrackTurnoutRightElementView";
import {
  getDoubleTurnoutAspect,
  getTurnoutClosedAspect,
  getTurnoutOpenedAspect,
  normalizeTurnoutOutputMode,
} from "../../models/editor/turnout/turnoutAccessoryHelpers";
import ElementPreview from "../../models/editor/rendering/ElementPreviewRenderer";
import { sendTurnoutOutput } from "../../services/layoutOutput";
import {
  createDoubleTurnoutPreview,
  createTurnoutPreview,
} from "./previewFactories";
import type { PropertyChangeHandler } from "./propertyPanelTypes";

type TurnoutBitPropertyEditorProps = {
  prop: IEditableProperty;
  selectedElement: BaseElementView;
  onChange: PropertyChangeHandler;
};

type DoubleTurnoutPosition = {
  label: string;
  firstClosed: boolean;
  secondClosed: boolean;
};

const DOUBLE_TURNOUT_POSITIONS: DoubleTurnoutPosition[] = [
  { label: "O-O", firstClosed: false, secondClosed: false },
  { label: "O-C", firstClosed: false, secondClosed: true },
  { label: "C-O", firstClosed: true, secondClosed: false },
  { label: "C-C", firstClosed: true, secondClosed: true },
];

function isTurnoutElement(
  element: BaseElementView
): element is
  | TrackTurnoutLeftElementView
  | TrackTurnoutRightElementView {
  return (
    element instanceof TrackTurnoutLeftElementView ||
    element instanceof TrackTurnoutRightElementView
  );
}

function isDoubleTurnoutElement(
  element: BaseElementView
): element is TrackTurnoutDoubleElementView {
  return element instanceof TrackTurnoutDoubleElementView;
}

function isDoubleTurnoutClosedValueProperty(
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
  return logicalClosed ? closedValue : !closedValue;
}

function getClosedValueFromPhysicalValue(
  physicalValue: boolean,
  logicalClosed: boolean
): boolean {
  return logicalClosed ? physicalValue : !physicalValue;
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

function sendSingleTurnoutState(
  element:
    | TrackTurnoutLeftElementView
    | TrackTurnoutRightElementView,
  logicalClosed: boolean
): void {
  sendTurnoutOutput(
    String((element as any).outputMode),
    element.turnoutAddress,
    getPhysicalValueForLogicalState(
      element.turnoutClosedValue,
      logicalClosed
    ),
    {
      closedValue: element.turnoutClosedValue,
      closedAspect: getTurnoutClosedAspect(element),
      openedAspect: getTurnoutOpenedAspect(element),
    }
  );
}

function sendDoubleTurnoutPosition(
  element: TrackTurnoutDoubleElementView,
  position: DoubleTurnoutPosition
): void {
  sendTurnoutOutput(
    String((element as any).outputMode),
    element.turnout1Address,
    getPhysicalValueForLogicalState(
      element.turnout1ClosedValue,
      position.firstClosed
    ),
    {
      closedValue: element.turnout1ClosedValue,
      closedAspect: getDoubleTurnoutAspect(element, 1, true),
      openedAspect: getDoubleTurnoutAspect(element, 1, false),
    }
  );

  sendTurnoutOutput(
    String((element as any).outputMode),
    element.turnout2Address,
    getPhysicalValueForLogicalState(
      element.turnout2ClosedValue,
      position.secondClosed
    ),
    {
      closedValue: element.turnout2ClosedValue,
      closedAspect: getDoubleTurnoutAspect(element, 2, true),
      openedAspect: getDoubleTurnoutAspect(element, 2, false),
    }
  );
}

function createClosedValueProperty(
  label: string,
  key: "turnout1ClosedValue" | "turnout2ClosedValue"
): IEditableProperty {
  return {
    label,
    key,
    type: "bittoggle",
    readonly: false,
    validate: () => true,
  };
}

function renderSingleExtendedEditor(
  selectedElement:
    | TrackTurnoutLeftElementView
    | TrackTurnoutRightElementView,
  onChange: PropertyChangeHandler
) {
  const closedProperty =
    numberProperty("Closed aspect", "turnoutClosedAspect");
  const openedProperty =
    numberProperty("Opened aspect", "turnoutOpenedAspect");

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>Extended accessory aspects</Text>

      <Group justify="space-between" align="flex-end" wrap="nowrap">
        <Box className="route-turnout-preview-button">
          <ElementPreview
            element={createTurnoutPreview(selectedElement, true)}
            label="Closed"
            width={40}
            height={40}
            onClick={() =>
              sendSingleTurnoutState(selectedElement, true)
            }
          />
        </Box>

        <NumberInput
          label="Closed aspect"
          min={0}
          max={255}
          allowDecimal={false}
          allowNegative={false}
          value={getTurnoutClosedAspect(selectedElement)}
          onChange={value => onChange(closedProperty, value)}
          w={130}
        />
      </Group>

      <Group justify="space-between" align="flex-end" wrap="nowrap">
        <Box className="route-turnout-preview-button">
          <ElementPreview
            element={createTurnoutPreview(selectedElement, false)}
            label="Opened"
            width={40}
            height={40}
            onClick={() =>
              sendSingleTurnoutState(selectedElement, false)
            }
          />
        </Box>

        <NumberInput
          label="Opened aspect"
          min={0}
          max={255}
          allowDecimal={false}
          allowNegative={false}
          value={getTurnoutOpenedAspect(selectedElement)}
          onChange={value => onChange(openedProperty, value)}
          w={130}
        />
      </Group>
    </Stack>
  );
}

function renderDoubleExtendedEditor(
  selectedElement: TrackTurnoutDoubleElementView,
  onChange: PropertyChangeHandler
) {
  const t1Closed =
    numberProperty("Turnout 1 closed aspect", "turnout1ClosedAspect");
  const t1Opened =
    numberProperty("Turnout 1 opened aspect", "turnout1OpenedAspect");
  const t2Closed =
    numberProperty("Turnout 2 closed aspect", "turnout2ClosedAspect");
  const t2Opened =
    numberProperty("Turnout 2 opened aspect", "turnout2OpenedAspect");

  return (
    <Stack gap="sm">
      <Text size="sm" fw={500}>Extended accessory aspects</Text>

      <SimpleGrid cols={2}>
        <NumberInput
          label="Turnout 1 closed"
          min={0}
          max={255}
          allowDecimal={false}
          allowNegative={false}
          value={getDoubleTurnoutAspect(selectedElement, 1, true)}
          onChange={value => onChange(t1Closed, value)}
        />
        <NumberInput
          label="Turnout 1 opened"
          min={0}
          max={255}
          allowDecimal={false}
          allowNegative={false}
          value={getDoubleTurnoutAspect(selectedElement, 1, false)}
          onChange={value => onChange(t1Opened, value)}
        />
        <NumberInput
          label="Turnout 2 closed"
          min={0}
          max={255}
          allowDecimal={false}
          allowNegative={false}
          value={getDoubleTurnoutAspect(selectedElement, 2, true)}
          onChange={value => onChange(t2Closed, value)}
        />
        <NumberInput
          label="Turnout 2 opened"
          min={0}
          max={255}
          allowDecimal={false}
          allowNegative={false}
          value={getDoubleTurnoutAspect(selectedElement, 2, false)}
          onChange={value => onChange(t2Opened, value)}
        />
      </SimpleGrid>

      <Text size="xs" c="dimmed">
        Test positions
      </Text>

      <Group gap="xs">
        {DOUBLE_TURNOUT_POSITIONS.map(position => (
          <Box
            key={position.label}
            className="route-turnout-preview-button"
          >
            <ElementPreview
              element={createDoubleTurnoutPreview(
                selectedElement,
                position.firstClosed,
                position.secondClosed
              )}
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
        ))}
      </Group>
    </Stack>
  );
}

function renderDoubleBasicEditor(
  selectedElement: TrackTurnoutDoubleElementView,
  onChange: PropertyChangeHandler
) {
  const firstClosedValueProperty = createClosedValueProperty(
    "Turnout 1 Closed Value",
    "turnout1ClosedValue"
  );
  const secondClosedValueProperty = createClosedValueProperty(
    "Turnout 2 Closed Value",
    "turnout2ClosedValue"
  );

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>Double turnout positions</Text>

      {DOUBLE_TURNOUT_POSITIONS.map(position => {
        const firstPhysicalValue =
          getPhysicalValueForLogicalState(
            selectedElement.turnout1ClosedValue,
            position.firstClosed
          );

        const secondPhysicalValue =
          getPhysicalValueForLogicalState(
            selectedElement.turnout2ClosedValue,
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
                element={createDoubleTurnoutPreview(
                  selectedElement,
                  position.firstClosed,
                  position.secondClosed
                )}
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
                value={firstPhysicalValue}
                onChange={value =>
                  onChange(
                    firstClosedValueProperty,
                    getClosedValueFromPhysicalValue(
                      value,
                      position.firstClosed
                    )
                  )
                }
              />
              <BitToggleElement
                value={secondPhysicalValue}
                onChange={value =>
                  onChange(
                    secondClosedValueProperty,
                    getClosedValueFromPhysicalValue(
                      value,
                      position.secondClosed
                    )
                  )
                }
              />
            </Group>
          </Group>
        );
      })}
    </Stack>
  );
}

export default function TurnoutBitPropertyEditor({
  prop,
  selectedElement,
  onChange,
}: TurnoutBitPropertyEditorProps) {
  const values =
    selectedElement as unknown as Record<string, unknown>;
  const propValue = Boolean(values[prop.key]);
  const mode = normalizeTurnoutOutputMode(
    (selectedElement as any).outputMode
  );

  if (
    isDoubleTurnoutElement(selectedElement) &&
    isDoubleTurnoutClosedValueProperty(prop)
  ) {
    if (prop.key !== "turnout1ClosedValue") {
      return null;
    }

    return mode === "extended"
      ? renderDoubleExtendedEditor(selectedElement, onChange)
      : renderDoubleBasicEditor(selectedElement, onChange);
  }

  if (!isTurnoutElement(selectedElement)) {
    return (
      <Group justify="space-between" align="center" wrap="nowrap">
        <Text size="sm" fw={500}>{prop.label}</Text>
        <BitToggleElement
          value={propValue}
          onChange={value => onChange(prop, value)}
        />
      </Group>
    );
  }

  if (mode === "extended") {
    return renderSingleExtendedEditor(
      selectedElement,
      onChange
    );
  }

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>{prop.label}</Text>

      <Group justify="space-between" align="center" wrap="nowrap">
        <Box className="route-turnout-preview-button">
          <ElementPreview
            element={createTurnoutPreview(selectedElement, true)}
            label="Closed"
            width={40}
            height={40}
            onClick={() =>
              sendSingleTurnoutState(selectedElement, true)
            }
          />
        </Box>

        <BitToggleElement
          value={propValue}
          onChange={value => onChange(prop, value)}
        />
      </Group>

      <Group justify="space-between" align="center" wrap="nowrap">
        <Box className="route-turnout-preview-button">
          <ElementPreview
            element={createTurnoutPreview(selectedElement, false)}
            label="Opened"
            width={40}
            height={40}
            onClick={() =>
              sendSingleTurnoutState(selectedElement, false)
            }
          />
        </Box>

        <BitToggleElement
          value={!propValue}
          onChange={value => onChange(prop, !value)}
        />
      </Group>
    </Stack>
  );
}
