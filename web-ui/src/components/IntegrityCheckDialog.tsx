import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconRefresh,
  IconShieldCheck,
  IconTrash,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  loadSignalLogicRulesWs,
} from "@/api/signalLogicWsApi";
import {
  deleteAutomationReference,
  deleteSignalAutomationById,
} from "@/api/signalLogicMaintenance";
import AppModal from "@/components/common/AppModal";
import type {
  LayoutView,
} from "@/models/editor/core/LayoutView";
import {
  inspectProjectIntegrity,
  type IntegrityReport,
} from "@/services/layoutIntegrity";
import type {
  Loco,
} from "@domain/types";

type IntegrityCheckDialogProps = {
  opened: boolean;
  onClose: () => void;
  layout: LayoutView;
  locos: Loco[];
};

type CleanupAction =
  | {
      kind: "signal";
      id: number;
    }
  | {
      kind: "sensor";
      id: number;
    }
  | {
      kind: "turnout";
      id: number;
    };

function validId(
  raw: string | undefined
): number | null {
  const id =
    Number(raw);

  return (
    Number.isInteger(id) &&
    id >= 1 &&
    id <= 0xffff
  )
    ? id
    : null;
}

function cleanupActionForMessage(
  message: string
): CleanupAction | null {
  const text =
    message.trim();

  let match =
    /^Signal ID (\d+) does not exist in the current layout\.$/u.exec(
      text
    );

  let id =
    validId(match?.[1]);

  if (id !== null) {
    return {
      kind: "signal",
      id,
    };
  }

  match =
    /^Sensor ID (\d+) does not exist in the current layout\.$/u.exec(
      text
    );

  id =
    validId(match?.[1]);

  if (id !== null) {
    return {
      kind: "sensor",
      id,
    };
  }

  match =
    /^Turnout ID (\d+) does not exist in the current layout\.$/u.exec(
      text
    );

  id =
    validId(match?.[1]);

  if (id !== null) {
    return {
      kind: "turnout",
      id,
    };
  }

  // The integrity service can also emit more contextual messages.
  match =
    /^Signal rule .+ references deleted sensor (\d+)\.$/u.exec(
      text
    );

  id =
    validId(match?.[1]);

  if (id !== null) {
    return {
      kind: "sensor",
      id,
    };
  }

  match =
    /^Signal rule .+ references deleted turnout (\d+)\.$/u.exec(
      text
    );

  id =
    validId(match?.[1]);

  if (id !== null) {
    return {
      kind: "turnout",
      id,
    };
  }

  return null;
}

function actionKey(
  action: CleanupAction
): string {
  return `${action.kind}:${action.id}`;
}

function actionLabel(
  action: CleanupAction
): string {
  switch (action.kind) {
    case "signal":
      return "Delete";
    case "sensor":
      return "Remove sensor ref";
    case "turnout":
      return "Remove turnout ref";
  }
}

export default function IntegrityCheckDialog({
  opened,
  onClose,
  layout,
  locos,
}: IntegrityCheckDialogProps) {
  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    loadError,
    setLoadError,
  ] = useState<string | null>(
    null
  );

  const [
    report,
    setReport,
  ] = useState<IntegrityReport | null>(
    null
  );

  const [
    cleanupKey,
    setCleanupKey,
  ] = useState<string | null>(
    null
  );

  const runCheck =
    useCallback(async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const signalResult =
          await loadSignalLogicRulesWs();

        setReport(
          inspectProjectIntegrity(
            layout,
            locos,
            signalResult.document,
            signalResult.issues
          )
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        setLoadError(message);

        setReport(
          inspectProjectIntegrity(
            layout,
            locos,
            null
          )
        );
      } finally {
        setLoading(false);
      }
    }, [
      layout,
      locos,
    ]);

  useEffect(() => {
    if (opened) {
      void runCheck();
    }
  }, [
    opened,
    runCheck,
  ]);

  const runCleanup =
    useCallback(
      async (
        action: CleanupAction
      ) => {
        const description =
          action.kind === "signal"
            ? `Delete orphan signal automation for Signal ID ${action.id}?`
            : `Remove all orphan ${action.kind} references to ${action.kind} ID ${action.id} from signal automation?`;

        const detail =
          action.kind === "signal"
            ? "Only the matching signal automation entry will be removed. No layout element will be deleted."
            : "Only matching conditions will be removed. Signal groups, rules and layout elements will remain.";

        if (
          !window.confirm(
            `${description}\n\n${detail}`
          )
        ) {
          return;
        }

        const key =
          actionKey(action);

        setCleanupKey(key);
        setLoadError(null);

        try {
          if (
            action.kind ===
            "signal"
          ) {
            const removed =
              await deleteSignalAutomationById(
                action.id
              );

            if (!removed) {
              setLoadError(
                `Signal automation ${action.id} was not found.`
              );
            }
          } else {
            const removed =
              await deleteAutomationReference(
                action.kind,
                action.id
              );

            if (removed === 0) {
              setLoadError(
                `No ${action.kind} reference to ID ${action.id} was found in signal automation.`
              );
            }
          }

          await runCheck();
        } catch (error) {
          setLoadError(
            error instanceof Error
              ? error.message
              : String(error)
          );
        } finally {
          setCleanupKey(null);
        }
      },
      [runCheck]
    );

  const errors =
    report?.issues.filter(
      issue =>
        issue.level === "error"
    ).length ?? 0;

  const warnings =
    report?.issues.filter(
      issue =>
        issue.level === "warning"
    ).length ?? 0;

  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      title="Project integrity check"
      size="lg"
      centered
      draggable
    >
      <Stack gap="sm">
        <Group
          justify="space-between"
        >
          <Group gap="xs">
            <IconShieldCheck
              size={24}
            />

            <div>
              <Text fw={700}>
                All project references
              </Text>

              <Text
                size="sm"
                c="dimmed"
              >
                Layout IDs, route turnouts, automatic routes,
                signal rules and locomotives.
              </Text>
            </div>
          </Group>

          <Button
            variant="light"
            leftSection={
              <IconRefresh
                size={16}
              />
            }
            loading={loading}
            onClick={() =>
              void runCheck()
            }
          >
            Check again
          </Button>
        </Group>

        {loading &&
          !report && (
            <Group gap="xs">
              <Loader size="sm" />
              <Text>
                Checking the complete project…
              </Text>
            </Group>
          )}

        {loadError && (
          <Alert
            color="red"
            icon={
              <IconAlertTriangle
                size={16}
              />
            }
          >
            {loadError}
          </Alert>
        )}

        {report &&
          !loading && (
            <Alert
              color={
                errors > 0
                  ? "red"
                  : warnings > 0
                    ? "yellow"
                    : "green"
              }
              icon={
                errors > 0
                  ? (
                    <IconAlertTriangle
                      size={16}
                    />
                  )
                  : (
                    <IconCheck
                      size={16}
                    />
                  )
              }
            >
              {errors > 0
                ? `Integrity check found ${errors} error(s) and ${warnings} warning(s).`
                : warnings > 0
                  ? `No broken references. ${warnings} warning(s) found.`
                  : "Integrity check passed. Every checked reference is valid."}
            </Alert>
          )}

        <ScrollArea.Autosize
          mah="62dvh"
          offsetScrollbars
        >
          <Stack
            gap="xs"
            pr="xs"
          >
            {report?.areas.map(
              area => {
                const areaErrors =
                  area.issues.filter(
                    issue =>
                      issue.level ===
                      "error"
                  ).length;

                const areaWarnings =
                  area.issues.filter(
                    issue =>
                      issue.level ===
                      "warning"
                  ).length;

                return (
                  <Card
                    key={area.area}
                    withBorder
                    p="sm"
                  >
                    <Group
                      justify="space-between"
                      mb={
                        area.issues.length >
                        0
                          ? "xs"
                          : 0
                      }
                    >
                      <Text fw={600}>
                        {area.area}
                      </Text>

                      <Group gap={5}>
                        <Badge
                          variant="light"
                          color="gray"
                        >
                          {area.checked} checked
                        </Badge>

                        {areaErrors >
                          0 && (
                          <Badge
                            color="red"
                          >
                            {areaErrors} errors
                          </Badge>
                        )}

                        {areaWarnings >
                          0 && (
                          <Badge
                            color="yellow"
                          >
                            {areaWarnings} warnings
                          </Badge>
                        )}

                        {area.issues.length ===
                          0 && (
                          <Badge
                            color="green"
                            leftSection={
                              <IconCheck
                                size={11}
                              />
                            }
                          >
                            OK
                          </Badge>
                        )}
                      </Group>
                    </Group>

                    {area.issues.length >
                      0 && (
                      <Stack gap={4}>
                        {area.issues.map(
                          (
                            issue,
                            index
                          ) => {
                            const action =
                              area.area ===
                              "Signal logic"
                                ? cleanupActionForMessage(
                                    issue.message
                                  )
                                : null;

                            const key =
                              action
                                ? actionKey(
                                    action
                                  )
                                : null;

                            return (
                              <Group
                                key={`${issue.message}-${index}`}
                                gap="xs"
                                wrap="nowrap"
                                align="flex-start"
                                justify="space-between"
                              >
                                <Group
                                  gap="xs"
                                  wrap="nowrap"
                                  align="flex-start"
                                  style={{
                                    flex: 1,
                                    minWidth: 0,
                                  }}
                                >
                                  <IconAlertTriangle
                                    size={15}
                                    color={
                                      issue.level ===
                                      "error"
                                        ? "var(--mantine-color-red-6)"
                                        : "var(--mantine-color-yellow-6)"
                                    }
                                    style={{
                                      flexShrink: 0,
                                      marginTop: 2,
                                    }}
                                  />

                                  <Text
                                    size="sm"
                                    style={{
                                      wordBreak:
                                        "break-word",
                                    }}
                                  >
                                    {issue.message}
                                  </Text>
                                </Group>

                                {action && (
                                  <Button
                                    size="compact-xs"
                                    color="red"
                                    variant="light"
                                    leftSection={
                                      <IconTrash
                                        size={14}
                                      />
                                    }
                                    loading={
                                      cleanupKey ===
                                      key
                                    }
                                    disabled={
                                      cleanupKey !==
                                        null &&
                                      cleanupKey !==
                                        key
                                    }
                                    onClick={() =>
                                      void runCleanup(
                                        action
                                      )
                                    }
                                  >
                                    {actionLabel(
                                      action
                                    )}
                                  </Button>
                                )}
                              </Group>
                            );
                          }
                        )}
                      </Stack>
                    )}
                  </Card>
                );
              }
            )}
          </Stack>
        </ScrollArea.Autosize>
      </Stack>
    </AppModal>
  );
}
