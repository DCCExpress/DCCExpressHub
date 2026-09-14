import {
  Alert,
  Badge,
  Card,
  Checkbox,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconBook2,
  IconInfoCircle,
} from "@tabler/icons-react";
import {
  useEffect,
  useState,
} from "react";

type CvBitDefinition = {
  bit: number;
  name: string;
  off?: string;
  on?: string;
  reserved?: boolean;
};

type CvDefinition = {
  name: string;
  description?: string;
  warning?: string;
  readOnlyValue?: boolean;
  default?: number;
  range?: {
    min?: number;
    max?: number;
  };
  related?: number[];
  bits?: CvBitDefinition[];
};

type CvHelpDocument = {
  schemaVersion: number;
  dataset?: string;
  language?: string;
  source?: {
    name?: string;
    revision?: string;
    url?: string;
  };
  notes?: string[];
  cvs: Record<string, CvDefinition>;
};

type Props = {
  cv: number;
  value: number;
  onChange?: (value: number) => void;
};

let cachedDocument: CvHelpDocument | null = null;
let pendingDocument: Promise<CvHelpDocument> | null = null;

async function loadCvHelp(): Promise<CvHelpDocument> {
  if (cachedDocument) {
    return cachedDocument;
  }

  if (!pendingDocument) {
    pendingDocument = fetch(
      "/help/cv-help.json",
      {
        cache: "force-cache",
      },
    )
      .then(async response => {
        if (!response.ok) {
          throw new Error(
            `CV help could not be loaded (HTTP ${response.status}).`,
          );
        }

        const document = await response.json() as CvHelpDocument;

        if (
          !document ||
          document.schemaVersion !== 1 ||
          !document.cvs ||
          typeof document.cvs !== "object"
        ) {
          throw new Error("Invalid CV help database.");
        }

        cachedDocument = document;
        return document;
      })
      .finally(() => {
        pendingDocument = null;
      });
  }

  return pendingDocument;
}

export function CvHelpPanel({
  cv,
  value,
  onChange,
}: Props) {
  const [document, setDocument] =
    useState<CvHelpDocument | null>(cachedDocument);
  const [error, setError] =
    useState("");

  useEffect(() => {
    let active = true;

    void loadCvHelp()
      .then(
        loaded => {
          if (active) {
            setDocument(loaded);
            setError("");
          }
        },
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
      active = false;
    };
  }, []);

  if (!Number.isFinite(cv) || cv < 1) {
    return null;
  }

  if (error) {
    return (
      <Alert
        color="orange"
        icon={<IconInfoCircle size={18} />}
      >
        {error}
      </Alert>
    );
  }

  if (!document) {
    return (
      <Group gap="xs">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          Loading CV help…
        </Text>
      </Group>
    );
  }

  const definition = document.cvs[String(cv)];
  const normalizedValue =
    Number.isFinite(value)
      ? Math.max(0, Math.min(255, Math.trunc(value)))
      : 0;

  if (!definition) {
    return (
      <Alert
        color="gray"
        variant="light"
        icon={<IconBook2 size={18} />}
        title={`CV${cv}`}
      >
        No standard NMRA help entry is stored for this CV. It may be
        manufacturer-specific; check the decoder manual before writing it.
      </Alert>
    );
  }

  const bits = [...(definition.bits ?? [])]
    .sort((left, right) => right.bit - left.bit);

  return (
    <Card
      withBorder
      radius={5}
      p="md"
      bg="var(--mantine-color-default-hover)"
    >
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap="xs">
              <IconBook2 size={18} />
              <Text fw={700}>
                CV{cv} — {definition.name}
              </Text>
              {definition.readOnlyValue && (
                <Badge size="sm" variant="light" color="blue">
                  normally read-only
                </Badge>
              )}
            </Group>

            {definition.description && (
              <Text size="sm" c="dimmed" mt={3}>
                {definition.description}
              </Text>
            )}
          </div>

        </Group>

        {definition.warning && (
          <Alert color="orange" variant="light">
            {definition.warning}
          </Alert>
        )}

        {bits.length > 0 && (
          <Stack gap={6}>
            <div>
              <Text size="sm" fw={700}>
                Bit meanings for the current value
              </Text>
              {onChange && (
                <Text size="xs" c="dimmed">
                  Change a bit here to update the CV value. The decoder is only
                  changed after you press Write CV.
                </Text>
              )}
            </div>

            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
              {bits.map(bit => {
                const enabled =
                  (normalizedValue & (1 << bit.bit)) !== 0;
                const meaning = bit.reserved
                  ? "Reserved"
                  : enabled
                    ? bit.on ?? "On"
                    : bit.off ?? "Off";

                return (
                  <Card
                    key={bit.bit}
                    withBorder
                    radius={5}
                    p="xs"
                  >
                    <Group
                      justify="space-between"
                      align="flex-start"
                      wrap="nowrap"
                    >
                      <div>
                        <Text size="sm" fw={650}>
                          b{bit.bit} · {bit.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {meaning}
                        </Text>
                      </div>

                      <Checkbox
                        aria-label={`Set CV${cv} bit ${bit.bit}`}
                        checked={enabled}
                        disabled={bit.reserved || !onChange}
                        onChange={event => {
                          if (!onChange || bit.reserved) {
                            return;
                          }

                          const nextValue = event.currentTarget.checked
                            ? normalizedValue | (1 << bit.bit)
                            : normalizedValue & ~(1 << bit.bit);

                          onChange(nextValue & 0xff);
                        }}
                      />
                    </Group>
                  </Card>
                );
              })}
            </SimpleGrid>
          </Stack>
        )}

        <Group gap="xs">
          {typeof definition.default === "number" && (
            <Text size="xs" c="dimmed">
              Default: {definition.default}
            </Text>
          )}

          {definition.range && (
            <Text size="xs" c="dimmed">
              Range: {definition.range.min ?? "?"}–{definition.range.max ?? "?"}
            </Text>
          )}

          {definition.related && definition.related.length > 0 && (
            <Text size="xs" c="dimmed">
              Related: {definition.related.map(item => `CV${item}`).join(", ")}
            </Text>
          )}
        </Group>
      </Stack>
    </Card>
  );
}
