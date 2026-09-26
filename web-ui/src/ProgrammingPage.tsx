import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Loader,
  Modal,
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
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getCommandCenterInfo,
  type CommandCenterInfo,
} from "@/api/commandCenterInfo";
import { getLocos } from "@/api/domainApi";
import { CvHelpPanel } from "@/components/programming/CvHelpPanel";
import LocoPanel from "@/layout/LocoPanel";
import { wsApi } from "@/services/wsApi";
import { wsClient } from "@/services/wsClient";
import type { WsConnectionStatus } from "@/services/wsClient";
import type {
  Loco,
  ProgrammingCommandAction,
  ProgrammingResponsePayload,
  WsPowerInfoPayload,
} from "@domain/types";

type Props = {
  onBack: () => void;
  status: WsConnectionStatus;
  controlStationActive: boolean;
  controlStationOwnerName: string | null;
};

type NumberValue = string | number;

type ProgrammingPowerInfo = WsPowerInfoPayload & {
  programmingJoined?: boolean;
};

function numberValue(value: NumberValue): number {
  return typeof value === "number"
    ? value
    : Number.parseInt(value, 10);
}

function BitEditor({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Group
      gap="xs"
      wrap="wrap"
      align="stretch"
    >
      {Array.from({ length: 8 }, (_, index) => 7 - index).map(bit => (
        <Card
          key={bit}
          withBorder
          radius="sm"
          p="xs"
          style={{
            minWidth: 68,
          }}
        >
          <Checkbox
            label={`b${bit}`}
            checked={(value & (1 << bit)) !== 0}
            onChange={event =>
              onChange(
                event.currentTarget.checked
                  ? value | (1 << bit)
                  : value & ~(1 << bit),
              )
            }
          />
        </Card>
      ))}
    </Group>
  );
}

function CvValueFormats({ value }: { value: number }) {
  const normalized = Number.isFinite(value)
    ? Math.max(0, Math.min(255, Math.trunc(value)))
    : 0;

  const hex = `0x${normalized
    .toString(16)
    .toUpperCase()
    .padStart(2, "0")}`;

  const binary = normalized
    .toString(2)
    .padStart(8, "0");

  return (
    <Group gap="xs" wrap="wrap">
      <Badge variant="outline">DEC {normalized}</Badge>
      <Badge variant="outline">HEX {hex}</Badge>
      <Badge variant="outline" ff="monospace">
        BIN {binary}
      </Badge>
    </Group>
  );
}

function ProgrammingResult({
  result,
}: {
  result: ProgrammingResponsePayload | null;
}) {
  useTranslation();
  if (!result) {
    return null;
  }

  return (
    <Alert
      color={result.ok ? "teal" : "red"}
      icon={
        result.ok
          ? <IconCheck size={18} />
          : <IconAlertTriangle size={18} />
      }
    >
      <Text size="sm" fw={600}>
        {result.message ?? (result.ok ? i18next.t("ui.commandCompleted") : i18next.t("ui.commandFailed"))}
      </Text>

      {typeof result.value === "number" && result.value >= 0 && (
        <Text size="sm"> {i18next.t("ui.returnedValue")} <strong>{result.value}</strong>
        </Text>
      )}

      {result.raw && (
        <Text size="xs" c="dimmed" ff="monospace" mt={4}>
          {result.raw}
        </Text>
      )}
    </Alert>
  );
}

function ProgrammingUnsupported({
  info,
  onBack,
}: {
  info: CommandCenterInfo;
  onBack: () => void;
}) {
  useTranslation();
  return (
    <Stack gap="lg">
      <Button
        variant="subtle"
        color="gray"
        leftSection={<IconArrowLeft size={18} />}
        onClick={onBack}
        style={{ alignSelf: "flex-start" }}
      > {i18next.t("ui.backToHome")} </Button>

      <Group gap="sm" wrap="nowrap">
        <ThemeIcon size={42} radius="md" variant="light" color="orange">
          <IconTool size={24} />
        </ThemeIcon>

        <div>
          <Title order={3}>{i18next.t("ui.decoderProgramming")}</Title>
          <Text size="sm" c="dimmed">{info.name}</Text>
        </div>
      </Group>

      <Alert
        color="blue"
        icon={<IconAlertTriangle size={18} />}
        title={i18next.t("ui.programmingIsNotAvailableInTheFirmware", { value1: info.name })}
      > {i18next.t("ui.theCurrentDccexpresshubProgrammingScreenUsesDccExServiceMode")} </Alert>
    </Stack>
  );
}

function DccExProgrammingPage({
  onBack,
  status,
  controlStationActive,
  controlStationOwnerName,
}: Props) {
  useTranslation();
  const [busy, setBusy] = useState(false);
  const [result, setResult] =
    useState<ProgrammingResponsePayload | null>(null);
  const [powerInfo, setPowerInfo] =
    useState<ProgrammingPowerInfo | null>(null);

  const [locoAddress, setLocoAddress] = useState<NumberValue>(3);
  const [cv, setCv] = useState<NumberValue>(1);
  const [cvValue, setCvValue] = useState<NumberValue>(0);
  const [pom, setPom] = useState(false);

  const [quickTestAddress, setQuickTestAddress] = useState<NumberValue>(3);
  const [quickControlOpened, setQuickControlOpened] = useState(false);
  const [quickControlLoco, setQuickControlLoco] = useState<Loco | null>(null);
  const [quickControlLoading, setQuickControlLoading] = useState(false);
  const [quickControlError, setQuickControlError] = useState("");

  const [accessoryCv, setAccessoryCv] = useState<NumberValue>(1);
  const [accessoryCvValue, setAccessoryCvValue] = useState<NumberValue>(0);
  const [accessoryAddress, setAccessoryAddress] = useState<NumberValue>(1);

  const [digiSwitchAddress, setDigiSwitchAddress] = useState<NumberValue>(1);
  const [digiSignalAddress, setDigiSignalAddress] = useState<NumberValue>(1);

  const controlStationActiveRef =
    useRef(
      controlStationActive
    );

  controlStationActiveRef.current =
    controlStationActive;

  useEffect(() => {
    const unsubscribe = wsClient.on("powerInfo", payload => {
      setPowerInfo(payload as ProgrammingPowerInfo);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (
      controlStationActive
    ) {
      setQuickControlOpened(
        false
      );
    }
  }, [controlStationActive]);

  const run = async (
    action: ProgrammingCommandAction,
    values: {
      address?: number;
      cv?: number;
      value?: number;
      active?: boolean;
    },
    confirmText?: string,
    valueTarget?: "locomotive" | "accessory",
  ) => {
    if (
      controlStationActiveRef.current
    ) {
      return;
    }

    if (confirmText && !window.confirm(confirmText)) {
      return;
    }

    const restoreJoinAfterProgramming =
      (powerInfo?.programmingJoined ?? false) &&
      (
        action === "readAddress" ||
        action === "writeAddress" ||
        action === "readCv" ||
        action === "writeCv"
      );

    setBusy(true);
    setResult(null);

    try {
      const requestId =
        `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const response = await wsApi.programmingRequest(
        requestId,
        action,
        values,
      );

      setResult(response);

      if (
        response.ok &&
        typeof response.value === "number" &&
        response.value >= 0
      ) {
        if (action === "readAddress") {
          setLocoAddress(response.value);
          setQuickTestAddress(response.value);
        }

        if (action === "readCv" && valueTarget === "locomotive") {
          setCvValue(response.value);
        }

        if (action === "readCv" && valueTarget === "accessory") {
          setAccessoryCvValue(response.value);
        }
      }
    } catch (error) {
      setResult({
        requestId: "local",
        action,
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Programming request failed.",
      });
    } finally {
      if (
        restoreJoinAfterProgramming &&
        !controlStationActiveRef.current
      ) {
        const joinedAgain =
          wsApi.writeDccExDirectCommand("<1 JOIN>");

        if (joinedAgain) {
          setPowerInfo(current =>
            current
              ? {
                  ...current,
                  programmingJoined: true,
                  programmingModeActive: true,
                  trackVoltageOn: true,
                }
              : current,
          );
        }
      }

      setBusy(false);
    }
  };

  const sendTrackPower = (
    target: "MAIN" | "PROG",
    on: boolean,
  ): void => {
    if (
      controlStationActiveRef.current
    ) {
      return;
    }

    const command = `<${on ? 1 : 0} ${target}>`;
    const sent = wsApi.writeDccExDirectCommand(command);

    if (!sent) {
      setResult({
        requestId: "local",
        action: "readAddress",
        ok: false,
        message: `${target} power command could not be sent.`,
      });

      return;
    }

    setPowerInfo(current => {
      if (!current) {
        return current;
      }

      if (target === "MAIN") {
        return {
          ...current,
          trackVoltageOn: on,
          trackVoltageOff: !on,
        };
      }

      return {
        ...current,
        programmingModeActive: on,
        ...(on
          ? {}
          : {
              programmingJoined: false,
            }),
      };
    });

  };

  const sendJoin = (joined: boolean): void => {
    if (
      controlStationActiveRef.current
    ) {
      return;
    }

    const command = joined
      ? "<1 JOIN>"
      : "<1 PROG>";

    const sent = wsApi.writeDccExDirectCommand(command);

    if (!sent) {
      setResult({
        requestId: "local",
        action: "readAddress",
        ok: false,
        message: "DCC-EX command could not be sent.",
      });

      return;
    }

    setPowerInfo(current =>
      current
        ? {
            ...current,
            programmingJoined: joined,
            programmingModeActive: true,
            ...(joined ? { trackVoltageOn: true } : {}),
          }
        : current,
    );

  };

  const openQuickControl = async (): Promise<void> => {
    if (
      controlStationActiveRef.current
    ) {
      return;
    }

    const address = numberValue(quickTestAddress);

    if (
      !Number.isFinite(address) ||
      address < 1 ||
      address > 10239
    ) {
      setQuickControlError("Invalid locomotive address.");
      return;
    }

    setQuickControlLoading(true);
    setQuickControlError("");

    try {
      const locos = await getLocos();
      const knownLoco =
        locos.find(loco => loco.address === address);

      const loco: Loco =
        knownLoco ?? {
          id: `quick-control-${address}`,
          name: `Unknown locomotive #${address}`,
          address,
          maxSpeed: 126,
          invert: false,
          length: 0,
          functions: [],
        };

      setQuickControlLoco(loco);
      setQuickControlOpened(true);
    } catch (error) {
      setQuickControlError(
        error instanceof Error
          ? error.message
          : "Could not load locomotive data.",
      );
    } finally {
      setQuickControlLoading(false);
    }
  };

  const disconnected = status !== "connected";
  const mainOn = powerInfo?.trackVoltageOn ?? false;
  const progOn = powerInfo?.programmingModeActive ?? false;
  const joined = powerInfo?.programmingJoined ?? false;
  const locoCv = numberValue(cv);
  const locoValue = numberValue(cvValue);
  const accCv = numberValue(accessoryCv);
  const accValue = numberValue(accessoryCvValue);

  const safeLocoValue = Number.isFinite(locoValue) ? locoValue : 0;
  const safeAccValue = Number.isFinite(accValue) ? accValue : 0;

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Button
          variant="subtle"
          color="gray"
          leftSection={<IconArrowLeft size={18} />}
          onClick={onBack}
        > {i18next.t("ui.backToHome")} </Button>

        <Badge
          color={disconnected ? "red" : "teal"}
          variant={disconnected ? "filled" : "light"}
        >
          {disconnected ? i18next.t("ui.offline2") : i18next.t("ui.connected2")}
        </Badge>
      </Group>

      <Group gap="sm" wrap="nowrap">
        <ThemeIcon size={42} radius="md" variant="light" color="orange">
          <IconTool size={24} />
        </ThemeIcon>

        <div>
          <Title order={3}>{i18next.t("ui.decoderProgramming")}</Title>
          <Text size="sm" c="dimmed"> {i18next.t("ui.locomotiveAccessoryAndDigitoolsSetup")} </Text>
        </div>
      </Group>

      {controlStationActive && (
        <Alert
          color="orange"
          icon={<IconAlertTriangle size={18} />}
          title="Programming is locked while Control Station is active"
        >
          {controlStationOwnerName
            ? `Automation is currently running on ${controlStationOwnerName}. Turn off Control Station before using decoder programming.`
            : "Automation is currently active. Turn off Control Station before using decoder programming."}
        </Alert>
      )}

      <fieldset
        disabled={
          controlStationActive
        }
        style={{
          border: 0,
          padding: 0,
          margin: 0,
          minWidth: 0,
          opacity:
            controlStationActive
              ? 0.55
              : 1,
        }}
      >
      <Card withBorder radius={5} p="lg">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <div>
              <Title order={4}>Programming track power</Title>
              <Text size="sm" c="dimmed">
                Live DCC-EX MAIN / PROG / JOIN state
              </Text>
            </div>

            <Badge
              size="lg"
              color={joined ? "blue" : "gray"}
              variant={joined ? "filled" : "light"}
            >
              {joined ? "JOINED / TEST" : "SERVICE MODE"}
            </Badge>
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Card withBorder radius="sm" p="sm">
              <Text size="xs" c="dimmed" fw={700}>MAIN</Text>
              <Badge
                mt={6}
                color={disconnected ? "gray" : mainOn ? "teal" : "red"}
                variant="filled"
              >
                {disconnected ? "UNKNOWN" : mainOn ? "ON" : "OFF"}
              </Badge>
            </Card>

            <Card withBorder radius="sm" p="sm">
              <Text size="xs" c="dimmed" fw={700}>PROG</Text>
              <Badge
                mt={6}
                color={disconnected ? "gray" : progOn ? "teal" : "red"}
                variant="filled"
              >
                {disconnected ? "UNKNOWN" : progOn ? "ON" : "OFF"}
              </Badge>
            </Card>

            <Card withBorder radius="sm" p="sm">
              <Text size="xs" c="dimmed" fw={700}>JOIN</Text>
              <Badge
                mt={6}
                color={disconnected ? "gray" : joined ? "lime" : "gray"}
                variant={joined ? "filled" : "light"}
              >
                {disconnected ? "UNKNOWN" : joined ? "ON" : "OFF"}
              </Badge>
            </Card>
          </SimpleGrid>

          <Divider label="Track power" labelPosition="center" />

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Card withBorder radius="sm" p="sm">
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text fw={700} size="sm">MAIN POWER</Text>
                  <Badge
                    color={mainOn ? "teal" : "red"}
                    variant="light"
                  >
                    {mainOn ? "ON" : "OFF"}
                  </Badge>
                </Group>

                <SimpleGrid cols={2}>
                  <Button
                    color={mainOn ? "lime" : "dark"}
                    variant="filled"
                    disabled={busy || disconnected}
                    onClick={() => sendTrackPower("MAIN", true)}
                  >
                    ON
                  </Button>

                  <Button
                    color={!mainOn ? "red" : "dark"}
                    variant="filled"
                    disabled={busy || disconnected}
                    onClick={() => sendTrackPower("MAIN", false)}
                  >
                    OFF
                  </Button>
                </SimpleGrid>
              </Stack>
            </Card>

            <Card withBorder radius="sm" p="sm">
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text fw={700} size="sm">PROG POWER</Text>
                  <Badge
                    color={progOn ? "teal" : "red"}
                    variant="light"
                  >
                    {progOn ? "ON" : "OFF"}
                  </Badge>
                </Group>

                <SimpleGrid cols={2}>
                  <Button
                    color={progOn ? "lime" : "dark"}
                    variant="filled"
                    disabled={busy || disconnected}
                    onClick={() => sendTrackPower("PROG", true)}
                  >
                    ON
                  </Button>

                  <Button
                    color={!progOn ? "red" : "dark"}
                    variant="filled"
                    disabled={busy || disconnected}
                    onClick={() => sendTrackPower("PROG", false)}
                  >
                    OFF
                  </Button>
                </SimpleGrid>
              </Stack>
            </Card>
          </SimpleGrid>

          <Divider label="Programming mode" labelPosition="center" />

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Button
              color={joined ? "lime" : "dark"}
              variant="filled"
              disabled={busy || disconnected}
              onClick={() => sendJoin(true)}
            >
              JOIN / TEST TRACK
            </Button>

            <Button
              color={!joined ? "blue" : "dark"}
              variant="filled"
              disabled={busy || disconnected}
              onClick={() => sendJoin(false)}
            >
              RETURN TO PROG
            </Button>
          </SimpleGrid>

          <Text size="xs" c="dimmed">
            JOIN sends MAIN DCC to the isolated programming output so speed, lights and sound functions can be tested. RETURN TO PROG sends &lt;1 PROG&gt; and restores normal service-mode programming.
          </Text>

          <Divider label="Quick control" labelPosition="center" />

          <Card withBorder radius="sm" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <div>
                  <Text fw={700}>Locomotive quick control</Text>
                  <Text size="xs" c="dimmed">
                    Opens the full locomotive controller for the address below.
                  </Text>
                </div>

                <Badge
                  color={joined ? "lime" : "gray"}
                  variant={joined ? "filled" : "light"}
                >
                  {joined ? "READY" : "JOIN REQUIRED"}
                </Badge>
              </Group>

              <Group align="end" grow>
                <NumberInput
                  label="Locomotive"
                  description="address"
                  value={quickTestAddress}
                  onChange={setQuickTestAddress}
                  min={1}
                  max={10239}
                  allowDecimal={false}
                  disabled={busy || disconnected}
                />

                <Button
                  color="blue"
                  variant="filled"
                  loading={quickControlLoading}
                  disabled={busy || disconnected || !joined}
                  onClick={() => void openQuickControl()}
                >
                  OPEN QUICK CONTROL
                </Button>
              </Group>

              {quickControlError && (
                <Alert color="red" py="xs">
                  {quickControlError}
                </Alert>
              )}
            </Stack>
          </Card>
        </Stack>
      </Card>

      <Modal
        opened={quickControlOpened}
        onClose={() => setQuickControlOpened(false)}
        title={
          quickControlLoco
            ? `Quick control · #${quickControlLoco.address} ${quickControlLoco.name}`
            : "Quick control"
        }
        size="xl"
        centered
        keepMounted={false}
      >
        {quickControlLoco && (
          <Box h={620}>
            <LocoPanel
              locos={[quickControlLoco]}
              selectedLocoStorageKey={`dcc-express.programming.quick-control.${quickControlLoco.address}`}
            />
          </Box>
        )}
      </Modal>

      {disconnected && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}> {i18next.t("ui.connectToTheDccExCommandCenterBeforeSendingProgramming")} </Alert>
      )}

      <ProgrammingResult result={result} />

      <Tabs defaultValue="locomotive" keepMounted={false}>
        <Tabs.List grow>
          <Tabs.Tab value="locomotive" leftSection={<IconTrain size={16} />}> {i18next.t("ui.locomotive")} </Tabs.Tab>
          <Tabs.Tab value="accessory" leftSection={<IconDeviceFloppy size={16} />}> {i18next.t("ui.accessory")} </Tabs.Tab>
          <Tabs.Tab value="digitools" leftSection={<IconTool size={16} />}>
            DigiTools
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="locomotive" pt="md">
          <Stack gap="md">
            <Alert
              color="yellow"
              icon={<IconAlertTriangle size={18} />}
              title={i18next.t("ui.programmingTrackSafety")}
            > {i18next.t("ui.serviceModeOperationsAutomaticallyPowerTheIsolatedProgOutputFor")} </Alert>

            <Card withBorder radius={5} p="lg">
              <Stack gap="md">
                <Title order={4}>{i18next.t("ui.locomotiveAddress")}</Title>

                <NumberInput
                  label={i18next.t("ui.address")}
                  value={locoAddress}
                  onChange={setLocoAddress}
                  min={1}
                  max={10239}
                  allowDecimal={false}
                />

                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Button
                    variant="light"
                    leftSection={<IconRefresh size={17} />}
                    disabled={busy || disconnected}
                    onClick={() => void run("readAddress", {})}
                  > {i18next.t("ui.readAddress")} </Button>

                  <Button
                    color="orange"
                    leftSection={<IconDeviceFloppy size={17} />}
                    disabled={busy || disconnected}
                    onClick={() =>
                      void run(
                        "writeAddress",
                        { address: numberValue(locoAddress) },
                        `Write locomotive address ${numberValue(locoAddress)}?`,
                      )
                    }
                  > {i18next.t("ui.writeAddress")} </Button>
                </SimpleGrid>
              </Stack>
            </Card>

            <Card withBorder radius={5} p="lg">
              <Stack gap="md">
                <Group justify="space-between" align="end">
                  <div>
                    <Title order={4}>{i18next.t("ui.configurationVariable")}</Title>
                    <Text size="sm" c="dimmed"> {i18next.t("ui.readOrWriteOneCvAtATime")} </Text>
                  </div>

                  <Switch
                    label={i18next.t("ui.pomMainTrack")}
                    checked={pom}
                    onChange={event => setPom(event.currentTarget.checked)}
                  />
                </Group>

                {pom && (
                  <Alert color="blue" icon={<IconHelpCircle size={18} />}> {i18next.t("ui.pomCanWriteButNormallyCannotConfirmTheResultNever")} </Alert>
                )}

                <SimpleGrid cols={{ base: 1, sm: pom ? 3 : 2 }}>
                  {pom && (
                    <NumberInput
                      label={i18next.t("ui.locomotiveAddress")}
                      value={locoAddress}
                      onChange={setLocoAddress}
                      min={1}
                      max={10239}
                      allowDecimal={false}
                    />
                  )}

                  <NumberInput
                    label="CV"
                    value={cv}
                    onChange={setCv}
                    min={1}
                    max={1024}
                    allowDecimal={false}
                  />

                  <NumberInput
                    label={i18next.t("ui.value")}
                    value={cvValue}
                    onChange={setCvValue}
                    min={0}
                    max={255}
                    allowDecimal={false}
                  />
                </SimpleGrid>

                <BitEditor
                  value={safeLocoValue}
                  onChange={setCvValue}
                />

                <CvValueFormats value={safeLocoValue} />

                <CvHelpPanel
                  cv={locoCv}
                  value={safeLocoValue}
                  onChange={setCvValue}
                />

                <SimpleGrid cols={{ base: 1, sm: pom ? 1 : 2 }}>
                  {!pom && (
                    <Button
                      variant="light"
                      leftSection={<IconRefresh size={17} />}
                      disabled={busy || disconnected}
                      onClick={() =>
                        void run(
                          "readCv",
                          { cv: locoCv },
                          undefined,
                          "locomotive",
                        )
                      }
                    > {i18next.t("ui.readCv")} </Button>
                  )}

                  <Button
                    color="orange"
                    leftSection={<IconDeviceFloppy size={17} />}
                    disabled={busy || disconnected}
                    onClick={() =>
                      void run(
                        pom ? "pomWriteCv" : "writeCv",
                        {
                          address: numberValue(locoAddress),
                          cv: locoCv,
                          value: locoValue,
                        },
                        `Write CV ${locoCv} = ${locoValue}${
                          pom
                            ? ` to locomotive ${numberValue(locoAddress)} on the main track`
                            : " on the programming track"
                        }?`,
                      )
                    }
                  > {i18next.t("ui.writeCv")} </Button>
                </SimpleGrid>
              </Stack>
            </Card>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="accessory" pt="md">
          <Stack gap="md">
            <Alert
              color="yellow"
              icon={<IconAlertTriangle size={18} />}
              title={i18next.t("ui.twoDifferentProgrammingMethods")}
            > {i18next.t("ui.cvProgrammingUsesTheIsolatedProgOutputAddressLearningUses")} </Alert>

            <Card withBorder radius={5} p="lg">
              <Stack gap="md">
                <Title order={4}>{i18next.t("ui.accessoryDecoderCv")}</Title>

                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <NumberInput
                    label="CV"
                    value={accessoryCv}
                    onChange={setAccessoryCv}
                    min={1}
                    max={1024}
                    allowDecimal={false}
                  />

                  <NumberInput
                    label={i18next.t("ui.value")}
                    value={accessoryCvValue}
                    onChange={setAccessoryCvValue}
                    min={0}
                    max={255}
                    allowDecimal={false}
                  />
                </SimpleGrid>

                <BitEditor
                  value={safeAccValue}
                  onChange={setAccessoryCvValue}
                />

                <CvValueFormats value={safeAccValue} />

                <CvHelpPanel
                  cv={accCv}
                  value={safeAccValue}
                  onChange={setAccessoryCvValue}
                />

                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Button
                    variant="light"
                    disabled={busy || disconnected}
                    onClick={() =>
                      void run(
                        "readCv",
                        { cv: accCv },
                        undefined,
                        "accessory",
                      )
                    }
                  > {i18next.t("ui.readCv")} </Button>

                  <Button
                    color="orange"
                    disabled={busy || disconnected}
                    onClick={() =>
                      void run(
                        "writeCv",
                        { cv: accCv, value: accValue },
                        `Write accessory decoder CV ${accCv} = ${accValue} on the PROG output?`,
                      )
                    }
                  > {i18next.t("ui.writeCv")} </Button>
                </SimpleGrid>
              </Stack>
            </Card>

            <Card withBorder radius={5} p="lg">
              <Stack gap="md">
                <Title order={4}>{i18next.t("ui.addressLearning")}</Title>

                <NumberInput
                  label={i18next.t("ui.linearAccessoryAddress")}
                  description={i18next.t("ui.dccExRange12044")}
                  value={accessoryAddress}
                  onChange={setAccessoryAddress}
                  min={1}
                  max={2044}
                  allowDecimal={false}
                />

                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Button
                    variant="light"
                    disabled={busy || disconnected}
                    onClick={() =>
                      void run(
                        "accessoryLearn",
                        {
                          address: numberValue(accessoryAddress),
                          active: false,
                        },
                      )
                    }
                  > {i18next.t("ui.sendDirection0")} </Button>

                  <Button
                    variant="light"
                    disabled={busy || disconnected}
                    onClick={() =>
                      void run(
                        "accessoryLearn",
                        {
                          address: numberValue(accessoryAddress),
                          active: true,
                        },
                      )
                    }
                  > {i18next.t("ui.sendDirection1")} </Button>
                </SimpleGrid>
              </Stack>
            </Card>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="digitools" pt="md">
          <Stack gap="md">
            <Alert
              color="yellow"
              icon={<IconAlertTriangle size={18} />}
              title={i18next.t("ui.putTheDeviceIntoProgrammingModeFirst")}
            > {i18next.t("ui.theseButtonsSendANormalAccessoryDirectionToTheMain")} </Alert>

            <Card withBorder radius={5} p="lg">
              <Stack gap="md">
                <div>
                  <Title order={4}>DigiSwitch-8</Title>
                  <Text size="sm" c="dimmed"> {i18next.t("ui.oneAddressSetsTheFirstOutputTheNextThreeAddresses")} </Text>
                </div>

                <NumberInput
                  label={i18next.t("ui.addressOrTimingValue")}
                  value={digiSwitchAddress}
                  onChange={setDigiSwitchAddress}
                  min={1}
                  max={2044}
                  allowDecimal={false}
                />

                <Divider label={i18next.t("ui.shortPrgPressAddress")} labelPosition="center" />

                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Button
                    disabled={busy || disconnected}
                    onClick={() =>
                      void run(
                        "accessoryLearn",
                        {
                          address: numberValue(digiSwitchAddress),
                          active: true,
                        },
                      )
                    }
                  > {i18next.t("ui.setK1K4Address")} </Button>

                  <Button
                    disabled={busy || disconnected}
                    onClick={() =>
                      void run(
                        "accessoryLearn",
                        {
                          address: numberValue(digiSwitchAddress),
                          active: false,
                        },
                      )
                    }
                  > {i18next.t("ui.setK5K8Address")} </Button>
                </SimpleGrid>

                <Divider label={i18next.t("ui.prgHeld3SecTiming")} labelPosition="center" />

                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Button
                    variant="light"
                    disabled={busy || disconnected}
                    onClick={() =>
                      void run(
                        "accessoryLearn",
                        {
                          address: numberValue(digiSwitchAddress),
                          active: true,
                        },
                      )
                    }
                  > {i18next.t("ui.setK1K4Timing")} </Button>

                  <Button
                    variant="light"
                    disabled={busy || disconnected}
                    onClick={() =>
                      void run(
                        "accessoryLearn",
                        {
                          address: numberValue(digiSwitchAddress),
                          active: false,
                        },
                      )
                    }
                  > {i18next.t("ui.setK5K8Timing")} </Button>
                </SimpleGrid>
              </Stack>
            </Card>

            <Card withBorder radius={5} p="lg">
              <Stack gap="md">
                <div>
                  <Title order={4}>DigiSignal-X4YYY</Title>
                  <Text size="sm" c="dimmed"> {i18next.t("ui.eachSignalGroupLearnsItsStartingAddressFromOneAccessory")} </Text>
                </div>

                <NumberInput
                  label={i18next.t("ui.startingAddress")}
                  value={digiSignalAddress}
                  onChange={setDigiSignalAddress}
                  min={1}
                  max={2044}
                  allowDecimal={false}
                />

                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Button
                    disabled={busy || disconnected}
                    onClick={() =>
                      void run(
                        "accessoryLearn",
                        {
                          address: numberValue(digiSignalAddress),
                          active: true,
                        },
                      )
                    }
                  > {i18next.t("ui.setABAddress")} </Button>

                  <Button
                    disabled={busy || disconnected}
                    onClick={() =>
                      void run(
                        "accessoryLearn",
                        {
                          address: numberValue(digiSignalAddress),
                          active: false,
                        },
                      )
                    }
                  > {i18next.t("ui.setCDAddress")} </Button>
                </SimpleGrid>
              </Stack>
            </Card>
          </Stack>
        </Tabs.Panel>
      </Tabs>
      </fieldset>
    </Stack>
  );
}

export default function ProgrammingPage(props: Props) {
  useTranslation();
  const [info, setInfo] = useState<CommandCenterInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void getCommandCenterInfo()
      .then(value => {
        if (active) {
          setInfo(value);
        }
      })
      .catch(cause => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : String(cause),
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <Stack gap="lg">
        <Button
          variant="subtle"
          color="gray"
          leftSection={<IconArrowLeft size={18} />}
          onClick={props.onBack}
          style={{ alignSelf: "flex-start" }}
        > {i18next.t("ui.backToHome")} </Button>

        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      </Stack>
    );
  }

  if (!info) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    );
  }

  if (!info.capabilities.programmingTrackPower) {
    return (
      <ProgrammingUnsupported
        info={info}
        onBack={props.onBack}
      />
    );
  }

  return <DccExProgrammingPage {...props} />;
}
