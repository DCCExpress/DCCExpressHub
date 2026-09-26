import i18next from "i18next";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Modal,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconDeviceFloppy,
  IconDownload,
  IconEdit,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconHome,
  IconMap,
  IconRefresh,
  IconRouter,
  IconSettings,
  IconTool,
  IconTrash,
  IconTrain,
  IconUpload,
  IconWifi,
  IconX,
  IconDeviceGamepad2,
  IconCpu,
  IconPower,
  IconTerminal2,
  IconGitBranch,
} from "@tabler/icons-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Loco, SignalLogicDocumentDto } from "@domain/types";

import { getLocos } from "@/api/domainApi";
import { exportLocoImages, importLocoImages, type LocoImageBackup } from "@/api/imageApi";
import { loadSignalLogicRulesWs, saveSignalLogicRulesWs } from "@/api/signalLogicWsApi";
import { loadSandboxSource, saveSandboxSource } from "@/api/sandboxApi";
import LocoDialog from "@/components/LocoDialog";
import CommandCenterSettingsDialog from "@/components/CommandCenterSettingsDialog";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import LocoPanel from "@/layout/LocoPanel";
import { getDefaultWsUrl } from "@/services/defaultWsUrl";
import { wsApi } from "@/services/wsApi";
import {
  wsClient,
  type WsConnectionStatus,
} from "@/services/wsClient";
import DeviceConfigurationPage, {
  isDeviceConfigurationDocument,
  type DeviceConfigurationDocument,
} from "./DeviceConfigurationPage";
import { useCommandCenter } from "./context/CommandCenterContext";
import {
  createEmptyAutomationFlowDocument,
  normalizeAutomationFlowDocument,
  type AutomationFlowDocument,
} from "@/domain/automationFlow";
import {
  loadAutomationFlow,
} from "@/services/automationApi";
import {
  useAutomationFlowRuntime,
} from "@/components/automation/useAutomationFlowRuntime";

const LiteLayoutPage = lazy(() => import("./LiteLayoutPage"));
const AutomationFlowPage = lazy(() => import("./AutomationFlowPage"));
const RuntimeLayoutOverlay = lazy(() => import("./RuntimeLayoutOverlay"));
const ProgrammingPage = lazy(() => import("./ProgrammingPage"));
const GamepadPage = lazy(() => import("./GamepadPage"));
const ConsolePage = lazy(() => import("./ConsolePage"));

type LoadState = "idle" | "loading" | "ready" | "error";
type Page = "home" | "drive" | "layout" | "flows" | "programming" | "settings" | "device-config" | "gamepad" | "console" | "files" | "backup";

type NetworkSettingsDto = {
  configured: boolean;
  ssid: string;
  hasPassword: boolean;
  hostname: string;
  mode: "access-point" | "station";
  currentIp: string;
  connectionUrl: string;
  restartPending: boolean;
};

type ApiResponse = {
  ok: boolean;
  message: string;
};

function statusColor(status: WsConnectionStatus): string {
  switch (status) {
    case "connected":
      return "teal";
    default:
      return "red";
  }
}

function formatStatus(status: WsConnectionStatus): string {
  switch (status) {
    case "connected":
      return "Online";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "error":
      return "Connection error";
    default:
      return "Offline";
  }
}

function pageFromHash(): Page {
  const page = window.location.hash.replace("#", "");
  return page === "drive" || page === "layout" || page === "flows" || page === "programming" || page === "settings" || page === "device-config" || page === "gamepad" || page === "console" || page === "files" || page === "backup" ? page : "home";
}

function AppHeader({ status, version }: { status: WsConnectionStatus; version: string }) {
  const { t } = useTranslation();
  const commandCenter = useCommandCenter();
  const [commandCenterSettingsOpened, setCommandCenterSettingsOpened] =
    useState(false);

  const translatedStatusKey =
    status === "connected" ||
    status === "connecting" ||
    status === "reconnecting" ||
    status === "error"
      ? status
      : "disconnected";

  return (
    <Group
      className="app-header"
      justify="space-between"
      align="center"
      wrap="wrap"
    >
      <Group
        className="app-header-main"
        gap="sm"
        wrap="nowrap"
      >
        <ThemeIcon size={44} radius="md" variant="gradient" gradient={{ from: "cyan", to: "blue" }}>
          <IconTrain size={25} />
        </ThemeIcon>
        <div>
          <Title order={3}>DCCExpressHub</Title>
          <Group
            className="app-header-meta"
            gap={6}
            wrap="wrap"
          >
            <Text size="xs" c="dimmed">{t("homeHub.commandStation")}</Text>
            <Badge
              className="app-version-badge"
              size="xs"
              variant="light"
              color="violet"
            >
              v{version}
            </Badge>
          </Group>
        </div>
      </Group>

      <Group
        className="app-header-actions"
        gap="xs"
        wrap="nowrap"
      >
        <Badge
          color={statusColor(status)}
          variant={status === "connected" ? "light" : "filled"}
          size="lg"
          className={status === "connected" ? "" : "lite-ws-alert"}
        >
          {t(`homeHub.status.${translatedStatusKey}`)}
        </Badge>

        <ActionIcon
          size="lg"
          radius="xl"
          variant="light"
          color="cyan"
          aria-label={t("homeHub.reloadPage")}
          title={t("homeHub.reloadPage")}
          onClick={() => window.location.reload()}
        >
          <IconRefresh size={20} />
        </ActionIcon>
      </Group>

      <Button
        size="xs"
        variant={commandCenter.powerInfo?.trackVoltageOn ? "filled" : "light"}
        color={commandCenter.powerInfo?.trackVoltageOn ? "green" : "red"}
        leftSection={<IconPower size={16} />}
        disabled={status !== "connected" || !commandCenter.alive}
        onClick={() => wsApi.setTrackPower(!commandCenter.powerInfo?.trackVoltageOn)}
        title={commandCenter.powerInfo?.trackVoltageOn ? t("homeHub.powerOffTitle") : t("homeHub.powerOnTitle")}
      > {i18next.t("ui.power")} {commandCenter.powerInfo?.trackVoltageOn ? i18next.t("ui.on") : i18next.t("ui.off")}
      </Button>

      {/* <Button
        size="xs"
        variant="light"
        color="blue"
        leftSection={<IconSettings size={16} />}
        onClick={() => setCommandCenterSettingsOpened(true)}
        title={t("homeHub.configureCsb1")}
      >
        CSB1
      </Button> */}

      <CommandCenterSettingsDialog
        opened={commandCenterSettingsOpened}
        onClose={() => setCommandCenterSettingsOpened(false)}
      />
    </Group>
  );
}

function PageTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <Group gap="sm" wrap="nowrap">
      <ThemeIcon size={42} radius="md" variant="light" color="cyan">
        {icon}
      </ThemeIcon>
      <div>
        <Title order={3}>{title}</Title>
        <Text size="sm" c="dimmed">{subtitle}</Text>
      </div>
    </Group>
  );
}

function HomePage({
  status,
  version,
  locoCount,
  onNavigate,
  onOpenLocoEditor,
}: {
  status: WsConnectionStatus;
  version: string;
  locoCount: number;
  onNavigate: (page: Page) => void;
  onOpenLocoEditor: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Stack gap="md">
      <Card className="hero-card" radius={5} p="lg">
        <Stack gap="sm">
          <AppHeader status={status} version={version} />
          <Group justify="space-between" align="center" gap="sm" wrap="wrap">
            <Text c="dimmed">
              {t("homeHub.description")}
            </Text>
            <LanguageSwitcher />
          </Group>
        </Stack>
      </Card>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("layout")}>
          <ThemeIcon size={48} radius="lg" color="teal" variant="light">
            <IconMap size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">{t("homeHub.cards.layout.title")}</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {t("homeHub.cards.layout.description")}
          </Text>
        </Card>

        <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("flows")}>
          <ThemeIcon size={48} radius="lg" color="violet" variant="light">
            <IconGitBranch size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">
            {t("homeHub.cards.flows.title", { defaultValue: "Flow Automation" })}
          </Title>
          <Text size="sm" c="dimmed" mt={4}>
            {t("homeHub.cards.flows.description", { defaultValue: "Build and manage event-driven automation flows." })}
          </Text>
        </Card>

        <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("drive")}>
          <ThemeIcon size={48} radius="lg" color="cyan" variant="light">
            <IconTrain size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">{t("homeHub.cards.mobile.title")}</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {locoCount > 0
              ? t("homeHub.cards.mobile.withCount", { count: locoCount })
              : t("homeHub.cards.mobile.empty")}
          </Text>
        </Card>

        {/* <Card className="action-card" withBorder radius={5} p="lg" onClick={onOpenLocoEditor}>
          <ThemeIcon size={48} radius="lg" color="violet" variant="light">
            <IconEdit size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">{t("homeHub.cards.locoEditor.title")}</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {t("homeHub.cards.locoEditor.description")}
          </Text>
        </Card> */}

        <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("programming")}>
          <ThemeIcon size={48} radius="lg" color="orange" variant="light">
            <IconTool size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">{t("homeHub.cards.programming.title")}</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {t("homeHub.cards.programming.description")}
          </Text>
        </Card>

        {/* <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("settings")}>
          <ThemeIcon size={48} radius="lg" color="indigo" variant="light">
            <IconRouter size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">{t("homeHub.cards.network.title")}</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {t("homeHub.cards.network.description")}
          </Text>
        </Card> */}

        {/* <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("device-config")}>
          <ThemeIcon size={48} radius="lg" color="blue" variant="light">
            <IconCpu size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">{t("homeHub.cards.devices.title")}</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {t("homeHub.cards.devices.description")}
          </Text>
        </Card> */}

        <Card
          className="action-card"
          withBorder
          radius={5}
          p="lg"
          onClick={() =>
            onNavigate("gamepad")
          }
        >
          <ThemeIcon
            size={48}
            radius="lg"
            color="grape"
            variant="light"
          >
            <IconDeviceGamepad2
              size={27}
            />
          </ThemeIcon>

          <Title
            order={4}
            mt="md"
          >
            {t("homeHub.cards.gamepad.title")}
          </Title>

          <Text
            size="sm"
            c="dimmed"
            mt={4}
          >
            {t("homeHub.cards.gamepad.description")}
          </Text>
        </Card>

        <Card
          className="action-card"
          withBorder
          radius={5}
          p="lg"
          onClick={() =>
            onNavigate("console")
          }
        >
          <ThemeIcon
            size={48}
            radius="lg"
            color="cyan"
            variant="light"
          >
            <IconTerminal2
              size={27}
            />
          </ThemeIcon>

          <Title
            order={4}
            mt="md"
          >
            {t("homeHub.cards.console.title")}
          </Title>

          <Text
            size="sm"
            c="dimmed"
            mt={4}
          >
            {t("homeHub.cards.console.description")}
          </Text>
        </Card>

        <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("files")}>
          <ThemeIcon size={48} radius="lg" color="orange" variant="light">
            <IconFolder size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">{t("homeHub.cards.files.title")}</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {t("homeHub.cards.files.description")}
          </Text>
        </Card>

        <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("backup")}>
          <ThemeIcon size={48} radius="lg" color="green" variant="light">
            <IconDownload size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">{t("homeHub.cards.backup.title")}</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {t("homeHub.cards.backup.description")}
          </Text>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}

type DeviceFile = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  deleteAllowed?: boolean;
};

type DeviceDirectoryListing = {
  path: string;
  entries: DeviceFile[];
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPreviewableImage(file: DeviceFile): boolean {
  return file.type === "file" && /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(file.name);
}

function isViewableTextFile(file: DeviceFile): boolean {
  return file.type === "file" && /\.(?:c|cc|conf|cpp|css|csv|h|hpp|htm|html|ini|ino|js|json|log|map|md|mjs|ndjson|svg|toml|ts|tsx|txt|xml|yaml|yml)$/i.test(file.name);
}

function FilesPage({ onBack }: { onBack: () => void }) {
  useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<DeviceFile[]>([]);
  const [currentPath, setCurrentPath] = useState("/");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textViewer, setTextViewer] = useState<{ name: string; content: string; loading: boolean } | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<DeviceFile | null>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/list?path=${encodeURIComponent(currentPath)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(i18next.t("ui.couldNotLoadFilesHttp", { value1: response.status }));
      const data = await response.json() as DeviceDirectoryListing;
      setFiles(data.entries.sort((left, right) => {
        if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
        return left.name.localeCompare(right.name);
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load files.");
    } finally {
      setLoading(false);
    }
  }, [i18next.resolvedLanguage, currentPath]);

  useEffect(() => { void loadFiles(); }, [loadFiles]);

  const uploadFiles = async (selected: FileList | null) => {
    if (!selected?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(selected)) {
        const formData = new FormData();
        formData.append("file", file, file.name);
        const response = await fetch(`/upload?path=${encodeURIComponent(currentPath)}`, { method: "POST", body: formData });
        if (!response.ok) throw new Error(i18next.t("ui.couldNotUploadHttp", { value1: file.name, value2: response.status }));
      }
      showNotification({ color: "teal", title: i18next.t("ui.uploadComplete"), message: i18next.t("ui.fileSUploaded", { value1: selected.length }) });
      await loadFiles();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
      setBusy(false);
    }
  };

  const deleteFile = async (file: DeviceFile) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/delete?path=${encodeURIComponent(file.path)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(i18next.t("ui.couldNotDeleteHttp", { value1: file.name, value2: response.status }));
      setDeleteCandidate(null);
      await loadFiles();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  const openTextFile = async (file: DeviceFile) => {
    setError(null);
    setTextViewer({ name: file.name, content: "", loading: true });
    try {
      const response = await fetch(`/api/files/text?path=${encodeURIComponent(file.path)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(i18next.t("ui.couldNotOpenHttp", { value1: file.name, value2: response.status }));
      const content = await response.text();
      setTextViewer({ name: file.name, content, loading: false });
    } catch (viewError) {
      setTextViewer(null);
      setError(viewError instanceof Error ? viewError.message : "Could not open text file.");
    }
  };

  const openEntry = (file: DeviceFile): void => {
    if (file.type === "directory") {
      setCurrentPath(file.path);
      return;
    }

    if (isViewableTextFile(file)) {
      void openTextFile(file);
      return;
    }

    window.open(file.path, "_blank", "noopener,noreferrer");
  };

  const pathSegments = currentPath.split("/").filter(Boolean);
  const navigateToSegment = (index: number) => {
    setCurrentPath(index < 0 ? "/" : `/${pathSegments.slice(0, index + 1).join("/")}`);
  };

  const deleteIsConfig = deleteCandidate?.path.startsWith("/flash/config/") === true;

  return (
    <Stack gap="lg">
      <Modal
        opened={textViewer !== null}
        onClose={() => setTextViewer(null)}
        title={textViewer?.name ?? i18next.t("ui.textFile")}
        size="xl"
        centered
      >
        {textViewer?.loading ? (
          <Group justify="center" py="xl"><Loader /></Group>
        ) : (
          <Box
            component="pre"
            m={0}
            p="sm"
            style={{ maxHeight: "70vh", overflow: "auto", whiteSpace: "pre", fontFamily: "monospace", fontSize: 13 }}
          >
            {textViewer?.content}
          </Box>
        )}
      </Modal>

      <Modal
        opened={deleteCandidate !== null}
        onClose={() => { if (!busy) setDeleteCandidate(null); }}
        title={deleteCandidate ? `Delete ${deleteCandidate.name}?` : "Delete?"}
        centered
        size="md"
      >
        <Stack gap="md">
          <Text size="sm">{deleteCandidate?.path}</Text>
          {deleteIsConfig && (
            <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
              This is Hub configuration. Deleting it removes the stored configuration. Restart the Hub afterwards so firmware runtime state is rebuilt.
            </Alert>
          )}
          {deleteCandidate?.type === "directory" && (
            <Alert color="blue">Only empty directories can be deleted.</Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={busy} onClick={() => setDeleteCandidate(null)}>Cancel</Button>
            <Button color="red" loading={busy} disabled={!deleteCandidate} onClick={() => { if (deleteCandidate) void deleteFile(deleteCandidate); }}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={18} />} onClick={onBack} className="back-button"> {i18next.t("ui.backToHome")} </Button>
      <PageTitle icon={<IconFolder size={24} />} title={i18next.t("ui.files")} subtitle={i18next.t("ui.browseTheCompleteLittlefsFilesystem")} />
      <Card withBorder radius="xl" p="lg">
        <Stack gap="md">
          <Group gap={4} wrap="wrap">
            <Button size="compact-sm" variant={currentPath === "/" ? "light" : "subtle"} leftSection={<IconHome size={15} />} onClick={() => navigateToSegment(-1)}> {i18next.t("ui.root")} </Button>
            {pathSegments.map((segment, index) => (
              <Button key={`${segment}-${index}`} size="compact-sm" variant={index === pathSegments.length - 1 ? "light" : "subtle"} onClick={() => navigateToSegment(index)}>
                / {segment}
              </Button>
            ))}
          </Group>
          <Group justify="space-between">
            <div>
              <Text fw={600} size="sm">{currentPath}</Text>
              <Text c="dimmed" size="xs">{files.length} {i18next.t("ui.itemS")}</Text>
            </div>
            <Group gap="xs">
              <Button variant="light" leftSection={<IconRefresh size={17} />} disabled={busy} onClick={() => void loadFiles()}>{i18next.t("ui.refresh")}</Button>
              <Button leftSection={<IconUpload size={17} />} loading={busy} disabled={busy || currentPath === "/"} onClick={() => inputRef.current?.click()}>{i18next.t("ui.upload")}</Button>
              <input ref={inputRef} hidden type="file" multiple onChange={event => void uploadFiles(event.currentTarget.files)} />
            </Group>
          </Group>
          {error && <Alert color="red" icon={<IconAlertTriangle size={18} />}>{error}</Alert>}
          {loading ? (
            <Group justify="center" py="xl"><Loader /></Group>
          ) : files.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">{i18next.t("ui.thisDirectoryIsEmpty")}</Text>
          ) : (
            <Stack gap="xs">
              {files.map(file => (
                <Card key={file.path} withBorder radius="md" p="sm">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                      {file.type === "directory" ? (
                        <IconFolderOpen size={22} />
                      ) : isPreviewableImage(file) ? (
                        <img
                          src={file.path}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          style={{ width: 80, height: 60, objectFit: "contain", flex: "0 0 auto" }}
                        />
                      ) : (
                        <IconFile size={22} />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <button
                          type="button"
                          onClick={() => openEntry(file)}
                          style={{
                            display: "block",
                            maxWidth: "100%",
                            padding: 0,
                            border: 0,
                            background: "transparent",
                            color: "inherit",
                            cursor: "pointer",
                            textAlign: "left",
                            font: "inherit",
                          }}
                        >
                          <Text fw={600} truncate>{file.name}</Text>
                        </button>
                        <Text size="xs" c="dimmed">{file.type === "directory" ? i18next.t("ui.directory2") : formatFileSize(file.size)}</Text>
                      </div>
                    </Group>
                    <Group gap={6} wrap="nowrap">
                      {file.deleteAllowed === false ? (
                        <Badge color="gray" variant="light" size="sm">Protected</Badge>
                      ) : (
                        <ActionIcon
                          color="red"
                          variant="light"
                          disabled={busy}
                          aria-label={i18next.t("ui.delete", { value1: file.name })}
                          onClick={() => setDeleteCandidate(file)}
                        >
                          <IconTrash size={17} />
                        </ActionIcon>
                      )}
                    </Group>
                  </Group>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

type LiteBackup = {
  format: "dcc-express-lite-backup";
  // This is the backup container format, not the application/release version.
  // Importers must treat it as informational and restore every section they know.
  version: number;
  exportedAt: string;
  layout?: unknown;
  locos?: Loco[];
  images?: LocoImageBackup[];
  signalLogic?: SignalLogicDocumentDto;
  devices?: DeviceConfigurationDocument;
  sandboxScript?: {
    path: "/scripts/sandbox.js";
    source: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function BackupPage({ onBack, onDataImported }: { onBack: () => void; onDataImported: () => Promise<void> }) {
  useTranslation();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const exportData = async () => {
    try {
      const backup: LiteBackup = {
        format: "dcc-express-lite-backup",
        version: 3,
        exportedAt: new Date().toISOString(),
      };
      const exported: string[] = [];
      const warnings: string[] = [];

      await Promise.all([
        (async () => {
          try {
            const response = await fetch("/api/layout", { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            backup.layout = await response.json();
            exported.push("layout");
          } catch (error) {
            warnings.push(`layout: ${errorMessage(error)}`);
          }
        })(),
        (async () => {
          try {
            const response = await fetch("/api/locos", { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const locos = await response.json() as unknown;
            if (!Array.isArray(locos)) throw new Error(i18next.t("ui.invalidResponse"));
            backup.locos = locos as Loco[];
            exported.push(`${locos.length} locomotives`);
          } catch (error) {
            warnings.push(`locomotives: ${errorMessage(error)}`);
          }
        })(),
        (async () => {
          try {
            const images = await exportLocoImages();
            backup.images = images;
            exported.push(`${images.length} images`);
          } catch (error) {
            warnings.push(`images: ${errorMessage(error)}`);
          }
        })(),
        (async () => {
          try {
            const signalLogic = await loadSignalLogicRulesWs();
            backup.signalLogic = signalLogic.document;
            exported.push("signal logic");
          } catch (error) {
            warnings.push(`signal logic: ${errorMessage(error)}`);
          }
        })(),
        (async () => {
          try {
            const response = await fetch("/api/device-config", { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const devices = await response.json() as unknown;
            if (!isDeviceConfigurationDocument(devices)) throw new Error(i18next.t("ui.invalidResponse"));
            backup.devices = devices;
            exported.push(`${devices.devices.length} HAL devices`);
          } catch (error) {
            warnings.push(`HAL devices: ${errorMessage(error)}`);
          }
        })(),
        (async () => {
          try {
            const source = await loadSandboxSource();
            backup.sandboxScript = {
              path: "/scripts/sandbox.js",
              source,
            };
            exported.push("JavaScript Sandbox script");
          } catch (error) {
            warnings.push(`Sandbox script: ${errorMessage(error)}`);
          }
        })(),
      ]);

      if (exported.length === 0) throw new Error(i18next.t("ui.noBackupDataCouldBeRead", { value1: warnings.join("; ") }));

      const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `dcc-express-lite-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
      showNotification({
        color: warnings.length > 0 ? "yellow" : "teal",
        title: warnings.length > 0 ? "Backup exported with warnings" : "Backup exported",
        message: i18next.t("ui.saved", { value1: exported.join(", "), value2: warnings.length > 0 ? ` Skipped: ${warnings.join("; ")}` : "" }),
      });
    } catch (exportError) {
      showNotification({ color: "red", title: i18next.t("ui.exportFailed"), message: errorMessage(exportError) });
    }
  };

  const importData = async (file: File) => {
    setImporting(true);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isRecord(parsed)) {
        throw new Error(i18next.t("ui.thisIsNotAValidDccexpressliteBackupFile"));
      }
      if (parsed.format !== undefined && parsed.format !== "dcc-express-lite-backup") {
        throw new Error(i18next.t("ui.thisIsNotADccexpressliteBackupFile"));
      }

      // Intentionally do not reject unknown backup versions. Each known section
      // is restored independently, while fields from newer releases are ignored.
      const hasLayout = Object.prototype.hasOwnProperty.call(parsed, "layout") && parsed.layout !== null;
      const locos = Array.isArray(parsed.locos) ? parsed.locos as Loco[] : null;
      const images = Array.isArray(parsed.images) ? parsed.images as LocoImageBackup[] : null;
      const signalLogic = isRecord(parsed.signalLogic) && Array.isArray(parsed.signalLogic.groups)
        ? parsed.signalLogic as SignalLogicDocumentDto
        : null;
      const devices = isDeviceConfigurationDocument(parsed.devices) ? parsed.devices : null;
      const sandboxScript =
        isRecord(parsed.sandboxScript) &&
        parsed.sandboxScript.path === "/scripts/sandbox.js" &&
        typeof parsed.sandboxScript.source === "string"
          ? parsed.sandboxScript.source
          : null;

      if (
        !hasLayout &&
        locos === null &&
        images === null &&
        signalLogic === null &&
        devices === null &&
        sandboxScript === null
      ) {
        throw new Error(i18next.t("ui.theFileContainsNoLayoutLocomotiveImageSignalLogicOr"));
      }

      const imported: string[] = [];
      const warnings: string[] = [];

      if (hasLayout) {
        try {
          const response = await fetch("/api/layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.layout) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          imported.push("layout");
        } catch (error) {
          warnings.push(`layout: ${errorMessage(error)}`);
        }
      }

      if (locos !== null) {
        try {
          const response = await fetch("/api/locos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(locos) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          imported.push(`${locos.length} locomotives`);
        } catch (error) {
          warnings.push(`locomotives: ${errorMessage(error)}`);
        }
      }

      if (images !== null) {
        try {
          await importLocoImages(images);
          imported.push(`${images.length} images`);
        } catch (error) {
          warnings.push(`images: ${errorMessage(error)}`);
        }
      }

      if (signalLogic !== null) {
        try {
          await saveSignalLogicRulesWs(signalLogic);
          imported.push("signal logic");
        } catch (error) {
          warnings.push(`signal logic: ${errorMessage(error)}`);
        }
      }

      if (sandboxScript !== null) {
        try {
          await saveSandboxSource(sandboxScript);
          imported.push("JavaScript Sandbox script");
        } catch (error) {
          warnings.push(`Sandbox script: ${errorMessage(error)}`);
        }
      }

      // Device configuration is deliberately restored last because the
      // firmware restarts shortly after accepting it.
      if (devices !== null) {
        try {
          const response = await fetch("/api/device-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(devices),
          });
          if (!response.ok) {
            const result = await response.json().catch(() => null) as { message?: string } | null;
            throw new Error(result?.message ?? `HTTP ${response.status}`);
          }
          imported.push(`${devices.devices.length} HAL devices (restart scheduled)`);
        } catch (error) {
          warnings.push(`HAL devices: ${errorMessage(error)}`);
        }
      }

      if (imported.length === 0) throw new Error(i18next.t("ui.noDataCouldBeRestored", { value1: warnings.join("; ") }));
      if (locos !== null) await onDataImported();
      showNotification({
        color: warnings.length > 0 ? "yellow" : "teal",
        title: warnings.length > 0 ? "Backup imported with warnings" : "Backup imported",
        message: i18next.t("ui.restored", { value1: imported.join(", "), value2: warnings.length > 0 ? ` Skipped: ${warnings.join("; ")}` : "" }),
      });
    } catch (importError) {
      showNotification({ color: "red", title: i18next.t("ui.importFailed"), message: errorMessage(importError) });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  return (
    <Stack gap="lg">
      <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={18} />} onClick={onBack} className="back-button"> {i18next.t("ui.backToHome")} </Button>
      <PageTitle icon={<IconDownload size={24} />} title={i18next.t("ui.exportImport")} subtitle={i18next.t("ui.backUpOrRestoreAllUserData")} />
      <Card withBorder radius={5} p="lg">
        <Stack gap="md">
          <div>
            <Title order={4}>{i18next.t("ui.layoutLocomotivesImagesSignalLogicAndDevices")}</Title>
            <Text size="sm" c="dimmed" mt={4}> {i18next.t("ui.exportTheCompleteLayoutLocomotiveListImagesSignalAutomationRules")} </Text>
          </div>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Button size="lg" variant="light" color="teal" leftSection={<IconDownload size={18} />} onClick={() => void exportData()}> {i18next.t("ui.exportBackup")} </Button>
            <Button size="lg" variant="light" color="blue" leftSection={<IconUpload size={18} />} loading={importing} onClick={() => importInputRef.current?.click()}> {i18next.t("ui.importBackup")} </Button>
          </SimpleGrid>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (file) void importData(file);
            }}
          />
        </Stack>
      </Card>
    </Stack>
  );
}

function SettingsPage({ onBack, status }: { onBack: () => void; status: WsConnectionStatus }) {
  useTranslation();
  const [settings, setSettings] = useState<NetworkSettingsDto | null>(null);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/settings/network", { cache: "no-store" });

      if (!response.ok) throw new Error(i18next.t("ui.theDeviceDidNotReturnItsNetworkSettings"));

      const data = await response.json() as NetworkSettingsDto;
      setSettings(data);
      setSsid(data.ssid);
      setPassword("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load network settings.");
    } finally {
      setLoading(false);
    }
  }, [i18next.resolvedLanguage, ]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveSettings = async () => {
    setSaving(true);
    setError(null);

    try {
      const body = new URLSearchParams({ ssid: ssid.trim(), password });
      const response = await fetch("/api/settings/network", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const result = await response.json() as ApiResponse;

      if (!response.ok || !result.ok) throw new Error(result.message || "Could not save network settings.");

      showNotification({
        color: "teal",
        title: i18next.t("ui.networkSaved"),
        message: i18next.t("ui.theExCsb1IsRestartingReconnectThroughYourLocalWi"),
        autoClose: 9000,
      });
      setSettings(current => current ? { ...current, configured: true, ssid: ssid.trim(), hasPassword: true, restartPending: true } : current);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save network settings.");
      setSaving(false);
    }
  };

  const resetSettings = async () => {
    if (!window.confirm(i18next.t("ui.clearTheSavedNetworkAndRestartInDccexHotspotMode"))) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/settings/network/reset", { method: "POST" });
      const result = await response.json() as ApiResponse;

      if (!response.ok || !result.ok) throw new Error(result.message || "Could not clear network settings.");

      showNotification({
        color: "teal",
        title: i18next.t("ui.hotspotModeRestored"),
        message: i18next.t("ui.theExCsb1IsRestartingJoinItsDccexHotspotAgain"),
        autoClose: 9000,
      });
      setSettings(current => current ? { ...current, configured: false, ssid: "", hasPassword: false, restartPending: true } : current);
      setSsid("");
      setPassword("");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Could not clear network settings.");
      setSaving(false);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={18} />} onClick={onBack} className="back-button"> {i18next.t("ui.backToHome")} </Button>
        <Badge
          color={statusColor(status)}
          variant={status === "connected" ? "light" : "filled"}
          className={status === "connected" ? "" : "lite-ws-alert"}
        >
          {formatStatus(status)}
        </Badge>
      </Group>

      <PageTitle icon={<IconSettings size={24} />} title={i18next.t("ui.settings")} subtitle={i18next.t("ui.deviceAndLocalNetwork")} />

      <Card withBorder radius="xl" p="lg">
        <Stack gap="md">
          <Group justify="space-between">
            <div>
              <Title order={4}>{i18next.t("ui.localWiFiNetwork")}</Title>
              <Text size="sm" c="dimmed">{i18next.t("ui.savedSecurelyOnTheExCsb1")}</Text>
            </div>
            <ThemeIcon size={42} radius="md" variant="light" color={settings?.configured ? "teal" : "gray"}>
              <IconWifi size={23} />
            </ThemeIcon>
          </Group>

          {loading ? (
            <Group justify="center" py="xl"><Loader /></Group>
          ) : (
            <>
              {settings?.configured && (
                <Alert color="teal" icon={<IconCheck size={18} />} title={i18next.t("ui.localNetworkConfigured")}> {i18next.t("ui.currentlySaved")} <strong>{settings.ssid}</strong>
                </Alert>
              )}

              {error && (
                <Alert color="red" icon={<IconAlertTriangle size={18} />} title={i18next.t("ui.networkSettings")}>
                  {error}
                </Alert>
              )}

              <TextInput
                label={i18next.t("ui.wiFiNameSsid")}
                placeholder={i18next.t("ui.yourLocalNetwork")}
                value={ssid}
                onChange={event => setSsid(event.currentTarget.value)}
                maxLength={32}
                leftSection={<IconRouter size={17} />}
                disabled={saving}
                required
              />

              <PasswordInput
                label={i18next.t("ui.wiFiPassword")}
                placeholder={settings?.hasPassword ? i18next.t("ui.leaveBlankToKeepTheSavedPassword") : i18next.t("ui.863Characters")}
                description={settings?.hasPassword ? i18next.t("ui.theSavedPasswordIsNeverSentBackToTheBrowser") : undefined}
                value={password}
                onChange={event => setPassword(event.currentTarget.value)}
                minLength={8}
                maxLength={63}
                disabled={saving}
              />

              <Alert color="blue" variant="light" icon={<IconWifi size={18} />}> {i18next.t("ui.afterSavingTheDeviceRestartsAndThisHotspotDisappearsJoin")} <strong>http://dccex.local</strong> {i18next.t("ui.orTheIpShownOnTheExCsb1Display")} </Alert>

              <Button
                size="md"
                leftSection={<IconDeviceFloppy size={19} />}
                loading={saving}
                disabled={!ssid.trim() || (!settings?.hasPassword && password.length < 8)}
                onClick={() => void saveSettings()}
              > {i18next.t("ui.saveNetworkAndRestart")} </Button>

              <Divider label={i18next.t("ui.recovery")} labelPosition="center" />

              <Button variant="light" color="red" disabled={saving || !settings?.configured} onClick={() => void resetSettings()}> {i18next.t("ui.returnToDccexHotspotMode")} </Button>
            </>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

export default function App() {
  useTranslation();
  const [page, setPage] = useState<Page>(pageFromHash);
  const [status, setStatus] = useState<WsConnectionStatus>(wsClient.getStatus());
  const [locos, setLocos] = useState<Loco[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [locoEditorOpened, setLocoEditorOpened] = useState(false);
  const [driveLayoutOpen, setDriveLayoutOpen] = useState(false);
  const [version, setVersion] = useState("development");
  const [
    automationFlow,
    setAutomationFlow,
  ] =
    useState<AutomationFlowDocument>(
      () =>
        createEmptyAutomationFlowDocument()
    );

  useAutomationFlowRuntime(
    automationFlow
  );

  const loadAutomationFlowState =
    useCallback(
      async (): Promise<void> => {
        const loaded =
          normalizeAutomationFlowDocument(
            await loadAutomationFlow()
          );

        setAutomationFlow(
          loaded
        );
      },
      []
    );

  const loadLocos = useCallback(async () => {
    setLoadState("loading");

    try {
      setLocos(await getLocos());
      setLoadState("ready");
    } catch (error) {
      console.error(error);
      setLoadState("error");
    }
  }, []);

  const loadLocosForEditor = useCallback(async (): Promise<Loco[]> => {
    const response = await fetch("/api/locos", { cache: "no-store" });
    if (!response.ok) throw new Error(i18next.t("ui.couldNotLoadLocomotivesFromTheExCsb1"));
    return response.json() as Promise<Loco[]>;
  }, [i18next.resolvedLanguage, ]);

  const saveLocosForEditor = useCallback(async (nextLocos: Loco[]): Promise<void> => {
    const response = await fetch("/api/locos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextLocos),
    });
    if (!response.ok) throw new Error(i18next.t("ui.couldNotSaveLocomotivesToTheExCsb1"));
  }, [i18next.resolvedLanguage, ]);

  useEffect(() => {
    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;

    const closeSocketForPageExit = () => wsApi.disconnect();
    const unsubscribeStatus = wsClient.subscribeStatus(nextStatus => {
      setStatus(nextStatus);
    });

    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("pagehide", closeSocketForPageExit);

    const prepareApplication = async () => {
      await Promise.allSettled([
        loadLocos(),
        loadAutomationFlowState(),
        fetch("/version.json", { cache: "no-store" })
          .then(response => response.ok ? response.json() as Promise<{ version?: string }> : null)
          .then(data => {
            if (data?.version) setVersion(data.version);
          }),
      ]);

      if (cancelled) return;

      // Let the downloaded application render and paint before opening the
      // realtime channel. This avoids competing with the initial HTTP/API
      // traffic on slower phones.
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (!cancelled) wsApi.connect(getDefaultWsUrl());
        });
      });
    };

    void prepareApplication();

    return () => {
      cancelled = true;
      if (firstFrame) window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("pagehide", closeSocketForPageExit);
      unsubscribeStatus();
      wsApi.disconnect();
    };
  }, [loadAutomationFlowState, loadLocos]);

  const reloadImportedData =
    useCallback(
      async (): Promise<void> => {
        await Promise.all([
          loadLocos(),
          loadAutomationFlowState(),
        ]);
      },
      [
        loadAutomationFlowState,
        loadLocos,
      ]
    );

  const navigate = (nextPage: Page) => {
    if (nextPage !== "drive") setDriveLayoutOpen(false);
    window.location.hash = nextPage === "home" ? "" : nextPage;
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const renderPage = () => {
    if (page === "settings") return <SettingsPage onBack={() => navigate("home")} status={status} />;

    if (page === "files") return <FilesPage onBack={() => navigate("home")} />;

    if (page === "backup") return <BackupPage onBack={() => navigate("home")} onDataImported={reloadImportedData} />;

    if (page === "programming") return <ProgrammingPage onBack={() => navigate("home")} status={status} />;

    if (page === "device-config") return <DeviceConfigurationPage onBack={() => navigate("home")} />;

    if (page === "flows") {
      return (
        <AutomationFlowPage
          document={
            automationFlow
          }
          onDocumentChange={
            setAutomationFlow
          }
          onBack={
            () =>
              navigate("home")
          }
        />
      );
    }

    if (page === "layout") return <LiteLayoutPage version={version} locos={locos} automationFlow={automationFlow} onAutomationFlowChange={setAutomationFlow} onBack={() => navigate("home")} onOpenLocoEditor={() => setLocoEditorOpened(true)} />;

    if (page === "drive") {
      return (
        <Stack className="mobile-drive-page" gap="md">
          <RuntimeLayoutOverlay
            locos={locos}
            open={driveLayoutOpen}
          />

          <ActionIcon
            className="mobile-back-fab"
            size={46}
            radius="xl"
            variant="filled"
            color="dark"
            aria-label={i18next.t("ui.backToHome")}
            title={i18next.t("ui.backToHome")}
            onClick={() => navigate("home")}
          >
            <IconArrowLeft size={24} />
          </ActionIcon>
          {loadState === "loading" && locos.length === 0 ? (
            <Card withBorder radius="xl" p="xl"><Stack align="center"><Loader /><Text c="dimmed">{i18next.t("ui.loadingLocomotives")}</Text></Stack></Card>
          ) : (
            <Box className="mobile-loco-panel">
              <LocoPanel locos={locos} mobileViewport />
            </Box>
          )}
          {loadState === "error" && (
            <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={() => void loadLocos()}>{i18next.t("ui.retryLoadingLocomotives")}</Button>
          )}
          <ActionIcon
            className="mobile-layout-fab"
            size={58}
            radius="xl"
            variant="filled"
            color={driveLayoutOpen ? "red" : "teal"}
            aria-label={driveLayoutOpen ? i18next.t("ui.closeLayoutPanel") : i18next.t("ui.openLayoutPanel")}
            title={driveLayoutOpen ? i18next.t("ui.closeLayoutPanel") : i18next.t("ui.openLayoutPanel")}
            onClick={() => setDriveLayoutOpen(value => !value)}
          >
            {driveLayoutOpen ? <IconX size={28} /> : <IconMap size={28} />}
          </ActionIcon>
        </Stack>
      );
    }

    if (page === "gamepad") {
      return (
        <GamepadPage
          onBack={() => navigate("home")}
        />
      );
    }

    if (page === "console") {
      return (
        <ConsolePage
          onBack={() =>
            navigate("home")
          }
        />
      );
    }

    return <HomePage status={status} version={version} locoCount={locos.length} onNavigate={navigate} onOpenLocoEditor={() => setLocoEditorOpened(true)} />;
  };

  return (
    <Box
      className={`mobile-shell${page === "layout" ? " layout-shell" : ""
        }${page === "drive" ? " drive-shell" : ""
        }${page === "device-config" ? " device-config-shell" : ""
        }`}
    >
      <Stack gap="md">
        <Box className="mobile-content">
          <Suspense
            fallback={
              <Group justify="center" py="xl">
                <Loader />
              </Group>
            }
          >
            {renderPage()}
          </Suspense>
        </Box>
      </Stack>
      <LocoDialog
        opened={locoEditorOpened}
        onClose={() => setLocoEditorOpened(false)}
        onSaved={() => void loadLocos()}
        loadLocos={loadLocosForEditor}
        saveLocos={saveLocosForEditor}
      />
    </Box>
  );
}
