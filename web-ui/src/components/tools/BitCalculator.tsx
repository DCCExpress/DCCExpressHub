import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";

import {
  IconBinary,
  IconCheck,
  IconCopy,
  IconRotateClockwise,
} from "@tabler/icons-react";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

type BitCalculatorProps = {
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
};

type CopyTarget =
  | "binary"
  | "decimal"
  | "hex"
  | null;

function clampByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      255,
      Math.trunc(value)
    )
  );
}

function toBinary(value: number): string {
  return value
    .toString(2)
    .padStart(8, "0");
}

function toHex(value: number): string {
  return `0x${value
    .toString(16)
    .toUpperCase()
    .padStart(2, "0")}`;
}

export default function BitCalculator({
  value,
  defaultValue = 0,
  onChange,
}: BitCalculatorProps) {
  const isControlled =
    value !== undefined;

  const [
    internalValue,
    setInternalValue,
  ] = useState(
    clampByte(defaultValue)
  );

  const [
    copied,
    setCopied,
  ] = useState<CopyTarget>(null);

  const currentValue =
    clampByte(
      isControlled
        ? value
        : internalValue
    );

  const binary =
    toBinary(currentValue);

  const hex =
    toHex(currentValue);

  const setValue =
    useCallback(
      (nextValue: number) => {
        const next =
          clampByte(nextValue);

        if (!isControlled) {
          setInternalValue(next);
        }

        onChange?.(next);
      },
      [
        isControlled,
        onChange,
      ]
    );

  const toggleBit =
    useCallback(
      (bit: number) => {
        const mask =
          1 << bit;

        setValue(
          currentValue ^ mask
        );
      },
      [
        currentValue,
        setValue,
      ]
    );

  const negate =
    useCallback(() => {
      setValue(
        (~currentValue) & 0xff
      );
    }, [
      currentValue,
      setValue,
    ]);

  const copyText =
    useCallback(
      async (
        target: Exclude<
          CopyTarget,
          null
        >,
        text: string
      ) => {
        try {
          await navigator.clipboard.writeText(
            text
          );

          setCopied(target);
        } catch {
          /*
           * Clipboard API nem minden
           * környezetben érhető el.
           */
          setCopied(null);
        }
      },
      []
    );

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer =
      window.setTimeout(
        () => {
          setCopied(null);
        },
        1200
      );

    return () => {
      window.clearTimeout(
        timer
      );
    };
  }, [copied]);

  const renderCopyButton = (
    target: Exclude<
      CopyTarget,
      null
    >,
    text: string
  ) => {
    const isCopied =
      copied === target;

    return (
      <Tooltip
        label={
          isCopied
            ? "Copied!"
            : "Copy"
        }
      >
        <ActionIcon
          variant="subtle"
          color={
            isCopied
              ? "teal"
              : "gray"
          }
          onClick={() =>
            void copyText(
              target,
              text
            )
          }
          aria-label="Copy"
        >
          {isCopied ? (
            <IconCheck
              size={17}
            />
          ) : (
            <IconCopy
              size={17}
            />
          )}
        </ActionIcon>
      </Tooltip>
    );
  };

  return (
    <Stack gap="lg">
      {/*
       * BIT EDITOR
       */}

      <Paper
        withBorder
        radius="md"
        p="md"
      >
        <Stack gap="sm">
          <Group
            justify="space-between"
            align="center"
          >
            <Group gap="xs">
              <IconBinary
                size={20}
              />

              <Text fw={700}>
                8-bit value
              </Text>
            </Group>

            <Badge
              variant="light"
              size="lg"
            >
              {currentValue}
            </Badge>
          </Group>

          <SimpleGrid
            cols={8}
            spacing={6}
          >
            {[
              7, 6, 5, 4,
              3, 2, 1, 0,
            ].map(bit => {
              const enabled =
                (currentValue &
                  (1 << bit)) !==
                0;

              return (
                <Stack
                  key={bit}
                  gap={3}
                  align="center"
                >
                  <Text
                    size="xs"
                    fw={700}
                    c="dimmed"
                  >
                    {bit}
                  </Text>

                  <Button
                    fullWidth
                    px={0}
                    variant={
                      enabled
                        ? "filled"
                        : "light"
                    }
                    color={
                      enabled
                        ? "blue"
                        : "gray"
                    }
                    onClick={() =>
                      toggleBit(bit)
                    }
                    styles={{
                      root: {
                        minWidth: 0,
                        height: 42,
                      },
                    }}
                  >
                    {enabled
                      ? "1"
                      : "0"}
                  </Button>

                  <Text
                    size="10px"
                    c="dimmed"
                    ff="monospace"
                  >
                    {1 << bit}
                  </Text>
                </Stack>
              );
            })}
          </SimpleGrid>
        </Stack>
      </Paper>

      {/*
       * VALUE REPRESENTATIONS
       */}

      <Stack gap="xs">
        <NumberInput
          label="Decimal"
          value={currentValue}
          min={0}
          max={255}
          allowDecimal={false}
          allowNegative={false}
          onChange={next => {
            if (
              typeof next ===
              "number"
            ) {
              setValue(next);
            }
          }}
          rightSection={
            renderCopyButton(
              "decimal",
              String(
                currentValue
              )
            )
          }
          rightSectionWidth={42}
        />

        <TextInput
          label="Binary"
          value={binary}
          readOnly
          ff="monospace"
          rightSection={
            renderCopyButton(
              "binary",
              binary
            )
          }
          rightSectionWidth={42}
        />

        <TextInput
          label="Hexadecimal"
          value={hex}
          readOnly
          ff="monospace"
          rightSection={
            renderCopyButton(
              "hex",
              hex
            )
          }
          rightSectionWidth={42}
        />
      </Stack>

      {/*
       * ACTIONS
       */}

      <Group
        justify="space-between"
        wrap="wrap"
      >
        <Group gap="xs">
          <Button
            variant="light"
            color="gray"
            onClick={() =>
              setValue(0)
            }
          >
            Clear
          </Button>

          <Button
            variant="light"
            color="gray"
            onClick={() =>
              setValue(255)
            }
          >
            All
          </Button>

          <Button
            variant="light"
            leftSection={
              <IconRotateClockwise
                size={17}
              />
            }
            onClick={
              negate
            }
          >
            Negate
          </Button>
        </Group>

        <Box>
          <Text
            size="xs"
            c="dimmed"
          >
            Click any bit to
            toggle it.
          </Text>
        </Box>
      </Group>
    </Stack>
  );
}