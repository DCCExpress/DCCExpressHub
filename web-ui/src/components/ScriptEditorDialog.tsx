import {
  useEffect,
  useState,
} from "react";

import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Stack,
  Text,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";

import {
  IconBraces,
  IconDeviceFloppy,
  IconPlayerPlay,
  IconWand,
  IconX,
} from "@tabler/icons-react";

import CodeMirror from "@uiw/react-codemirror";
import {
  javascript,
} from "@codemirror/lang-javascript";

import AppModal from "./AppModal";

type ScriptEditorDialogProps = {
  opened: boolean;
  title: string;
  value: string;
  onClose: () => void;
  onSave: (value: string) => void;
  onRun: (value: string) => Promise<void>;
};

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

export default function ScriptEditorDialog({
  opened,
  title,
  value,
  onClose,
  onSave,
  onRun,
}: ScriptEditorDialogProps) {
  const {
    colorScheme,
  } =
    useMantineColorScheme();

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
    running,
    setRunning,
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
        setRunning(true);
        setError(null);

        await onRun(
          draft
        );
      } catch (
        runError
      ) {
        setError(
          runError instanceof Error
            ? runError.message
            : String(
                runError
              )
        );
      } finally {
        setRunning(false);
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
          (
            event.ctrlKey ||
            event.metaKey
          ) &&
          key === "s"
        ) {
          event.preventDefault();
          event.stopPropagation();

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
    <AppModal
      opened={opened}
      onClose={onClose}
      closeOnClickOutside={false}
      closeOnEscape={false}
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
        </Group>
      }
      size="72vw"
      centered
      draggable
      resetPositionOnOpen
      styles={{
        content: {
          height:
            "78dvh",
          maxHeight:
            "78dvh",
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

            <Tooltip
              label="Run current draft"
            >
              <ActionIcon
                variant="light"
                color="green"
                loading={running}
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
          </Group>

          <Text
            size="xs"
            c="dimmed"
          >
            Ctrl+S save · Shift+Alt+F format
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
            Scripts run in the browser and send commands to the Hub through WebSocket.
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
              Cancel
            </Button>

            <Button
              color="green"
              variant="light"
              leftSection={
                <IconPlayerPlay
                  size={15}
                />
              }
              loading={running}
              onClick={() => {
                void handleRun();
              }}
            >
              Run test
            </Button>

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
  );
}
