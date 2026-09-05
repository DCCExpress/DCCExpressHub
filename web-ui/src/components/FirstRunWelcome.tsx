import {
  Button,
  Group,
  Modal,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconDownload,
  IconMap,
  IconTrain,
} from "@tabler/icons-react";
import {
  useEffect,
  useState,
} from "react";

import {
  getLocos,
} from "@/api/domainApi";

function navigateTo(
  hash: "backup" | "layout",
) {
  window.location.hash = hash;
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

export default function FirstRunWelcome() {
  const [
    opened,
    setOpened,
  ] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkFirstRun = async () => {
      try {
        const locos =
          await getLocos();

        if (
          !cancelled &&
          locos.length === 0
        ) {
          setOpened(true);
        }
      } catch {
        // A failed locomotive request must never be treated as a fresh install.
      }
    };

    void checkFirstRun();

    return () => {
      cancelled = true;
    };
  }, []);

  const openBackup = () => {
    setOpened(false);
    navigateTo("backup");
  };

  const openLayout = () => {
    setOpened(false);
    navigateTo("layout");
  };

  return (
    <Modal
      opened={opened}
      onClose={() =>
        setOpened(false)
      }
      title="Welcome to DCCExpressHub"
      centered
      size="lg"
      radius="md"
    >
      <Stack gap="lg">
        <Group
          gap="md"
          align="flex-start"
          wrap="nowrap"
        >
          <ThemeIcon
            size={52}
            radius="md"
            color="cyan"
            variant="light"
          >
            <IconTrain
              size={30}
            />
          </ThemeIcon>

          <div>
            <Title
              order={4}
            >
              Your layout is ready to be configured
            </Title>

            <Text
              c="dimmed"
              size="sm"
              mt={6}
            >
              No locomotives are configured yet, so this looks like a new
              DCCExpressHub installation.
            </Text>
          </div>
        </Group>

        <Stack gap="xs">
          <Text fw={600}>
            Already have a DCCExpressHub backup?
          </Text>

          <Text
            c="dimmed"
            size="sm"
          >
            Restore your previous backup from Export / Import. This can bring
            back your layout, locomotives, images, signal logic and device
            configuration.
          </Text>
        </Stack>

        <Stack gap="xs">
          <Text fw={600}>
            Starting a new layout?
          </Text>

          <Text
            c="dimmed"
            size="sm"
          >
            Start by adding your locomotives from Home → Locomotive editor.
            Then draw your track plan in Layout editor and configure the
            turnouts, signals, sensors, devices and automation needed for your
            layout.
          </Text>
        </Stack>

        <Group
          justify="flex-end"
          gap="sm"
          wrap="wrap"
        >
          <Button
            variant="default"
            onClick={() =>
              setOpened(false)
            }
          >
            Close
          </Button>

          <Button
            variant="light"
            color="teal"
            leftSection={
              <IconMap size={18} />
            }
            onClick={openLayout}
          >
            Open layout editor
          </Button>

          <Button
            color="blue"
            leftSection={
              <IconDownload size={18} />
            }
            onClick={openBackup}
          >
            Restore backup
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
