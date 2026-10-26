import { useState } from "react";
import { Accordion, Button, Code, Group, Modal, Stack, Text } from "@mantine/core";
import { IconBraces, IconBook2 } from "@tabler/icons-react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { useMantineColorScheme } from "@mantine/core";
import i18next from "i18next";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

const EXAMPLES = [
  { title: "Pass payload", code: "return payload;" },
  { title: "Stop branch", code: "return null;" },
  { title: "Turnout → VPIN", code: "await dcc.setVpin(3000, payload.closed);\nreturn payload;" },
  { title: "Read VPIN", code: "const on = dcc.getVpin(3000);\nlog(on === undefined ? 'UNKNOWN' : on ? 'ON' : 'OFF');\nreturn payload;" },
  { title: "Check power", code: "if (!dcc.isPowerOn()) return null;\nreturn payload;" },
];

export default function AutomationFlowFunctionEditor({ value, onChange }: Props) {
  const [opened, setOpened] = useState(false);
  const { colorScheme } = useMantineColorScheme();
  const hu = i18next.language.startsWith("hu");
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
      <Modal opened={opened} onClose={() => setOpened(false)}
        title={<Group gap="xs"><IconBraces size={18} /><Text fw={700}>{hu ? "Flow Function – JavaScript szerkesztő" : "Flow Function – JavaScript editor"}</Text></Group>}
        size="80vw" centered>
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {hu ? "A Function node kódja a Flow aktuális payload értékével fut. A módosítás a Flow következő végrehajtásakor érvényesül." : "The Function node runs with the current Flow payload. Changes take effect on the next Flow execution."}
          </Text>
          <CodeMirror
            value={value}
            height="48vh"
            theme={colorScheme === "dark" ? "dark" : "light"}
            extensions={[javascript({ jsx: false })]}
            onChange={onChange}
            basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
          />
          <Accordion variant="contained">
            <Accordion.Item value="quick-help">
              <Accordion.Control icon={<IconBook2 size={18} />}>
                {hu ? "Function Quick Help" : "Function Quick Help"}
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  <Text size="sm">{hu ? "A dcc API ugyanúgy elérhető, mint a Script Editorban. A példák a kurzor pozíciója helyett a teljes kódot cserélik." : "The same dcc API as in Script Editor is available. Choosing an example replaces the entire function body."}</Text>
                  {EXAMPLES.map(example => (
                    <Group key={example.title} justify="space-between" align="center">
                      <Code>{example.title}</Code>
                      <Button size="compact-xs" variant="subtle" onClick={() => onChange(example.code)}>
                        {hu ? "Használat" : "Use"}
                      </Button>
                    </Group>
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
          <Group justify="flex-end">
            <Button onClick={() => setOpened(false)}>{hu ? "Bezárás" : "Close"}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
