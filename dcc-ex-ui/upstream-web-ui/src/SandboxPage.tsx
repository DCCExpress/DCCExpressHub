import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";

import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBug,
  IconDeviceFloppy,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconReload,
  IconX,
} from "@tabler/icons-react";

import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  abortSandbox,
  getSandboxStatus,
  loadSandboxSource,
  pauseSandbox,
  resumeSandbox,
  saveSandboxSource,
  startSandbox,
  stopSandbox,
  type SandboxState,
  type SandboxStatus,
} from "@/api/sandboxApi";

type Props = {
  onBack: () => void;
};

const EMPTY_STATUS: SandboxStatus = {
  ok: true,
  state: "idle",
  error: "",
  log: "",
  startedAtMs: 0,
  finishedAtMs: 0,
  totalHeap: 0,
  freeHeap: 0,
  minFreeHeap: 0,
  largestFreeHeapBlock: 0,

  totalPsram: 0,
  freePsram: 0,
  minFreePsram: 0,
  largestFreePsramBlock: 0,

  baselineFreeHeap: 0,
  baselineFreePsram: 0,
  heapDeltaSinceStart: 0,
  psramDeltaSinceStart: 0,

  sourceBytes: 0,
  vmMemoryLimitBytes: 0,
  taskStackBytes: 0,
};

function stateColor(
  state: SandboxState,
): string {
  switch (state) {
    case "running":
      return "green";

    case "paused":
      return "yellow";

    case "stopping":
    case "aborting":
      return "orange";

    case "completed":
      return "teal";

    case "error":
    case "aborted":
      return "red";

    case "stopped":
      return "gray";

    default:
      return "blue";
  }
}

function formatBytes(
  bytes: number,
): string {
  if (bytes <= 0) {
    return "-";
  }

  if (
    bytes <
    1024 * 1024
  ) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatSignedBytes(
  bytes: number,
): string {
  if (bytes === 0) {
    return "0 KB";
  }

  const sign =
    bytes > 0
      ? "+"
      : "-";

  return `${sign}${formatBytes(Math.abs(bytes))}`;
}

function usagePercent(
  free: number,
  total: number,
): string {
  if (total <= 0) {
    return "-";
  }

  return `${Math.round(((total - free) / total) * 100)}%`;
}

export default function SandboxPage({
  onBack,
}: Props) {
  const [
    code,
    setCode,
  ] =
    useState("");

  const [
    savedCode,
    setSavedCode,
  ] =
    useState("");

  const [
    status,
    setStatus,
  ] =
    useState<SandboxStatus>(
      EMPTY_STATUS,
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const logViewportRef =
    useRef<HTMLDivElement>(
      null,
    );

  const active =
    status.state === "running" ||
    status.state === "paused" ||
    status.state === "stopping" ||
    status.state === "aborting";

  const dirty =
    code !== savedCode;

  const editorExtensions =
    useMemo(
      () => [
        javascript({
          jsx: false,
          typescript: false,
        }),
      ],
      [],
    );

  const refreshStatus =
    useCallback(
      async () => {
        try {
          const next =
            await getSandboxStatus();

          setStatus(
            next,
          );

          setError("");
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : String(cause),
          );
        }
      },
      [],
    );

  const reloadSource =
    useCallback(
      async () => {
        setLoading(
          true,
        );

        setError("");

        try {
          const source =
            await loadSandboxSource();

          setCode(
            source,
          );

          setSavedCode(
            source,
          );

          await refreshStatus();
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : String(cause),
          );
        } finally {
          setLoading(
            false,
          );
        }
      },
      [
        refreshStatus,
      ],
    );

  useEffect(
    () => {
      void reloadSource();
    },
    [
      reloadSource,
    ],
  );

  useEffect(
    () => {
      const timer =
        window.setInterval(
          () => {
            void refreshStatus();
          },
          active
            ? 300
            : 1000,
        );

      return () => {
        window.clearInterval(
          timer,
        );
      };
    },
    [
      active,
      refreshStatus,
    ],
  );

  useEffect(
    () => {
      const viewport =
        logViewportRef.current;

      if (viewport) {
        viewport.scrollTop =
          viewport.scrollHeight;
      }
    },
    [
      status.log,
    ],
  );

  const execute =
    async (
      action: () => Promise<void>,
    ) => {
      setBusy(
        true,
      );

      setError("");

      try {
        await action();
        await refreshStatus();
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : String(cause),
        );
      } finally {
        setBusy(
          false,
        );
      }
    };

  const save =
    () =>
      execute(
        async () => {
          await saveSandboxSource(
            code,
          );

          setSavedCode(
            code,
          );
        },
      );

  const start =
    () =>
      execute(
        async () => {
          await startSandbox(
            code,
          );
        },
      );

  const reload =
    async () => {
      if (
        dirty &&
        !window.confirm(
          "Discard the unsaved editor changes and reload sandbox.js?",
        )
      ) {
        return;
      }

      await reloadSource();
    };

  const resetEditor =
    () => {
      if (
        dirty &&
        !window.confirm(
          "Discard the unsaved editor changes?",
        )
      ) {
        return;
      }

      setCode(
        savedCode,
      );
    };

  return (
    <Stack gap="md">
      <Group
        justify="space-between"
        align="center"
        wrap="wrap"
      >
        <Group
          gap="sm"
          wrap="nowrap"
        >
          <ActionIcon
            variant="subtle"
            color="gray"
            size="lg"
            aria-label="Back to home"
            onClick={onBack}
          >
            <IconArrowLeft
              size={22}
            />
          </ActionIcon>

          <ThemeIcon
            size={42}
            radius="md"
            variant="light"
            color="violet"
          >
            <IconBug
              size={23}
            />
          </ThemeIcon>

          <div>
            <Group
              gap="xs"
            >
              <Title
                order={3}
              >
                JavaScript Sandbox
              </Title>

              <Badge
                color={stateColor(
                  status.state,
                )}
                variant="light"
              >
                {status.state}
              </Badge>

              {dirty && (
                <Badge
                  color="orange"
                  variant="dot"
                >
                  unsaved
                </Badge>
              )}
            </Group>

            <Text
              size="sm"
              c="dimmed"
            >
              Isolated QuickJS test environment for Hub command-center scripts.
            </Text>
          </div>
        </Group>

        <Group
          gap="xs"
        >
          <Text
            size="xs"
            c="dimmed"
          >
            Source {formatBytes(code.length)}
            {" · "}
            QuickJS limit {formatBytes(status.vmMemoryLimitBytes)}
          </Text>
        </Group>
      </Group>


      <SimpleGrid
        cols={{
          base: 1,
          sm: 2,
          lg: 4,
        }}
        spacing="sm"
      >
        <Card
          withBorder
          radius="md"
          p="sm"
        >
          <Text
            size="xs"
            c="dimmed"
          >
            Internal heap
          </Text>

          <Text
            fw={700}
            size="lg"
          >
            {formatBytes(status.freeHeap)}
            {" / "}
            {formatBytes(status.totalHeap)}
          </Text>

          <Text
            size="xs"
            c="dimmed"
          >
            {usagePercent(
              status.freeHeap,
              status.totalHeap,
            )} used
          </Text>
        </Card>

        <Card
          withBorder
          radius="md"
          p="sm"
        >
          <Text
            size="xs"
            c="dimmed"
          >
            Heap Δ since Start
          </Text>

          <Text
            fw={700}
            size="lg"
          >
            {status.baselineFreeHeap > 0
              ? formatSignedBytes(
                  status.heapDeltaSinceStart,
                )
              : "-"}
          </Text>

          <Text
            size="xs"
            c="dimmed"
          >
            min {formatBytes(status.minFreeHeap)}
            {" · "}
            largest {formatBytes(status.largestFreeHeapBlock)}
          </Text>
        </Card>

        <Card
          withBorder
          radius="md"
          p="sm"
        >
          <Text
            size="xs"
            c="dimmed"
          >
            PSRAM
          </Text>

          <Text
            fw={700}
            size="lg"
          >
            {formatBytes(status.freePsram)}
            {" / "}
            {formatBytes(status.totalPsram)}
          </Text>

          <Text
            size="xs"
            c="dimmed"
          >
            {usagePercent(
              status.freePsram,
              status.totalPsram,
            )} used
          </Text>
        </Card>

        <Card
          withBorder
          radius="md"
          p="sm"
        >
          <Text
            size="xs"
            c="dimmed"
          >
            PSRAM Δ since Start
          </Text>

          <Text
            fw={700}
            size="lg"
          >
            {status.baselineFreePsram > 0
              ? formatSignedBytes(
                  status.psramDeltaSinceStart,
                )
              : "-"}
          </Text>

          <Text
            size="xs"
            c="dimmed"
          >
            min {formatBytes(status.minFreePsram)}
            {" · "}
            largest {formatBytes(status.largestFreePsramBlock)}
          </Text>
        </Card>
      </SimpleGrid>

      <Card
        withBorder
        radius="md"
        p="sm"
      >
        <Group
          justify="space-between"
          gap="sm"
          wrap="wrap"
        >
          <Text
            size="sm"
          >
            <strong>Script storage:</strong>{" "}
            <code>/scripts/sandbox.js</code>{" "}
            in LittleFS
          </Text>

          <Group
            gap="md"
            wrap="wrap"
          >
            <Text
              size="xs"
              c="dimmed"
            >
              Editor {formatBytes(code.length)}
            </Text>

            <Text
              size="xs"
              c="dimmed"
            >
              Running source {formatBytes(status.sourceBytes)}
            </Text>

            <Text
              size="xs"
              c="dimmed"
            >
              VM limit {formatBytes(status.vmMemoryLimitBytes)}
            </Text>

            <Text
              size="xs"
              c="dimmed"
            >
              Task stack {formatBytes(status.taskStackBytes)}
            </Text>
          </Group>
        </Group>

        <Text
          size="xs"
          c="dimmed"
          mt={4}
        >
          Start runs the current editor contents. Save is what writes the code
          to LittleFS; Reload reads the saved file back.
        </Text>
      </Card>

      {error && (
        <Alert
          color="red"
          icon={
            <IconAlertTriangle
              size={18}
            />
          }
          title="Sandbox"
        >
          {error}
        </Alert>
      )}

      {status.error && (
        <Alert
          color="red"
          icon={
            <IconAlertTriangle
              size={18}
            />
          }
          title="Script error"
        >
          <Box
            component="pre"
            m={0}
            style={{
              whiteSpace:
                "pre-wrap",
              fontFamily:
                "monospace",
            }}
          >
            {status.error}
          </Box>
        </Alert>
      )}

      <Card
        withBorder
        radius="md"
        p="md"
      >
        <Stack gap="sm">
          <Group
            justify="space-between"
            align="center"
            wrap="wrap"
          >
            <Group gap="xs">
              <Button
                size="xs"
                color="green"
                leftSection={
                  <IconPlayerPlay
                    size={16}
                  />
                }
                disabled={
                  active ||
                  loading ||
                  !code.trim()
                }
                loading={
                  busy &&
                  !active
                }
                onClick={() =>
                  void start()
                }
              >
                Start
              </Button>

              {status.state !==
              "paused" ? (
                <Button
                  size="xs"
                  color="yellow"
                  variant="light"
                  leftSection={
                    <IconPlayerPause
                      size={16}
                    />
                  }
                  disabled={
                    status.state !==
                    "running"
                  }
                  onClick={() =>
                    void execute(
                      pauseSandbox,
                    )
                  }
                >
                  Pause
                </Button>
              ) : (
                <Button
                  size="xs"
                  color="green"
                  variant="light"
                  leftSection={
                    <IconPlayerPlay
                      size={16}
                    />
                  }
                  onClick={() =>
                    void execute(
                      resumeSandbox,
                    )
                  }
                >
                  Resume
                </Button>
              )}

              <Button
                size="xs"
                variant="light"
                color="gray"
                leftSection={
                  <IconPlayerStop
                    size={16}
                  />
                }
                disabled={
                  !(
                    status.state ===
                      "running" ||
                    status.state ===
                      "paused"
                  )
                }
                onClick={() =>
                  void execute(
                    stopSandbox,
                  )
                }
              >
                Stop
              </Button>

              <Button
                size="xs"
                color="red"
                variant="light"
                leftSection={
                  <IconX
                    size={16}
                  />
                }
                disabled={
                  !active
                }
                onClick={() =>
                  void execute(
                    abortSandbox,
                  )
                }
              >
                Abort
              </Button>
            </Group>

            <Group gap="xs">
              <Button
                size="xs"
                variant="light"
                leftSection={
                  <IconDeviceFloppy
                    size={16}
                  />
                }
                disabled={
                  active ||
                  loading ||
                  !dirty
                }
                onClick={() =>
                  void save()
                }
              >
                Save
              </Button>

              <Button
                size="xs"
                variant="light"
                color="gray"
                leftSection={
                  <IconReload
                    size={16}
                  />
                }
                disabled={
                  active ||
                  loading
                }
                onClick={() =>
                  void reload()
                }
              >
                Reload
              </Button>

              <ActionIcon
                variant="subtle"
                color="gray"
                disabled={
                  active ||
                  loading ||
                  !dirty
                }
                aria-label="Reset editor"
                title="Reset editor to last saved source"
                onClick={resetEditor}
              >
                <IconRefresh
                  size={17}
                />
              </ActionIcon>
            </Group>
          </Group>

          {loading ? (
            <Group
              justify="center"
              py="xl"
            >
              <Loader
                size="sm"
              />
            </Group>
          ) : (
            <Box
              style={{
                border:
                  "1px solid var(--mantine-color-default-border)",
                borderRadius:
                  "var(--mantine-radius-sm)",
                overflow:
                  "hidden",
              }}
            >
              <CodeMirror
                value={code}
                height="460px"
                theme="dark"
                extensions={
                  editorExtensions
                }
                basicSetup={{
                  lineNumbers:
                    true,
                  foldGutter:
                    true,
                  highlightActiveLine:
                    true,
                  bracketMatching:
                    true,
                  closeBrackets:
                    true,
                  autocompletion:
                    true,
                  indentOnInput:
                    true,
                }}
                editable={
                  !active
                }
                onChange={
                  value =>
                    setCode(
                      value,
                    )
                }
              />
            </Box>
          )}
        </Stack>
      </Card>

      <Card
        withBorder
        radius="md"
        p="md"
      >
        <Stack gap="xs">
          <Group
            justify="space-between"
          >
            <Title
              order={5}
            >
              Output
            </Title>

            <Text
              size="xs"
              c="dimmed"
            >
              live status polling
            </Text>
          </Group>

          <ScrollArea
            h={220}
            viewportRef={
              logViewportRef
            }
            type="auto"
          >
            <Box
              component="pre"
              m={0}
              p="sm"
              style={{
                minHeight:
                  190,
                whiteSpace:
                  "pre-wrap",
                fontFamily:
                  "monospace",
                fontSize:
                  13,
              }}
            >
              {status.log ||
                "No output yet."}
            </Box>
          </ScrollArea>
        </Stack>
      </Card>

      <Alert
        color="blue"
        variant="light"
      >
        Available API:{" "}
        <code>
          hub.log()
        </code>
        ,{" "}
        <code>
          await hub.delay(ms)
        </code>
        ,{" "}
        <code>
          hub.setLoco()
        </code>
        ,{" "}
        <code>
          hub.setLocoFunction()
        </code>
        ,{" "}
        <code>
          hub.setTurnout()
        </code>
        ,{" "}
        <code>
          hub.setSignal()
        </code>
        ,{" "}
        <code>
          hub.getSensor()
        </code>
        .
      </Alert>
    </Stack>
  );
}
