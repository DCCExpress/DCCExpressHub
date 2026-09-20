import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
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
  createPortal,
} from "react-dom";

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

function isHomeHash(): boolean {
  const hash =
    normalizedHash();

  return (
    hash === "" ||
    hash === "home"
  );
}

function findHomeGrid(): HTMLElement | null {
  if (!isHomeHash()) {
    return null;
  }

  const firstActionCard =
    document.querySelector(
      ".action-card",
    );

  const candidate =
    firstActionCard
      ?.parentElement;

  return (
    candidate instanceof HTMLElement
      ? candidate
      : null
  );
}

function SandboxHomeCard({
  capabilities,
  onOpen,
}: {
  capabilities: HubCapabilities | null;
  onOpen: () => void;
}) {
  const supported =
    import.meta.env.DEV ||
    capabilities
      ?.javascriptAutomation === true;

  const loading =
    !import.meta.env.DEV &&
    capabilities === null;

  return (
    <Card
      className="action-card"
      withBorder
      radius={5}
      p="lg"
      aria-disabled={!supported}
      onClick={
        supported
          ? onOpen
          : undefined
      }
      style={{
        opacity:
          supported
            ? 1
            : 0.55,

        cursor:
          supported
            ? "pointer"
            : "not-allowed",
      }}
    >
      <Group
        justify="space-between"
        align="flex-start"
      >
        <ThemeIcon
          size={48}
          radius="lg"
          color="violet"
          variant="light"
        >
          <IconTerminal2
            size={27}
          />
        </ThemeIcon>

        {!supported && (
          <Badge
            color="gray"
            variant="light"
          >
            {loading
              ? "Checking..."
              : "Not supported"}
          </Badge>
        )}
      </Group>

      <Title
        order={4}
        mt="md"
      >
        JavaScript Sandbox
      </Title>

      <Text
        size="sm"
        c="dimmed"
        mt={4}
      >
        {loading
          ? "Checking firmware capability..."
          : supported
            ? "Edit, run and inspect QuickJS automation scripts."
            : "This firmware does not include JavaScript automation."}
      </Text>
    </Card>
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
            This Hub firmware was built without JavaScript automation support.
            The Sandbox cannot be opened on this device.
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

  const [
    homeGrid,
    setHomeGrid,
  ] =
    useState<HTMLElement | null>(
      null,
    );

  const refreshHomeGrid =
    useCallback(
      () => {
        setHomeGrid(
          findHomeGrid(),
        );
      },
      [],
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

          window.requestAnimationFrame(
            refreshHomeGrid,
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
    [
      refreshHomeGrid,
    ],
  );

  useEffect(
    () => {
      if (sandboxOpen) {
        setHomeGrid(
          null,
        );

        return;
      }

      refreshHomeGrid();

      const observer =
        new MutationObserver(
          () => {
            refreshHomeGrid();
          },
        );

      observer.observe(
        document.body,
        {
          childList: true,
          subtree: true,
        },
      );

      const frame =
        window.requestAnimationFrame(
          refreshHomeGrid,
        );

      return () => {
        observer.disconnect();

        window.cancelAnimationFrame(
          frame,
        );
      };
    },
    [
      sandboxOpen,
      refreshHomeGrid,
    ],
  );

  const openSandbox =
    () => {
      if (
        !import.meta.env.DEV &&
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
    if (
      !import.meta.env.DEV &&
      capabilities === null
    ) {
      return (
        <CapabilityLoading />
      );
    }

    if (
      !import.meta.env.DEV &&
      !capabilities
        ?.javascriptAutomation
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
    <>
      <App />

      {homeGrid &&
        createPortal(
          <SandboxHomeCard
            capabilities={
              capabilities
            }
            onOpen={
              openSandbox
            }
          />,
          homeGrid,
        )}
    </>
  );
}
