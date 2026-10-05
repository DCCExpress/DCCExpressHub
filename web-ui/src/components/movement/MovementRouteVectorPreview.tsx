import {
  Group,
  Loader,
  Text,
} from "@mantine/core";

import i18next from "i18next";

import {
  useEffect,
  useState,
  type KeyboardEvent,
} from "react";

import type {
  MovementPage,
} from "../../domain/movement";

import type {
  LayoutView,
} from "../../models/editor/core/LayoutView";

import {
  createCurrentClientLayoutSnapshot,
} from "../../services/clientRouteGraphCache";

import {
  loadMovementRouteVector,
  type MovementRouteVectorItem,
} from "../../services/movementRouteVector";

import {
  movementText,
  useMovementTranslation,
} from "./movementI18n";

import "../../styles/movementEditor.css";

type Props = {
  page:
    MovementPage;
  layout:
    LayoutView;
  selectedKey?:
    string | null;
  onItemClick?: (
    item:
      MovementRouteVectorItem
  ) => void;
};

const ITEM_WIDTH =
  164;

const ITEM_GAP =
  42;

const START_X =
  24;

const SVG_HEIGHT =
  154;

function typeLabel(
  item:
    MovementRouteVectorItem
): string {
  if (
    item.kind ===
      "segment"
  ) {
    return movementText("movementSegmentUpper");
  }

  if (
    item.kind ===
      "turnout"
  ) {
    return movementText("movementTurnoutUpper");
  }

  const mergedSegments =
    item.mergedSegmentNames.length >
      0
      ? ` + SEG:${item.mergedSegmentNames.join(",")}`
      : "";

  if (
    item.role ===
      "source"
  ) {
    return (
      movementText("movementSourceBlock") +
      mergedSegments
    );
  }

  if (
    item.role ===
      "destination"
  ) {
    return (
      movementText("movementDestination") +
      mergedSegments
    );
  }

  return (
    movementText("movementBlockUpper") +
    mergedSegments
  );
}

function blockTypeLabel(
  item:
    MovementRouteVectorItem
): string {
  if (
    item.kind !==
      "block"
  ) {
    return "";
  }

  const key =
    `block.types.${item.blockType}`;

  const translated =
    i18next.t(
      key
    );

  return translated ===
    key
    ? item.blockType
    : translated;
}

function itemClassName(
  item:
    MovementRouteVectorItem,
  selectedKey:
    string | null,
  clickable:
    boolean
): string {
  const classes = [
    "movement-route-vector-node",
    item.kind ===
      "segment"
      ? "is-segment"
      : item.kind ===
          "turnout"
        ? "is-turnout"
        : item.role ===
            "source"
          ? "is-source"
          : item.role ===
              "destination"
            ? "is-destination"
            : "is-block",
  ];

  if (
    item.sensors.length ===
      0 &&
    item.kind !==
      "turnout"
  ) {
    classes.push(
      "is-no-sensor"
    );
  }

  if (
    selectedKey ===
      item.key
  ) {
    classes.push(
      "is-selected"
    );
  }

  if (
    clickable
  ) {
    classes.push(
      "is-clickable"
    );
  }

  return classes.join(
    " "
  );
}

export default function MovementRouteVectorPreview({
  page,
  layout,
  selectedKey = null,
  onItemClick,
}: Props) {
  const mt =
    useMovementTranslation();

  const [
    items,
    setItems,
  ] =
    useState<
      MovementRouteVectorItem[]
    >([]);

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );

  const routeSignature =
    page.routeRef
      ? [
          page.routeRef.fromBlockId,
          ...page.routeRef.viaBlockIds,
          page.routeRef.toBlockId,
          page.routeRef.direction,
        ].join(
          ":"
        )
      : "";

  useEffect(
    () => {
      let disposed =
        false;

      if (
        page.routeRef ===
          null
      ) {
        setItems(
          []
        );

        setError(
          null
        );

        setLoading(
          false
        );

        return () => {
          disposed =
            true;
        };
      }

      setLoading(
        true
      );

      setError(
        null
      );

      const layoutSnapshot =
        createCurrentClientLayoutSnapshot(
          layout
        );

      void loadMovementRouteVector(
        page,
        layoutSnapshot
      )
        .then(
          next => {
            if (
              !disposed
            ) {
              setItems(
                next
              );
            }
          }
        )
        .catch(
          loadError => {
            if (
              disposed
            ) {
              return;
            }

            setItems(
              []
            );

            setError(
              loadError instanceof Error
                ? loadError.message
                : String(
                    loadError
                  )
            );
          }
        )
        .finally(
          () => {
            if (
              !disposed
            ) {
              setLoading(
                false
              );
            }
          }
        );

      return () => {
        disposed =
          true;
      };
    },
    [
      routeSignature,
      layout,
    ]
  );

  if (
    page.routeRef ===
      null
  ) {
    return null;
  }

  if (
    loading
  ) {
    return (
      <Group
        gap="xs"
        mt="xs"
        className="movement-route-vector-status"
      >
        <Loader
          size="xs"
        />

        <Text
          size="xs"
          c="dimmed"
        >
          {mt("movementBuildingRouteVector")}
        </Text>
      </Group>
    );
  }

  if (
    error
  ) {
    return (
      <Text
        size="xs"
        c="red"
        mt="xs"
        className="movement-route-vector-status"
      >
        {
          mt(
            "movementRouteVectorError",
            {
              error,
            }
          )
        }
      </Text>
    );
  }

  if (
    items.length ===
      0
  ) {
    return null;
  }

  const width =
    Math.max(
      620,
      START_X *
        2 +
      items.length *
        ITEM_WIDTH +
      Math.max(
        0,
        items.length -
          1
      ) *
        ITEM_GAP
    );

  const activate =
    (
      item:
        MovementRouteVectorItem
    ): void => {
      onItemClick?.(
        item
      );
    };

  const onKeyDown =
    (
      event:
        KeyboardEvent<SVGGElement>,
      item:
        MovementRouteVectorItem
    ): void => {
      if (
        !onItemClick ||
        (
          event.key !==
            "Enter" &&
          event.key !==
            " "
        )
      ) {
        return;
      }

      event.preventDefault();

      activate(
        item
      );
    };

  return (
    <div
      className="movement-route-vector-shell"
    >
      <div
        className="movement-route-vector-caption"
      >
        <Text
          size="xs"
          fw={700}
        >
          {mt("movementRouteVectorCaption")}
        </Text>

        <Text
          size="xs"
          c="dimmed"
        >
          {mt("movementRouteVectorSubtitle")}
        </Text>
      </div>

      <div
        className="movement-route-vector-scroll"
      >
        <svg
          className="movement-route-vector-svg"
          width={
            width
          }
          height={
            SVG_HEIGHT
          }
          viewBox={
            `0 0 ${width} ${SVG_HEIGHT}`
          }
          aria-label={mt("movementRouteVectorAria")}
        >
          {
            items.map(
              (
                item,
                index
              ) => {
                const x =
                  START_X +
                  index *
                    (
                      ITEM_WIDTH +
                      ITEM_GAP
                    );

                const centerX =
                  x +
                  ITEM_WIDTH /
                    2;

                const nextX =
                  x +
                  ITEM_WIDTH +
                  ITEM_GAP;

                const clickable =
                  Boolean(
                    onItemClick
                  );

                return (
                  <g
                    key={
                      item.key
                    }
                  >
                    {
                      index <
                        items.length -
                          1 && (
                        <>
                          <line
                            className="movement-route-vector-link"
                            x1={
                              x +
                              ITEM_WIDTH
                            }
                            y1={77}
                            x2={
                              nextX
                            }
                            y2={77}
                          />

                          <path
                            className="movement-route-vector-link-arrow"
                            d={
                              `M ${nextX - 9} 71 L ${nextX} 77 L ${nextX - 9} 83 Z`
                            }
                          />
                        </>
                      )
                    }

                    <g
                      className={
                        itemClassName(
                          item,
                          selectedKey,
                          clickable
                        )
                      }
                      data-route-vector-key={
                        item.key
                      }
                      data-route-vector-kind={
                        item.kind
                      }
                      role={
                        clickable
                          ? "button"
                          : undefined
                      }
                      tabIndex={
                        clickable
                          ? 0
                          : undefined
                      }
                      onClick={
                        clickable
                          ? () =>
                              activate(
                                item
                              )
                          : undefined
                      }
                      onKeyDown={
                        clickable
                          ? event =>
                              onKeyDown(
                                event,
                                item
                              )
                          : undefined
                      }
                    >
                      {
                        item.kind ===
                          "block" &&
                        item.mergedSegmentNames.length >
                          0 && (
                          <rect
                            className="movement-route-vector-composite-segment-card"
                            x={
                              x + 7
                            }
                            y={35}
                            width={
                              ITEM_WIDTH
                            }
                            height={102}
                            rx={11}
                          />
                        )
                      }

                      <rect
                        className="movement-route-vector-card"
                        x={x}
                        y={28}
                        width={
                          ITEM_WIDTH
                        }
                        height={102}
                        rx={11}
                      />

                      <circle
                        className="movement-route-vector-order-circle"
                        cx={
                          x + 15
                        }
                        cy={28}
                        r={13}
                      />

                      <text
                        className="movement-route-vector-order"
                        x={
                          x + 15
                        }
                        y={32}
                        textAnchor="middle"
                      >
                        {
                          item.order
                        }
                      </text>

                      <text
                        className="movement-route-vector-type"
                        x={
                          centerX
                        }
                        y={48}
                        textAnchor="middle"
                      >
                        {
                          typeLabel(
                            item
                          )
                        }
                      </text>

                      <text
                        className="movement-route-vector-name"
                        x={
                          centerX
                        }
                        y={70}
                        textAnchor="middle"
                      >
                        {
                          item.kind ===
                            "segment"
                            ? item.nodeName
                            : item.name
                        }
                      </text>

                      {
                        item.kind ===
                          "block" && (
                          <text
                            className="movement-route-vector-detail"
                            x={
                              centerX
                            }
                            y={86}
                            textAnchor="middle"
                          >
                            {
                              blockTypeLabel(
                                item
                              )
                            }
                          </text>
                        )
                      }

                      {
                        item.kind ===
                          "segment" &&
                        item.trackName &&
                        item.trackName !==
                          item.nodeName && (
                          <text
                            className="movement-route-vector-detail"
                            x={
                              centerX
                            }
                            y={86}
                            textAnchor="middle"
                          >
                            {
                              item.trackName
                            }
                          </text>
                        )
                      }

                      {
                        item.kind ===
                          "turnout" &&
                        item.turnoutStates.length >
                          0 && (
                          <text
                            className="movement-route-vector-detail"
                            x={
                              centerX
                            }
                            y={86}
                            textAnchor="middle"
                          >
                            {
                              item.turnoutStates
                                .map(
                                  state =>
                                    `#${state.address} ${state.closed ? mt("movementClosed") : mt("movementThrown")}`
                                )
                                .join(
                                  " · "
                                )
                            }
                          </text>
                        )
                      }

                      <text
                        className={
                          "movement-route-vector-sensor" +
                          (
                            item.sensors.length ===
                              0 &&
                            item.kind !==
                              "turnout"
                              ? " is-missing"
                              : ""
                          )
                        }
                        x={
                          centerX
                        }
                        y={104}
                        textAnchor="middle"
                      >
                        {
                          item.sensors.length ===
                            0
                            ? mt("movementNoSensorUpper")
                            : (
                                item.kind ===
                                  "block"
                                  ? `OCC ${item.sensors.join(" · ")}`
                                  : `SEN ${item.sensors.join(" · ")}`
                              )
                        }
                      </text>

                    </g>
                  </g>
                );
              }
            )
          }
        </svg>
      </div>
    </div>
  );
}
