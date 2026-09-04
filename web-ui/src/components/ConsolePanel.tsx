import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";

import {
  IconAlertTriangle,
  IconBolt,
  IconClearAll,
  IconPlug,
  IconPlugConnected,
  IconPlayerPlay,
  IconPower,
  IconTerminal2,
} from "@tabler/icons-react";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  serialConsole,
  type SerialConsoleStatus,
} from "@/services/serialConsole";

import { wsApi } from "@/services/wsApi";

import {
  wsClient,
  type WsConnectionStatus,
} from "@/services/wsClient";

import { useCommandCenter } from "@/context/CommandCenterContext";

type ConsoleTransport =
  | "websocket"
  | "serial";

type ConsoleLogDirection =
  | "TX"
  | "RX"
  | "SYS";

type ConsoleLogEntry = {
  id: number;
  timestamp: string;
  direction: ConsoleLogDirection;
  text: string;
};

type QuickCommand = {
  id: string;
  command: string;
  description: string;
};

const MAX_LOG_ENTRIES = 200;

const QUICK_COMMANDS_STORAGE_KEY =
  "dcc-express-lite.console.quick-commands.v1";

const DEFAULT_QUICK_COMMANDS: QuickCommand[] = [
  {
    id: "power-on",
    command: "<1>",
    description: "Track power ON",
  },
  {
    id: "power-off",
    command: "<0>",
    description: "Track power OFF",
  },
  {
    id: "emergency-stop",
    command: "<!>",
    description: "Emergency stop",
  },
  {
    id: "status",
    command: "<s>",
    description: "Command station status",
  },
  {
    id: "vpin-on",
    command: "<z 100>",
    description: "VPIN ON",
  },
  {
    id: "vpin-off",
    command: "<z -100>",
    description: "VPIN OFF",
  },
  {
    id: "loco-test",
    command: "<t 3 40 1>",
    description: "Loco speed / direction",
  },
  {
    id: "accessory-on",
    command: "<a 1 1>",
    description: "Accessory ON",
  },
  {
    id: "accessory-off",
    command: "<a 1 0>",
    description: "Accessory OFF",
  },
];

function loadQuickCommands(): QuickCommand[] {
  try {
    const raw = localStorage.getItem(
      QUICK_COMMANDS_STORAGE_KEY
    );

    if (!raw) {
      return DEFAULT_QUICK_COMMANDS;
    }

    const parsed =
      JSON.parse(raw) as QuickCommand[];

    if (!Array.isArray(parsed)) {
      return DEFAULT_QUICK_COMMANDS;
    }

    return DEFAULT_QUICK_COMMANDS.map(
      defaultItem => {
        const saved = parsed.find(
          item =>
            item.id === defaultItem.id
        );

        return saved
          ? {
              ...defaultItem,
              command:
                saved.command ??
                defaultItem.command,
            }
          : defaultItem;
      }
    );
  } catch {
    return DEFAULT_QUICK_COMMANDS;
  }
}

function saveQuickCommands(
  commands: QuickCommand[]
): void {
  try {
    localStorage.setItem(
      QUICK_COMMANDS_STORAGE_KEY,
      JSON.stringify(commands)
    );
  } catch {
    // localStorage failure should not break console.
  }
}

function formatTime(): string {
  return new Date().toLocaleTimeString(
    undefined,
    {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }
  );
}

function wsStatusLabel(
  status: WsConnectionStatus
): string {
  switch (status) {
    case "connected":
      return "ONLINE";

    case "connecting":
      return "CONNECTING";

    case "reconnecting":
      return "RECONNECTING";

    case "error":
      return "ERROR";

    default:
      return "OFFLINE";
  }
}

function wsStatusColor(
  status: WsConnectionStatus
): string {
  switch (status) {
    case "connected":
      return "teal";

    case "connecting":
    case "reconnecting":
      return "yellow";

    default:
      return "red";
  }
}

function serialStatusLabel(
  status: SerialConsoleStatus
): string {
  switch (status) {
    case "connected":
      return "ONLINE";

    case "connecting":
      return "CONNECTING";

    case "disconnecting":
      return "DISCONNECTING";

    case "error":
      return "ERROR";

    default:
      return "OFFLINE";
  }
}

function serialStatusColor(
  status: SerialConsoleStatus
): string {
  switch (status) {
    case "connected":
      return "teal";

    case "connecting":
    case "disconnecting":
      return "yellow";

    default:
      return "red";
  }
}

function logColor(
  direction: ConsoleLogDirection
): string {
  switch (direction) {
    case "TX":
      return "cyan";

    case "RX":
      return "teal";

    default:
      return "gray";
  }
}

export default function ConsolePanel() {
  const commandCenter =
    useCommandCenter();

  const [transport, setTransport] =
    useState<ConsoleTransport>(
      "websocket"
    );

  const [wsStatus, setWsStatus] =
    useState<WsConnectionStatus>(
      wsClient.getStatus()
    );

  const [
    serialStatus,
    setSerialStatus,
  ] =
    useState<SerialConsoleStatus>(
      serialConsole.getStatus()
    );

  const [
    serialBusy,
    setSerialBusy,
  ] = useState(false);

  const [
    showDccExStatus,
    setShowDccExStatus,
  ] = useState(false);

  const [command, setCommand] =
    useState("<s>");

  const [
    quickCommands,
    setQuickCommands,
  ] =
    useState<QuickCommand[]>(
      loadQuickCommands
    );

  const [log, setLog] =
    useState<
      ConsoleLogEntry[]
    >([]);

  const logIdRef =
    useRef(0);

  const viewportRef =
    useRef<HTMLDivElement>(
      null
    );

  const addLog =
    useCallback(
      (
        direction:
          ConsoleLogDirection,
        text: string
      ) => {
        const entry:
          ConsoleLogEntry = {
          id: ++logIdRef.current,
          timestamp:
            formatTime(),
          direction,
          text,
        };

        setLog(current => {
          const next = [
            ...current,
            entry,
          ];

          if (
            next.length >
            MAX_LOG_ENTRIES
          ) {
            return next.slice(
              next.length -
                MAX_LOG_ENTRIES
            );
          }

          return next;
        });
      },
      []
    );

  useEffect(() => {
    saveQuickCommands(
      quickCommands
    );
  }, [quickCommands]);

  useEffect(() => {
    const unsubscribe =
      wsClient.subscribeStatus(
        nextStatus => {
          setWsStatus(
            nextStatus
          );

          if (
            transport ===
            "websocket"
          ) {
            addLog(
              "SYS",
              `WebSocket ${wsStatusLabel(
                nextStatus
              )}`
            );
          }
        }
      );

    return unsubscribe;
  }, [
    addLog,
    transport,
  ]);

  useEffect(() => {
    if (
      transport !==
      "websocket"
    ) {
      return;
    }

    const unsubscribe =
      wsClient.subscribeMessages(
        message => {
          if (
            !showDccExStatus &&
            message.type ===
              "dccExStatus"
          ) {
            return;
          }

          try {
            addLog(
              "RX",
              JSON.stringify(
                message
              )
            );
          } catch {
            addLog(
              "RX",
              String(message)
            );
          }
        }
      );

    return unsubscribe;
  }, [
    addLog,
    transport,
    showDccExStatus,
  ]);

  useEffect(() => {
    const unsubscribe =
      serialConsole.subscribeStatus(
        nextStatus => {
          setSerialStatus(
            nextStatus
          );

          if (
            transport ===
            "serial"
          ) {
            addLog(
              "SYS",
              `Serial ${serialStatusLabel(
                nextStatus
              )}`
            );
          }
        }
      );

    return unsubscribe;
  }, [
    addLog,
    transport,
  ]);

  useEffect(() => {
    const unsubscribe =
      serialConsole.subscribeMessages(
        message => {
          if (
            transport !==
            "serial"
          ) {
            return;
          }

          addLog(
            "RX",
            message
          );
        }
      );

    return unsubscribe;
  }, [
    addLog,
    transport,
  ]);

  useEffect(() => {
    const viewport =
      viewportRef.current;

    if (!viewport) {
      return;
    }

    viewport.scrollTop =
      viewport.scrollHeight;
  }, [log]);

  const connectSerial =
    useCallback(
      async () => {
        setSerialBusy(true);

        try {
          await serialConsole.connect();

          addLog(
            "SYS",
            `Serial connected · ${serialConsole.getBaudRate()} baud`
          );
        } catch (error) {
          addLog(
            "SYS",
            `Serial connection failed: ${
              error instanceof Error
                ? error.message
                : String(error)
            }`
          );
        } finally {
          setSerialBusy(false);
        }
      },
      [addLog]
    );

  const disconnectSerial =
    useCallback(
      async () => {
        setSerialBusy(true);

        try {
          await serialConsole.disconnect();

          addLog(
            "SYS",
            "Serial disconnected"
          );
        } catch (error) {
          addLog(
            "SYS",
            `Serial disconnect failed: ${
              error instanceof Error
                ? error.message
                : String(error)
            }`
          );
        } finally {
          setSerialBusy(false);
        }
      },
      [addLog]
    );

  const sendRawCommand =
    useCallback(
      async (
        value: string
      ): Promise<boolean> => {
        const trimmed =
          value.trim();

        if (!trimmed) {
          return false;
        }

        if (
          transport ===
          "websocket"
        ) {
          if (
            wsStatus !==
              "connected" ||
            !wsClient.isConnected()
          ) {
            addLog(
              "SYS",
              `Command not sent: WebSocket is ${wsStatusLabel(
                wsStatus
              )}`
            );

            return false;
          }

          addLog(
            "TX",
            trimmed
          );

          const sent =
            wsApi.writeDccExDirectCommand(
              trimmed
            );

          if (!sent) {
            addLog(
              "SYS",
              "Command could not be sent."
            );
          }

          return sent;
        }

        if (
          !serialConsole.isConnected()
        ) {
          addLog(
            "SYS",
            "Command not sent: Serial port is not connected."
          );

          return false;
        }

        addLog(
          "TX",
          trimmed
        );

        try {
          await serialConsole.send(
            trimmed
          );

          return true;
        } catch (error) {
          addLog(
            "SYS",
            `Serial write failed: ${
              error instanceof Error
                ? error.message
                : String(error)
            }`
          );

          return false;
        }
      },
      [
        addLog,
        transport,
        wsStatus,
      ]
    );

  const sendCommand =
    useCallback(
      async () => {
        await sendRawCommand(
          command
        );
      },
      [
        command,
        sendRawCommand,
      ]
    );

  const updateQuickCommand =
    useCallback(
      (
        id: string,
        value: string
      ) => {
        setQuickCommands(
          current =>
            current.map(
              item =>
                item.id === id
                  ? {
                      ...item,
                      command:
                        value,
                    }
                  : item
            )
        );
      },
      []
    );

  const setTrackPower =
    useCallback(
      async (on: boolean) => {
        if (
          transport ===
          "websocket"
        ) {
          const sent =
            wsApi.setTrackPower(
              on
            );

          addLog(
            sent
              ? "TX"
              : "SYS",
            sent
              ? `Track power ${
                  on
                    ? "ON"
                    : "OFF"
                }`
              : "Track power command could not be sent."
          );

          return;
        }

        await sendRawCommand(
          on ? "<1>" : "<0>"
        );
      },
      [
        addLog,
        transport,
        sendRawCommand,
      ]
    );

  const emergencyStop =
    useCallback(
      async () => {
        if (
          transport ===
          "websocket"
        ) {
          const sent =
            wsApi.emergencyStop();

          addLog(
            sent
              ? "TX"
              : "SYS",
            sent
              ? "Emergency stop"
              : "Emergency stop command could not be sent."
          );

          return;
        }

        await sendRawCommand(
          "<!>"
        );
      },
      [
        addLog,
        transport,
        sendRawCommand,
      ]
    );

  const websocketOnline =
    wsStatus === "connected";

  const serialOnline =
    serialStatus ===
    "connected";

  const activeTransportOnline =
    transport ===
    "websocket"
      ? websocketOnline
      : serialOnline;

  const trackPowerOn =
    commandCenter.powerInfo
      ?.trackVoltageOn ??
    false;

  return (
    <Stack gap="md">
      <Card
        withBorder
        radius="md"
        p="md"
      >
        <Stack gap="md">
          <Group
            justify="space-between"
            align="center"
            wrap="wrap"
          >
            <Group gap="sm">
              <IconTerminal2
                size={22}
              />

              <div>
                <Text fw={600}>
                  DCC-EX Console
                </Text>

                <Text
                  size="xs"
                  c="dimmed"
                >
                  Raw DCC-EX
                  command console
                </Text>
              </div>
            </Group>

            <Group gap="xs">
              {transport ===
              "websocket" ? (
                <Badge
                  color={wsStatusColor(
                    wsStatus
                  )}
                  variant="light"
                  size="lg"
                >
                  WS{" "}
                  {wsStatusLabel(
                    wsStatus
                  )}
                </Badge>
              ) : (
                <Badge
                  color={serialStatusColor(
                    serialStatus
                  )}
                  variant="light"
                  size="lg"
                >
                  SERIAL{" "}
                  {serialStatusLabel(
                    serialStatus
                  )}
                </Badge>
              )}

              <Badge
                color={
                  trackPowerOn
                    ? "green"
                    : "gray"
                }
                variant="light"
                size="lg"
              >
                POWER{" "}
                {trackPowerOn
                  ? "ON"
                  : "OFF"}
              </Badge>
            </Group>
          </Group>

          <SegmentedControl
            fullWidth
            value={transport}
            onChange={value =>
              setTransport(
                value as ConsoleTransport
              )
            }
            data={[
              {
                label:
                  "WebSocket",
                value:
                  "websocket",
              },
              {
                label:
                  "Serial port",
                value:
                  "serial",
              },
            ]}
          />

          {transport ===
            "serial" && (
            <Stack gap="xs">
              {!serialConsole.isSupported() && (
                <Alert
                  color="orange"
                  icon={
                    <IconAlertTriangle
                      size={18}
                    />
                  }
                  title="Web Serial is not available"
                >
                  Web Serial
                  requires Chrome
                  or Edge and a
                  secure context
                  such as localhost
                  or HTTPS.
                </Alert>
              )}

              <Group
                justify="space-between"
                align="center"
                wrap="wrap"
              >
                <Text
                  size="sm"
                  c="dimmed"
                >
                  Direct USB serial
                  ·{" "}
                  {serialConsole.getBaudRate()}{" "}
                  baud
                </Text>

                {!serialOnline ? (
                  <Button
                    size="sm"
                    variant="light"
                    leftSection={
                      <IconPlugConnected
                        size={17}
                      />
                    }
                    loading={
                      serialBusy
                    }
                    disabled={
                      !serialConsole.isSupported()
                    }
                    onClick={() =>
                      void connectSerial()
                    }
                  >
                    Connect serial
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="light"
                    color="red"
                    leftSection={
                      <IconPlug
                        size={17}
                      />
                    }
                    loading={
                      serialBusy
                    }
                    onClick={() =>
                      void disconnectSerial()
                    }
                  >
                    Disconnect
                  </Button>
                )}
              </Group>
            </Stack>
          )}
        </Stack>
      </Card>

      <Card
        withBorder
        radius="md"
        p="md"
      >
        <Stack gap="sm">
          <Group
            justify="space-between"
            align="center"
          >
            <Text fw={600}>
              Controls
            </Text>

            <Text
              size="xs"
              c="dimmed"
            >
              {transport ===
              "websocket"
                ? "WebSocket"
                : `Serial ${serialConsole.getBaudRate()}`}
            </Text>
          </Group>

          <Group gap="xs">
            <Button
              color="green"
              variant={
                trackPowerOn
                  ? "filled"
                  : "light"
              }
              leftSection={
                <IconPower
                  size={17}
                />
              }
              disabled={
                !activeTransportOnline
              }
              onClick={() =>
                void setTrackPower(
                  true
                )
              }
            >
              Power ON
            </Button>

            <Button
              color="red"
              variant={
                !trackPowerOn
                  ? "filled"
                  : "light"
              }
              leftSection={
                <IconPower
                  size={17}
                />
              }
              disabled={
                !activeTransportOnline
              }
              onClick={() =>
                void setTrackPower(
                  false
                )
              }
            >
              Power OFF
            </Button>

            <Button
              color="orange"
              variant="light"
              leftSection={
                <IconBolt
                  size={17}
                />
              }
              disabled={
                !activeTransportOnline
              }
              onClick={() =>
                void emergencyStop()
              }
            >
              E-STOP
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card
        withBorder
        radius="md"
        p="md"
      >
        <Stack gap="sm">
          <Text fw={600}>
            Quick commands
          </Text>

          <Text
            size="xs"
            c="dimmed"
          >
            Edit commands directly.
            Changes are saved automatically
            in this browser.
          </Text>

          <SimpleGrid
            cols={{
              base: 1,
              sm: 2,
              md: 3,
            }}
            spacing="xs"
          >
            {quickCommands.map(
              item => (
                <Stack
                  key={item.id}
                  gap={4}
                >
                  <Text
                    size="xs"
                    fw={600}
                    c="dimmed"
                  >
                    {item.description}
                  </Text>

                  <TextInput
                    value={
                      item.command
                    }
                    onChange={event =>
                      updateQuickCommand(
                        item.id,
                        event.currentTarget.value
                      )
                    }
                    onKeyDown={event => {
                      if (
                        event.key ===
                        "Enter"
                      ) {
                        event.preventDefault();

                        void sendRawCommand(
                          item.command
                        );
                      }
                    }}
                    disabled={
                      !activeTransportOnline
                    }
                    rightSectionWidth={68}
                    rightSection={
                      <Button
                        size="compact-xs"
                        px="xs"
                        disabled={
                          !activeTransportOnline ||
                          !item.command.trim()
                        }
                        onClick={() =>
                          void sendRawCommand(
                            item.command
                          )
                        }
                      >
                        Send
                      </Button>
                    }
                    styles={{
                      input: {
                        fontFamily:
                          "monospace",
                        paddingRight: 72,
                      },
                      section: {
                        paddingRight: 4,
                      },
                    }}
                  />
                </Stack>
              )
            )}
          </SimpleGrid>
        </Stack>
      </Card>

      <Card
        withBorder
        radius="md"
        p="md"
      >
        <Stack gap="sm">
          <Group
            justify="space-between"
            align="center"
          >
            <Text fw={600}>
              Command
            </Text>

            <Badge
              size="sm"
              variant="light"
              color={
                activeTransportOnline
                  ? "teal"
                  : "red"
              }
            >
              {transport ===
              "websocket"
                ? "WS"
                : "SERIAL"}
            </Badge>
          </Group>

          <TextInput
            value={command}
            onChange={event =>
              setCommand(
                event.currentTarget.value
              )
            }
            placeholder="<s>"
            disabled={
              !activeTransportOnline
            }
            onKeyDown={event => {
              if (
                event.key ===
                "Enter"
              ) {
                event.preventDefault();

                void sendCommand();
              }
            }}
            rightSectionWidth={76}
            rightSection={
              <Button
                size="compact-sm"
                leftSection={
                  <IconPlayerPlay
                    size={14}
                  />
                }
                disabled={
                  !activeTransportOnline ||
                  !command.trim()
                }
                onClick={() =>
                  void sendCommand()
                }
              >
                Send
              </Button>
            }
            styles={{
              input: {
                fontFamily:
                  "monospace",
                paddingRight: 80,
              },
              section: {
                paddingRight: 4,
              },
            }}
          />
        </Stack>
      </Card>

      <Card
        withBorder
        radius="md"
        p="md"
      >
        <Stack gap="sm">
          <Group
            justify="space-between"
            align="center"
            wrap="wrap"
          >
            <div>
              <Text fw={600}>
                Log
              </Text>

              <Text
                size="xs"
                c="dimmed"
              >
                TX · RX · connection events
              </Text>
            </div>

            <Group gap="md">
              {transport ===
                "websocket" && (
                <Switch
                  size="sm"
                  label="DCC-EX status"
                  checked={
                    showDccExStatus
                  }
                  onChange={event =>
                    setShowDccExStatus(
                      event.currentTarget.checked
                    )
                  }
                />
              )}

              <Button
                size="xs"
                variant="subtle"
                color="gray"
                leftSection={
                  <IconClearAll
                    size={15}
                  />
                }
                disabled={
                  log.length === 0
                }
                onClick={() =>
                  setLog([])
                }
              >
                Clear
              </Button>
            </Group>
          </Group>

          <ScrollArea
            h={320}
            viewportRef={
              viewportRef
            }
            type="auto"
          >
            <Stack
              gap={3}
              pr="sm"
            >
              {log.length === 0 && (
                <Text
                  size="sm"
                  c="dimmed"
                  ff="monospace"
                >
                  Waiting for
                  console activity…
                </Text>
              )}

              {log.map(entry => (
                <Group
                  key={entry.id}
                  gap="xs"
                  wrap="nowrap"
                  align="flex-start"
                >
                  <Text
                    size="xs"
                    c="dimmed"
                    ff="monospace"
                    style={{
                      flexShrink: 0,
                    }}
                  >
                    {entry.timestamp}
                  </Text>

                  <Text
                    size="xs"
                    fw={700}
                    c={logColor(
                      entry.direction
                    )}
                    ff="monospace"
                    style={{
                      width: 28,
                      flexShrink: 0,
                    }}
                  >
                    {entry.direction}
                  </Text>

                  <Text
                    size="xs"
                    ff="monospace"
                    style={{
                      whiteSpace:
                        "pre-wrap",
                      wordBreak:
                        "break-word",
                    }}
                  >
                    {entry.text}
                  </Text>
                </Group>
              ))}
            </Stack>
          </ScrollArea>
        </Stack>
      </Card>
    </Stack>
  );
}
