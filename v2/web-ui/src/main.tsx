import React from "react";
import ReactDOM from "react-dom/client";
import "@mantine/core/styles.css";
import { MantineProvider, Container, Stack, Title, Text, Paper, Badge } from "@mantine/core";

function App() {
  return (
    <MantineProvider defaultColorScheme="dark">
      <Container size="md" py="xl">
        <Stack gap="lg">
          <Badge variant="light" color="teal">V2 Development</Badge>
          <Title order={1}>DCCExpressHub V2</Title>
          <Text c="dimmed">Welcome! A clean React + Mantine + Vite starting point.</Text>
          <Paper p="xl" withBorder radius="md">
            <Title order={3}>Ready for the next step</Title>
            <Text mt="sm" c="dimmed">
              Connections and devices will be built here.
            </Text>
          </Paper>
        </Stack>
      </Container>
    </MantineProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>
);
