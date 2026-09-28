import {
  Text,
} from "@mantine/core";

import type {
  MovementRouteVectorItem,
} from "../../services/movementRouteVector";

type Props = {
  items:
    MovementRouteVectorItem[];
  selectedKey:
    string | null;
};

type SectionPreview = {
  nodeIndex: number;
  segment:
    Extract<
      MovementRouteVectorItem,
      { kind: "segment" }
    > |
    null;
  blocks:
    Array<
      Extract<
        MovementRouteVectorItem,
        { kind: "block" }
      >
    >;
  turnouts:
    Array<
      Extract<
        MovementRouteVectorItem,
        { kind: "turnout" }
      >
    >;
};

const SLOT_WIDTH =
  280;

const SVG_HEIGHT =
  190;

const TRACK_Y =
  62;

function buildSections(
  items:
    MovementRouteVectorItem[]
): SectionPreview[] {
  const byNode =
    new Map<
      number,
      SectionPreview
    >();

  for (
    const item of
    items
  ) {
    let section =
      byNode.get(
        item.nodeIndex
      );

    if (!section) {
      section = {
        nodeIndex:
          item.nodeIndex,
        segment:
          null,
        blocks: [],
        turnouts: [],
      };

      byNode.set(
        item.nodeIndex,
        section
      );
    }

    if (
      item.kind ===
        "segment"
    ) {
      section.segment =
        item;
    } else if (
      item.kind ===
        "block"
    ) {
      section.blocks.push(
        item
      );
    } else {
      section.turnouts.push(
        item
      );
    }
  }

  return [
    ...byNode.values(),
  ].sort(
    (
      left,
      right
    ) =>
      left.nodeIndex -
      right.nodeIndex
  );
}

function sectionTitle(
  section:
    SectionPreview
): string {
  return (
    section.segment?.nodeName ??
    \`S\${section.nodeIndex + 1}\`
  );
}

function sectionSensor(
  section:
    SectionPreview
): number | null {
  return (
    section.segment?.sensor ??
    null
  );
}

function selectedItemForSection(
  section:
    SectionPreview,
  selectedKey:
    string
): MovementRouteVectorItem | null {
  if (
    section.segment?.key ===
      selectedKey
  ) {
    return section.segment;
  }

  return (
    section.blocks.find(
      item =>
        item.key ===
        selectedKey
    ) ??
    section.turnouts.find(
      item =>
        item.key ===
        selectedKey
    ) ??
    null
  );
}

function blockLabel(
  block:
    Extract<
      MovementRouteVectorItem,
      { kind: "block" }
    >
): string {
  return (
    \`B\${block.blockId}: \${block.name}\`
  );
}

function turnoutLabel(
  turnout:
    Extract<
      MovementRouteVectorItem,
      { kind: "turnout" }
    >
): string {
  return (
    \`Turnout: \${turnout.name}\`
  );
}

export default function MovementLocalSectionPreview({
  items,
  selectedKey,
}: Props) {
  if (
    selectedKey ===
      null ||
    items.length ===
      0
  ) {
    return null;
  }

  const selected =
    items.find(
      item =>
        item.key ===
        selectedKey
    );

  if (!selected) {
    return null;
  }

  const sections =
    buildSections(
      items
    );

  const currentIndex =
    sections.findIndex(
      section =>
        section.nodeIndex ===
        selected.nodeIndex
    );

  if (
    currentIndex <
      0
  ) {
    return null;
  }

  const slots:
    Array<
      SectionPreview |
      null
    > = [
      sections[
        currentIndex - 1
      ] ??
        null,
      sections[
        currentIndex
      ] ??
        null,
      sections[
        currentIndex + 1
      ] ??
        null,
    ];

  const width =
    SLOT_WIDTH *
    3;

  return (
    <div
      className="movement-local-preview-shell"
    >
      <div
        className="movement-local-preview-caption"
      >
        <Text
          size="xs"
          fw={700}
        >
          Local section preview
        </Text>

        <Text
          size="xs"
          c="dimmed"
        >
          Previous, selected and next graph section
        </Text>
      </div>

      <div
        className="movement-local-preview-scroll"
      >
        <svg
          className="movement-local-preview-svg"
          width={
            width
          }
          height={
            SVG_HEIGHT
          }
          viewBox={
            \`0 0 \${width} \${SVG_HEIGHT}\`
          }
          aria-label="Movement local section preview"
        >
          {
            slots.map(
              (
                section,
                slotIndex
              ) => {
                const x =
                  slotIndex *
                  SLOT_WIDTH;

                const centerX =
                  x +
                  SLOT_WIDTH /
                    2;

                const isCurrent =
                  slotIndex ===
                    1 &&
                  section !==
                    null;

                if (!section) {
                  return (
                    <g
                      key={
                        \`empty-\${slotIndex}\`
                      }
                      className="movement-local-preview-section is-empty"
                    >
                      <line
                        className="movement-local-preview-track is-empty"
                        x1={
                          x + 22
                        }
                        y1={
                          TRACK_Y
                        }
                        x2={
                          x +
                          SLOT_WIDTH -
                          22
                        }
                        y2={
                          TRACK_Y
                        }
                      />

                      <text
                        className="movement-local-preview-empty-label"
                        x={
                          centerX
                        }
                        y={116}
                        textAnchor="middle"
                      >
                        Route boundary
                      </text>
                    </g>
                  );
                }

                const sensor =
                  sectionSensor(
                    section
                  );

                const localSelected =
                  selectedItemForSection(
                    section,
                    selectedKey
                  );

                const blockLines =
                  section.blocks.slice(
                    0,
                    2
                  );

                const turnoutLines =
                  section.turnouts.slice(
                    0,
                    1
                  );

                const sensorY =
                  116;

                const detailStartY =
                  136;

                return (
                  <g
                    key={
                      \`section-\${section.nodeIndex}\`
                    }
                    className={
                      "movement-local-preview-section" +
                      (
                        isCurrent
                          ? " is-current"
                          : ""
                      )
                    }
                    data-node-index={
                      section.nodeIndex
                    }
                  >
                    {
                      slotIndex >
                        0 && (
                        <line
                          className="movement-local-preview-divider"
                          x1={x}
                          y1={24}
                          x2={x}
                          y2={166}
                        />
                      )
                    }

                    <line
                      className="movement-local-preview-track"
                      x1={
                        x + 12
                      }
                      y1={
                        TRACK_Y
                      }
                      x2={
                        x +
                        SLOT_WIDTH -
                        12
                      }
                      y2={
                        TRACK_Y
                      }
                    />

                    <circle
                      className={
                        "movement-local-preview-sensor" +
                        (
                          sensor ===
                            null
                            ? " is-missing"
                            : ""
                        ) +
                        (
                          isCurrent
                            ? " is-current"
                            : ""
                        )
                      }
                      cx={
                        centerX
                      }
                      cy={
                        TRACK_Y
                      }
                      r={
                        isCurrent
                          ? 12
                          : 10
                      }
                    />

                    <text
                      className="movement-local-preview-section-name"
                      x={
                        centerX
                      }
                      y={30}
                      textAnchor="middle"
                    >
                      {
                        sectionTitle(
                          section
                        )
                      }
                    </text>

                    <text
                      className={
                        "movement-local-preview-sensor-label" +
                        (
                          sensor ===
                            null
                            ? " is-missing"
                            : ""
                        )
                      }
                      x={
                        centerX
                      }
                      y={
                        sensorY
                      }
                      textAnchor="middle"
                    >
                      {
                        sensor ===
                          null
                          ? "NO SECTION SENSOR"
                          : \`Sensor \${sensor}\`
                      }
                    </text>

                    {
                      blockLines.map(
                        (
                          block,
                          index
                        ) => (
                          <text
                            key={
                              block.key
                            }
                            className={
                              "movement-local-preview-detail is-block" +
                              (
                                block.key ===
                                  localSelected?.key
                                  ? " is-selected"
                                  : ""
                              )
                            }
                            x={
                              centerX
                            }
                            y={
                              detailStartY +
                              index *
                                16
                            }
                            textAnchor="middle"
                          >
                            {
                              blockLabel(
                                block
                              )
                            }
                          </text>
                        )
                      )
                    }

                    {
                      turnoutLines.map(
                        (
                          turnout,
                          index
                        ) => (
                          <text
                            key={
                              turnout.key
                            }
                            className={
                              "movement-local-preview-detail is-turnout" +
                              (
                                turnout.key ===
                                  localSelected?.key
                                  ? " is-selected"
                                  : ""
                              )
                            }
                            x={
                              centerX
                            }
                            y={
                              detailStartY +
                              blockLines.length *
                                16 +
                              index *
                                16
                            }
                            textAnchor="middle"
                          >
                            {
                              turnoutLabel(
                                turnout
                              )
                            }
                          </text>
                        )
                      )
                    }

                    {
                      localSelected?.kind ===
                        "segment" && (
                        <text
                          className="movement-local-preview-detail is-selected"
                          x={
                            centerX
                          }
                          y={
                            detailStartY
                          }
                          textAnchor="middle"
                        >
                          Selected section
                        </text>
                      )
                    }
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
