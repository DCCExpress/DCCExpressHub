import {
  Alert,
  Box,
  Button,
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
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  EMPTY_HUB_CAPABILITIES,
  getHubCapabilities,
  type HubCapabilities,
} from "@/api/hubCapabilitiesApi";

import App from "./App";
import SandboxPage from "./SandboxPage";

function normalizedHash(): string {
  return (
    window.location.hash
      .replace("#", "")
      .trim()
      .toLowerCase()
  );
}

function isSandboxHash(): boolean {
  return (
    normalizedHash() ===
    "sandbox"
  );
}

function UnsupportedSandbox({
  onBack,
}: {
  onBack: () => void;
}) {
  return (
    <Box
      className="mobile-shell"
    >
      <Box
        className="mobile-content"
      >
        <Stack
          gap="lg"
        >
          <Button
            variant="subtle"
            color="gray"
            leftSection={
              <IconArrowLeft
                size={18}
              />
            }
            onClick={onBack}
            className="back-button"
          >
            Back to home
          </Button>

          <Group
            gap="sm"
            wrap="nowrap"
          >
            <ThemeIcon
              size={42}
              radius="md"
              variant="light"
              color="violet"
            >
              <IconTerminal2
                size={24}
              />
            </ThemeIcon>

            <div>
              <Title
                order={3}
              >
                JavaScript Sandbox
              </Title>

              <Text
                size="sm"
                c="dimmed"
              >
                JavaScript automation capability
              </Text>
            </div>
          </Group>

          <Alert
            color="yellow"
            icon={
              <IconAlertTriangle
                size={18}
              />
            }
            title="Not supported by this firmware"
          >
            This device or firmware does not support JavaScript automation.
            The Sandbox is currently available only on supported ESP32-S3 builds.
          </Alert>
        </Stack>
      </Box>
    </Box>
  );
}

function CapabilityLoading() {
  return (
    <Box
      className="mobile-shell"
    >
      <Box
        className="mobile-content"
      >
        <Card
          withBorder
          radius="xl"
          p="xl"
        >
          <Stack
            align="center"
            gap="sm"
          >
            <Loader />

            <Text
              c="dimmed"
            >
              Checking JavaScript automation capability...
            </Text>
          </Stack>
        </Card>
      </Box>
    </Box>
  );
}

export default function SandboxEntry() {
  const [
    sandboxOpen,
    setSandboxOpen,
  ] =
    useState(
      isSandboxHash,
    );

  const [
    capabilities,
    setCapabilities,
  ] =
    useState<HubCapabilities | null>(
      null,
    );

  useEffect(
    () => {
      let cancelled =
        false;

      void getHubCapabilities()
        .then(
          nextCapabilities => {
            if (!cancelled) {
              setCapabilities(
                nextCapabilities,
              );
            }
          },
        )
        .catch(
          error => {
            console.warn(
              "Could not load Hub capabilities",
              error,
            );

            if (!cancelled) {
              // Development UI must remain testable even when the connected
              // backend/mock firmware does not yet expose /api/capabilities.
              // Production stays fail-closed.
              setCapabilities(
                import.meta.env.DEV
                  ? {
                      ...EMPTY_HUB_CAPABILITIES,
                      javascriptAutomation: true,
                    }
                  : EMPTY_HUB_CAPABILITIES,
              );
            }
          },
        );

      return () => {
        cancelled =
          true;
      };
    },
    [],
  );

  useEffect(
    () => {
      const onHashChange =
        () => {
          setSandboxOpen(
            isSandboxHash(),
          );

        };

      window.addEventListener(
        "hashchange",
        onHashChange,
      );

      return () => {
        window.removeEventListener(
          "hashchange",
          onHashChange,
        );
      };
    },
    [],
  );

  const openSandbox =
    () => {
      if (
        capabilities
          ?.javascriptAutomation !==
        true
      ) {
        return;
      }

      window.location.hash =
        "sandbox";

      setSandboxOpen(
        true,
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    };

  const closeSandbox =
    () => {
      window.location.hash =
        "";

      setSandboxOpen(
        false,
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    };

  if (sandboxOpen) {
    if (capabilities === null) {
      return (
        <CapabilityLoading />
      );
    }

    if (
      !capabilities
        .javascriptAutomation
    ) {
      return (
        <UnsupportedSandbox
          onBack={closeSandbox}
        />
      );
    }

    return (
      <Box
        className="mobile-shell"
      >
        <Box
          className="mobile-content"
        >
          <SandboxPage
            onBack={closeSandbox}
          />
        </Box>
      </Box>
    );
  }

  return (
    <App />
  );
}
