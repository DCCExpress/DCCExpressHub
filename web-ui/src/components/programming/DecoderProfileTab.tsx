import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Badge, Button, Card, Group, NumberInput, Progress, ScrollArea,
  Stack, Table, Text, TextInput, Title,
} from "@mantine/core";
import { wsApi } from "../../services/wsApi";

type CvInfo = {
  name: string;
  description?: string;
  bits?: Array<{ bit: number; name: string; off?: string; on?: string; reserved?: boolean }>;
};
type Help = { cvs: Record<string, CvInfo> };
type Result = { value?: number; error?: string };
type ExportRow = { cv: number; value: number; name: string; description: string };
const MAX_CV = 1024;
const CURVE_CVS = Array.from({ length: 28 }, (_, i) => 67 + i);
const numberFormat = (value: number) => ({
  decimal: String(value),
  hex: "0x" + value.toString(16).toUpperCase().padStart(2, "0"),
  binary: value.toString(2).padStart(8, "0"),
});
function meaning(cv: number, info?: CvInfo): string {
  if (info?.name) return info.name;
  if (cv >= 67 && cv <= 94) return `Extended speed table point ${cv - 66}`;
  return "Unknown / manufacturer-specific";
}

function CvCurve({ values }: { values: Record<number, Result> }) {
  const points = CURVE_CVS.map((cv, i) => ({
    cv, x: 36 + i * 21.3,
    value: values[cv]?.value,
  }));
  const present = points.filter((p): p is typeof p & { value: number } =>
    typeof p.value === "number");
  const segments: Array<Array<typeof present[number]>> = [];
  for (const point of present) {
    const last = segments[segments.length - 1];
    if (!last || last[last.length - 1]!.cv !== point.cv - 1) segments.push([point]);
    else last.push(point);
  }
  return <Card withBorder>
    <Stack gap="xs">
      <Group justify="space-between">
        <Title order={5}>Extended speed table · CV67–94</Title>
        <Group gap="xs">
          <Badge color={values[29]?.value === undefined ? "gray" : (values[29].value! & 0x10) !== 0 ? "green" : "orange"}>
            {values[29]?.value === undefined ? "UNKNOWN · read CV29" : (values[29].value! & 0x10) !== 0 ? "IN USE" : "NOT IN USE"}
          </Badge>
          <Badge variant="outline">{present.length}/28 read</Badge>
        </Group>
      </Group>
      <svg viewBox="0 0 660 260" role="img" aria-label="Extended decoder speed-table CV67 to CV94">
        {[0,64,128,192,255].map(v =>
          <g key={v}>
            <line x1="36" y1={221-v*0.75} x2="616" y2={221-v*0.75}
              stroke="currentColor" opacity=".14"/>
            <text x="6" y={225-v*0.75} fontSize="11" fill="currentColor">{v}</text>
          </g>)}
        {segments.filter(part => part.length >= 2).map((part, i) =>
          <polyline key={i} points={part.map(p => `${p.x},${221-p.value*0.75}`).join(" ")}
            stroke="#228be6" strokeWidth="2.5" fill="none"/>)}
        {present.map(p => <g key={p.cv}>
          <circle cx={p.x} cy={221-p.value*0.75} r="3.5" fill="#228be6">
            <title>{`CV${p.cv}: ${p.value}`}</title>
          </circle>
        </g>)}
        <text x="36" y="248" fill="currentColor" fontSize="12">CV67</text>
        <text x="565" y="248" fill="currentColor" fontSize="12">CV94</text>
      </svg>
      <Text size="xs" c="dimmed">
        Only successfully read points are drawn; unread values are gaps, not zeros.
        CV29 bit 4 selects whether this table is active. Values are decoder parameters,
        not measured millimeters per second.
      </Text>
    </Stack>
  </Card>;
}

export default function DecoderProfileTab({ disconnected }: { disconnected: boolean }) {
  const [help, setHelp] = useState<Help>({ cvs: {} });
  const [results, setResults] = useState<Record<number, Result>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [activeCv, setActiveCv] = useState<number | null>(null);
  const [fileName, setFileName] = useState("dcc-decoder-profile");
  const [locoAddress, setLocoAddress] = useState<number | string>(3);
  const [savedMessage, setSavedMessage] = useState("");
  const [error, setError] = useState("");
  const [customStart, setCustomStart] = useState<number | string>(1);
  const [customEnd, setCustomEnd] = useState<number | string>(1024);
  const cancel = useRef(false);
  useEffect(() => {
    void fetch("/help/cv-help.json", { cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("CV reference unavailable");
        return response.json() as Promise<Help>;
      }).then(setHelp).catch(() => setError("CV descriptions could not be loaded."));
  }, []);
  const knownCvs = useMemo(() =>
    [...new Set([...Object.keys(help.cvs).map(Number), ...CURVE_CVS])]
      .filter(cv => Number.isInteger(cv) && cv >= 1 && cv <= MAX_CV)
      .sort((a,b) => a-b), [help]);
  const read = async (cvs: number[]) => {
    if (busy || disconnected || cvs.length === 0) return;
    cancel.current = false;
    setBusy(true);
    setError("");
    setProgress({ done: 0, total: cvs.length });
    try {
      for (let i=0; i<cvs.length; i++) {
        if (cancel.current) break;
        const cv = cvs[i]!;
        setActiveCv(cv);
        let item: Result;
        try {
          const response = await wsApi.programmingRequest(
            `cv-profile-${cv}-${Date.now()}-${i}`, "readCv", { cv }, 30000
          );
          item = response.ok && typeof response.value === "number" &&
            Number.isInteger(response.value) && response.value >= 0 &&
            response.value <= 255
            ? { value: response.value }
            : { error: response.message ?? "No valid decoder acknowledgement" };
        } catch (e) {
          item = { error: e instanceof Error ? e.message : String(e) };
        }
        setResults(prev => ({ ...prev, [cv]: item }));
        setProgress({ done: i + 1, total: cvs.length });
      }
    } finally {
      setActiveCv(null);
      setBusy(false);
    }
  };
  const rows = useMemo(() => Object.entries(results)
    .map(([cv, result]) => ({ cv: Number(cv), result }))
    .sort((a,b) => a.cv-b.cv), [results]);
  const successful = rows.filter(row => row.result.value !== undefined);
  const cv29 = results[29]?.value;
  // The actual DCC address belongs to the decoder CVs, not to a
  // manually entered default. CV29 bit 5 selects short vs extended.
  const decodedAddress = cv29 === undefined ? null
    : (cv29 & 0x20) !== 0
      ? (results[17]?.value !== undefined && results[18]?.value !== undefined
        ? ((results[17].value! & 0x3f) << 8) | results[18].value!
        : null)
      : results[1]?.value ?? null;
  useEffect(() => {
    if (decodedAddress !== null && decodedAddress > 0 && decodedAddress <= 10239)
      setLocoAddress(decodedAddress);
  }, [decodedAddress]);
  const identifier = {
    manufacturerId: results[8]?.value ?? null,
    decoderVersion: results[7]?.value ?? null,
    userId1: results[105]?.value ?? null,
    userId2: results[106]?.value ?? null,
    addressFromCv: decodedAddress,
    verifiedUnique: false,
  };
  const currentProfile = () => ({
    schemaVersion: 1,
    type: "dcc-decoder-cv-profile",
    address: Number(locoAddress),
    readMode: "service-programming-track",
    readAt: new Date().toISOString(),
    identity: identifier,
    cvValues: Object.fromEntries(successful.map(({cv,result}) => [String(cv),result.value!])),
    failed: rows.filter(row => row.result.error).map(row => ({cv:row.cv,error:row.result.error})),
  });
  const saveToHub = async () => {
    const address = Number(locoAddress);
    if (!Number.isInteger(address) || address < 1 || address > 10239) {
      setError("Enter a valid locomotive address."); return;
    }
    if (!successful.length) { setError("Nothing has been read successfully."); return; }
    try {
      const response = await fetch("/api/decoder-profiles", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(currentProfile()),
      });
      if (!response.ok) throw new Error(`Profile save failed (HTTP ${response.status})`);
      setSavedMessage(`Saved to Hub: config/profiles/loco-${address}.json`);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const exportProfile = () => {
    if (!successful.length) { setError("Nothing has been read successfully."); return; }
    const safeName = fileName.trim().replace(/[\\/:*?"<>|]/g, "_");
    if (!safeName) { setError("Enter an export filename."); return; }
    const data: ExportRow[] = successful.map(({cv,result}) => ({
      cv, value: result.value!, name: meaning(cv, help.cvs[String(cv)]),
      description: help.cvs[String(cv)]?.description ?? "",
    }));
    const json = JSON.stringify({
      schemaVersion: 1, type: "dcc-decoder-cv-profile", exportedAt: new Date().toISOString(),
      readMode: "service-programming-track", requested: rows.length,
      cvRange: { min: rows[0]?.cv ?? 1, max: rows[rows.length-1]?.cv ?? MAX_CV },
      identity: identifier, address: Number(locoAddress),
      values: data, failed: rows.filter(row => row.result.error)
        .map(row => ({ cv: row.cv, error: row.result.error })),
    }, null, 2);
    const url = URL.createObjectURL(new Blob([json], {type: "application/json"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = safeName.endsWith(".json") ? safeName : safeName + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setError("");
  };
  return <Stack gap="md">
    <Alert color="orange">
      Service-mode read only: use an isolated PROG track with one decoder.
      A complete CV1–1024 scan can take a long time, and unsupported CVs may fail.
      Reading does not modify decoder settings.
    </Alert>
    <Card withBorder>
      <Stack gap="sm">
        <Title order={4}>Decoder Profile · CV scan</Title>
        <Group>
          <Button disabled={busy || disconnected} onClick={() => void read(knownCvs)}>Read known CVs</Button>
          <Button disabled={busy || disconnected} variant="light"
            onClick={() => void read(Array.from({ length: 256 }, (_,i) => i+1))}>CV1–256</Button>
          <Button disabled={busy || disconnected} variant="light"
            onClick={() => void read(Array.from({ length: 768 }, (_,i) => i+257))}>CV257–1024</Button>
          <Button disabled={busy || disconnected} color="blue"
            onClick={() => void read(Array.from({ length: MAX_CV }, (_,i) => i+1))}>
            Read all CV1–1024
          </Button>
        </Group>
        <Group align="end">
          <NumberInput label="From CV" value={customStart} min={1} max={MAX_CV}
            onChange={setCustomStart} w={130} disabled={busy}/>
          <NumberInput label="To CV" value={customEnd} min={1} max={MAX_CV}
            onChange={setCustomEnd} w={130} disabled={busy}/>
          <Button variant="outline" disabled={busy || disconnected ||
            !Number.isInteger(Number(customStart)) || !Number.isInteger(Number(customEnd)) ||
            Number(customStart) < 1 || Number(customEnd) > MAX_CV ||
            Number(customStart) > Number(customEnd)}
            onClick={() => void read(Array.from({length: Number(customEnd)-Number(customStart)+1},
              (_,i) => Number(customStart)+i))}>Read range</Button>
          {busy && <Button color="red" variant="light"
            onClick={() => { cancel.current = true; }}>Stop after current CV</Button>}
        </Group>
        {progress.total > 0 && <>
          <Progress value={100*progress.done/progress.total}/>
          <Text size="sm">Read {progress.done}/{progress.total}
            {activeCv !== null ? ` · CV${activeCv}` : ""}
            {busy ? " · Running" : " · Finished/stopped"}
          </Text>
        </>}
        <Text size="sm">Successfully read: {successful.length} · Failed: {rows.length-successful.length}
          · CV29 speed curve: {cv29 === undefined ? "unknown" :
            (cv29 & 0x10) ? "extended CV67–94 enabled" : "three-point CV2/5/6"}
        </Text>
      </Stack>
    </Card>
    <CvCurve values={results}/>
    <Card withBorder>
      <Stack gap="xs">
        <Title order={5}>Acceleration and braking CV settings</Title>
        <Group>
          {[3,4].map(cv => <Badge key={cv} size="lg" variant="light">
            CV{cv}: {results[cv]?.value === undefined ? "not read" : results[cv]?.value}
            {cv === 3 ? " acceleration" : " braking"}
          </Badge>)}
        </Group>
        <Text size="sm">CV3 — Acceleration delay: a larger value means slower acceleration (more inertia), not stronger acceleration.</Text>
        <Text size="sm">CV4 — Braking delay: a larger value means slower deceleration and generally longer stopping distance. A smaller value usually shortens it.</Text>
        <Text size="xs" c="dimmed">These are decoder momentum settings, not measured acceleration or braking distances. A physical brake-distance curve cannot be reconstructed from CV4 alone. Manufacturer-specific constant-distance settings may also apply.</Text>
      </Stack>
    </Card>
    <Card withBorder>
      <Stack gap="sm">
        <Title order={5}>Decoder identification and Hub storage</Title>
        <Text size="sm">Decoder manufacturer CV8: {identifier.manufacturerId ?? "not read"} · version CV7: {identifier.decoderVersion ?? "not read"} · user IDs CV105/106: {identifier.userId1 ?? "?"}/{identifier.userId2 ?? "?"}</Text>
        <Text size="sm">Address from decoder CVs: {decodedAddress ?? "not yet determined (read CV29 and CV1 or CV17/18)"}. {decodedAddress !== null ? "Locomotive address has been filled automatically." : ""}</Text>
        <Text size="xs" c="dimmed">No universal unique decoder serial number is defined by these CVs. Address and manufacturer/version are clues, not proof that the same physical decoder is present. Read CV1/17/18/29/7/8/105/106 to include available identification.</Text>
        <Group align="end">
          <NumberInput label="Locomotive DCC address" min={1} max={10239} value={locoAddress} onChange={setLocoAddress} w={190}/>
          <Button onClick={() => void saveToHub()} disabled={!successful.length}>Save to Hub profiles</Button>
        </Group>
        {savedMessage && <Text size="sm" c="green">{savedMessage}</Text>}
        <Title order={5}>Export decoder profile</Title>
        <Group align="end">
          <TextInput label="Export filename" value={fileName} onChange={e => setFileName(e.currentTarget.value)}
            style={{ flex: 1 }} placeholder="my-locomotive-decoder"/>
          <Button onClick={exportProfile} disabled={!successful.length}>Export JSON</Button>
        </Group>
        <Text size="xs" c="dimmed">The export contains CV numbers, decoded names, values, and failed read addresses. No decoder values are written.</Text>
      </Stack>
    </Card>
    {error && <Alert color="red">{error}</Alert>}
    <Card withBorder>
      <Title order={5} mb="sm">CV values and bit definitions</Title>
      <ScrollArea h={500} type="auto">
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead><Table.Tr>
            <Table.Th>CV</Table.Th><Table.Th>Meaning</Table.Th>
            <Table.Th>DEC</Table.Th><Table.Th>HEX</Table.Th><Table.Th>BIN</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {rows.map(({cv,result}) => {
              const info = help.cvs[String(cv)];
              const value = result.value;
              const format = value !== undefined ? numberFormat(value) : null;
              return <Table.Tr key={cv}>
                <Table.Td>CV{cv}</Table.Td>
                <Table.Td>
                  <Text fw={500} size="sm">{meaning(cv,info)}</Text>
                  {info?.description && <Text size="xs" c="dimmed">{info.description}</Text>}
                  {value !== undefined && info?.bits?.length ? <Stack gap={1} mt={4}>
                    {info.bits.map(bit => <Text key={bit.bit} size="xs">
                      b{bit.bit} = {(value >> bit.bit) & 1} · {bit.name}
                      {bit.reserved ? " (reserved)" : " · " +
                        (((value >> bit.bit) & 1) ? bit.on ?? "ON" : bit.off ?? "OFF")}
                    </Text>)}
                  </Stack> : null}
                  {result.error && <Text size="xs" c="red">{result.error}</Text>}
                </Table.Td>
                <Table.Td>{format?.decimal ?? "—"}</Table.Td>
                <Table.Td ff="monospace">{format?.hex ?? "—"}</Table.Td>
                <Table.Td ff="monospace">{format?.binary ?? "—"}</Table.Td>
              </Table.Tr>;
            })}
          </Table.Tbody>
        </Table>
        {!rows.length && <Text p="sm" c="dimmed">No CVs read yet.</Text>}
      </ScrollArea>
    </Card>
  </Stack>;
}
