import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Group, NumberInput, Stack, Table, Text, Title } from "@mantine/core";
import type { Loco } from "../../domain/domainTypes";
import { wsApi } from "../../services/wsApi";

type Saved = {
  address: number;
  identity?: { manufacturerId?: number | null; decoderVersion?: number | null;
    userId1?: number | null; userId2?: number | null; verifiedUnique?: boolean };
  cvValues: Record<string, number>;
};
export default function LocoDecoderProfileEditor({ loco }: { loco: Loco }) {
  const [profile, setProfile] = useState<Saved | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Record<string, number | string>>({});
  useEffect(() => {
    let alive = true;
    setProfile(null);
    setEditing({});
    setMessage("");
    void fetch("/api/decoder-profiles", { cache: "no-store" })
      .then(async r => { if (!r.ok) throw Error("Could not load saved decoder profiles"); return r.json() as Promise<Saved[]>; })
      .then(list => {
        if (!alive) return;
        setProfile(list.find(item => item.address === loco.address) ?? null);
        setError("");
      }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [loco.address]);
  const write = async (cv: 3 | 4, value: number, restore: boolean) => {
    if (!Number.isInteger(value) || value < 0 || value > 255) return;
    const original = profile?.cvValues[String(cv)];
    if (!window.confirm(
      `POM write CV${cv} = ${value} to locomotive DCC address ${loco.address} on MAIN?\n` +
      `Profile baseline: ${original ?? "unknown"}\n` +
      `This command has NO decoder read-back verification. Verify the address and ensure only the intended locomotive responds.`
    )) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await wsApi.programmingRequest(
        `loco-profile-${loco.address}-${cv}-${Date.now()}`,
        "pomWriteCv", { address: loco.address, cv, value }
      );
      if (!result.ok) throw Error(result.message ?? "POM command rejected");
      setMessage(`POM CV${cv} = ${value} command sent to #${loco.address}${restore ? " (saved profile baseline)" : ""}. Unverified; stored baseline unchanged.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return <Stack gap="md" p="sm">
    <Title order={4}>Decoder profile · locomotive #{loco.address}</Title>
    {!profile ? <Alert color="yellow">No saved decoder CV profile for this DCC address. Read the decoder on Programming → Profile and use Save to Hub profiles.</Alert> :
      <>
        <Alert color="blue">Profile matched by DCC address only, not a verified hardware serial number. CV8 manufacturer and CV7 version are not unique. A POM write is not proof that the CV changed.</Alert>
        <Group>
          <Badge>CV8 manufacturer: {profile.identity?.manufacturerId ?? "unknown"}</Badge>
          <Badge>CV7 version: {profile.identity?.decoderVersion ?? "unknown"}</Badge>
          <Badge>CV105/106: {profile.identity?.userId1 ?? "?"}/{profile.identity?.userId2 ?? "?"}</Badge>
        </Group>
        <Card withBorder>
          <Title order={5} mb="xs">Motor momentum · POM controls</Title>
          <Text size="sm" mb="sm">Higher CV3 means slower acceleration. Higher CV4 means longer braking delay and generally longer stopping distance. The baseline comes from the saved PROG read; Reset CV writes that value back by POM.</Text>
          <Table>
            <Table.Thead><Table.Tr><Table.Th>CV</Table.Th><Table.Th>Stored baseline</Table.Th><Table.Th>New value</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {([3,4] as const).map(cv => {
                const baseline = profile.cvValues[String(cv)];
                const value = editing[String(cv)] ?? baseline ?? 0;
                return <Table.Tr key={cv}>
                  <Table.Td>CV{cv} · {cv===3 ? "Acceleration" : "Braking"}</Table.Td>
                  <Table.Td>{baseline ?? "Not read"}</Table.Td>
                  <Table.Td><NumberInput min={0} max={255} disabled={busy} w={110} value={value} onChange={v => setEditing(old => ({...old,[String(cv)]:v}))}/></Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Button size="xs" disabled={busy || !Number.isInteger(Number(value)) || Number(value)<0 || Number(value)>255}
                        onClick={() => void write(cv, Number(value), false)}>Write POM</Button>
                      <Button size="xs" variant="outline" disabled={busy || baseline === undefined}
                        onClick={() => void write(cv, baseline!, true)}>Reset CV</Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>;
              })}
            </Table.Tbody>
          </Table>
        </Card>
      </>
    }
    {error && <Alert color="red">{error}</Alert>}
    {message && <Alert color="green">{message}</Alert>}
  </Stack>;
}
