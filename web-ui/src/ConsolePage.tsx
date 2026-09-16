import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  ActionIcon,
  Alert,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";

import {
  IconAlertTriangle,
  IconArrowLeft,
  IconTerminal2,
} from "@tabler/icons-react";

import {
  useEffect,
  useState,
} from "react";

import {
  getCommandCenterInfo,
  type CommandCenterInfo,
} from "@/api/commandCenterInfo";

import ConsolePanel from "@/components/ConsolePanel";

type Props = {
  onBack: () => void;
};

export default function ConsolePage({
  onBack,
}: Props) {
  useTranslation();
  const [
    info,
    setInfo,
  ] =
    useState<CommandCenterInfo | null>(
      null,
    );

  const [
    error,
    setError,
  ] =
    useState("");

  useEffect(
    () => {
      let active =
        true;

      void getCommandCenterInfo()
        .then(
          value => {
            if (active) {
              setInfo(
                value,
              );
            }
          },
        )
        .catch(
          cause => {
            if (active) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : String(cause),
              );
            }
          },
        );

      return () => {
        active =
          false;
      };
    },
    [],
  );

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
            aria-label={i18next.t("ui.backToHome")}
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
            <Title order={3}> {i18next.t("ui.console")} </Title>

            <Text
              size="sm"
              c="dimmed"
            >
              {
                info
                  ? i18next.t("ui.diagnostics", { value1: info.name })
                  : i18next.t("ui.commandCenterDiagnostics")
              }
            </Text>
          </div>
        </Group>
      </Group>

      {
        !info &&
        !error && (
          <Group
            justify="center"
            py="xl"
          >
            <Loader
              size="sm"
            />
          </Group>
        )
      }

      {
        error && (
          <Alert
            color="red"
            icon={
              <IconAlertTriangle
                size={18}
              />
            }
          >
            {error}
          </Alert>
        )
      }

      {
        info &&
        !info.capabilities.rawCommand && (
          <Alert
            color="blue"
            title={i18next.t("ui.rawConsoleIsNotAvailable", { value1: info.name })}
            icon={
              <IconAlertTriangle
                size={18}
              />
            }
          >
            This firmware uses the {info.name} protocol and does not expose
            raw DCC-EX commands. Normal locomotive, turnout, accessory,
            signal and power controls remain available through DCCExpressHub.
          </Alert>
        )
      }

      {
        info?.capabilities
          .rawCommand && (
          <ConsolePanel />
        )
      }
    </Stack>
  );
}
