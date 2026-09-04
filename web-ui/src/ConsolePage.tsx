import {
  ActionIcon,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";

import {
  IconArrowLeft,
  IconTerminal2,
} from "@tabler/icons-react";

import ConsolePanel from "@/components/ConsolePanel";

type Props = {
  onBack: () => void;
};

export default function ConsolePage({
  onBack,
}: Props) {
  return (
    <Stack gap="md">
      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
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
            color="cyan"
          >
            <IconTerminal2
              size={23}
            />
          </ThemeIcon>

          <div>
            <Title order={3}>
              Console
            </Title>

            <Text
              size="sm"
              c="dimmed"
            >
              Send raw DCC-EX
              commands over
              WebSocket
            </Text>
          </div>
        </Group>
      </Group>

      <ConsolePanel />
    </Stack>
  );
}