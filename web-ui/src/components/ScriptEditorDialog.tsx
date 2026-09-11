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
import { javascript } from "@codemirror/lang-javascript";
import type { EditorView } from "@codemirror/view";

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
    description: "Creates a named asynchronous task that can use await.",
    insert: "async function taskName() {\n  \n}",
  },
  {
    syntax: "await delay(ms)",
    description: "Waits without blocking the UI. Pause/Resume remains cooperative around await checkpoints.",
    insert: "await delay(1000);",
  },
  {
    syntax: "await Promise.all([...])",
    description: "Runs multiple asynchronous tasks in parallel and waits for all of them.",
    insert: "await Promise.all([\n  task1(),\n  task2(),\n]);",
  },

  // Blocks
  {
    syntax: "dcc.clearBlock(blockName)",
    description: "Clears the locomotive assignment from the named layout block.",
    insert: 'dcc.clearBlock("A2");',
  },
  {
    syntax: "dcc.clearBlockTargetLoco(blockName)",
    description: "Clears the current target-locomotive marker from the named block.",
    insert: 'dcc.clearBlockTargetLoco("A2");',
  },
  {
    syntax: "dcc.getBlock(blockName)",
    description: "Returns the DCC locomotive address in the named block, or 0 when the block is empty.",
    insert: 'const locoAddress = dcc.getBlock("A1");',
  },
  {
    syntax: "dcc.getBlockTargetLoco(blockName)",
    description: "Returns the locomotive address targeted to the named block, or 0 when there is no target.",
    insert: 'const targetLoco = dcc.getBlockTargetLoco("A2");',
  },
  {
    syntax: "dcc.resetBlocks()",
    description: "Clears all runtime block-to-locomotive assignments.",
    insert: "dcc.resetBlocks();",
  },
  {
    syntax: "dcc.setBlock(blockName, locoAddress)",
    description: "Moves the locomotive assignment to the named layout block by DCC address.",
    insert: 'dcc.setBlock("A2", 10);',
  },
  {
    syntax: "dcc.setBlockTargetLoco(blockName, locoAddress)",
    description: "Marks a locomotive as heading to the named block until it arrives or the script is aborted.",
    insert: 'dcc.setBlockTargetLoco("A2", 10);',
  },

  // Sensors
  {
    syntax: "dcc.getSensor(address)",
    description: "Returns the locally cached sensor state: true = ON/occupied, false = OFF/free.",
    insert: "const occupied = dcc.getSensor(100);",
  },
  {
    syntax: "dcc.setSensor(address, on)",
    description: "Sets a sensor state through the Hub runtime API. Physical S88 feedback normally uses get/wait only.",
    insert: "dcc.setSensor(100, true);",
  },
  {
    syntax: "dcc.waitForSensor(address, on, timeoutMs?)",
    description: "Waits event-driven until the cached sensor state matches the requested value. Optional timeout is in milliseconds.",
    insert: "await dcc.waitForSensor(100, true, 10000);",
  },

  // Turnouts
  {
    syntax: "dcc.getTurnout(address)",
    description: "Returns the logical turnout state from the local cache: true = CLOSED, false = THROWN.",
    insert: "const closed = dcc.getTurnout(20);",
  },
  {
    syntax: "dcc.isClosed(address)",
    description: "Returns true when the configured turnout is logically CLOSED.",
    insert: "if (dcc.isClosed(20)) {\n  \n}",
  },
  {
    syntax: "dcc.isThrown(address)",
    description: "Returns true when the configured turnout is logically THROWN.",
    insert: "if (dcc.isThrown(20)) {\n  \n}",
  },
  {
    syntax: "dcc.setClosed(address)",
    description: "Sets the turnout logically CLOSED using its layout output configuration.",
    insert: "dcc.setClosed(20);",
  },
  {
    syntax: "dcc.setThrown(address)",
    description: "Sets the turnout logically THROWN using its layout output configuration.",
    insert: "dcc.setThrown(20);",
  },
  {
    syntax: "dcc.setTurnout(address, closed)",
    description: "Sets the logical turnout state through the layout configuration. true = CLOSED, false = THROWN.",
    insert: "dcc.setTurnout(20, true);",
  },
  {
    syntax: "dcc.waitForClosed(address, timeoutMs?)",
    description: "Waits until the cached logical turnout state becomes CLOSED.",
    insert: "await dcc.waitForClosed(20, 10000);",
  },
  {
    syntax: "dcc.waitForThrown(address, timeoutMs?)",
    description: "Waits until the cached logical turnout state becomes THROWN.",
    insert: "await dcc.waitForThrown(20, 10000);",
  },
  {
    syntax: "dcc.waitForTurnout(address, closed, timeoutMs?)",
    description: "Waits until the cached logical turnout state matches the requested CLOSED/THROWN value.",
    insert: "await dcc.waitForTurnout(20, true, 10000);",
  },

  // Signals
  {
    syntax: "dcc.getSignalState(address)",
    description: "Returns the locally cached logical signal-state label, for example Red, Green, Yellow or a custom state name.",
    insert: "const state = dcc.getSignalState(100);",
  },
  {
    syntax: "dcc.isGreen(address)",
    description: "Returns true when the configured signal is logically Green.",
    insert: "if (dcc.isGreen(100)) {\n  \n}",
  },
  {
    syntax: "dcc.isRed(address)",
    description: "Returns true when the configured signal is logically Red.",
    insert: "if (dcc.isRed(100)) {\n  \n}",
  },
  {
    syntax: "dcc.isSignalState(address, stateName)",
    description: "Returns true when the signal's cached logical state matches the configured state name.",
    insert: 'if (dcc.isSignalState(100, "Slow")) {\n  \n}',
  },
  {
    syntax: "dcc.isWhite(address)",
    description: "Returns true when the configured signal is logically White.",
    insert: "if (dcc.isWhite(100)) {\n  \n}",
  },
  {
    syntax: "dcc.isYellow(address)",
    description: "Returns true when the configured signal is logically Yellow.",
    insert: "if (dcc.isYellow(100)) {\n  \n}",
  },
  {
    syntax: "dcc.setGreen(address)",
    description: "Sets the configured Green state. Basic DCC output patterns and DCC Extended aspects are resolved from the layout.",
    insert: "dcc.setGreen(100);",
  },
  {
    syntax: "dcc.setRed(address)",
    description: "Sets the configured Red state using the signal's layout output configuration.",
    insert: "dcc.setRed(100);",
  },
  {
    syntax: "dcc.setSignalAspect(address, aspect)",
    description: "Low-level escape hatch: sends an explicit DCC Extended signal aspect from 0 to 255.",
    insert: "dcc.setSignalAspect(100, 16);",
  },
  {
    syntax: "dcc.setSignalState(address, stateName)",
    description: "Sets a configured logical signal state by name. The layout translates it to Basic DCC outputs or a DCC Extended aspect.",
    insert: 'dcc.setSignalState(100, "Slow");',
  },
  {
    syntax: "dcc.setWhite(address)",
    description: "Sets the configured White signal state.",
    insert: "dcc.setWhite(100);",
  },
  {
    syntax: "dcc.setYellow(address)",
    description: "Sets the configured Yellow signal state.",
    insert: "dcc.setYellow(100);",
  },
  {
    syntax: "dcc.waitForGreen(address, timeoutMs?)",
    description: "Waits until the cached logical signal state becomes Green.",
    insert: "await dcc.waitForGreen(100, 10000);",
  },
  {
    syntax: "dcc.waitForRed(address, timeoutMs?)",
    description: "Waits until the cached logical signal state becomes Red.",
    insert: "await dcc.waitForRed(100, 10000);",
  },
  {
    syntax: "dcc.waitForSignalState(address, stateName, timeoutMs?)",
    description: "Waits event-driven until the signal reaches the configured logical state name.",
    insert: 'await dcc.waitForSignalState(100, "Slow", 10000);',
  },
  {
    syntax: "dcc.waitForWhite(address, timeoutMs?)",
    description: "Waits until the cached logical signal state becomes White.",
    insert: "await dcc.waitForWhite(100, 10000);",
  },
  {
    syntax: "dcc.waitForYellow(address, timeoutMs?)",
    description: "Waits until the cached logical signal state becomes Yellow.",
    insert: "await dcc.waitForYellow(100, 10000);",
  },

  // Other explicit setters/actions
  {
    syntax: "dcc.emergencyStop()",
    description: "Sends an emergency stop command.",
    insert: "dcc.emergencyStop();",
  },
  {
    syntax: 'dcc.sendRaw("<DCC-EX command>")',
    description: "Sends a raw DCC-EX command through the Hub.",
    insert: 'dcc.sendRaw("<s>");',
  },
  {
    syntax: "dcc.setAccessory(address, active)",
    description: "Low-level Basic DCC accessory setter.",
    insert: "dcc.setAccessory(100, true);",
  },
  {
    syntax: 'dcc.setLoco(address, speed, "forward|reverse")',
    description: "Sets locomotive speed and direction. Speed range is 0-126.",
    insert: 'dcc.setLoco(18, 30, "forward");',
  },
  {
    syntax: "dcc.setLocoFunction(address, function, active)",
    description: "Sets locomotive function F0-F28 ON or OFF.",
    insert: "dcc.setLocoFunction(18, 2, true);",
  },
  {
    syntax: "dcc.setPower(on)",
    description: "Sets MAIN track power ON or OFF.",
    insert: "dcc.setPower(true);",
  },
  {
    syntax: "dcc.setProgrammingPower(on)",
    description: "Sets programming-track power ON or OFF.",
    insert: "dcc.setProgrammingPower(true);",
  },
  {
    syntax: "playAudio(name)",
    description: "Plays /sd/audio/<name>.mp3 from the SD card. Use only the base filename, without a path or .mp3 extension.",
    insert: 'playAudio("mav_szignal");',
  },
  {
    syntax: "log(value, ...)",
    description: "Writes values to the browser console with the automation name prefix.",
    insert: 'log("Automation reached this point");',
  },
  {
    syntax: "setInfo(message)",
    description: "Shows a temporary message on the running automation card. A later call replaces it.",
    insert: 'setInfo("Mozdony indul a B1 blokkba");',
  },
].sort((a, b) =>
  a.syntax.localeCompare(b.syntax, undefined, {
    sensitivity: "base",
  })
);

async function formatScriptBody(
  script: string
): Promise<string> {
  const [prettierModule, babelModule, estreeModule] =
    await Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
    ]);

  const wrapped =
    `async function __script__() {\n${script}\n}`;

  const formattedWrapped =
    await prettierModule.default.format(wrapped, {
      parser: "babel",
      plugins: [
        babelModule.default,
        estreeModule.default,
      ],
      semi: true,
      singleQuote: false,
    });

  return formattedWrapped
    .replace(/^async function __script__\(\) {\n/, "")
    .replace(/\n}\s*$/, "")
    .split("\n")
    .map(line =>
      line.startsWith("  ")        ? line.slice(2)
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
  const { colorScheme } =
    useMantineColorScheme();

  const editorViewRef =
    useRef<EditorView | null>(null);

  const [helpOpened, setHelpOpened] =
    useState(false);
  const [draft, setDraft] =
    useState(value);
  const [formatting, setFormatting] =
    useState(false);
  const [starting, setStarting] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setDraft(value);
    setError(null);
  }, [opened, value]);

  const insertSnippet = (
    snippet: string
  ): void => {
    const view = editorViewRef.current;

    if (!view) {
      setDraft(current =>
        current
          ? `${current}\n${snippet}`
          : snippet
      );
      setHelpOpened(false);
      return;
    }

    const selection =
      view.state.selection.main;

    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: snippet,
      },
      selection: {
        anchor: selection.from + snippet.length,
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
        setDraft(await formatScriptBody(draft));
      } catch (formatError) {
        setError(
          formatError instanceof Error
            ? formatError.message
            : String(formatError)
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
        await onRun(draft);
      } catch (runError) {
        if (
          runError instanceof Error &&
          runError.name === "ScriptAbortError"
        ) {
          return;
        }

        setError(
          runError instanceof Error
            ? runError.message
            : String(runError)
        );
      } finally {
        setStarting(false);
      }
    };

  useEffect(() => {
    if (!opened) return;

    const handleKeyDown = (
      event: KeyboardEvent
    ): void => {
      const key = event.key.toLowerCase();

      if (key === "escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
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

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [opened, draft, onSave]);

  return (
    <>
      <AppModal
        opened={opened}
        onClose={onClose}
        closeOnClickOutside={false}
        closeOnEscape={false}
        trapFocus
        title={
          <Group gap="xs" wrap="nowrap">
            <IconBraces size={19} />
            <Text fw={700}>{title}</Text>
            <Badge
              size="sm"
              variant="light"
              color={statusColor(scriptStatus)}
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
            height: "76dvh",
            maxHeight: "76dvh",
            display: "flex",
            flexDirection: "column",
          },
          body: {
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          },
        }}
      >
        <Stack
          gap="xs"
          style={{ flex: 1, minHeight: 0 }}
        >
          <Group justify="space-between" wrap="nowrap">
            <Group gap={5}>
              <Tooltip label="Quick command help">
                <ActionIcon
                  variant="light"
                  color="blue"
                  onClick={() => setHelpOpened(true)}
                  aria-label="Script help"
                >
                  <IconBook2 size={17} />
                </ActionIcon>
              </Tooltip>

              <Tooltip label="Format JavaScript · Shift+Alt+F">
                <ActionIcon
                  variant="light"
                  color="violet"
                  loading={formatting}
                  onClick={() => void handleFormat()}
                  aria-label="Format JavaScript"
                >
                  <IconWand size={17} />
                </ActionIcon>
              </Tooltip>

              {scriptStatus === "idle" && (
                <Tooltip label="Run current draft">
                  <ActionIcon
                    variant="light"
                    color="green"
                    loading={starting}
                    onClick={() => void handleRun()}
                    aria-label="Run script"
                  >
                    <IconPlayerPlay size={17} />
                  </ActionIcon>
                </Tooltip>
              )}

              {scriptStatus === "running" && (
                <Tooltip label="Pause at the next cooperative await checkpoint">
                  <ActionIcon
                    variant="light"
                    color="yellow"
                    onClick={onPause}
                    aria-label="Pause script"
                  >
                    <IconPlayerPause size={17} />
                  </ActionIcon>
                </Tooltip>
              )}

              {scriptStatus === "paused" && (
                <Tooltip label="Resume paused script">
                  <ActionIcon
                    variant="light"
                    color="green"
                    onClick={onResume}
                    aria-label="Resume script"
                  >
                    <IconPlayerPlay size={17} />
                  </ActionIcon>
                </Tooltip>
              )}

              {scriptStatus !== "idle" && (
                <Tooltip label="Abort this run permanently">
                  <ActionIcon
                    variant="light"
                    color="red"
                    onClick={onAbort}
                    aria-label="Abort script"
                  >
                    <IconTrashX size={17} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>

            <Text size="xs" c="dimmed">
              Ctrl+S save · Shift+Alt+F format · ESC disabled
            </Text>
          </Group>

          {error && (
            <Alert color="red" title="JavaScript error">
              <Text
                size="sm"
                style={{
                  whiteSpace: "pre-wrap",
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
              overflow: "hidden",
              border:
                "1px solid var(--mantine-color-default-border)",
              borderRadius: 6,
            }}
          >
            <CodeMirror
              value={draft}
              height="100%"
              theme={colorScheme === "dark" ? "dark" : "light"}
              extensions={[
                javascript({
                  jsx: false,
                  typescript: false,
                }),
              ]}
              onCreateEditor={view => {
                editorViewRef.current = view;
              }}
              onChange={setDraft}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                highlightSelectionMatches: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: true,
                indentOnInput: true,
              }}
              style={{
                height: "100%",
                fontSize: 14,
              }}
            />
          </div>

          <Group
            justify="space-between"
            align="center"
            wrap="nowrap"
          >
            <Text size="xs" c="dimmed">
              Pause is cooperative around await checkpoints. Abort terminates the active run.
            </Text>

            <Group gap="xs">
              <Button
                variant="default"
                leftSection={<IconX size={15} />}
                onClick={onClose}
              >
                Close
              </Button>

              {scriptStatus === "idle" && (
                <Button
                  color="green"
                  variant="light"
                  leftSection={<IconPlayerPlay size={15} />}
                  loading={starting}
                  onClick={() => void handleRun()}
                >
                  Run
                </Button>
              )}

              {scriptStatus === "running" && (
                <Button
                  color="yellow"
                  variant="light"
                  leftSection={<IconPlayerStop size={15} />}
                  onClick={onPause}
                >
                  Stop
                </Button>
              )}

              {scriptStatus === "paused" && (
                <Button
                  color="green"
                  variant="light"
                  leftSection={<IconPlayerPlay size={15} />}
                  onClick={onResume}
                >
                  Resume
                </Button>
              )}

              {scriptStatus !== "idle" && (
                <Button
                  color="red"
                  variant="light"
                  leftSection={<IconTrashX size={15} />}
                  onClick={onAbort}
                >
                  Abort
                </Button>
              )}

              <Button
                leftSection={<IconDeviceFloppy size={15} />}
                onClick={() => onSave(draft)}
              >
                Save
              </Button>
            </Group>
          </Group>
        </Stack>
      </AppModal>

      <AppModal
        opened={opened && helpOpened}
        onClose={() => setHelpOpened(false)}
        closeOnClickOutside={false}
        closeOnEscape={false}
        title={
          <Group gap="xs" wrap="nowrap">
            <IconBook2 size={19} />
            <Text fw={700}>Script quick help</Text>
          </Group>
        }
        size="68vw"
        centered
        draggable
        resetPositionOnOpen
        styles={{
          content: {
            height: "70dvh",
            maxHeight: "70dvh",
            display: "flex",
            flexDirection: "column",
          },
          body: {
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          },
        }}
      >
        <Stack
          gap="xs"
          style={{ flex: 1, minHeight: 0 }}
        >
          <Text size="sm" c="dimmed">
            Click a row to insert its syntax at the current editor cursor or replace the current selection.
          </Text>

          <Alert color="blue" variant="light">
            Canonical commands use explicit set/get/wait names. Signal and turnout helpers use the layout configuration, while get/is/wait read the local event-driven runtime cache.
          </Alert>

          <ScrollArea
            style={{ flex: 1, minHeight: 0 }}
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
                  <Table.Th style={{ width: "44%" }}>
                    Syntax
                  </Table.Th>
                  <Table.Th>Description</Table.Th>
                </Table.Tr>
              </Table.Thead>

              <Table.Tbody>
                {SCRIPT_HELP_ITEMS.map(item => (
                  <Table.Tr
                    key={item.syntax}
                    onClick={() => insertSnippet(item.insert)}
                    style={{ cursor: "pointer" }}
                  >
                    <Table.Td>
                      <Code>{item.syntax}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {item.description}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>

          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Entries are sorted alphabetically by syntax. Legacy short setter aliases are intentionally not listed.
            </Text>
            <Button
              variant="default"
              leftSection={<IconX size={15} />}
              onClick={() => setHelpOpened(false)}
            >
              Close help
            </Button>
          </Group>
        </Stack>
      </AppModal>
    </>
  );
}