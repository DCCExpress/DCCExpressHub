import {
  Alert,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";

import {
  useEffect,
  useState,
} from "react";

import type {
  MovementPage,
} from "../../domain/movement";

import {
  loadMovementExecutionScript,
} from "../../services/movementExecutionScript";

import {
  useMovementTranslation,
} from "./movementI18n";

type Props = {
  opened: boolean;
  onClose: () => void;
  page:
    MovementPage;
};

export default function MovementExecutionScriptDialog({
  opened,
  onClose,
  page,
}: Props) {
  const mt =
    useMovementTranslation();

  const [
    script,
    setScript,
  ] =
    useState("");

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
      let disposed =
        false;

      if (!opened) {
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

      setScript(
        ""
      );

      void loadMovementExecutionScript(
        page
      )
        .then(
          value => {
            if (
              !disposed
            ) {
              setScript(
                value
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
      page,
    ]
  );

  return (
    <Modal
      opened={
        opened
      }
      onClose={
        onClose
      }
      title={
        mt(
          "movementExecutionScriptTitle",
          {
            name:
              page.name,
          }
        )
      }
      size="xl"
      centered
      className="movement-execution-script-modal"
    >
      <Stack
        gap="sm"
      >
        <Text
          size="xs"
          c="dimmed"
        >
          {mt("movementExecutionScriptDescription")}
        </Text>

        {
          loading && (
            <Stack
              gap="xs"
              align="center"
              py="xl"
            >
              <Loader
                size="sm"
              />

              <Text
                size="sm"
                c="dimmed"
              >
                {mt("movementResolvingExecutionPlan")}
              </Text>
            </Stack>
          )
        }

        {
          error && (
            <Alert
              color="red"
            >
              {
                error
              }
            </Alert>
          )
        }

        {
          !loading &&
          !error &&
          script && (
            <ScrollArea
              h="68vh"
              type="auto"
              className="movement-execution-script-scroll"
            >
              <pre
                className="movement-execution-script-code"
              >
                {
                  script
                }
              </pre>
            </ScrollArea>
          )
        }
      </Stack>
    </Modal>
  );
}
