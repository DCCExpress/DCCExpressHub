import { useTranslation } from "react-i18next";
import i18next from "i18next";
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
  useTranslation();
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
      title={i18next.t("ui.welcomeToDccexpresshub")}
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
            > {i18next.t("ui.yourLayoutIsReadyToBeConfigured")} </Title>

            <Text
              c="dimmed"
              size="sm"
              mt={6}
            > {i18next.t("ui.noLocomotivesAreConfiguredYetSoThisLooksLikeA")} </Text>
          </div>
        </Group>

        <Stack gap="xs">
          <Text fw={600}> {i18next.t("ui.alreadyHaveADccexpresshubBackup")} </Text>

          <Text
            c="dimmed"
            size="sm"
          > {i18next.t("ui.restoreYourPreviousBackupFromExportImportThisCanBring")} </Text>
        </Stack>

        <Stack gap="xs">
          <Text fw={600}> {i18next.t("ui.startingANewLayout")} </Text>

          <Text
            c="dimmed"
            size="sm"
          > {i18next.t("ui.startByAddingYourLocomotivesFromHomeLocomotiveEditorThen")} </Text>
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
          > {i18next.t("ui.close")} </Button>

          <Button
            variant="light"
            color="teal"
            leftSection={
              <IconMap size={18} />
            }
            onClick={openLayout}
          > {i18next.t("ui.openLayoutEditor")} </Button>

          <Button
            color="blue"
            leftSection={
              <IconDownload size={18} />
            }
            onClick={openBackup}
          > {i18next.t("ui.restoreBackup")} </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
