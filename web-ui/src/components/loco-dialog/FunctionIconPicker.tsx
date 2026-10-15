import { ActionIcon, Button, Group, Modal, ScrollArea, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import { IconPhoto } from "@tabler/icons-react";
import { BUILTIN_FUNCTION_ICONS, getBuiltinFunctionIcon } from "../loco/FunctionIconRegistry";

type Props = { opened: boolean; value: string; onClose: () => void; onSelect: (value: string) => void };
export default function FunctionIconPicker({ opened, value, onClose, onSelect }: Props) {
  const Preview = getBuiltinFunctionIcon(value);
  return <Modal opened={opened} onClose={onClose} title="Function icon" centered zIndex={4000} size="sm">
    <Stack gap="sm">
      <Text size="xs" c="dimmed">Built-in railway function icons</Text>
      <ScrollArea.Autosize mah={300}>
        <SimpleGrid cols={5} spacing="xs">
          {BUILTIN_FUNCTION_ICONS.map(([id, label]) => {
            const Icon = getBuiltinFunctionIcon(`builtin:${id}`);
            return <Tooltip label={label} key={id}>
              <ActionIcon size={46} radius="md" variant={value === `builtin:${id}` ? "filled" : "light"}
                color={value === `builtin:${id}` ? "lime" : "gray"}
                aria-label={label} onClick={() => { onSelect(`builtin:${id}`); onClose(); }}>
                {Icon && <Icon size={24}/>}
              </ActionIcon>
            </Tooltip>;
          })}
        </SimpleGrid>
      </ScrollArea.Autosize>
      <Group justify="space-between">
        <Group gap="xs">{Preview ? <Preview size={18}/> : <IconPhoto size={18}/>}<Text size="xs">{value || "No icon"}</Text></Group>
        <Button size="xs" variant="light" color="gray" onClick={() => { onSelect(""); onClose(); }}>Clear</Button>
      </Group>
    </Stack>
  </Modal>;
}
