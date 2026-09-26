import {
  ActionIcon,
  Button,
  Group,
  Select,
  Text,
  Tooltip,
} from "@mantine/core";

import {
  IconArrowRight,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

import type {
  MovementPage,
} from "../../domain/movement";

import type {
  AutomationBlockOption,
} from "../../services/automationBlockCatalog";

import type {
  MovementRouteNavigation,
} from "../../services/movementRouteNavigation";

type Props = {
  page:
    MovementPage;
  catalog:
    AutomationBlockOption[];
  navigation:
    MovementRouteNavigation | null;
  onChange: (
    page:
      MovementPage
  ) => void;
};

function selectedSequence(
  page:
    MovementPage
): number[] {
  const result:
    number[] = [];

  if (
    page.fromBlockId !==
    null
  ) {
    result.push(
      page.fromBlockId
    );
  }

  result.push(
    ...page.viaBlockIds
  );

  if (
    page.toBlockId !==
    null
  ) {
    result.push(
      page.toBlockId
    );
  }

  return result;
}

function withSelectedSequence(
  page:
    MovementPage,
  sequence:
    number[]
): MovementPage {
  const unique:
    number[] = [];

  for (
    const blockId of
    sequence
  ) {
    if (
      !unique.includes(
        blockId
      )
    ) {
      unique.push(
        blockId
      );
    }
  }

  const fromBlockId =
    unique[0] ??
    null;

  const toBlockId =
    unique.length >=
      2
      ? unique[
          unique.length -
          1
        ]!
      : null;

  const viaBlockIds =
    unique.length >
      2
      ? unique.slice(
          1,
          -1
        )
      : [];

  const selectedIds =
    new Set(
      unique
    );

  return {
    ...page,
    fromBlockId,
    viaBlockIds,
    toBlockId,
    blockRules:
      page.blockRules.filter(
        rule =>
          selectedIds.has(
            rule.blockId
          )
      ),
  };
}

function blockLabel(
  blockId: number,
  catalog:
    AutomationBlockOption[]
): string {
  return (
    catalog.find(
      block =>
        block.id ===
        blockId
    )?.label ??
    `Block #${blockId}`
  );
}

export default function MovementRouteSelector({
  page,
  catalog,
  navigation,
  onChange,
}: Props) {
  const sequence =
    selectedSequence(
      page
    );

  const fromData =
    catalog.map(
      block => ({
        value:
          String(
            block.id
          ),
        label:
          block.label,
      })
    );

  const nextData =
    (
      previousId:
        number | null,
      currentId:
        number | null,
      usedIds:
        Set<number>
    ) => {
      if (
        previousId ===
          null
      ) {
        return [];
      }

      const ids =
        navigation?.nextByBlockId.get(
          previousId
        ) ??
        [];

      const allowed =
        ids.filter(
          id =>
            id ===
              currentId ||
            !usedIds.has(
              id
            )
        );

      if (
        currentId !==
          null &&
        !allowed.includes(
          currentId
        )
      ) {
        allowed.unshift(
          currentId
        );
      }

      return allowed.map(
        id => ({
          value:
            String(
              id
            ),
          label:
            blockLabel(
              id,
              catalog
            ),
        })
      );
    };

  const changeFrom =
    (
      value:
        string | null
    ): void => {
      if (
        value ===
        null
      ) {
        onChange(
          withSelectedSequence(
            page,
            []
          )
        );

        return;
      }

      onChange(
        withSelectedSequence(
          page,
          [
            Number(
              value
            ),
          ]
        )
      );
    };

  const changeVia =
    (
      viaIndex: number,
      value:
        string | null
    ): void => {
      const prefix = [
        page.fromBlockId!,
        ...page.viaBlockIds.slice(
          0,
          viaIndex
        ),
      ];

      if (
        value !==
        null
      ) {
        prefix.push(
          Number(
            value
          )
        );
      }

      /*
       * Editing an earlier checkpoint invalidates everything after it.
       * The newly selected block becomes the current TO until Add block is
       * pressed again.
       */
      onChange(
        withSelectedSequence(
          page,
          prefix
        )
      );
    };

  const removeVia =
    (
      viaIndex: number
    ): void => {
      const prefix = [
        page.fromBlockId!,
        ...page.viaBlockIds.slice(
          0,
          viaIndex
        ),
      ];

      onChange(
        withSelectedSequence(
          page,
          prefix
        )
      );
    };

  const changeTo =
    (
      value:
        string | null
    ): void => {
      const prefix = [
        ...(page.fromBlockId ===
          null
          ? []
          : [
              page.fromBlockId,
            ]),
        ...page.viaBlockIds,
      ];

      if (
        value !==
        null
      ) {
        prefix.push(
          Number(
            value
          )
        );
      }

      onChange(
        withSelectedSequence(
          page,
          prefix
        )
      );
    };

  const previousForTo =
    page.viaBlockIds[
      page.viaBlockIds.length -
      1
    ] ??
    page.fromBlockId;

  const usedBeforeTo =
    new Set<number>([
      ...(page.fromBlockId ===
        null
        ? []
        : [
            page.fromBlockId,
          ]),
      ...page.viaBlockIds,
    ]);

  const toOptions =
    nextData(
      previousForTo,
      page.toBlockId,
      usedBeforeTo
    );

  const nextAfterTo =
    page.toBlockId ===
      null
      ? []
      : (
          navigation?.nextByBlockId.get(
            page.toBlockId
          ) ??
          []
        ).filter(
          id =>
            !new Set(
              sequence
            ).has(
              id
            )
        );

  const canAddBlock =
    page.toBlockId !==
      null &&
    nextAfterTo.length >
      0;

  return (
    <div
      className="movement-route-chain"
    >
      <div
        className="movement-route-chain-card is-from"
      >
        <Text
          size="xs"
          fw={700}
          c="blue"
        >
          FROM BLOCK
        </Text>

        <Select
          size="xs"
          searchable
          clearable
          placeholder="Select block"
          data={
            fromData
          }
          value={
            page.fromBlockId ===
              null
              ? null
              : String(
                  page.fromBlockId
                )
          }
          onChange={
            changeFrom
          }
        />
      </div>

      {
        page.viaBlockIds.map(
          (
            blockId,
            viaIndex
          ) => {
            const previousId =
              viaIndex ===
                0
                ? page.fromBlockId
                : page.viaBlockIds[
                    viaIndex -
                      1
                  ] ??
                  null;

            const usedIds =
              new Set<number>([
                ...(page.fromBlockId ===
                  null
                  ? []
                  : [
                      page.fromBlockId,
                    ]),
                ...page.viaBlockIds.slice(
                  0,
                  viaIndex
                ),
              ]);

            return (
              <Group
                key={
                  `via-${viaIndex}-${blockId}`
                }
                gap={6}
                wrap="nowrap"
                className="movement-route-chain-step"
              >
                <IconArrowRight
                  size={15}
                  className="movement-route-chain-arrow"
                />

                <div
                  className="movement-route-chain-card is-via"
                >
                  <Group
                    justify="space-between"
                    gap={6}
                    wrap="nowrap"
                  >
                    <Text
                      size="xs"
                      fw={700}
                      c="violet"
                    >
                      VIA BLOCK
                    </Text>

                    <Tooltip
                      label="Remove this VIA and every block after it"
                      withArrow
                    >
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        color="red"
                        onClick={
                          () =>
                            removeVia(
                              viaIndex
                            )
                        }
                      >
                        <IconTrash
                          size={12}
                        />
                      </ActionIcon>
                    </Tooltip>
                  </Group>

                  <Select
                    size="xs"
                    searchable
                    allowDeselect={
                      false
                    }
                    data={
                      nextData(
                        previousId,
                        blockId,
                        usedIds
                      )
                    }
                    value={
                      String(
                        blockId
                      )
                    }
                    onChange={
                      value =>
                        changeVia(
                          viaIndex,
                          value
                        )
                    }
                  />
                </div>
              </Group>
            );
          }
        )
      }

      {
        page.fromBlockId !==
          null && (
          <Group
            gap={6}
            wrap="nowrap"
            className="movement-route-chain-step"
          >
            <IconArrowRight
              size={15}
              className="movement-route-chain-arrow"
            />

            <div
              className="movement-route-chain-card is-to"
            >
              <Text
                size="xs"
                fw={700}
                c="green"
              >
                TO BLOCK
              </Text>

              <Select
                size="xs"
                searchable
                clearable
                placeholder={
                  toOptions.length >
                    0
                    ? "Select next block"
                    : "No next block"
                }
                disabled={
                  toOptions.length ===
                  0
                }
                data={
                  toOptions
                }
                value={
                  page.toBlockId ===
                    null
                    ? null
                    : String(
                        page.toBlockId
                      )
                }
                onChange={
                  changeTo
                }
              />
            </div>
          </Group>
        )
      }

      {
        page.toBlockId !==
          null && (
          <Group
            gap={6}
            wrap="nowrap"
            className="movement-route-chain-step"
          >
            <IconArrowRight
              size={15}
              className="movement-route-chain-arrow"
            />

            <Button
              size="xs"
              variant="light"
              leftSection={
                <IconPlus
                  size={14}
                />
              }
              disabled={
                !canAddBlock
              }
              onClick={
                () => {
                  if (
                    page.toBlockId ===
                      null ||
                    !canAddBlock
                  ) {
                    return;
                  }

                  onChange({
                    ...page,
                    viaBlockIds: [
                      ...page.viaBlockIds,
                      page.toBlockId,
                    ],
                    toBlockId:
                      null,
                  });
                }
              }
            >
              Add block
            </Button>
          </Group>
        )
      }
    </div>
  );
}
