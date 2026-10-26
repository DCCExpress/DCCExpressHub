import { useRef, useState } from "react";
import { Button, Code, Group, Modal, Stack, Text, useMantineColorScheme } from "@mantine/core";
import { IconBook2, IconBraces } from "@tabler/icons-react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import type { EditorView } from "@codemirror/view";
import i18next from "i18next";
import ScriptQuickHelp from "../ScriptQuickHelp";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export default function AutomationFlowFunctionEditor({ value, onChange }: Props) {
  const [opened, setOpened] = useState(false);
  const [helpOpened, setHelpOpened] = useState(false);
  const editorViewRef = useRef<EditorView | null>(null);
  const { colorScheme } = useMantineColorScheme();
  const hu = i18next.language.startsWith("hu");

  const insertSnippet = (snippet: string) => {
    const view = editorViewRef.current;
    if (view) {
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: snippet },
        selection: { anchor: selection.from + snippet.length },
        scrollIntoView: true,
      });
      view.focus();
    } else {
      onChange(value ? `${value}\n${snippet}` : snippet);
    }
    setHelpOpened(false);
  };

  return (
    <>
      <Stack gap="xs">
        <Text size="sm" fw={500}>{hu ? "JavaScript függvénytörzs" : "JavaScript function body"}</Text>
        <Text size="xs" c="dimmed">
          {hu ? "Bemenet: payload. return payload: folytatás; return null: az ág leállítása." : "Input: payload. return payload continues; return null stops this branch."}
        </Text>
        <Button variant="light" leftSection={<IconBraces size={17} />} onClick={() => setOpened(true)}>
          {hu ? "Function szerkesztése…" : "Edit Function…"}
        </Button>
        <Code block style={{ whiteSpace: "pre-wrap", maxHeight: 110, overflow: "auto" }}>{value || "return payload;"}</Code>
      </Stack>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={<Group gap="xs"><IconBraces size={18} /><Text fw={700}>{hu ? "Flow Function – JavaScript szerkesztő" : "Flow Function – JavaScript editor"}</Text></Group>}
        size="80vw"
        centered
      >
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed">
              {hu ? "Bemenet: payload · return payload = folytatás · return null = ág leállítása" : "Input: payload · return payload = continue · return null = stop branch"}
            </Text>
            <Button variant="light" size="xs" leftSection={<IconBook2 size={17} />} onClick={() => setHelpOpened(true)}>
              {i18next.t("ui.scriptQuickHelp")}
            </Button>
          </Group>
          <CodeMirror
            value={value}
            height="48vh"
            theme={colorScheme === "dark" ? "dark" : "light"}
            extensions={[javascript({ jsx: false, typescript: false })]}
            onCreateEditor={view => { editorViewRef.current = view; }}
            onChange={onChange}
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
            style={{ fontSize: 14 }}
          />
          <Group justify="flex-end">
            <Button onClick={() => setOpened(false)}>{hu ? "Bezárás" : "Close"}</Button>
          </Group>
        </Stack>
      </Modal>
      <ScriptQuickHelp
        opened={opened && helpOpened}
        onClose={() => setHelpOpened(false)}
        onInsert={insertSnippet}
        flowMode
      />
    </>
  );
}
