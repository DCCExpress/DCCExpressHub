import React, { useState } from "react";
import ConfigurationPage from "./ConfigurationPage";
import ReactDOM from "react-dom/client";
import "@mantine/core/styles.css";
import "./styles.css";
import {
  ActionIcon, Badge, Box, Card, Container, Group, MantineProvider,
  SimpleGrid, Stack, Text, ThemeIcon, Title, useMantineColorScheme
} from "@mantine/core";
import { IconArrowLeft, IconLayoutDashboard, IconMap, IconSettings, IconMoon, IconSun } from "@tabler/icons-react";

type Page = "home" | "configuration" | "layout";

function AppContent() {
  const [page, setPage] = useState<Page>("home");
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
      <Box className="app-shell">
        <Container size="lg" py="xl">
          <Stack gap="md">
            <Card className="hero-card" radius={5} p="lg">
              <Group justify="space-between" align="center" gap="md">
                <Group gap="md">
                  {page !== "home" && (
                    <ActionIcon
                      size="lg" variant="subtle" color="gray"
                      aria-label="Back to home" onClick={() => setPage("home")}
                    >
                      <IconArrowLeft size={23} />
                    </ActionIcon>
                  )}
                  <ThemeIcon size={48} radius="lg" color="teal" variant="light">
                    <IconLayoutDashboard size={27} />
                  </ThemeIcon>
                  <div>
                    <Title order={2}>DCCExpressHub V2</Title>
                    <Text size="sm" c="dimmed">Model railway control system</Text>
                  </div>
                </Group>
                <Group gap="xs">
                  <Badge color="teal" variant="light">V2 Development</Badge>
                  <ActionIcon variant="light" size="lg" color="gray" aria-label={colorScheme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={colorScheme === "dark" ? "Light theme" : "Dark theme"} onClick={() => setColorScheme(colorScheme === "dark" ? "light" : "dark")}>
                    {colorScheme === "dark" ? <IconSun size={20}/> : <IconMoon size={20}/>}
                  </ActionIcon>
                </Group>
              </Group>
            </Card>

            {page === "home" ? (
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Card
                  className="action-card" withBorder radius={5} p="lg"
                  tabIndex={0} role="button"
                  onClick={() => setPage("configuration")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPage("configuration"); } }}
                >
                  <ThemeIcon size={48} radius="lg" color="blue" variant="light">
                    <IconSettings size={27} />
                  </ThemeIcon>
                  <Title order={4} mt="md">Configuration</Title>
                  <Text size="sm" c="dimmed" mt={4}>
                    Configure connections, devices and system settings.
                  </Text>
                </Card>

                <Card
                  className="action-card" withBorder radius={5} p="lg"
                  tabIndex={0} role="button"
                  onClick={() => setPage("layout")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPage("layout"); } }}
                >
                  <ThemeIcon size={48} radius="lg" color="teal" variant="light">
                    <IconMap size={27} />
                  </ThemeIcon>
                  <Title order={4} mt="md">Layout</Title>
                  <Text size="sm" c="dimmed" mt={4}>
                    Create and edit your railway track layout.
                  </Text>
                </Card>
              </SimpleGrid>
            ) : page === "configuration" ? (
              <ConfigurationPage />
            ) : (
              <Card withBorder radius={5} p="xl">
                <Group gap="sm" mb="md">
                  <ThemeIcon size={42} color="teal" variant="light">
                    <IconMap size={24} />
                  </ThemeIcon>
                  <Title order={3}>Layout</Title>
                </Group>
                <Text c="dimmed" size="sm">This section is ready for development.</Text>
              </Card>
            )}
          </Stack>
        </Container>
      </Box>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><MantineProvider defaultColorScheme="dark"><AppContent /></MantineProvider></React.StrictMode>
);
