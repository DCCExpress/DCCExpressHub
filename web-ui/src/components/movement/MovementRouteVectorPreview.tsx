import {
  Group,
  Loader,
  Text,
} from "@mantine/core";

import {
  useEffect,
  useState,
  type KeyboardEvent,
} from "react";

import type {
  MovementPage,
} from "../../domain/movement";

import {
  loadMovementRouteVector,
  type MovementRouteVectorItem,
} from "../../services/movementRouteVector";

type Props = {
  page:
    MovementPage;
  selectedKey?:
    string | null;
  onItemClick?: (
    item:
      MovementRouteVectorItem
  ) => void;
};

const ITEM_WIDTH =
  136;

const ITEM_GAP =
  42;

const START_X =
  24;

const SVG_HEIGHT =
  136;

function typeLabel(
  item:
    MovementRouteVectorItem
): string {
  if (
    item.kind ===
      "segment"
  ) {
    return "SEGMENT";
  }

  if (
    item.kind ===
      "turnout"
  ) {
    return "TURNOUT";
  }

  if (
    item.role ===
      "source"
  ) {
    return "SOURCE BLOCK";
  }

  if (
    item.role ===
      "destination"
  ) {
    return "DESTINATION";
  }

  return "BLOCK";
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
    item.sensor ===
      null &&
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
  selectedKey = null,
  onItemClick,
}: Props) {
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
    [
      page.routeKey,
      page.fromBlockId ??
        0,
      ...page.viaBlockIds,
      page.toBlockId ??
        0,
    ].join(
      ":"
    );

  useEffect(
    () => {
      let disposed =
        false;

      if (
        page.fromBlockId ===
          null ||
        page.toBlockId ===
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

      void loadMovementRouteVector(
        page
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
    ]
  );

  if (
    page.fromBlockId ===
      null ||
    page.toBlockId ===
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
          Building route vector...
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
        Route vector: {
          error
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
          Route vector
        </Text>

        <Text
          size="xs"
          c="dimmed"
        >
          Blocks, graph segments and turnouts in physical movement order
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
          aria-label="Movement route vector"
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
                            y1={67}
                            x2={
                              nextX
                            }
                            y2={67}
                          />

                          <path
                            className="movement-route-vector-link-arrow"
                            d={
                              `M ${nextX - 9} 61 L ${nextX} 67 L ${nextX - 9} 73 Z`
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
                      <rect
                        className="movement-route-vector-card"
                        x={x}
                        y={28}
                        width={
                          ITEM_WIDTH
                        }
                        height={78}
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
                                    `#${state.address} ${state.closed ? "CLOSED" : "THROWN"}`
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
                            item.sensor ===
                              null &&
                            item.kind !==
                              "turnout"
                              ? " is-missing"
                              : ""
                          )
                        }
                        x={
                          centerX
                        }
                        y={
                          (
                            item.kind ===
                              "segment" &&
                            item.trackName &&
                            item.trackName !==
                              item.nodeName
                          ) ||
                          (
                            item.kind ===
                              "turnout" &&
                            item.turnoutStates.length >
                              0
                          )
                            ? 100
                            : 90
                        }
                        textAnchor="middle"
                      >
                        {
                          item.sensor ===
                            null
                            ? (
                              item.kind ===
                                "turnout"
                                ? "No detector"
                                : "NO SENSOR"
                            )
                            : `Sensor ${item.sensor}`
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
