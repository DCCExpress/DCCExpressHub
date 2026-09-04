import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconDeviceFloppy,
  IconHelpCircle,
  IconRefresh,
  IconTool,
  IconTrain,
} from "@tabler/icons-react";
import { useState } from "react";

import type { ProgrammingCommandAction, ProgrammingResponsePayload } from "@domain/types";
import { wsApi } from "@/services/wsApi";
import type { WsConnectionStatus } from "@/services/wsClient";

type Props = {
  onBack: () => void;
  status: WsConnectionStatus;
};

type NumberValue = string | number;

function numberValue(value: NumberValue): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function BitEditor({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <Group gap="xs" wrap="wrap">
      {Array.from({ length: 8 }, (_, index) => 7 - index).map(bit => (
        <Checkbox
          key={bit}
          label={`b${bit}`}
          checked={(value & (1 << bit)) !== 0}
          onChange={event => onChange(event.currentTarget.checked ? value | (1 << bit) : value & ~(1 << bit))}
        />
      ))}
    </Group>
  );
}

function ProgrammingResult({ result }: { result: ProgrammingResponsePayload | null }) {
  if (!result) return null;
  return (
    <Alert color={result.ok ? "teal" : "red"} icon={result.ok ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />}>
      <Text size="sm" fw={600}>{result.message ?? (result.ok ? "Command completed." : "Command failed.")}</Text>
      {typeof result.value === "number" && result.value >= 0 && <Text size="sm">Returned value: <strong>{result.value}</strong></Text>}
      {result.raw && <Text size="xs" c="dimmed" ff="monospace" mt={4}>{result.raw}</Text>}
    </Alert>
  );
}

export default function ProgrammingPage({ onBack, status }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProgrammingResponsePayload | null>(null);
  const [locoAddress, setLocoAddress] = useState<NumberValue>(3);
  const [cv, setCv] = useState<NumberValue>(1);
  const [cvValue, setCvValue] = useState<NumberValue>(0);
  const [pom, setPom] = useState(false);
  const [accessoryCv, setAccessoryCv] = useState<NumberValue>(1);
  const [accessoryCvValue, setAccessoryCvValue] = useState<NumberValue>(0);
  const [accessoryAddress, setAccessoryAddress] = useState<NumberValue>(1);
  const [digiSwitchAddress, setDigiSwitchAddress] = useState<NumberValue>(1);
  const [digiSignalAddress, setDigiSignalAddress] = useState<NumberValue>(1);

  const run = async (
    action: ProgrammingCommandAction,
    values: { address?: number; cv?: number; value?: number; active?: boolean },
    confirmText?: string,
    valueTarget?: "locomotive" | "accessory"
  ) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setResult(null);
    try {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const response = await wsApi.programmingRequest(requestId, action, values);
      setResult(response);
      if (response.ok && typeof response.value === "number" && response.value >= 0) {
        if (action === "readAddress") setLocoAddress(response.value);
        if (action === "readCv" && valueTarget === "locomotive") setCvValue(response.value);
        if (action === "readCv" && valueTarget === "accessory") setAccessoryCvValue(response.value);
      }
    } catch (error) {
      setResult({ requestId: "local", action, ok: false, message: error instanceof Error ? error.message : "Programming request failed." });
    } finally {
      setBusy(false);
    }
  };

  const disconnected = status !== "connected";
  const locoCv = numberValue(cv);
  const locoValue = numberValue(cvValue);
  const accCv = numberValue(accessoryCv);
  const accValue = numberValue(accessoryCvValue);

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={18} />} onClick={onBack}>
          Back to home
        </Button>
        <Badge color={disconnected ? "red" : "teal"} variant={disconnected ? "filled" : "light"}>
          {disconnected ? "Offline" : "Connected"}
        </Badge>
      </Group>

      <Group gap="sm" wrap="nowrap">
        <ThemeIcon size={42} radius="md" variant="light" color="orange"><IconTool size={24} /></ThemeIcon>
        <div>
          <Title order={3}>Decoder programming</Title>
          <Text size="sm" c="dimmed">Locomotive, accessory and DigiTools setup</Text>
        </div>
      </Group>

      {disconnected && <Alert color="red" icon={<IconAlertTriangle size={18} />}>Connect to the EX-CSB1 before sending programming commands.</Alert>}
      <ProgrammingResult result={result} />

      <Tabs defaultValue="locomotive" keepMounted={false}>
        <Tabs.List grow>
          <Tabs.Tab value="locomotive" leftSection={<IconTrain size={16} />}>Locomotive</Tabs.Tab>
          <Tabs.Tab value="accessory" leftSection={<IconDeviceFloppy size={16} />}>Accessory</Tabs.Tab>
          <Tabs.Tab value="digitools" leftSection={<IconTool size={16} />}>DigiTools</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="locomotive" pt="md">
          <Stack gap="md">
            <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Programming track safety">
              Service-mode operations automatically power the isolated PROG output for the command, then switch it off. Keep only the decoder being programmed on that track.
            </Alert>

            <Card withBorder radius={5} p="lg">
              <Stack gap="md">
                <Title order={4}>Locomotive address</Title>
                <NumberInput label="Address" value={locoAddress} onChange={setLocoAddress} min={1} max={10239} allowDecimal={false} />
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Button variant="light" leftSection={<IconRefresh size={17} />} disabled={busy || disconnected} onClick={() => void run("readAddress", {})}>Read address</Button>
                  <Button color="orange" leftSection={<IconDeviceFloppy size={17} />} disabled={busy || disconnected} onClick={() => void run("writeAddress", { address: numberValue(locoAddress) }, `Write locomotive address ${numberValue(locoAddress)}?`)}>Write address</Button>
                </SimpleGrid>
              </Stack>
            </Card>

            <Card withBorder radius={5} p="lg">
              <Stack gap="md">
                <Group justify="space-between" align="end">
                  <div><Title order={4}>Configuration variable</Title><Text size="sm" c="dimmed">Read or write one CV at a time</Text></div>
                  <Switch label="POM / main track" checked={pom} onChange={event => setPom(event.currentTarget.checked)} />
                </Group>
                {pom && <Alert color="blue" icon={<IconHelpCircle size={18} />}>POM can write but normally cannot confirm the result. Never change a locomotive address with POM.</Alert>}
                <SimpleGrid cols={{ base: 1, sm: pom ? 3 : 2 }}>
                  {pom && <NumberInput label="Locomotive address" value={locoAddress} onChange={setLocoAddress} min={1} max={10239} allowDecimal={false} />}
                  <NumberInput label="CV" value={cv} onChange={setCv} min={1} max={1024} allowDecimal={false} />
                  <NumberInput label="Value" value={cvValue} onChange={setCvValue} min={0} max={255} allowDecimal={false} />
                </SimpleGrid>
                <BitEditor value={Number.isFinite(locoValue) ? locoValue : 0} onChange={setCvValue} />
                <SimpleGrid cols={{ base: 1, sm: pom ? 1 : 2 }}>
                  {!pom && <Button variant="light" leftSection={<IconRefresh size={17} />} disabled={busy || disconnected} onClick={() => void run("readCv", { cv: locoCv }, undefined, "locomotive")}>Read CV</Button>}
                  <Button color="orange" leftSection={<IconDeviceFloppy size={17} />} disabled={busy || disconnected} onClick={() => void run(pom ? "pomWriteCv" : "writeCv", { address: numberValue(locoAddress), cv: locoCv, value: locoValue }, `Write CV ${locoCv} = ${locoValue}${pom ? ` to locomotive ${numberValue(locoAddress)} on the main track` : " on the programming track"}?`)}>Write CV</Button>
                </SimpleGrid>
              </Stack>
            </Card>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="accessory" pt="md">
          <Stack gap="md">
            <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Two different programming methods">
              CV programming uses the isolated PROG output. Address learning uses the MAIN track: press the decoder's learn/program button first, then send one accessory direction below.
            </Alert>
            <Card withBorder radius={5} p="lg">
              <Stack gap="md">
                <Title order={4}>Accessory decoder CV</Title>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <NumberInput label="CV" value={accessoryCv} onChange={setAccessoryCv} min={1} max={1024} allowDecimal={false} />
                  <NumberInput label="Value" value={accessoryCvValue} onChange={setAccessoryCvValue} min={0} max={255} allowDecimal={false} />
                </SimpleGrid>
                <BitEditor value={Number.isFinite(accValue) ? accValue : 0} onChange={setAccessoryCvValue} />
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Button variant="light" disabled={busy || disconnected} onClick={() => void run("readCv", { cv: accCv }, undefined, "accessory")}>Read CV</Button>
                  <Button color="orange" disabled={busy || disconnected} onClick={() => void run("writeCv", { cv: accCv, value: accValue }, `Write accessory decoder CV ${accCv} = ${accValue} on the PROG output?`)}>Write CV</Button>
                </SimpleGrid>
              </Stack>
            </Card>
            <Card withBorder radius={5} p="lg">
              <Stack gap="md">
                <Title order={4}>Address learning</Title>
                <NumberInput label="Linear accessory address" description="DCC-EX range: 1-2044" value={accessoryAddress} onChange={setAccessoryAddress} min={1} max={2044} allowDecimal={false} />
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Button variant="light" disabled={busy || disconnected} onClick={() => void run("accessoryLearn", { address: numberValue(accessoryAddress), active: false })}>Send direction 0</Button>
                  <Button variant="light" disabled={busy || disconnected} onClick={() => void run("accessoryLearn", { address: numberValue(accessoryAddress), active: true })}>Send direction 1</Button>
                </SimpleGrid>
              </Stack>
            </Card>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="digitools" pt="md">
          <Stack gap="md">
            <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Put the device into programming mode first">
              These buttons send a normal accessory direction to the MAIN track; they do not write CVs. For address setup press PRG briefly. For DigiSwitch timing hold PRG for more than three seconds.
            </Alert>
            <Card withBorder radius={5} p="lg">
              <Stack gap="md">
                <div><Title order={4}>DigiSwitch-8</Title><Text size="sm" c="dimmed">One address sets the first output; the next three addresses follow automatically.</Text></div>
                <NumberInput label="Address or timing value" value={digiSwitchAddress} onChange={setDigiSwitchAddress} min={1} max={2044} allowDecimal={false} />
                <Divider label="Short PRG press · address" labelPosition="center" />
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Button disabled={busy || disconnected} onClick={() => void run("accessoryLearn", { address: numberValue(digiSwitchAddress), active: true })}>Set K1–K4 address</Button>
                  <Button disabled={busy || disconnected} onClick={() => void run("accessoryLearn", { address: numberValue(digiSwitchAddress), active: false })}>Set K5–K8 address</Button>
                </SimpleGrid>
                <Divider label="PRG held 3+ sec · timing" labelPosition="center" />
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Button variant="light" disabled={busy || disconnected} onClick={() => void run("accessoryLearn", { address: numberValue(digiSwitchAddress), active: true })}>Set K1–K4 timing</Button>
                  <Button variant="light" disabled={busy || disconnected} onClick={() => void run("accessoryLearn", { address: numberValue(digiSwitchAddress), active: false })}>Set K5–K8 timing</Button>
                </SimpleGrid>
              </Stack>
            </Card>
            <Card withBorder radius={5} p="lg">
              <Stack gap="md">
                <div><Title order={4}>DigiSignal-X4YYY</Title><Text size="sm" c="dimmed">Each signal group learns its starting address from one accessory command.</Text></div>
                <NumberInput label="Starting address" value={digiSignalAddress} onChange={setDigiSignalAddress} min={1} max={2044} allowDecimal={false} />
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Button disabled={busy || disconnected} onClick={() => void run("accessoryLearn", { address: numberValue(digiSignalAddress), active: true })}>Set A–B address</Button>
                  <Button disabled={busy || disconnected} onClick={() => void run("accessoryLearn", { address: numberValue(digiSignalAddress), active: false })}>Set C–D address</Button>
                </SimpleGrid>
              </Stack>
            </Card>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
