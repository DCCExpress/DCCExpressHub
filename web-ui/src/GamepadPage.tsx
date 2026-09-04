import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconDeviceGamepad2,
  IconTrash,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GAMEPAD_ACTION_OPTIONS,
  useGamepad,
  type GamepadAction,
} from "@/context/GamepadContext";

type Props = {
  onBack: () => void;
};

type GamepadSnapshot = {
  index: number;
  id: string;
  mapping: string;
  axes: number[];
  buttons: {
    pressed: boolean;
    value: number;
  }[];
};

type LogEntry = {
  id: number;
  time: string;
  text: string;
};

const DEADZONE = 0.08;
const AXIS_LOG_DELTA = 0.2;
const MAX_LOGS = 120;

const ACTION_SELECT_DATA =
  GAMEPAD_ACTION_OPTIONS.map(option => ({
    value: option.value,
    label: option.label,
  }));

export default function GamepadPage({ onBack }: Props) {
  const {
    gamepads,
    selectedGamepadIndex,
    selectGamepad,
    mapping,
    setButtonAction,
    resetMapping,
  } = useGamepad();

  const [gamepad, setGamepad] =
    useState<GamepadSnapshot | null>(null);
  const [logs, setLogs] =
    useState<LogEntry[]>([]);

  const previousRef =
    useRef<GamepadSnapshot | null>(null);

  const frameRef =
    useRef<number | null>(null);

  const logIdRef = useRef(0);

  const addLog = useCallback((text: string) => {
    const item: LogEntry = {
      id: ++logIdRef.current,
      time: new Date().toLocaleTimeString(),
      text,
    };

    setLogs(current =>
      [item, ...current].slice(0, MAX_LOGS)
    );
  }, []);

  const readGamepad = (
    pad: Gamepad
  ): GamepadSnapshot => ({
    index: pad.index,
    id: pad.id,
    mapping: pad.mapping || "none",

    axes: Array.from(pad.axes),

    buttons: pad.buttons.map(button => ({
      pressed: button.pressed,
      value: button.value,
    })),
  });

  useEffect(() => {
    const connected = (event: GamepadEvent) => {
      addLog(
        `CONNECTED #${event.gamepad.index}: ${event.gamepad.id}`
      );
    };

    const disconnected = (event: GamepadEvent) => {
      addLog(
        `DISCONNECTED #${event.gamepad.index}: ${event.gamepad.id}`
      );

      if (event.gamepad.index === selectedGamepadIndex) {
        previousRef.current = null;
        setGamepad(null);
      }
    };

    window.addEventListener(
      "gamepadconnected",
      connected
    );

    window.addEventListener(
      "gamepaddisconnected",
      disconnected
    );

    return () => {
      window.removeEventListener(
        "gamepadconnected",
        connected
      );

      window.removeEventListener(
        "gamepaddisconnected",
        disconnected
      );
    };
  }, [addLog, selectedGamepadIndex]);

  useEffect(() => {
    const poll = () => {
      const pads =
        navigator.getGamepads?.() ?? [];

      const active =
        Array.from(pads).find(
          (pad): pad is Gamepad =>
            !!pad &&
            pad.connected &&
            pad.index === selectedGamepadIndex
        ) ?? null;

      if (!active) {
        setGamepad(null);
        previousRef.current = null;

        frameRef.current =
          requestAnimationFrame(poll);

        return;
      }

      const next = readGamepad(active);
      const previous = previousRef.current;

      if (
        !previous ||
        previous.index !== next.index
      ) {
        addLog(
          `ACTIVE #${next.index}: ${next.id}`
        );
      } else {
        /* GOMBOK */

        next.buttons.forEach(
          (button, index) => {
            const old =
              previous.buttons[index];

            if (!old) return;

            if (
              button.pressed !== old.pressed
            ) {
              addLog(
                button.pressed
                  ? `BUTTON ${index} DOWN  value=${button.value.toFixed(3)}`
                  : `BUTTON ${index} UP`
              );
            }
          }
        );

        /* JOYSTICKOK */

        next.axes.forEach(
          (value, index) => {
            const old =
              previous.axes[index] ?? 0;

            const enteredDeadzone =
              Math.abs(old) < DEADZONE &&
              Math.abs(value) >= DEADZONE;

            const changedEnough =
              Math.abs(value - old) >=
              AXIS_LOG_DELTA;

            if (
              enteredDeadzone ||
              changedEnough
            ) {
              addLog(
                `AXIS ${index}: ${value.toFixed(3)}`
              );
            }
          }
        );
      }

      previousRef.current = next;
      setGamepad(next);

      frameRef.current =
        requestAnimationFrame(poll);
    };

    frameRef.current =
      requestAnimationFrame(poll);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(
          frameRef.current
        );
      }
    };
  }, [addLog, selectedGamepadIndex]);

  const pressedButtons = useMemo(
    () =>
      gamepad?.buttons
        .map((button, index) => ({
          button,
          index,
        }))
        .filter(x => x.button.pressed) ??
      [],
    [gamepad]
  );

  const gamepadSupported =
    "getGamepads" in navigator;

  const gamepadSelectData = useMemo(
    () => gamepads.map(device => ({
      value: String(device.index),
      label: `#${device.index} · ${device.id}`,
    })),
    [gamepads]
  );

  const actionByButton = useMemo(() => {
    const result = new Map<number, GamepadAction>();

    for (const [action, button] of
      Object.entries(mapping)) {
      if (button !== undefined) {
        result.set(button, action as GamepadAction);
      }
    }

    return result;
  }, [mapping]);

  return (
    <Stack gap="md">

      {/* FEJLÉC */}

      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
      >
        <Group gap="xs" wrap="nowrap">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="lg"
            onClick={onBack}
          >
            <IconArrowLeft size={22} />
          </ActionIcon>

          <div>
            <Title order={3}>
              Gamepad diagnostics
            </Title>

            <Text
              size="sm"
              c="dimmed"
            >
              Bluetooth / USB controller
            </Text>
          </div>
        </Group>

        <Badge
          size="lg"
          color={
            gamepad ? "teal" : "gray"
          }
        >
          {gamepad
            ? "Connected"
            : "Waiting"}
        </Badge>
      </Group>


      {/* GAMEPAD INFO */}

      <Card
        withBorder
        radius="sm"
        p="md"
      >
        {gamepadSupported && (
          <Select
            mb="md"
            label="Active controller"
            description="Only this controller can operate the locomotive on this device."
            placeholder="No controller detected"
            data={gamepadSelectData}
            value={
              selectedGamepadIndex === null
                ? null
                : String(selectedGamepadIndex)
            }
            disabled={gamepadSelectData.length === 0}
            allowDeselect={false}
            onChange={value => {
              if (value !== null) {
                selectGamepad(Number(value));
              }
            }}
          />
        )}

        {!gamepadSupported ? (
          <Text c="red">
            Gamepad API is not supported
            by this browser.
          </Text>
        ) : (
          <Group
            gap="md"
            wrap="nowrap"
          >
            <IconDeviceGamepad2
              size={42}
            />

            <div
              style={{
                minWidth: 0,
              }}
            >
              <Text
                fw={700}
                lineClamp={2}
              >
                {gamepad?.id ??
                  "No controller detected"}
              </Text>

              <Text
                size="xs"
                c="dimmed"
              >
                {gamepad
                  ? `Index ${gamepad.index} · ${gamepad.axes.length} axes · ${gamepad.buttons.length} buttons · mapping: ${gamepad.mapping}`
                  : "Pair the controller and press any gamepad button."}
              </Text>
            </div>
          </Group>
        )}

        {pressedButtons.length > 0 && (
          <Group
            gap="xs"
            mt="md"
          >
            <Text
              size="sm"
              fw={700}
            >
              Pressed:
            </Text>

            {pressedButtons.map(
              ({ index, button }) => (
                <Badge
                  key={index}
                  color="cyan"
                >
                  B{index}{" "}
                  {button.value.toFixed(2)}
                </Badge>
              )
            )}
          </Group>
        )}

        <Group
          justify="space-between"
          align="center"
          mt="md"
          gap="sm"
        >
          <Text
            size="xs"
            c="dimmed"
            style={{
              flex: 1,
              minWidth: 0,
            }}
          >
            Button assignments are saved in this browser.
            Each function can belong to one button only.
          </Text>

          <Button
            size="compact-sm"
            variant="light"
            color="orange"
            onClick={() => {
              resetMapping();

              addLog(
                "MAPPING RESET TO DEFAULTS"
              );
            }}
          >
            Reset to defaults
          </Button>
        </Group>

      </Card>

      {/* AXIS + BUTTON */}

      {gamepad && (
        <SimpleGrid
          cols={{
            base: 1,
            sm: 2,
          }}
        >

          {/* JOYSTICK */}

          <Card
            withBorder
            radius="sm"
            p="md"
          >
            <Stack gap="sm">

              <Title order={4}>
                Axes
              </Title>

              {gamepad.axes.map(
                (value, index) => (
                  <Box key={index}>

                    <Group
                      justify="space-between"
                      mb={4}
                    >
                      <Text
                        size="sm"
                        fw={600}
                      >
                        Axis {index}
                      </Text>

                      <Text
                        size="sm"
                        ff="monospace"
                      >
                        {Math.abs(value) <
                          DEADZONE
                          ? "0.000"
                          : value.toFixed(3)}
                      </Text>
                    </Group>

                    <Progress
                      value={
                        ((value + 1) / 2) *
                        100
                      }
                      size="lg"
                      radius="sm"
                    />

                  </Box>
                )
              )}

            </Stack>
          </Card>


          {/* GOMBOK */}

          <Card
            withBorder
            radius="sm"
            p="md"
          >
            <Stack gap="sm">

              <Title order={4}>
                Button assignments
              </Title>

              <Text size="xs" c="dimmed">
                Choose the function for each physical button.
                Clearing a selection disables that button.
              </Text>

              <SimpleGrid
                cols={{
                  base: 1,
                  xs: 2,
                  md: 3,
                }}
                spacing="xs"
              >

                {gamepad.buttons.map(
                  (button, index) => (

                    <Card
                      key={index}
                      withBorder
                      radius="sm"
                      p="xs"
                      style={{
                        borderColor:
                          button.pressed
                            ? "var(--mantine-color-cyan-6)"
                            : undefined,

                        background:
                          button.pressed
                            ? "rgba(34,184,207,0.15)"
                            : undefined,
                      }}
                    >

                      <Stack gap={6}>
                        <Group
                          justify="space-between"
                          gap="xs"
                        >
                          <Text fw={800}>
                            B{index}
                          </Text>

                          <Badge
                            size="sm"
                            color={
                              button.pressed
                                ? "cyan"
                                : "gray"
                            }
                            variant={
                              button.pressed
                                ? "filled"
                                : "light"
                            }
                          >
                            {button.pressed
                              ? "DOWN"
                              : button.value.toFixed(2)}
                          </Badge>
                        </Group>

                        <Select
                          size="xs"
                          aria-label={`Button ${index} function`}
                          placeholder="No function"
                          clearable
                          data={ACTION_SELECT_DATA}
                          value={
                            actionByButton.get(index) ?? null
                          }
                          onChange={value =>
                            setButtonAction(
                              index,
                              value as GamepadAction | null
                            )
                          }
                        />
                      </Stack>

                    </Card>
                  )
                )}

              </SimpleGrid>

            </Stack>
          </Card>

        </SimpleGrid>
      )}


      {/* LOG */}

      <Card
        withBorder
        radius="sm"
        p="md"
      >
        <Stack gap="sm">

          <Group justify="space-between">

            <div>
              <Title order={4}>
                Input log
              </Title>

              <Text
                size="xs"
                c="dimmed"
              >
                Button and joystick events
              </Text>
            </div>

            <Button
              size="compact-sm"
              variant="light"
              color="gray"
              leftSection={
                <IconTrash size={15} />
              }
              disabled={
                logs.length === 0
              }
              onClick={() =>
                setLogs([])
              }
            >
              Clear
            </Button>

          </Group>

          <Box
            component="pre"
            m={0}
            p="sm"
            style={{
              height: 260,
              overflow: "auto",

              borderRadius: 4,

              background:
                "var(--mantine-color-dark-8)",

              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",

              fontSize: 12,

              whiteSpace:
                "pre-wrap",
            }}
          >
            {logs.length === 0
              ? "Waiting for gamepad input…"
              : logs
                .map(
                  item =>
                    `[${item.time}] ${item.text}`
                )
                .join("\n")}
          </Box>

        </Stack>
      </Card>

    </Stack>
  );
}
