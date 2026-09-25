import { useTranslation } from "react-i18next";
import i18next from "i18next";
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

//import AppModal from "./common/AppModal";
import AppModal from "@/components/common/AppModal";

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
    get description() { return i18next.t("ui.createsANamedAsynchronousTaskThatCanUseAwait"); },
    insert: "async function taskName() {\n  \n}",
  },
  {
    syntax: "await delay(ms)",
    get description() { return i18next.t("ui.waitsWithoutBlockingTheUiPauseResumeRemainsCooperativeAround"); },
    insert: "await delay(1000);",
  },
  {
    syntax: "await Promise.all([...])",
    get description() { return i18next.t("ui.runsMultipleAsynchronousTasksInParallelAndWaitsForAll"); },
    insert: "await Promise.all([\n  task1(),\n  task2(),\n]);",
  },
  {
    syntax: "isFinishing()",
    description: "Returns true when the global Automation Control Finishing mode is active.",
    insert: "if (isFinishing()) {\n  return;\n}",
  },
  {
    syntax: "isRunning()",
    description: "Returns true while global automation mode is normal. Use it around a sequence loop so Finishing completes the current sequence without starting another one.",
    insert: "while (isRunning()) {\n  await runSequence();\n}",
  },
  {
    syntax: "await switchMan([turnouts], async sw => { ... })",
    description:
      "Waits until every requested turnout is free, atomically locks the complete group, runs the callback, then automatically releases the group when the callback finishes or throws.",
    insert:
      "await switchMan([10, 11], async sw => {\n  setInfo(\"Váltókörzet beállítása\");\n\n  await sw.setTurnout(10, true);\n  await sw.setTurnout(11, false);\n\n  dcc.setLoco(18, 30, \"forward\");\n  await dcc.waitForSensor(33, true);\n});",
  },
  {
    syntax: "await switchMan([turnouts], async sw => { ... }, timeoutMs)",
    description:
      "Like switchMan(...), but throws when the complete turnout group cannot be acquired within timeoutMs.",
    insert:
      "await switchMan([10, 11], async sw => {\n  await sw.setTurnout(10, true);\n  await sw.setTurnout(11, false);\n  await dcc.waitForSensor(33, true);\n}, 30000);",
  },
  {
    syntax: "await sw.setTurnout(address, closed)",
    description:
      "Sets a turnout owned by the current SwitchMan section. Use this inside switchMan(...) instead of dcc.setTurnout(...).",
    insert: "await sw.setTurnout(10, true);",
  },
  {
    syntax: "await setRoute(name)",
    description:
      "Sets the named RouteButton with the default 250 ms delay between route turnout steps.",
    insert: 'await setRoute("Bejárat 1");',
  },
  {
    syntax: "await setRoute(name, delayMs)",
    description:
      "Sets the named RouteButton and waits delayMs between route turnout steps.",
    insert: 'await setRoute("Bejárat 1", 100);',
  },

  // Blocks
  {
    syntax: "dcc.clearBlock(blockName)",
    get description() { return i18next.t("ui.clearsTheLocomotiveAssignmentFromTheNamedLayoutBlock"); },
    insert: 'dcc.clearBlock("A2");',
  },
  {
    syntax: "dcc.clearBlockTargetLoco(blockName)",
    get description() { return i18next.t("ui.clearsTheCurrentTargetLocomotiveMarkerFromTheNamedBlock"); },
    insert: 'dcc.clearBlockTargetLoco("A2");',
  },
  {
    syntax: "dcc.getBlock(blockName)",
    get description() { return i18next.t("ui.returnsTheDccLocomotiveAddressInTheNamedBlockOr"); },
    insert: 'const locoAddress = dcc.getBlock("A1");',
  },
  {
    syntax: "dcc.getBlockTargetLoco(blockName)",
    get description() { return i18next.t("ui.returnsTheLocomotiveAddressTargetedToTheNamedBlockOr"); },
    insert: 'const targetLoco = dcc.getBlockTargetLoco("A2");',
  },
  {
    syntax: "dcc.resetBlocks()",
    get description() { return i18next.t("ui.clearsAllRuntimeBlockToLocomotiveAssignments"); },
    insert: "dcc.resetBlocks();",
  },
  {
    syntax: "dcc.setBlock(blockName, locoAddress)",
    get description() { return i18next.t("ui.movesTheLocomotiveAssignmentToTheNamedLayoutBlockBy"); },
    insert: 'dcc.setBlock("A2", 10);',
  },
  {
    syntax: "dcc.setBlockTargetLoco(blockName, locoAddress)",
    get description() { return i18next.t("ui.marksALocomotiveAsHeadingToTheNamedBlockUntil"); },
    insert: 'dcc.setBlockTargetLoco("A2", 10);',
  },

  // Sensors
  {
    syntax: "dcc.getSensor(address)",
    get description() { return i18next.t("ui.returnsTheLocallyCachedSensorStateTrueOnOccupiedFalse"); },
    insert: "const occupied = dcc.getSensor(100);",
  },
  {
    syntax: "dcc.setSensor(address, on)",
    get description() { return i18next.t("ui.setsASensorStateThroughTheHubRuntimeApiPhysical"); },
    insert: "dcc.setSensor(100, true);",
  },
  {
    syntax: "dcc.waitForSensor(address, on, timeoutMs?)",
    get description() { return i18next.t("ui.waitsEventDrivenUntilTheCachedSensorStateMatchesThe"); },
    insert: "await dcc.waitForSensor(100, true, 10000);",
  },

  // Turnouts
  {
    syntax: "dcc.getTurnout(address)",
    get description() { return i18next.t("ui.returnsTheLogicalTurnoutStateFromTheLocalCacheTrue"); },
    insert: "const closed = dcc.getTurnout(20);",
  },
  {
    syntax: "dcc.isClosed(address)",
    get description() { return i18next.t("ui.returnsTrueWhenTheConfiguredTurnoutIsLogicallyClosed"); },
    insert: "if (dcc.isClosed(20)) {\n  \n}",
  },
  {
    syntax: "dcc.isThrown(address)",
    get description() { return i18next.t("ui.returnsTrueWhenTheConfiguredTurnoutIsLogicallyThrown"); },
    insert: "if (dcc.isThrown(20)) {\n  \n}",
  },
  {
    syntax: "dcc.setClosed(address)",
    get description() { return i18next.t("ui.setsTheTurnoutLogicallyClosedUsingItsLayoutOutputConfiguration"); },
    insert: "dcc.setClosed(20);",
  },
  {
    syntax: "dcc.setThrown(address)",
    get description() { return i18next.t("ui.setsTheTurnoutLogicallyThrownUsingItsLayoutOutputConfiguration"); },
    insert: "dcc.setThrown(20);",
  },
  {
    syntax: "dcc.setTurnout(address, closed)",
    get description() { return i18next.t("ui.setsTheLogicalTurnoutStateThroughTheLayoutConfigurationTrue"); },
    insert: "dcc.setTurnout(20, true);",
  },
  {
    syntax: "dcc.waitForClosed(address, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalTurnoutStateBecomesClosed"); },
    insert: "await dcc.waitForClosed(20, 10000);",
  },
  {
    syntax: "dcc.waitForThrown(address, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalTurnoutStateBecomesThrown"); },
    insert: "await dcc.waitForThrown(20, 10000);",
  },
  {
    syntax: "dcc.waitForTurnout(address, closed, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalTurnoutStateMatchesTheRequested"); },
    insert: "await dcc.waitForTurnout(20, true, 10000);",
  },

  // Signals
  {
    syntax: "dcc.getSignalState(address)",
    get description() { return i18next.t("ui.returnsTheLocallyCachedLogicalSignalStateLabelForExample"); },
    insert: "const state = dcc.getSignalState(100);",
  },
  {
    syntax: "dcc.isGreen(address)",
    get description() { return i18next.t("ui.returnsTrueWhenTheConfiguredSignalIsLogicallyGreen"); },
    insert: "if (dcc.isGreen(100)) {\n  \n}",
  },
  {
    syntax: "dcc.isRed(address)",
    get description() { return i18next.t("ui.returnsTrueWhenTheConfiguredSignalIsLogicallyRed"); },
    insert: "if (dcc.isRed(100)) {\n  \n}",
  },
  {
    syntax: "dcc.isSignalState(address, stateName)",
    get description() { return i18next.t("ui.returnsTrueWhenTheSignalSCachedLogicalStateMatches"); },
    insert: 'if (dcc.isSignalState(100, "Slow")) {\n  \n}',
  },
  {
    syntax: "dcc.isWhite(address)",
    get description() { return i18next.t("ui.returnsTrueWhenTheConfiguredSignalIsLogicallyWhite"); },
    insert: "if (dcc.isWhite(100)) {\n  \n}",
  },
  {
    syntax: "dcc.isYellow(address)",
    get description() { return i18next.t("ui.returnsTrueWhenTheConfiguredSignalIsLogicallyYellow"); },
    insert: "if (dcc.isYellow(100)) {\n  \n}",
  },
  {
    syntax: "dcc.setGreen(address)",
    get description() { return i18next.t("ui.setsTheConfiguredGreenStateBasicDccOutputPatternsAnd"); },
    insert: "dcc.setGreen(100);",
  },
  {
    syntax: "dcc.setRed(address)",
    get description() { return i18next.t("ui.setsTheConfiguredRedStateUsingTheSignalSLayout"); },
    insert: "dcc.setRed(100);",
  },
  {
    syntax: "dcc.setSignalAspect(address, aspect)",
    get description() { return i18next.t("ui.lowLevelEscapeHatchSendsAnExplicitDccExtendedSignal"); },
    insert: "dcc.setSignalAspect(100, 16);",
  },
  {
    syntax: "dcc.setSignalState(address, stateName)",
    get description() { return i18next.t("ui.setsAConfiguredLogicalSignalStateByNameTheLayout"); },
    insert: 'dcc.setSignalState(100, "Slow");',
  },
  {
    syntax: "dcc.setWhite(address)",
    get description() { return i18next.t("ui.setsTheConfiguredWhiteSignalState"); },
    insert: "dcc.setWhite(100);",
  },
  {
    syntax: "dcc.setYellow(address)",
    get description() { return i18next.t("ui.setsTheConfiguredYellowSignalState"); },
    insert: "dcc.setYellow(100);",
  },
  {
    syntax: "dcc.waitForGreen(address, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalSignalStateBecomesGreen"); },
    insert: "await dcc.waitForGreen(100, 10000);",
  },
  {
    syntax: "dcc.waitForRed(address, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalSignalStateBecomesRed"); },
    insert: "await dcc.waitForRed(100, 10000);",
  },
  {
    syntax: "dcc.waitForSignalState(address, stateName, timeoutMs?)",
    get description() { return i18next.t("ui.waitsEventDrivenUntilTheSignalReachesTheConfiguredLogical"); },
    insert: 'await dcc.waitForSignalState(100, "Slow", 10000);',
  },
  {
    syntax: "dcc.waitForWhite(address, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalSignalStateBecomesWhite"); },
    insert: "await dcc.waitForWhite(100, 10000);",
  },
  {
    syntax: "dcc.waitForYellow(address, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalSignalStateBecomesYellow"); },
    insert: "await dcc.waitForYellow(100, 10000);",
  },

  // Other explicit setters/actions
  {
    syntax: "dcc.emergencyStop()",
    get description() { return i18next.t("ui.sendsAnEmergencyStopCommand"); },
    insert: "dcc.emergencyStop();",
  },
  {
    syntax: 'dcc.sendRaw("<DCC-EX command>")',
    get description() { return i18next.t("ui.sendsARawDccExCommandThroughTheHub"); },
    insert: 'dcc.sendRaw("<s>");',
  },
  {
    syntax: "dcc.setAccessory(address, active)",
    get description() { return i18next.t("ui.lowLevelBasicDccAccessorySetter"); },
    insert: "dcc.setAccessory(100, true);",
  },
  {
    syntax: 'dcc.setLoco(address, speed, "forward|reverse")',
    get description() { return i18next.t("ui.setsLocomotiveSpeedAndDirectionSpeedRangeIs0126"); },
    insert: 'dcc.setLoco(18, 30, "forward");',
  },
  {
    syntax: "dcc.setLocoFunction(address, function, active)",
    get description() { return i18next.t("ui.setsLocomotiveFunctionF0F28OnOrOff"); },
    insert: "dcc.setLocoFunction(18, 2, true);",
  },
  {
    syntax: "dcc.setPower(on)",
    get description() { return i18next.t("ui.setsMainTrackPowerOnOrOff"); },
    insert: "dcc.setPower(true);",
  },
  {
    syntax: "dcc.setProgrammingPower(on)",
    get description() { return i18next.t("ui.setsProgrammingTrackPowerOnOrOff"); },
    insert: "dcc.setProgrammingPower(true);",
  },
  {
    syntax: "playAudio(name)",
    get description() { return i18next.t("ui.playsSdAudioNameMp3FromTheSdCardUse"); },
    insert: 'playAudio("mav_szignal");',
  },
  {
    syntax: "await playAudio(name)",
    get description() { return i18next.t("ui.waitsUntilAudioPlaybackFinishes"); },
    insert: 'await playAudio("mav_szignal");',
  },
  {
    syntax: "log(value, ...)",
    get description() { return i18next.t("ui.writesValuesToTheBrowserConsoleWithTheAutomationName"); },
    insert: 'log("Automation reached this point");',
  },
  {
    syntax: "setInfo(message)",
    get description() { return i18next.t("ui.showsATemporaryMessageOnTheRunningAutomationCardA"); },
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
  useTranslation();
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
              <Tooltip label={i18next.t("ui.quickCommandHelp")}>
                <ActionIcon
                  variant="light"
                  color="blue"
                  onClick={() => setHelpOpened(true)}
                  aria-label={i18next.t("ui.scriptHelp")}
                >
                  <IconBook2 size={17} />
                </ActionIcon>
              </Tooltip>

              <Tooltip label={i18next.t("ui.formatJavascriptShiftAltF")}>
                <ActionIcon
                  variant="light"
                  color="violet"
                  loading={formatting}
                  onClick={() => void handleFormat()}
                  aria-label={i18next.t("ui.formatJavascript")}
                >
                  <IconWand size={17} />
                </ActionIcon>
              </Tooltip>

              {scriptStatus === "idle" && (
                <Tooltip label={i18next.t("ui.runCurrentDraft")}>
                  <ActionIcon
                    variant="light"
                    color="green"
                    loading={starting}
                    onClick={() => void handleRun()}
                    aria-label={i18next.t("ui.runScript")}
                  >
                    <IconPlayerPlay size={17} />
                  </ActionIcon>
                </Tooltip>
              )}

              {scriptStatus === "running" && (
                <Tooltip label={i18next.t("ui.pauseAtTheNextCooperativeAwaitCheckpoint")}>
                  <ActionIcon
                    variant="light"
                    color="yellow"
                    onClick={onPause}
                    aria-label={i18next.t("ui.pauseScript")}
                  >
                    <IconPlayerPause size={17} />
                  </ActionIcon>
                </Tooltip>
              )}

              {scriptStatus === "paused" && (
                <Tooltip label={i18next.t("ui.resumePausedScript")}>
                  <ActionIcon
                    variant="light"
                    color="green"
                    onClick={onResume}
                    aria-label={i18next.t("ui.resumeScript")}
                  >
                    <IconPlayerPlay size={17} />
                  </ActionIcon>
                </Tooltip>
              )}

              {scriptStatus !== "idle" && (
                <Tooltip label={i18next.t("ui.abortThisRunPermanently")}>
                  <ActionIcon
                    variant="light"
                    color="red"
                    onClick={onAbort}
                    aria-label={i18next.t("ui.abortScript")}
                  >
                    <IconTrashX size={17} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>

            <Text size="xs" c="dimmed"> {i18next.t("ui.ctrlSSaveShiftAltFFormatEscDisabled")} </Text>
          </Group>

          {error && (
            <Alert color="red" title={i18next.t("ui.javascriptError")}>
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
            <Text size="xs" c="dimmed"> {i18next.t("ui.pauseIsCooperativeAroundAwaitCheckpointsAbortTerminatesTheActive")} </Text>

            <Group gap="xs">
              <Button
                variant="default"
                leftSection={<IconX size={15} />}
                onClick={onClose}
              > {i18next.t("ui.close")} </Button>

              {scriptStatus === "idle" && (
                <Button
                  color="green"
                  variant="light"
                  leftSection={<IconPlayerPlay size={15} />}
                  loading={starting}
                  onClick={() => void handleRun()}
                > {i18next.t("ui.run")} </Button>
              )}

              {scriptStatus === "running" && (
                <Button
                  color="yellow"
                  variant="light"
                  leftSection={<IconPlayerStop size={15} />}
                  onClick={onPause}
                > {i18next.t("ui.stop")} </Button>
              )}

              {scriptStatus === "paused" && (
                <Button
                  color="green"
                  variant="light"
                  leftSection={<IconPlayerPlay size={15} />}
                  onClick={onResume}
                > {i18next.t("ui.resume")} </Button>
              )}

              {scriptStatus !== "idle" && (
                <Button
                  color="red"
                  variant="light"
                  leftSection={<IconTrashX size={15} />}
                  onClick={onAbort}
                > {i18next.t("ui.abort")} </Button>
              )}

              <Button
                leftSection={<IconDeviceFloppy size={15} />}
                onClick={() => onSave(draft)}
              > {i18next.t("ui.save2")} </Button>
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
            <Text fw={700}>{i18next.t("ui.scriptQuickHelp")}</Text>
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
          <Text size="sm" c="dimmed"> {i18next.t("ui.clickARowToInsertItsSyntaxAtTheCurrent")} </Text>

          <Alert color="blue" variant="light"> {i18next.t("ui.canonicalCommandsUseExplicitSetGetWaitNamesSignalAnd")} </Alert>

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
                  <Table.Th style={{ width: "44%" }}> {i18next.t("ui.syntax")} </Table.Th>
                  <Table.Th>{i18next.t("ui.description")}</Table.Th>
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
            <Text size="xs" c="dimmed"> {i18next.t("ui.entriesAreSortedAlphabeticallyBySyntaxLegacyShortSetterAliases")} </Text>
            <Button
              variant="default"
              leftSection={<IconX size={15} />}
              onClick={() => setHelpOpened(false)}
            > {i18next.t("ui.closeHelp")} </Button>
          </Group>
        </Stack>
      </AppModal>
    </>
  );
}
