import {
  Group,
  Text,
  UnstyledButton,
} from "@mantine/core";

import type {
  MovementPage,
} from "../../domain/movement";

import type {
  AutomationBlockOption,
} from "../../services/automationBlockCatalog";

import MovementElapsedBadge from "./MovementElapsedBadge";

import MovementRuntimeControls, {
  useMovementRuntimeState,
} from "./MovementRuntimeControls";

type Props = {
  page:
    MovementPage;
  catalog:
    AutomationBlockOption[];
  active: boolean;
  onSelect: () => void;
};

function routeLabel(
  page:
    MovementPage,
  catalog:
    AutomationBlockOption[]
): string {
  const ids = [
    ...(page.fromBlockId ===
      null
      ? []
      : [
          page.fromBlockId,
        ]),
    ...page.viaBlockIds,
    ...(page.toBlockId ===
      null
      ? []
      : [
          page.toBlockId,
        ]),
  ];

  if (
    ids.length ===
    0
  ) {
    return "No route";
  }

  return ids
    .map(
      id =>
        catalog.find(
          block =>
            block.id ===
            id
        )?.name ||
        `#${id}`
    )
    .join(
      " → "
    );
}

export default function MovementSidebarCard({
  page,
  catalog,
  active,
  onSelect,
}: Props) {
  const state =
    useMovementRuntimeState(
      page.id
    );

  const routeIds = [
    page.fromBlockId,
    ...page.viaBlockIds,
    page.toBlockId,
  ].filter(
    (
      value
    ): value is number =>
      value !==
      null
  );

  const routeResolved =
    page.fromBlockId !==
      null &&
    page.toBlockId !==
      null &&
    routeIds.every(
      blockId =>
        catalog.some(
          block =>
            block.id ===
            blockId
        )
    );

  return (
    <div
      className={
        "movement-page-list-card" +
        (
          active
            ? " is-active"
            : ""
        )
    }
  >
      <UnstyledButton
        className="movement-page-list-select"
        onClick={
          onSelect
        }
      >
        <Group
          justify="space-between"
          gap={6}
          wrap="nowrap"
        >
          <Text
            size="sm"
            fw={600}
            truncate
          >
            {
              page.name
            }
          </Text>

          <span
            className={
              page.enabled
                ? "movement-enabled-dot"
                : "movement-disabled-dot"
            }
          />
        </Group>

        <Text
          size="xs"
          c="dimmed"
          truncate
        >
          {
            routeLabel(
              page,
              catalog
            )
          }
        </Text>
      </UnstyledButton>

      <div
        className="movement-page-list-runtime"
      >
        <MovementRuntimeControls
          page={
            page
          }
          compact
          routeResolved={
            routeResolved
          }
          showStatus
        />


        <MovementElapsedBadge
          page={
            page
          }
          state={
            state
          }
          compact
        />

        {
          state.info && (
            <Text
              size="xs"
              c={
                state.status ===
                  "error"
                  ? "red"
                  : state.status ===
                      "running"
                    ? "blue"
                    : "dimmed"
              }
              truncate
              title={
                state.info
              }
            >
              {
                state.info
              }
            </Text>
          )
        }
      </div>
    </div>
  );
}
