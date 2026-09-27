import {
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
} from "@mantine/core";

import {
  useEffect,
  useState,
} from "react";

import i18next from "i18next";

import type {
  MovementDocument,
  MovementPage,
} from "../../domain/movement";

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

      void loadMovementRouteCandidates(
        document
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
    ]
  );

  const select =
    (
      candidate:
        MovementRouteCandidate
    ): void => {
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
              "ui.movementNoUnusedRoutes"
            )}
          </Text>
        )}

        {!loading &&
          !error &&
          candidates.length >
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
                {candidates.map(
                  candidate => (
                    <Table.Tr
                      key={
                        candidate.key
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
                          candidate.turnoutCount
                        }
                      </Table.Td>

                      <Table.Td>
                        <Button
                          size="xs"
                          fullWidth
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
