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
  Group,
  Stack,
  Text,
  TextInput,
  Switch,
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
import ScriptQuickHelp from "./ScriptQuickHelp";

type ScriptEditorDialogProps = {
  opened: boolean;
  title: string;
  value: string;
  scriptName?: string;
  scriptEnabled?: boolean;
  scriptAutoStart?: boolean;
  onSettingsChange?: (settings: { name: string; enabled: boolean; autoStart: boolean }) => void;
  scriptStatus: ClientScriptStatus;
  onClose: () => void;
  onSave: (value: string) => void;
  onRun: (value: string) => Promise<void>;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
};

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
  scriptName,
  scriptEnabled = true,
  scriptAutoStart = false,
  onSettingsChange,
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
      if (!scriptEnabled) return;
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
          {onSettingsChange && (
            <Group gap="md" align="end" wrap="wrap">
              <TextInput
                label={i18next.t("ui.scriptNameLabel")}
                value={scriptName ?? ""}
                onChange={event => onSettingsChange({ name: event.currentTarget.value, enabled: scriptEnabled, autoStart: scriptAutoStart })}
                style={{ flex: 1, minWidth: 180 }}
              />
              <Switch label={i18next.t("ui.enabled")} checked={scriptEnabled}
                onChange={event => onSettingsChange({ name: scriptName ?? "", enabled: event.currentTarget.checked, autoStart: scriptAutoStart })} />
              <Switch label={i18next.t("ui.scriptAutostartLabel")} checked={scriptAutoStart} disabled={!scriptEnabled}
                onChange={event => onSettingsChange({ name: scriptName ?? "", enabled: scriptEnabled, autoStart: event.currentTarget.checked })} />
            </Group>
          )}
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
                    disabled={!scriptEnabled}
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
                    <IconX size={17} />
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

          <Group justify="flex-end" gap="xs">
            <Button
              variant="default"
              leftSection={<IconX size={15} />}
              onClick={onClose}
            > {i18next.t("ui.close")} </Button>
            <Button
              leftSection={<IconDeviceFloppy size={15} />}
              onClick={() => onSave(draft)}
            > {i18next.t("ui.save2")} </Button>
          </Group>
        </Stack>
      </AppModal>

      <ScriptQuickHelp opened={opened && helpOpened} onClose={() => setHelpOpened(false)} onInsert={insertSnippet} />
    </>
  );
}
