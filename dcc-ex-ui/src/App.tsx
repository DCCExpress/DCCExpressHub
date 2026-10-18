import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppShell, Badge, Box, Button, Card, Container, Group, NumberInput, Paper, SegmentedControl, Slider, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { IconAlertTriangle, IconPlugConnected, IconPlayerStop, IconTrain, IconWifiOff } from '@tabler/icons-react';
import { functionCommand, parseFrames, throttleCommand } from './dccex';

type Connection = 'disconnected' | 'connecting' | 'connected';
const DEFAULT_URL = 'ws://192.168.1.100:8080/';
function saved(key: string, fallback: string) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
export function App() {
  const [url, setUrl] = useState(() => saved('dcc-ex-ui.wsUrl', DEFAULT_URL));
  const [address, setAddress] = useState<number | string>(() => Number(saved('dcc-ex-ui.loco', '18')));
  const [status, setStatus] = useState<Connection>('disconnected');
  const [speed, setSpeed] = useState(0);
  const [forward, setForward] = useState(true);
  const [light, setLight] = useState(false);
  const [power, setPower] = useState<boolean | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const active = useRef({ address: 18, speed: 0, forward: true });
  const append = useCallback((line: string) => setLog(lines => [line, ...lines].slice(0, 30)), []);
  const send = useCallback((command: string): boolean => {
    if (socket.current?.readyState !== WebSocket.OPEN) { setError('Not connected to a WebSocket endpoint.'); return false; }
    socket.current.send(command); append('TX ' + command); return true;
  }, [append]);
  const stop = useCallback(() => {
    const { address: a, forward: d } = active.current;
    try { if (send(throttleCommand({ address: a, speed: 0, forward: d }))) { active.current.speed = 0; setSpeed(0); } } catch (e) { setError(String(e)); }
  }, [send]);
  const disconnect = useCallback(() => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      const { address: a, forward: d } = active.current;
      socket.current.send(throttleCommand({ address: a, speed: 0, forward: d }));
    }
    socket.current?.close(); socket.current = null; setStatus('disconnected'); setSpeed(0);
  }, []);
  useEffect(() => () => { socket.current?.close(); }, []);
  const connect = () => {
    setError('');
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') throw new Error('URL must start with ws:// or wss://');
      const ws = new WebSocket(parsed.href);
      socket.current = ws; setStatus('connecting');
      ws.onopen = () => { if (socket.current !== ws) return; setStatus('connected'); append('Connected: ' + parsed.href); ws.send('<s>'); };
      ws.onmessage = event => {
        if (socket.current !== ws) return;
        if (typeof event.data !== 'string') return;
        const frames = parseFrames(event.data);
        for (const frame of frames.length ? frames : [event.data]) {
          append('RX ' + frame);
          if (/^<p1(?:\\s|>)/.test(frame)) setPower(true);
          if (/^<p0(?:\\s|>)/.test(frame)) setPower(false);
        }
      };
      ws.onerror = () => { if (socket.current === ws) setError('WebSocket connection failed. Verify that the station or bridge supports WebSocket, not just TCP.'); };
      ws.onclose = () => { if (socket.current === ws) { socket.current = null; setStatus('disconnected'); setSpeed(0); append('Disconnected'); } };
      try { localStorage.setItem('dcc-ex-ui.wsUrl', url); } catch { /* storage optional */ }
    } catch (e) { setStatus('disconnected'); setError(String(e)); }
  };
  const drive = (nextSpeed: number, nextForward = forward) => {
    const a = Number(address);
    if (!Number.isInteger(a) || a < 1 || a > 10239) { setError('Select a valid DCC address (1–10239).'); return; }
    try {
      // Stop the old locomotive when changing addresses before sending to the new locomotive.
      if (active.current.address !== a && active.current.speed > 0) {
        if (!send(throttleCommand({ address: active.current.address, speed: 0, forward: active.current.forward }))) return;
      }
      if (send(throttleCommand({ address: a, speed: nextSpeed, forward: nextForward }))) {
        active.current = { address: a, speed: nextSpeed, forward: nextForward };
        setSpeed(nextSpeed); setForward(nextForward);
        try { localStorage.setItem('dcc-ex-ui.loco', String(a)); } catch { /* optional */ }
      }
    } catch (e) { setError(String(e)); }
  };
  const ready = status === 'connected';
  return (
    <AppShell header={{ height: 68 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="lg" justify="space-between">
          <Group>
            <IconTrain size={28} />
            <Title order={3}>DCCExpressHub <Text span c="dimmed" size="sm">Browser alpha7</Text></Title>
          </Group>
          <Badge color={ready ? 'green' : status === 'connecting' ? 'yellow' : 'gray'}>{status}</Badge>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="sm">
          <Stack gap="lg">
            <Card withBorder radius="md">
              <Stack>
                <Title order={4}>DCC-EX WebSocket connection</Title>
                <TextInput
                  label="WebSocket URL"
                  description="Requires a real WebSocket endpoint forwarding raw DCC-EX commands. TCP port 2560 is not WebSocket."
                  value={url}
                  onChange={(event) => setUrl(event.currentTarget.value)}
                  disabled={status !== 'disconnected'}
                  placeholder="ws://station:port/path"
                />
                <Group>
                  <Button leftSection={<IconPlugConnected size={18} />} disabled={status !== 'disconnected'} onClick={connect}>Connect</Button>
                  <Button color="gray" variant="outline" leftSection={<IconWifiOff size={18} />} disabled={status === 'disconnected'} onClick={disconnect}>Disconnect</Button>
                </Group>
              </Stack>
            </Card>
            <Card withBorder radius="md">
              <Stack gap="md">
                <Group justify="space-between"><Title order={4}>Locomotive throttle</Title><Badge variant="light">DCC-EX</Badge></Group>
                <NumberInput label="DCC locomotive address" value={address} onChange={setAddress} min={1} max={10239} clampBehavior="strict" disabled={speed > 0} />
                <Text size="xs" c="dimmed">Choose an address at speed zero, then move the throttle.</Text>
                <Group justify="space-between"><Text>Speed</Text><Title order={2}>{speed} / 126</Title></Group>
                <Box px="xs">
                  <Slider
                    min={0}
                    max={126}
                    value={speed}
                    onChange={setSpeed}
                    onChangeEnd={(value) => drive(value)}
                    disabled={!ready}
                    marks={[{ value: 0, label: '0' }, { value: 63, label: '63' }, { value: 126, label: '126' }]}
                    mb="lg"
                  />
                </Box>
                <SegmentedControl
                  fullWidth
                  value={forward ? 'forward' : 'reverse'}
                  onChange={(value) => {
                    if (speed !== 0) { setError('Stop before changing direction.'); return; }
                    drive(0, value === 'forward');
                  }}
                  disabled={!ready}
                  data={[{ label: 'Forward', value: 'forward' }, { label: 'Reverse', value: 'reverse' }]}
                />
                <Button color="red" size="lg" leftSection={<IconPlayerStop />} disabled={!ready} onClick={stop}>STOP locomotive</Button>
                <Switch
                  label="F0 – Headlight"
                  checked={light}
                  disabled={!ready}
                  onChange={(event) => {
                    const enabled = event.currentTarget.checked;
                    try {
                      if (send(functionCommand(Number(address), 0, enabled))) setLight(enabled);
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                />
                <Group>
                  <Button variant="light" disabled={!ready} onClick={() => send('<1>')}>Track power ON</Button>
                  <Button variant="light" color="orange" disabled={!ready} onClick={() => send('<0>')}>Track power OFF</Button>
                  <Badge color={power === null ? 'gray' : power ? 'green' : 'red'}>Power: {power === null ? 'unknown' : power ? 'on' : 'off'}</Badge>
                </Group>
              </Stack>
            </Card>
            {error && (
              <Alert icon={<IconAlertTriangle size={18} />} color="red" title="Connection / command error" withCloseButton onClose={() => setError('')}>
                {error}
              </Alert>
            )}
            <Paper withBorder p="md" radius="md">
              <Group justify="space-between">
                <Title order={5}>Protocol log</Title>
                <Button variant="subtle" size="xs" onClick={() => setLog([])}>Clear</Button>
              </Group>
              <Box mah={220} style={{ overflowY: 'auto' }}>
                <Stack gap={3} mt="sm">
                  {log.map((line, index) => <Text key={index} size="xs" ff="monospace">{line}</Text>)}
                </Stack>
              </Box>
            </Paper>
            <Text c="dimmed" size="xs">
              Keep this tab active. Network loss or browser closure cannot guarantee a stop command reaches the station. Use physical emergency stop for safety.
            </Text>
          </Stack>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
