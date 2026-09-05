import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";

import {
  IconBook2,
  IconBraces,
  IconDeviceFloppy,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconTrashX,
  IconWand,
  IconX,
} from "@tabler/icons-react";

import CodeMirror from "@uiw/react-codemirror";

import {
  javascript,
} from "@codemirror/lang-javascript";

import type {
  EditorView,
} from "@codemirror/view";

import type {
  ClientScriptStatus,
} from "../services/clientScriptRunner";

import AppModal from "./AppModal";

type ScriptEditorDialogProps = {
  opened: boolean;
  title: string;
  value: string;
  scriptStatus: ClientScriptStatus;
  onClose: () => void;
  onSave: (value: string) => void;
  onRun: (value: string) => Promise<void>;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
};

type ScriptHelpItem = {
  syntax: string;
  description: string;
  insert: string;
};

const SCRIPT_HELP_ITEMS: ScriptHelpItem[] = [
  {
    syntax: "async function name()",
    description:
      "Creates a named asynchronous task that can use await.",
    insert:
      "async function taskName() {\n  \n}",
  },
  {
    syntax: "await delay(ms)",
    description:
      "Waits without blocking the UI. Stop/Resume can pause around this checkpoint.",
    insert:
      "await delay(1000);",
  },
  {
    syntax: "await Promise.all([...])",
    description:
      "Runs multiple async tasks in parallel and waits until all of them finish.",
    insert:
      "await Promise.all([\n  task1(),\n  task2(),\n]);",
  },
  {
    syntax: "dcc.accessory(address, active)",
    description:
      "Sets a basic accessory output ON or OFF.",
    insert:
      "dcc.accessory(100, true);",
  },
  {
    syntax: "dcc.block(blockId, locoId, locoAddress?)",
    description:
      "Assigns a locomotive to a physical layout block.",
    insert:
      'dcc.block(1, "loco-18", 18);',
  },
  {
    syntax: "dcc.clearBlock(blockId, locoId?)",
    description:
      "Removes the locomotive assignment from a layout block.",
    insert:
      "dcc.clearBlock(1);",
  },
  {
    syntax: "dcc.emergencyStop()",
    description:
      "Sends an emergency stop command.",
    insert:
      "dcc.emergencyStop();",
  },
  {
    syntax: 'dcc.loco(address, speed, "forward|reverse")',
    description:
      "Sets locomotive speed and direction. Speed range is 0–126.",
    insert:
      'dcc.loco(18, 30, "forward");',
  },
  {
    syntax: "dcc.locoFunction(address, function, active)",
    description:
      "Turns locomotive function F0–F28 ON or OFF.",
    insert:
      "dcc.locoFunction(18, 2, true);",
  },
  {
    syntax: "dcc.power(on)",
    description:
      "Turns MAIN track power ON or OFF.",
    insert:
      "dcc.power(true);",
  },
  {
    syntax: "dcc.programmingPower(on)",
    description:
      "Turns programming-track power ON or OFF.",
    insert:
      "dcc.programmingPower(true);",
  },
  {
    syntax: 'dcc.raw("<DCC-EX command>")',
    description:
      "Sends a raw DCC-EX command through the Hub.",
    insert:
      'dcc.raw("<s>");',
  },
  {
    syntax: "dcc.resetBlocks()",
    description:
      "Clears all runtime block-to-locomotive assignments.",
    insert:
      "dcc.resetBlocks();",
  },
  {
    syntax: "dcc.sensor(address, on)",
    description:
      "Sets a sensor state through the Hub runtime API.",
    insert:
      "dcc.sensor(1, true);",
  },
  {
    syntax: "dcc.signal(address, aspect)",
    description:
      "Sets an extended accessory / signal aspect value from 0–255.",
    insert:
      "dcc.signal(100, 16);",
  },
  {
    syntax: "dcc.turnout(address, closed)",
    description:
      "Sets a turnout CLOSED (true) or THROWN (false).",
    insert:
      "dcc.turnout(20, true);",
  },
  {
    syntax: "log(value, ...)",
    description:
      "Writes values to the browser console with the automation name prefix.",
    insert:
      'log("Automation reached this point");',
  },
].sort(
  (a, b) =>
    a.syntax.localeCompare(
      b.syntax,
      undefined,
      {
        sensitivity: "base",
      }
    )
);

async function formatScriptBody(
  script: string
): Promise<string> {
  const [
    prettierModule,
    babelModule,
    estreeModule,
  ] = await Promise.all([
    import("prettier/standalone"),
    import("prettier/plugins/babel"),
    import("prettier/plugins/estree"),
  ]);

  const prettier =
    prettierModule.default;

  const babelPlugin =
    babelModule.default;

  const estreePlugin =
    estreeModule.default;

  const wrapped =
    `async function __script__() {\n${script}\n}`;

  const formattedWrapped =
    await prettier.format(
      wrapped,
      {
        parser: "babel",
        plugins: [
          babelPlugin,
          estreePlugin,
        ],
        semi: true,
        singleQuote: false,
      }
    );

  const body =
    formattedWrapped
      .replace(
        /^async function __script__\(\) {\n/,
        ""
      )
      .replace(
        /\n}\s*$/,
        ""
      );

  return body
    .split("\n")
    .map(line =>
      line.startsWith("  ")
        ? line.slice(2)
        : line
    )
    .join("\n");
}

function statusColor(
  status: ClientScriptStatus
): string {
  if (status === "running") return "green";
  if (status === "paused") return "yellow";
  return "gray";
}

export default function ScriptEditorDialog({
  opened,
  title,
  value,
  scriptStatus,
  onClose,
  onSave,
  onRun,
  onPause,
  onResume,
  onAbort,
}: ScriptEditorDialogProps) {
  const {
    colorScheme,
  } =
    useMantineColorScheme();

  const editorViewRef =
    useRef<EditorView | null>(
      null
    );

  const [
    helpOpened,
    setHelpOpened,
  ] =
    useState(false);

  const [
    draft,
    setDraft,
  ] =
    useState(value);

  const [
    formatting,
    setFormatting,
  ] =
    useState(false);

  const [
    starting,
    setStarting,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );

  useEffect(() => {
    if (!opened) return;

    setDraft(value);
    setError(null);
  }, [
    opened,
    value,
  ]);

  const insertSnippet = (
    snippet: string
  ): void => {
    const view =
      editorViewRef.current;

    if (!view) {
      setDraft(current => {
        if (!current) {
          return snippet;
        }

        return `${current}\n${snippet}`;
      });

      setHelpOpened(false);
      return;
    }

    const selection =
      view.state.selection.main;

    const from =
      selection.from;

    const to =
      selection.to;

    view.dispatch({
      changes: {
        from,
        to,
        insert: snippet,
      },
      selection: {
        anchor:
          from +
          snippet.length,
      },
      scrollIntoView: true,
    });

    view.focus();

    setHelpOpened(false);
  };

  const handleFormat =
    async (): Promise<void> => {
      try {
        setFormatting(true);
        setError(null);

        setDraft(
          await formatScriptBody(
            draft
          )
        );
      } catch (
        formatError
      ) {
        setError(
          formatError instanceof Error
            ? formatError.message
            : String(
                formatError
              )
        );
      } finally {
        setFormatting(false);
      }
    };

  const handleRun =
    async (): Promise<void> => {
      try {
        setStarting(true);
        setError(null);

        await onRun(
          draft
        );
      } catch (
        runError
      ) {
        if (
          runError instanceof Error &&
          runError.name ===
            "ScriptAbortError"
        ) {
          return;
        }

        setError(
          runError instanceof Error
            ? runError.message
            : String(
                runError
              )
        );
      } finally {
        setStarting(false);
      }
    };

  useEffect(() => {
    if (!opened) return;

    const handleKeyDown =
      (
        event: KeyboardEvent
      ): void => {
        const key =
          event.key.toLowerCase();

        if (
          key === "escape"
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          return;
        }

        if (
          (
            event.ctrlKey ||
            event.metaKey
          ) &&
          key === "s"
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          onSave(draft);
          return;
        }

        if (
          event.shiftKey &&
          event.altKey &&
          key === "f"
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          void handleFormat();
        }
      };

    window.addEventListener(
      "keydown",
      handleKeyDown,
      true
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
        true
      );
    };
  }, [
    opened,
    draft,
    onSave,
  ]);

  return (
    <>
      <AppModal
        opened={opened}
        onClose={onClose}
        closeOnClickOutside={false}
        closeOnEscape={false}
        trapFocus
        title={
          <Group
            gap="xs"
            wrap="nowrap"
          >
            <IconBraces
              size={19}
            />

            <Text fw={700}>
              {title}
            </Text>

            <Badge
              size="sm"
              variant="light"
              color={
                statusColor(
                  scriptStatus
                )
              }
            >
              {scriptStatus.toUpperCase()}
            </Badge>
          </Group>
        }
        size="68vw"
        centered
        draggable
        resetPositionOnOpen
        styles={{
          content: {
            height:
              "76dvh",
            maxHeight:
              "76dvh",
            display:
              "flex",
            flexDirection:
              "column",
          },
          body: {
            flex: 1,
            minHeight: 0,
            display:
              "flex",
            flexDirection:
              "column",
          },
        }}
      >
        <Stack
          gap="xs"
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <Group
            justify="space-between"
            wrap="nowrap"
          >
            <Group gap={5}>
              <Tooltip
                label="Quick command help"
              >
                <ActionIcon
                  variant="light"
                  color="blue"
                  onClick={() => {
                    setHelpOpened(true);
                  }}
                  aria-label="Script help"
                >
                  <IconBook2
                    size={17}
                  />
                </ActionIcon>
              </Tooltip>

              <Tooltip
                label="Format JavaScript · Shift+Alt+F"
              >
                <ActionIcon
                  variant="light"
                  color="violet"
                  loading={formatting}
                  onClick={() => {
                    void handleFormat();
                  }}
                  aria-label="Format JavaScript"
                >
                  <IconWand
                    size={17}
                  />
                </ActionIcon>
              </Tooltip>

              {scriptStatus ===
                "idle" && (
                <Tooltip
                  label="Run current draft"
                >
                  <ActionIcon
                    variant="light"
                    color="green"
                    loading={starting}
                    onClick={() => {
                      void handleRun();
                    }}
                    aria-label="Run script"
                  >
                    <IconPlayerPlay
                      size={17}
                    />
                  </ActionIcon>
                </Tooltip>
              )}

              {scriptStatus ===
                "running" && (
                <Tooltip
                  label="Stop / pause at the next await delay() checkpoint"
                >
                  <ActionIcon
                    variant="light"
                    color="yellow"
                    onClick={onPause}
                    aria-label="Pause script"
                  >
                    <IconPlayerPause
                      size={17}
                    />
                  </ActionIcon>
                </Tooltip>
              )}

              {scriptStatus ===
                "paused" && (
                <Tooltip
                  label="Resume paused script"
                >
                  <ActionIcon
                    variant="light"
                    color="green"
                    onClick={onResume}
                    aria-label="Resume script"
                  >
                    <IconPlayerPlay
                      size={17}
                    />
                  </ActionIcon>
                </Tooltip>
              )}

              {scriptStatus !==
                "idle" && (
                <Tooltip
                  label="Abort this run permanently"
                >
                  <ActionIcon
                    variant="light"
                    color="red"
                    onClick={onAbort}
                    aria-label="Abort script"
                  >
                    <IconTrashX
                      size={17}
                    />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>

            <Text
              size="xs"
              c="dimmed"
            >
              Ctrl+S save · Shift+Alt+F format · ESC disabled
            </Text>
          </Group>

          {error && (
            <Alert
              color="red"
              title="JavaScript error"
            >
              <Text
                size="sm"
                style={{
                  whiteSpace:
                    "pre-wrap",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                }}
              >
                {error}
              </Text>
            </Alert>
          )}

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow:
                "hidden",
              border:
                "1px solid var(--mantine-color-default-border)",
              borderRadius: 6,
            }}
          >
            <CodeMirror
              value={draft}
              height="100%"
              theme={
                colorScheme ===
                "dark"
                  ? "dark"
                  : "light"
              }
              extensions={[
                javascript({
                  jsx: false,
                  typescript:
                    false,
                }),
              ]}
              onCreateEditor={view => {
                editorViewRef.current =
                  view;
              }}
              onChange={setDraft}
              basicSetup={{
                lineNumbers:
                  true,
                foldGutter:
                  true,
                highlightActiveLine:
                  true,
                highlightSelectionMatches:
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
              style={{
                height:
                  "100%",
                fontSize: 14,
              }}
            />
          </div>

          <Group
            justify="space-between"
            align="center"
            wrap="nowrap"
          >
            <Text
              size="xs"
              c="dimmed"
            >
              Stop pauses cooperatively at await delay(). Abort terminates the active run.
            </Text>

            <Group gap="xs">
              <Button
                variant="default"
                leftSection={
                  <IconX
                    size={15}
                  />
                }
                onClick={onClose}
              >
                Close
              </Button>

              {scriptStatus ===
                "idle" && (
                <Button
                  color="green"
                  variant="light"
                  leftSection={
                    <IconPlayerPlay
                      size={15}
                    />
                  }
                  loading={starting}
                  onClick={() => {
                    void handleRun();
                  }}
                >
                  Run
                </Button>
              )}

              {scriptStatus ===
                "running" && (
                <Button
                  color="yellow"
                  variant="light"
                  leftSection={
                    <IconPlayerStop
                      size={15}
                    />
                  }
                  onClick={onPause}
                >
                  Stop
                </Button>
              )}

              {scriptStatus ===
                "paused" && (
                <Button
                  color="green"
                  variant="light"
                  leftSection={
                    <IconPlayerPlay
                      size={15}
                    />
                  }
                  onClick={onResume}
                >
                  Resume
                </Button>
              )}

              {scriptStatus !==
                "idle" && (
                <Button
                  color="red"
                  variant="light"
                  leftSection={
                    <IconTrashX
                      size={15}
                    />
                  }
                  onClick={onAbort}
                >
                  Abort
                </Button>
              )}

              <Button
                leftSection={
                  <IconDeviceFloppy
                    size={15}
                  />
                }
                onClick={() => {
                  onSave(draft);
                }}
              >
                Save
              </Button>
            </Group>
          </Group>
        </Stack>
      </AppModal>

      <AppModal
        opened={
          opened &&
          helpOpened
        }
        onClose={() => {
          setHelpOpened(false);
        }}
        closeOnClickOutside={false}
        closeOnEscape={false}
        title={
          <Group
            gap="xs"
            wrap="nowrap"
          >
            <IconBook2
              size={19}
            />

            <Text fw={700}>
              Script quick help
            </Text>
          </Group>
        }
        size="58vw"
        centered
        draggable
        resetPositionOnOpen
        styles={{
          content: {
            height:
              "62dvh",
            maxHeight:
              "62dvh",
            display:
              "flex",
            flexDirection:
              "column",
          },
          body: {
            flex: 1,
            minHeight: 0,
            display:
              "flex",
            flexDirection:
              "column",
          },
        }}
      >
        <Stack
          gap="xs"
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <Text
            size="sm"
            c="dimmed"
          >
            Click a row to insert its syntax at the current editor cursor or replace the current selection.
          </Text>

          <ScrollArea
            style={{
              flex: 1,
              minHeight: 0,
            }}
            type="always"
            scrollbarSize={9}
          >
            <Table
              striped
              highlightOnHover
              withTableBorder
              withColumnBorders
              stickyHeader
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th
                    style={{
                      width: "42%",
                    }}
                  >
                    Syntax
                  </Table.Th>

                  <Table.Th>
                    Description
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>

              <Table.Tbody>
                {SCRIPT_HELP_ITEMS.map(
                  item => (
                    <Table.Tr
                      key={
                        item.syntax
                      }
                      onClick={() => {
                        insertSnippet(
                          item.insert
                        );
                      }}
                      style={{
                        cursor:
                          "pointer",
                      }}
                    >
                      <Table.Td>
                        <Code>
                          {item.syntax}
                        </Code>
                      </Table.Td>

                      <Table.Td>
                        <Text
                          size="sm"
                        >
                          {item.description}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>

          <Group
            justify="space-between"
          >
            <Text
              size="xs"
              c="dimmed"
            >
              Entries are sorted alphabetically by syntax.
            </Text>

            <Button
              variant="default"
              leftSection={
                <IconX
                  size={15}
                />
              }
              onClick={() => {
                setHelpOpened(false);
              }}
            >
              Close help
            </Button>
          </Group>
        </Stack>
      </AppModal>
    </>
  );
}
