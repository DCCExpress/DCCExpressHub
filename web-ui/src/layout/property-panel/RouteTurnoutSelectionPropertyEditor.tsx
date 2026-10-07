import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconPlayerPlay, IconTrash } from "@tabler/icons-react";

import type { LayoutElementId } from "@domain/layout/layoutDto";
import type { BaseElement } from "../../models/editor/core/BaseElement";
import type { LayoutView } from "../../models/editor/core/LayoutView";
import type { IEditableProperty } from "../../models/editor/elements/PropertyDescriptor";
import {
  RouteButtonElement,
  type RouteTurnoutItem,
} from "../../models/editor/elements/RouteButtonElement";
import TrackTurnoutDoubleElement from "../../models/editor/elements/TrackTurnoutDoubleElement";
import {
  TrackTurnoutThreeWayElement,
} from "../../models/editor/elements/TrackTurnoutThreeWayElement";
import ElementPreview from "../../models/editor/rendering/ElementPreviewRenderer";
import { useCommandCenter } from "../../context/CommandCenterContext";
import { useEffect, useMemo, useState } from "react";
import { showWarningMessage } from "../../helpers";
import { executeLegacyRouteButton } from "../../services/routeButtonExecutor";
import {
  applyGeneratedRouteButtonCandidate,
  getAvailableGeneratedRouteButtonCandidates,
  type GeneratedRouteButtonCandidate,
} from "../../services/routeButtonRouteGenerator";
import type {
  LayoutSetter,
  SelectedElementUpdateHandler,
} from "./propertyPanelTypes";

type RouteTurnoutSelectionPropertyEditorProps = {
  prop: IEditableProperty;
  selectedElement: BaseElement;
  layout: LayoutView;
  turnoutSelectionMode: boolean;
  setTurnoutSelectionMode: (on: boolean) => void;
  onLayoutChange: LayoutSetter;
  onUpdateSelectedElement: SelectedElementUpdateHandler;
  setBusy?: (busy: boolean, text?: string) => void;
  routeSelectRequest?: number;
};

function findElementById(layout: LayoutView, id: LayoutElementId) {
  return layout.getAllElements().find(element => element.id === id) ?? null;
}

function getItems(
  selectedElement: BaseElement,
  prop: IEditableProperty
): RouteTurnoutItem[] {
  const value = (selectedElement as any)[prop.key];
  return Array.isArray(value) ? (value as RouteTurnoutItem[]) : [];
}

function removeTurnout(
  selectedElement: BaseElement,
  turnoutId: LayoutElementId,
  onUpdateSelectedElement: SelectedElementUpdateHandler
) {
  const routeButton = selectedElement as RouteButtonElement;
  routeButton.removeTurnout(turnoutId);
  onUpdateSelectedElement(selectedElement);
}

function getRouteTurnoutLogicalLabel(
  turnout: unknown,
  firstClosed: boolean,
  secondClosed?: boolean
): string {
  if (turnout instanceof TrackTurnoutThreeWayElement) {
    const second = secondClosed ?? turnout.turnout2Closed;

    const positions = ["left", "straight", "right"] as const;
    for (const position of positions) {
      const bits = turnout.getBitsForPosition(position);
      if (bits.first === firstClosed && bits.second === second) {
        return position === "left"
          ? "Left"
          : position === "right"
            ? "Right"
            : "Straight";
      }
    }

    return `${Number(firstClosed)}-${Number(second)}`;
  }

  if (turnout instanceof TrackTurnoutDoubleElement) {
    const second = secondClosed ?? turnout.turnout2Closed;

    const states = [
      ["O-O", turnout.ooMotor1Value, turnout.ooMotor2Value],
      ["O-C", turnout.ocMotor1Value, turnout.ocMotor2Value],
      ["C-O", turnout.coMotor1Value, turnout.coMotor2Value],
      ["C-C", turnout.ccMotor1Value, turnout.ccMotor2Value],
    ] as const;

    for (const [label, first, secondBit] of states) {
      if (first === firstClosed && secondBit === second) {
        return label;
      }
    }

    return `${Number(firstClosed)}-${Number(second)}`;
  }

  const turnoutClosedValue =
    typeof (turnout as any)?.turnoutClosedValue === "boolean"
      ? (turnout as any).turnoutClosedValue as boolean
      : true;

  return firstClosed === turnoutClosedValue ? "C" : "T";
}

export default function RouteTurnoutSelectionPropertyEditor({
  prop,
  selectedElement,
  layout,
  turnoutSelectionMode,
  setTurnoutSelectionMode,
  onLayoutChange,
  onUpdateSelectedElement,
  setBusy,
  routeSelectRequest = 0,
}: RouteTurnoutSelectionPropertyEditorProps) {
  useTranslation();
  const commandCenter = useCommandCenter();
  const items = getItems(selectedElement, prop);
  const hasTurnouts = items.length > 0;

  const [
    routeSelectOpened,
    setRouteSelectOpened,
  ] = useState(false);

  const [
    routeCandidates,
    setRouteCandidates,
  ] = useState<
    GeneratedRouteButtonCandidate[]
  >([]);

  const [
    fromFilter,
    setFromFilter,
  ] = useState<string | null>(
    null
  );

  const [
    toFilter,
    setToFilter,
  ] = useState<string | null>(
    null
  );

  const [
    routeSelectError,
    setRouteSelectError,
  ] = useState<string | null>(
    null
  );

  const openRouteSelect = (): void => {
    if (
      !(selectedElement instanceof
        RouteButtonElement)
    ) {
      return;
    }

    try {
      setRouteSelectError(
        null
      );

      setFromFilter(
        null
      );

      setToFilter(
        null
      );

      setRouteCandidates(
        getAvailableGeneratedRouteButtonCandidates(
          layout,
          selectedElement.id
        )
      );

      setRouteSelectOpened(
        true
      );
    } catch (error) {
      setRouteCandidates(
        []
      );

      setRouteSelectError(
        error instanceof Error
          ? error.message
          : String(error)
      );

      setRouteSelectOpened(
        true
      );
    }
  };

  useEffect(
    () => {
      if (
        routeSelectRequest <=
          0
      ) {
        return;
      }

      openRouteSelect();
    },
    [
      routeSelectRequest,
    ]
  );

  const routeFilterOptions =
    useMemo(
      () => {
        const from =
          new Set<string>();

        const to =
          new Set<string>();

        for (
          const candidate of
          routeCandidates
        ) {
          from.add(
            candidate.fromBlockName
          );

          to.add(
            candidate.toBlockName
          );
        }

        const sortOptions =
          (
            values:
              Iterable<string>
          ) =>
            Array.from(
              values
            )
              .sort(
                (
                  left,
                  right
                ) =>
                  left.localeCompare(
                    right,
                    undefined,
                    {
                      numeric:
                        true,
                      sensitivity:
                        "base",
                    }
                  )
              )
              .map(
                value => ({
                  value,
                  label:
                    value,
                })
              );

        return {
          from:
            sortOptions(
              from
            ),
          to:
            sortOptions(
              to
            ),
        };
      },
      [
        routeCandidates,
      ]
    );

  const filteredRouteCandidates =
    useMemo(
      () =>
        routeCandidates.filter(
          candidate =>
            (
              fromFilter ===
                null ||
              candidate.fromBlockName ===
                fromFilter
            ) &&
            (
              toFilter ===
                null ||
              candidate.toBlockName ===
                toFilter
            )
        ),
      [
        routeCandidates,
        fromFilter,
        toFilter,
      ]
    );

  const applyRouteCandidate = (
    candidate:
      GeneratedRouteButtonCandidate
  ): void => {
    if (
      !(selectedElement instanceof
        RouteButtonElement)
    ) {
      return;
    }

    applyGeneratedRouteButtonCandidate(
      selectedElement,
      candidate
    );

    setTurnoutSelectionMode(
      false
    );

    onUpdateSelectedElement(
      selectedElement
    );

    onLayoutChange(
      previous =>
        previous
    );

    setRouteSelectOpened(
      false
    );
  };

  const setRouteTurnoutState = (
    turnoutId: LayoutElementId,
    firstClosed: boolean,
    secondClosed?: boolean
  ): void => {
    const routeItems = getItems(selectedElement, prop);
    const item = routeItems.find(routeItem => routeItem.turnoutId === turnoutId);
    if (!item) return;

    if (
      selectedElement instanceof
        RouteButtonElement
    ) {
      selectedElement.clearGeneratedRoute();
    }

    item.closed = firstClosed;

    if (secondClosed === undefined) {
      delete item.secondClosed;
    } else {
      item.secondClosed = secondClosed;
    }

    onLayoutChange(previous => previous);
  };

  const toggleRouteTurnout = (turnoutId: LayoutElementId): void => {
    const item = items.find(routeItem => routeItem.turnoutId === turnoutId);
    if (!item) return;

    const turnout = findElementById(layout, turnoutId);
    if (!turnout) return;

    if (turnout instanceof TrackTurnoutThreeWayElement) {
      const states = [
        turnout.getBitsForPosition("left"),
        turnout.getBitsForPosition("straight"),
        turnout.getBitsForPosition("right"),
      ];

      const second = item.secondClosed ?? turnout.turnout2Closed;
      const currentIndex = states.findIndex(
        state => state.first === item.closed && state.second === second
      );
      const next = states[(currentIndex + 1) % states.length]!;

      setRouteTurnoutState(turnoutId, next.first, next.second);
      return;
    }

    if (turnout instanceof TrackTurnoutDoubleElement) {
      const states = [
        { first: turnout.ooMotor1Value, second: turnout.ooMotor2Value },
        { first: turnout.ocMotor1Value, second: turnout.ocMotor2Value },
        { first: turnout.coMotor1Value, second: turnout.coMotor2Value },
        { first: turnout.ccMotor1Value, second: turnout.ccMotor2Value },
      ];

      const second = item.secondClosed ?? turnout.turnout2Closed;
      const currentIndex = states.findIndex(
        state => state.first === item.closed && state.second === second
      );
      const next = states[(currentIndex + 1) % states.length]!;

      setRouteTurnoutState(turnoutId, next.first, next.second);
      return;
    }

    setRouteTurnoutState(turnoutId, !item.closed);
  };

  const testRouteButton = async (): Promise<void> => {
    if (!(selectedElement instanceof RouteButtonElement)) return;

    const completed = await executeLegacyRouteButton({
      routeButton: selectedElement,
      layout,
      commandCenterLocked: commandCenter.locked,
      busyText: "Route is being tested...",
      onInvalidate: () => onUpdateSelectedElement(selectedElement),
      onCommandCenterBusy: () => {
        showWarningMessage("Route test", "Command center is busy.");
      },
      ...(setBusy !== undefined ? { setBusy } : {}),
    });
    if (!completed && !commandCenter.locked) {
      showWarningMessage("Route test", "The route could not be set. Check the turnout configuration and connection.");
    }
  };

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Button
          size="xs"
          variant={turnoutSelectionMode ? "filled" : "light"}
          onClick={() => setTurnoutSelectionMode(!turnoutSelectionMode)}
        >
          {turnoutSelectionMode ? i18next.t("ui.finishSelection") : i18next.t("ui.addTurnouts")}
        </Button>

        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlayerPlay size={14} />}
          disabled={!hasTurnouts}
          onClick={() => void testRouteButton()}
        > {i18next.t("ui.testRoute")} </Button>
      </Group>

      <Modal
        opened={
          routeSelectOpened
        }
        onClose={
          () =>
            setRouteSelectOpened(
              false
            )
        }
        title={
          i18next.t(
            "ui.selectGeneratedRouteTitle"
          )
        }
        centered
        size="min(980px, 94vw)"
      >
        <Stack gap="sm">
          <Text
            size="sm"
            c="dimmed"
          >
            {i18next.t(
              "ui.selectGeneratedRouteDescription"
            )}
          </Text>

          <Group
            grow
            align="flex-end"
          >
            <Select
              label={
                i18next.t(
                  "ui.from"
                )
              }
              data={
                routeFilterOptions.from
              }
              value={
                fromFilter
              }
              onChange={
                setFromFilter
              }
              searchable
              clearable
            />

            <Select
              label={
                i18next.t(
                  "ui.to"
                )
              }
              data={
                routeFilterOptions.to
              }
              value={
                toFilter
              }
              onChange={
                setToFilter
              }
              searchable
              clearable
            />
          </Group>

          {routeSelectError && (
            <Alert
              color="red"
              title={
                i18next.t(
                  "ui.error"
                )
              }
            >
              {routeSelectError}
            </Alert>
          )}

          {!routeSelectError &&
            routeCandidates.length ===
              0 && (
              <Text
                c="dimmed"
                ta="center"
                py="md"
              >
                {i18next.t(
                  "ui.noUnusedGeneratedRoutes"
                )}
              </Text>
            )}

          {!routeSelectError &&
            routeCandidates.length >
              0 && (
              <ScrollArea.Autosize
                mah="60dvh"
              >
                <Table
                  striped
                  highlightOnHover
                  withTableBorder
                  withColumnBorders
                  verticalSpacing="xs"
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        {i18next.t(
                          "ui.path"
                        )}
                      </Table.Th>

                      <Table.Th>
                        {i18next.t(
                          "ui.blockPath"
                        )}
                      </Table.Th>

                      <Table.Th
                        ta="center"
                      >
                        {i18next.t(
                          "ui.direction"
                        )}
                      </Table.Th>

                      <Table.Th
                        ta="center"
                      >
                        {i18next.t(
                          "ui.turnouts"
                        )}
                      </Table.Th>

                      <Table.Th
                        style={{
                          width:
                            96,
                        }}
                      />
                    </Table.Tr>
                  </Table.Thead>

                  <Table.Tbody>
                    {filteredRouteCandidates.length === 0 && (
                      <Table.Tr>
                        <Table.Td
                          colSpan={5}
                        >
                          <Text
                            c="dimmed"
                            ta="center"
                            size="sm"
                          >
                            {i18next.t(
                              "ui.noUnusedGeneratedRoutes"
                            )}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    )}

                    {filteredRouteCandidates.map(
                      candidate => (
                        <Table.Tr
                          key={
                            candidate.id
                          }
                        >
                          <Table.Td>
                            <Text
                              fw={700}
                              size="sm"
                            >
                              {
                                candidate.label
                              }
                            </Text>
                          </Table.Td>

                          <Table.Td>
                            <Text
                              size="xs"
                              c="dimmed"
                            >
                              {
                                candidate.blockPath.join(
                                  " → "
                                ) ||
                                candidate.label
                              }
                            </Text>
                          </Table.Td>

                          <Table.Td
                            ta="center"
                          >
                            <Badge
                              variant="light"
                              color={
                                candidate.locoDirection ===
                                  "unknown"
                                  ? "gray"
                                  : "blue"
                              }
                            >
                              {candidate.locoDirection ===
                              "forward"
                                ? i18next.t(
                                    "ui.forward"
                                  )
                                : candidate.locoDirection ===
                                    "reverse"
                                  ? i18next.t(
                                      "ui.reverse"
                                    )
                                  : i18next.t(
                                      "ui.unknown"
                                    )}
                            </Badge>
                          </Table.Td>

                          <Table.Td
                            ta="center"
                          >
                            {
                              candidate.routeTurnouts.length
                            }
                          </Table.Td>

                          <Table.Td>
                            <Button
                              size="xs"
                              fullWidth
                              onClick={
                                () =>
                                  applyRouteCandidate(
                                    candidate
                                  )
                              }
                            >
                              {i18next.t(
                                "ui.select"
                              )}
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      )
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
        </Stack>
      </Modal>

      <Text size="xs" c="dimmed">
        {turnoutSelectionMode
          ? i18next.t("ui.clickTurnoutsOnTheLayoutToAddThemThenPress")
          : i18next.t("ui.useAddTurnoutsToPickTurnoutsFromTheLayoutClick")}
      </Text>

      {items.length === 0 ? (
        <Text size="xs" c="dimmed">{i18next.t("ui.noTurnoutsSelected")}</Text>
      ) : (
        <Stack gap={6}>
          {items.map(item => {
            const turnout = findElementById(layout, item.turnoutId);
            if (!turnout) {
              return (
                <Group key={item.turnoutId} justify="space-between" gap="xs">
                  <Text size="xs" c="red">{i18next.t("ui.missingTurnout")} {item.turnoutId}</Text>
                  <ActionIcon
                    size="sm"
                    color="red"
                    variant="subtle"
                    onClick={() => removeTurnout(selectedElement, item.turnoutId, onUpdateSelectedElement)}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              );
            }

            const previewTurnout = turnout.clone();
            previewTurnout.id = turnout.id;
            previewTurnout.x = 0;
            previewTurnout.y = 0;
            previewTurnout.selected = false;
            previewTurnout.enabled = true;

            // TrackTurnoutDoubleElement.clone() currently does not copy the
            // explicit per-position bit table. RouteButton preview must use
            // the exact O-O / O-C / C-O / C-C mapping configured on the real
            // turnout, otherwise the stored physical bit pair can be rendered
            // as the wrong logical Double position.
            if (
              turnout instanceof TrackTurnoutDoubleElement &&
              previewTurnout instanceof TrackTurnoutDoubleElement
            ) {
              previewTurnout.ooMotor1Value = turnout.ooMotor1Value;
              previewTurnout.ooMotor2Value = turnout.ooMotor2Value;
              previewTurnout.ocMotor1Value = turnout.ocMotor1Value;
              previewTurnout.ocMotor2Value = turnout.ocMotor2Value;
              previewTurnout.coMotor1Value = turnout.coMotor1Value;
              previewTurnout.coMotor2Value = turnout.coMotor2Value;
              previewTurnout.ccMotor1Value = turnout.ccMotor1Value;
              previewTurnout.ccMotor2Value = turnout.ccMotor2Value;
            }

            if (
              previewTurnout instanceof TrackTurnoutDoubleElement ||
              previewTurnout instanceof TrackTurnoutThreeWayElement
            ) {
              previewTurnout.turnout1Closed = item.closed;
              previewTurnout.turnout2Closed =
                item.secondClosed ?? previewTurnout.turnout2Closed;
            } else {
              (previewTurnout as any).turnoutClosed = item.closed;
            }

            return (
              <Group key={item.turnoutId} gap="xs" wrap="nowrap" align="center">
                <Box
                  className="route-turnout-preview-button"
                  onClick={() => {
                    toggleRouteTurnout(item.turnoutId);
                    onUpdateSelectedElement(selectedElement);
                  }}
                >
                  <ElementPreview
                    element={previewTurnout}
                    label={
                      previewTurnout instanceof TrackTurnoutDoubleElement ||
                      previewTurnout instanceof TrackTurnoutThreeWayElement
                        ? `#${previewTurnout.turnout1Address}/#${previewTurnout.turnout2Address}`
                        : "#" + (previewTurnout as any).turnoutAddress
                    }
                    width={40}
                    height={40}
                  />
                </Box>
                <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                  <Text size="xs" fw={500} truncate>{turnout.name || i18next.t("ui.turnout2")}</Text>
                  <Text size="xs" c="dimmed"> {i18next.t("ui.routeState")} {getRouteTurnoutLogicalLabel(
                      turnout,
                      item.closed,
                      item.secondClosed
                    )}
                  </Text>
                </Stack>
                <ActionIcon
                  size="sm"
                  color="red"
                  variant="subtle"
                  title={i18next.t("ui.removeTurnout")}
                  onClick={event => {
                    event.stopPropagation();
                    removeTurnout(selectedElement, item.turnoutId, onUpdateSelectedElement);
                  }}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
