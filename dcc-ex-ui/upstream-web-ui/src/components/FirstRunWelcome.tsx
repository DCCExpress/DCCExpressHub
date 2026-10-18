import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  SimpleGrid,
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

type FirstRunStatus = {
  locoCount: number;
  layoutElementCount: number;
};

type LayoutLike = {
  layers?: Array<{
    elements?: unknown[];
  }>;
};

function navigateTo(
  hash: "backup" | "layout",
) {
  window.location.hash = hash;
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

async function getLayoutElementCount(): Promise<number> {
  const response =
    await fetch(
      "/api/layout",
      {
        cache: "no-store",
      }
    );

  if (!response.ok) {
    throw new Error(
      `Could not load layout: HTTP ${response.status}`
    );
  }

  const layout =
    await response.json() as LayoutLike;

  return (
    layout.layers ?? []
  ).reduce(
    (
      total,
      layer
    ) =>
      total +
      (
        Array.isArray(
          layer.elements
        )
          ? layer.elements.length
          : 0
      ),
    0
  );
}

function reasonText(
  status: FirstRunStatus
): string {
  const noLocos =
    status.locoCount === 0;

  const noLayout =
    status.layoutElementCount === 0;

  if (
    noLocos &&
    noLayout
  ) {
    return "Reason: no locomotives and no layout elements are configured.";
  }

  if (noLocos) {
    return "Reason: no locomotives are configured.";
  }

  if (noLayout) {
    return "Reason: no layout elements are configured.";
  }

  return "";
}

export default function FirstRunWelcome() {
  useTranslation();

  const [
    opened,
    setOpened,
  ] = useState(false);

  const [
    status,
    setStatus,
  ] = useState<FirstRunStatus | null>(
    null
  );

  useEffect(() => {
    let cancelled =
      false;

    const checkFirstRun =
      async () => {
        try {
          const [
            locos,
            layoutElementCount,
          ] =
            await Promise.all([
              getLocos(),
              getLayoutElementCount(),
            ]);

          if (cancelled) {
            return;
          }

          const nextStatus:
            FirstRunStatus = {
              locoCount:
                locos.length,
              layoutElementCount,
            };

          setStatus(
            nextStatus
          );

          // The welcome dialog is a setup diagnostic:
          // show it only while one of the two core configuration areas is empty.
          setOpened(
            nextStatus.locoCount ===
              0 ||
            nextStatus.layoutElementCount ===
              0
          );
        } catch {
          // Failed requests must never be interpreted as a fresh installation.
          if (!cancelled) {
            setOpened(false);
          }
        }
      };

    void checkFirstRun();

    return () => {
      cancelled = true;
    };
  }, []);

  const openBackup =
    () => {
      setOpened(false);
      navigateTo(
        "backup"
      );
    };

  const openLayout =
    () => {
      setOpened(false);
      navigateTo(
        "layout"
      );
    };

  return (
    <Modal
      opened={opened}
      onClose={() =>
        setOpened(false)
      }
      title={i18next.t(
        "ui.welcomeToDccexpresshub"
      )}
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
              {i18next.t(
                "ui.yourLayoutIsReadyToBeConfigured"
              )}
            </Title>

            <Text
              c="dimmed"
              size="sm"
              mt={6}
            >
              Setup information is shown below so you can see exactly why this dialog appeared.
            </Text>
          </div>
        </Group>

        {status && (
          <>
            <SimpleGrid
              cols={{
                base: 1,
                sm: 2,
              }}
              spacing="sm"
            >
              <Card
                withBorder
                radius="md"
                p="md"
              >
                <Group
                  justify="space-between"
                  align="center"
                >
                  <Group gap="xs">
                    <IconTrain
                      size={20}
                    />
                    <Text fw={600}>
                      Locomotives
                    </Text>
                  </Group>

                  <Badge
                    size="lg"
                    color={
                      status.locoCount >
                      0
                        ? "teal"
                        : "red"
                    }
                    variant="light"
                  >
                    {status.locoCount}
                  </Badge>
                </Group>
              </Card>

              <Card
                withBorder
                radius="md"
                p="md"
              >
                <Group
                  justify="space-between"
                  align="center"
                >
                  <Group gap="xs">
                    <IconMap
                      size={20}
                    />
                    <Text fw={600}>
                      Layout elements
                    </Text>
                  </Group>

                  <Badge
                    size="lg"
                    color={
                      status.layoutElementCount >
                      0
                        ? "teal"
                        : "red"
                    }
                    variant="light"
                  >
                    {
                      status.layoutElementCount
                    }
                  </Badge>
                </Group>
              </Card>
            </SimpleGrid>

            <Card
              withBorder
              radius="md"
              p="md"
            >
              <Text
                fw={600}
                c="orange"
              >
                {reasonText(
                  status
                )}
              </Text>
            </Card>
          </>
        )}

        <Stack gap="xs">
          <Text fw={600}>
            {i18next.t(
              "ui.alreadyHaveADccexpresshubBackup"
            )}
          </Text>

          <Text
            c="dimmed"
            size="sm"
          >
            {i18next.t(
              "ui.restoreYourPreviousBackupFromExportImportThisCanBring"
            )}
          </Text>
        </Stack>

        <Stack gap="xs">
          <Text fw={600}>
            {i18next.t(
              "ui.startingANewLayout"
            )}
          </Text>

          <Text
            c="dimmed"
            size="sm"
          >
            {i18next.t(
              "ui.startByAddingYourLocomotivesFromHomeLocomotiveEditorThen"
            )}
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
            {i18next.t(
              "ui.close"
            )}
          </Button>

          <Button
            variant="light"
            color="teal"
            leftSection={
              <IconMap
                size={18}
              />
            }
            onClick={
              openLayout
            }
          >
            {i18next.t(
              "ui.openLayoutEditor"
            )}
          </Button>

          <Button
            color="blue"
            leftSection={
              <IconDownload
                size={18}
              />
            }
            onClick={
              openBackup
            }
          >
            {i18next.t(
              "ui.restoreBackup"
            )}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
