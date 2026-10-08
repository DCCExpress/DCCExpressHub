import { useEffect, useRef, useState } from "react";
import {
  Alert, Badge, Button, Group, NumberInput, Progress, ScrollArea,
  Stack, Table, Text, Title,
} from "@mantine/core";
import { wsApi } from "../../services/wsApi";
import type { Loco } from "../../domain/domainTypes";

type Props = {
  loco: Loco;
  onPatch: (patch: Partial<Loco>) => void;
};

const CORE = [2, 3, 4, 5, 6, 29, 66, 95];
const CURVE = Array.from({ length: 28 }, (_, index) => index + 67);
const ALL = [...CORE, ...CURVE];

const CV_NAMES: Record<number, string> = {
  2: "Start voltage",
  3: "Acceleration delay",
  4: "Braking delay",
  5: "Maximum speed",
  6: "Mid speed",
  29: "Decoder configuration",
  66: "Forward trim",
  95: "Reverse trim",
};

export default function DecoderProfilePanel({ loco, onPatch }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<number[]>([]);
  const [customCv, setCustomCv] = useState<number | string>(4);
  const cancel = useRef(false);
  const [liveValues, setLiveValues] = useState<Record<string, number> | null>(null);
  const locoIdRef = useRef(loco.id);
  useEffect(() => {
    locoIdRef.current = loco.id;
    cancel.current = true;
    setLiveValues(null);
    setErrors([]);
    setMessage("");
  }, [loco.id]);
  const saved = loco.decoderProfile?.cvValues ?? {};
  const values = liveValues ?? saved;
  const readAt = loco.decoderProfile?.readAt;
  const curveEnabled = values["29"] !== undefined
    ? (values["29"] & 0x10) !== 0
    : null;
  const curve = CURVE.map((cv, index) => ({ x: index + 1, y: values[String(cv)] }))
    .filter((point): point is { x: number; y: number } =>
      typeof point.y === "number");
  const line = curve.map(point =>
    `${16 + ((point.x - 1) / 27) * 690},${218 - (point.y / 255) * 198}`
  ).join(" ");

  const read = async (cvs: number[]) => {
    if (busy) return;
    cancel.current = false;
    setBusy(true);
    setErrors([]);
    setMessage("");
    setProgress({ done: 0, total: cvs.length });
    const next = { ...values };
    const failed: number[] = [];
    let succeeded = 0;
    try {
      // Each CV is read on PROG (service mode), never via unverified POM.
      // Sequential requests avoid overloading the command station.
      for (let index = 0; index < cvs.length; index++) {
        if (cancel.current || locoIdRef.current !== loco.id) break;
        const cv = cvs[index]!;
        try {
          const result = await wsApi.programmingRequest(
            `decoder-profile-${loco.id}-${cv}-${Date.now()}`,
            "readCv",
            { cv },
            30000
          );
          if (!result.ok || typeof result.value !== "number" ||
              !Number.isInteger(result.value) || result.value < 0 ||
              result.value > 255) {
            throw new Error(result.message ?? "Decoder did not acknowledge CV");
          }
          if (cancel.current || locoIdRef.current !== loco.id) break;
          next[String(cv)] = result.value;
          succeeded++;
          setLiveValues({ ...next });
          // Persist the successful partial profile via the Loco Editor Save.
          onPatch({
            decoderProfile: {
              source: "service",
              cvValues: { ...next },
              readAt: new Date().toISOString(),
            },
          });
        } catch {
          failed.push(cv);
        }
        setProgress({ done: index + 1, total: cvs.length });
      }
      setErrors(failed);
      setMessage(
        `Read ${succeeded} CV(s)${failed.length ? `; failed: ${failed.join(", ")}` : ""}${cancel.current ? " (stopped)" : ""}. Press Save in the locomotive editor to persist.`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollArea h="100%" type="auto" offsetScrollbars>
      <Stack p="sm" gap="md">
        <Group justify="space-between" align="center">
          <div>
            <Title order={4}>Decoder CV Profile</Title>
            <Text size="sm" c="dimmed">
              Read decoder settings on the programming track, then Save the locomotive.
            </Text>
          </div>
          <Badge variant="light">PROG read only</Badge>
        </Group>
        <Alert color="orange">
          Place only this locomotive on the isolated PROG output before reading.
          The decoder values are not physical speed (mm/s) or stopping distance (mm).
          No CVs are written from this panel.
        </Alert>
        <Group>
          <Button disabled={busy} onClick={() => void read(CORE)}>
            Read core CVs
          </Button>
          <Button variant="light" disabled={busy} onClick={() => void read(ALL)}>
            Read complete speed curve
          </Button>
          <NumberInput label="CV" min={1} max={1024} w={100}
            value={customCv} onChange={setCustomCv} disabled={busy}/>
          <Button variant="subtle" disabled={busy || !Number.isInteger(Number(customCv)) ||
            Number(customCv) < 1 || Number(customCv) > 1024}
            onClick={() => void read([Number(customCv)])}>Read CV</Button>
          {busy && <Button color="red" variant="light"
            onClick={() => { cancel.current = true; }}>Stop after current CV</Button>}
        </Group>
        {busy && <Progress value={progress.total ? 100 * progress.done / progress.total : 0} />}
        {message && <Text size="sm">{message}</Text>}
        {errors.length > 0 && <Alert color="yellow">
          Unreadable CVs are omitted, never replaced by zero: {errors.join(", ")}.
        </Alert>}
        <Group>
          <Text size="sm">Last saved read: {readAt ?? "Not yet saved"}</Text>
          <Text size="sm">Curve mode: {curveEnabled === null
            ? "CV29 not read" : curveEnabled ? "28-point curve enabled" : "3-point speed curve"}</Text>
        </Group>
        <Title order={5}>Decoder speed curve (CV output, 0–255)</Title>
        {curve.length > 0 ? (
          <svg viewBox="0 0 730 240" role="img"
            aria-label="Decoder speed table CV67 to CV94">
            {[0, 64, 128, 192, 255].map(level =>
              <g key={level}>
                <line x1="16" x2="706" y1={218 - level / 255 * 198}
                  y2={218 - level / 255 * 198} stroke="currentColor"
                  opacity="0.14" />
                <text x="707" y={222 - level / 255 * 198}
                  fill="currentColor" fontSize="11">{level}</text>
              </g>
            )}
            <polyline points={line} fill="none" stroke="#228be6" strokeWidth="2.5" />
            {curve.map(point =>
              <circle key={point.x} cx={16 + (point.x - 1) / 27 * 690}
                cy={218 - point.y / 255 * 198} r="3" fill="#228be6" />
            )}
            <text x="16" y="237" fontSize="11" fill="currentColor">
              Step 1 (CV67)
            </text>
            <text x="620" y="237" fontSize="11" fill="currentColor">
              Step 28 (CV94)
            </text>
          </svg>
        ) : (
          <Text c="dimmed" size="sm">
            Read the complete curve to display CV67–94. CV29 determines
            whether that curve is actually enabled.
          </Text>
        )}
        <Title order={5}>Read CV values</Title>
        <Table striped highlightOnHover>
          <Table.Thead><Table.Tr>
            <Table.Th>CV</Table.Th><Table.Th>Setting</Table.Th><Table.Th>Value</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {ALL.filter(cv => values[String(cv)] !== undefined).map(cv =>
              <Table.Tr key={cv}>
                <Table.Td>{cv}</Table.Td>
                <Table.Td>{CV_NAMES[cv] ?? `Speed point ${cv - 66}`}</Table.Td>
                <Table.Td>{values[String(cv)]}</Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed">
          CV3/CV4 describe decoder acceleration/braking delay. Some decoders
          use manufacturer-specific constant-braking-distance settings,
          which require their own decoder definition.
        </Text>
      </Stack>
    </ScrollArea>
  );
}
