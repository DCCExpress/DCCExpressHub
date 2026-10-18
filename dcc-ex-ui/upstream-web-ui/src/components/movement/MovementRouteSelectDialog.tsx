import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import i18next from "i18next";

import {
  IconX,
} from "@tabler/icons-react";

import type {
  MovementDocument,
  MovementPage,
} from "../../domain/movement";

import type {
  LayoutView,
} from "../../models/editor/core/LayoutView";

import {
  createCurrentClientLayoutSnapshot,
} from "../../services/clientRouteGraphCache";

import {
  applyMovementRouteCandidate,
  loadMovementRouteCandidates,
  type MovementRouteCandidate,
} from "../../services/movementRouteCatalog";

type Props = {
  opened: boolean;
  document:
    MovementDocument;
  page:
    MovementPage;
  layout:
    LayoutView;
  onClose: () => void;
  onSelect: (
    page:
      MovementPage
  ) => void;
};

export default function MovementRouteSelectDialog({
  opened,
  document,
  page,
  layout,
  onClose,
  onSelect,
}: Props) {
  const [
    candidates,
    setCandidates,
  ] =
    useState<
      MovementRouteCandidate[]
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

  const [
    fromFilter,
    setFromFilter,
  ] =
    useState("");

  const [
    toFilter,
    setToFilter,
  ] =
    useState("");

  useEffect(
    () => {
      if (!opened) {
        return;
      }

      let disposed =
        false;

      setLoading(
        true
      );

      setError(
        null
      );

      setFromFilter(
        ""
      );

      setToFilter(
        ""
      );

      const layoutSnapshot =
        createCurrentClientLayoutSnapshot(
          layout
        );

      void loadMovementRouteCandidates(
        document,
        layoutSnapshot
      )
        .then(
          result => {
            if (
              disposed
            ) {
              return;
            }

            setCandidates(
              result
            );
          }
        )
        .catch(
          loadError => {
            if (
              disposed
            ) {
              return;
            }

            setCandidates(
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
      opened,
      document,
      page.id,
      layout,
    ]
  );

  const filteredCandidates =
    useMemo(
      () => {
        const fromNeedle =
          fromFilter
            .trim()
            .toLocaleLowerCase();

        const toNeedle =
          toFilter
            .trim()
            .toLocaleLowerCase();

        return candidates.filter(
          candidate =>
            (
              !fromNeedle ||
              candidate.fromBlockName
                .toLocaleLowerCase()
                .includes(
                  fromNeedle
                )
            ) &&
            (
              !toNeedle ||
              candidate.toBlockName
                .toLocaleLowerCase()
                .includes(
                  toNeedle
                )
            )
        );
      },
      [
        candidates,
        fromFilter,
        toFilter,
      ]
    );

  const select =
    (
      candidate:
        MovementRouteCandidate
    ): void => {
      if (
        candidate.used
      ) {
        return;
      }

      onSelect(
        applyMovementRouteCandidate(
          page,
          candidate
        )
      );

      onClose();
    };

  return (
    <Modal
      opened={
        opened
      }
      onClose={
        onClose
      }
      title={
        i18next.t(
          "ui.movementSelectRouteTitle"
        )
      }
      centered
      size="min(1040px, 94vw)"
    >
      <Stack gap="sm">
        <Text
          size="sm"
          c="dimmed"
        >
          {i18next.t(
            "ui.movementSelectRouteDescription"
          )}
        </Text>

        <Group
          gap="sm"
          grow
          align="flex-end"
        >
          <TextInput
            label={
              i18next.t(
                "ui.movementFromFilter"
              )
            }
            placeholder={
              i18next.t(
                "ui.movementFilterPlaceholder"
              )
            }
            value={
              fromFilter
            }
            onChange={
              event =>
                setFromFilter(
                  event.currentTarget.value
                )
            }
            rightSection={
              fromFilter ? (
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label={
                    i18next.t(
                      "ui.clearFilter"
                    )
                  }
                  onClick={
                    () =>
                      setFromFilter(
                        ""
                      )
                  }
                >
                  <IconX
                    size={14}
                  />
                </ActionIcon>
              ) : null
            }
          />

          <TextInput
            label={
              i18next.t(
                "ui.movementToFilter"
              )
            }
            placeholder={
              i18next.t(
                "ui.movementFilterPlaceholder"
              )
            }
            value={
              toFilter
            }
            onChange={
              event =>
                setToFilter(
                  event.currentTarget.value
                )
            }
            rightSection={
              toFilter ? (
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label={
                    i18next.t(
                      "ui.clearFilter"
                    )
                  }
                  onClick={
                    () =>
                      setToFilter(
                        ""
                      )
                  }
                >
                  <IconX
                    size={14}
                  />
                </ActionIcon>
              ) : null
            }
          />
        </Group>

        {loading && (
          <Group
            justify="center"
            py="xl"
          >
            <Loader
              size="sm"
            />

            <Text
              size="sm"
              c="dimmed"
            >
              {i18next.t(
                "ui.loading"
              )}
            </Text>
          </Group>
        )}

        {!loading &&
          error && (
          <Alert
            color="red"
            title={
              i18next.t(
                "ui.error"
              )
            }
          >
            {error}
          </Alert>
        )}

        {!loading &&
          !error &&
          candidates.length ===
            0 && (
          <Text
            c="dimmed"
            ta="center"
            py="xl"
          >
            {i18next.t(
              "ui.movementNoRoutes"
            )}
          </Text>
        )}

        {!loading &&
          !error &&
          candidates.length >
            0 &&
          filteredCandidates.length ===
            0 && (
          <Text
            c="dimmed"
            ta="center"
            py="xl"
          >
            {i18next.t(
              "ui.movementNoRoutesMatchFilter"
            )}
          </Text>
        )}

        {!loading &&
          !error &&
          filteredCandidates.length >
            0 && (
          <ScrollArea.Autosize
            mah="65dvh"
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
                        110,
                    }}
                  />
                </Table.Tr>
              </Table.Thead>

              <Table.Tbody>
                {filteredCandidates.map(
                  candidate => (
                    <Table.Tr
                      key={
                        candidate.key
                      }
                      className={
                        candidate.used
                          ? "movement-route-candidate-used"
                          : undefined
                      }
                    >
                      <Table.Td>
                        <Text
                          fw={700}
                        >
                          {
                            candidate.fromBlockName
                          }
                          {" → "}
                          {
                            candidate.toBlockName
                          }
                        </Text>

                        {candidate.used && (
                          <Badge
                            mt={4}
                            size="xs"
                            color="red"
                            variant="light"
                          >
                            {i18next.t(
                              "ui.movementRouteAlreadyUsed"
                            )}
                          </Badge>
                        )}
                      </Table.Td>

                      <Table.Td>
                        <Text
                          size="sm"
                        >
                          {
                            candidate.blockPath
                              .map(
                                block =>
                                  block.name
                              )
                              .join(
                                " → "
                              )
                          }
                        </Text>

                        {candidate.nodePath.length >
                          0 && (
                          <Text
                            size="xs"
                            c="dimmed"
                          >
                            {
                              candidate.nodePath.join(
                                " → "
                              )
                            }
                          </Text>
                        )}

                        {candidate.used &&
                          candidate.usedByMovementNames.length >
                            0 && (
                          <Text
                            size="xs"
                            c="red"
                          >
                            {i18next.t(
                              "ui.movementUsedBy"
                            )}{" "}
                            {
                              candidate.usedByMovementNames.join(
                                ", "
                              )
                            }
                          </Text>
                        )}
                      </Table.Td>

                      <Table.Td
                        ta="center"
                      >
                        <Badge
                          variant="light"
                          color={
                            candidate.locoDirection ===
                              "forward"
                              ? "blue"
                              : candidate.locoDirection ===
                                  "reverse"
                                ? "orange"
                                : "gray"
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
                          candidate.turnoutCount
                        }
                      </Table.Td>

                      <Table.Td>
                        <Button
                          size="xs"
                          fullWidth
                          disabled={
                            candidate.used
                          }
                          onClick={
                            () =>
                              select(
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
  );
}
