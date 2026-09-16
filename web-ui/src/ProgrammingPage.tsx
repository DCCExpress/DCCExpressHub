import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Loader,
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
  useState,
} from "react";

import {
  getCommandCenterInfo,
  type CommandCenterInfo,
} from "@/api/commandCenterInfo";
import { CvHelpPanel } from "@/components/programming/CvHelpPanel";
import { wsApi } from "@/services/wsApi";
import type { WsConnectionStatus } from "@/services/wsClient";
import type {
  ProgrammingCommandAction,
  ProgrammingResponsePayload,
} from "@domain/types";

type Props = {
  onBack: () => void;
  status: WsConnectionStatus;
};

type NumberValue = string | number;

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

function DccExProgrammingPage({ onBack, status }: Props) {
  useTranslation();
  const [busy, setBusy] = useState(false);
  const [result, setResult] =
    useState<ProgrammingResponsePayload | null>(null);

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
    values: {
      address?: number;
      cv?: number;
      value?: number;
      active?: boolean;
    },
    confirmText?: string,
    valueTarget?: "locomotive" | "accessory",
  ) => {
    if (confirmText && !window.confirm(confirmText)) {
      return;
    }

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
      setBusy(false);
    }
  };

  const disconnected = status !== "connected";
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
