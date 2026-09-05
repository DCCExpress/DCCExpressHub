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
  IconExternalLink,
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
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Loco, SignalLogicDocumentDto } from "@domain/types";

import { getLocos } from "@/api/domainApi";
import { exportLocoImages, importLocoImages, type LocoImageBackup } from "@/api/imageApi";
import { loadSignalLogicRulesWs, saveSignalLogicRulesWs } from "@/api/signalLogicWsApi";
import LocoDialog from "@/components/LocoDialog";
import CommandCenterSettingsDialog from "@/components/CommandCenterSettingsDialog";
import LocoPanel from "@/layout/LocoPanel";
import LiteLayoutPage from "./LiteLayoutPage";
import RuntimeLayoutOverlay from "./RuntimeLayoutOverlay";
import ProgrammingPage from "./ProgrammingPage";
import { getDefaultWsUrl } from "@/services/defaultWsUrl";
import { wsApi } from "@/services/wsApi";
import {
  wsClient,
  type WsConnectionStatus,
} from "@/services/wsClient";
import GamepadPage from "./GamepadPage";
import DeviceConfigurationPage, {
  isDeviceConfigurationDocument,
  type DeviceConfigurationDocument,
} from "./DeviceConfigurationPage";
import { useCommandCenter } from "./context/CommandCenterContext";
import ConsolePage from "./ConsolePage";

type LoadState = "idle" | "loading" | "ready" | "error";
type Page = "home" | "drive" | "layout" | "programming" | "settings" | "device-config" | "gamepad" | "console" | "files" | "backup";

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
  return page === "drive" || page === "layout" || page === "programming" || page === "settings" || page === "device-config" || page === "gamepad" || page === "console" || page === "files" || page === "backup" ? page : "home";
}

function AppHeader({ status, version }: { status: WsConnectionStatus; version: string }) {

  const commandCenter = useCommandCenter();
  const [commandCenterSettingsOpened, setCommandCenterSettingsOpened] =
    useState(false);
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
            <Text size="xs" c="dimmed">EX-CSB1 command station</Text>
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
          {formatStatus(status)}
        </Badge>

        <ActionIcon
          size="lg"
          radius="xl"
          variant="light"
          color="cyan"
          aria-label="Reload page"
          title="Reload page"
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
        title={commandCenter.powerInfo?.trackVoltageOn ? "Turn track power off" : "Turn track power on"}
      >
        POWER {commandCenter.powerInfo?.trackVoltageOn ? "ON" : "OFF"}
      </Button>

      <Button
        size="xs"
        variant="light"
        color="blue"
        leftSection={<IconSettings size={16} />}
        onClick={() => setCommandCenterSettingsOpened(true)}
        title="Configure EX-CSB1 connection"
      >
        CSB1
      </Button>

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
  return (
    <Stack gap="md">
      <Card className="hero-card" radius={5} p="lg">
        <Stack gap="sm">
          <AppHeader status={status} version={version} />
          <Text c="dimmed">
            Control locomotives, operate the layout and configure the EX-CSB1.
          </Text>
        </Stack>
      </Card>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("layout")}>
          <ThemeIcon size={48} radius="lg" color="teal" variant="light">
            <IconMap size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">Layout editor</Title>
          <Text size="sm" c="dimmed" mt={4}>
            Build the track plan and operate turnouts
          </Text>
        </Card>

        <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("drive")}>
          <ThemeIcon size={48} radius="lg" color="cyan" variant="light">
            <IconTrain size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">Mobile controller</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {locoCount > 0 ? `Drive ${locoCount} locomotive${locoCount === 1 ? "" : "s"} from your phone` : "Open mobile throttle and function controls"}
          </Text>
        </Card>

        <Card className="action-card" withBorder radius={5} p="lg" onClick={onOpenLocoEditor}>
          <ThemeIcon size={48} radius="lg" color="violet" variant="light">
            <IconEdit size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">Locomotive editor</Title>
          <Text size="sm" c="dimmed" mt={4}>
            Add locomotives and configure addresses, images and functions
          </Text>
        </Card>

        <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("programming")}>
          <ThemeIcon size={48} radius="lg" color="orange" variant="light">
            <IconTool size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">Decoder programming</Title>
          <Text size="sm" c="dimmed" mt={4}>
            Program locomotive, accessory and DigiTools decoders
          </Text>
        </Card>

        <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("settings")}>
          <ThemeIcon size={48} radius="lg" color="indigo" variant="light">
            <IconRouter size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">Network settings</Title>
          <Text size="sm" c="dimmed" mt={4}>
            Join the EX-CSB1 to your local Wi-Fi network
          </Text>
        </Card>

        <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("device-config")}>
          <ThemeIcon size={48} radius="lg" color="blue" variant="light">
            <IconCpu size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">Device configuration</Title>
          <Text size="sm" c="dimmed" mt={4}>
            Configure external servo and input/output devices
          </Text>
        </Card>

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
            Gamepad
          </Title>

          <Text
            size="sm"
            c="dimmed"
            mt={4}
          >
            Test Bluetooth and USB
            game controllers
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
            Console
          </Title>

          <Text
            size="sm"
            c="dimmed"
            mt={4}
          >
            Send raw DCC-EX commands
            and inspect WebSocket traffic
          </Text>
        </Card>

        <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("files")}>
          <ThemeIcon size={48} radius="lg" color="orange" variant="light">
            <IconFolder size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">Files</Title>
          <Text size="sm" c="dimmed" mt={4}>
            Browse, upload and delete files across the complete LittleFS filesystem
          </Text>
        </Card>

        <Card className="action-card" withBorder radius={5} p="lg" onClick={() => onNavigate("backup")}>
          <ThemeIcon size={48} radius="lg" color="green" variant="light">
            <IconDownload size={27} />
          </ThemeIcon>
          <Title order={4} mt="md">Export / Import</Title>
          <Text size="sm" c="dimmed" mt={4}>
            Back up or restore the layout, locomotives and images
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
  return file.type === "file" && /\.(?:c|cc|conf|cpp|css|csv|h|hpp|htm|html|ini|ino|js|json|log|map|md|mjs|svg|toml|ts|tsx|txt|xml|yaml|yml)$/i.test(file.name);
}

function FilesPage({ onBack }: { onBack: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<DeviceFile[]>([]);
  const [currentPath, setCurrentPath] = useState("/");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textViewer, setTextViewer] = useState<{ name: string; content: string; loading: boolean } | null>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/list?path=${encodeURIComponent(currentPath)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not load files (HTTP ${response.status}).`);
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
  }, [currentPath]);

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
        if (!response.ok) throw new Error(`Could not upload ${file.name} (HTTP ${response.status}).`);
      }
      showNotification({ color: "teal", title: "Upload complete", message: `${selected.length} file(s) uploaded.` });
      await loadFiles();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
      setBusy(false);
    }
  };

  const deleteFile = async (file: DeviceFile) => {
    const warning = file.type === "directory"
      ? `Delete the empty directory ${file.path}?`
      : `Delete ${file.path}?\n\nDeleting index.html or files under /assets can make the web interface unavailable.`;
    if (!window.confirm(warning)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/delete?path=${encodeURIComponent(file.path)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not delete ${file.name} (HTTP ${response.status}).`);
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
      if (!response.ok) throw new Error(`Could not open ${file.name} (HTTP ${response.status}).`);
      const content = await response.text();
      setTextViewer({ name: file.name, content, loading: false });
    } catch (viewError) {
      setTextViewer(null);
      setError(viewError instanceof Error ? viewError.message : "Could not open text file.");
    }
  };

  const pathSegments = currentPath.split("/").filter(Boolean);
  const navigateToSegment = (index: number) => {
    setCurrentPath(index < 0 ? "/" : `/${pathSegments.slice(0, index + 1).join("/")}`);
  };

  return (
    <Stack gap="lg">
      <Modal
        opened={textViewer !== null}
        onClose={() => setTextViewer(null)}
        title={textViewer?.name ?? "Text file"}
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
      <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={18} />} onClick={onBack} className="back-button">
        Back to home
      </Button>
      <PageTitle icon={<IconFolder size={24} />} title="Files" subtitle="Browse the complete LittleFS filesystem" />
      <Card withBorder radius="xl" p="lg">
        <Stack gap="md">
          <Group gap={4} wrap="wrap">
            <Button size="compact-sm" variant={currentPath === "/" ? "light" : "subtle"} leftSection={<IconHome size={15} />} onClick={() => navigateToSegment(-1)}>
              root
            </Button>
            {pathSegments.map((segment, index) => (
              <Button key={`${segment}-${index}`} size="compact-sm" variant={index === pathSegments.length - 1 ? "light" : "subtle"} onClick={() => navigateToSegment(index)}>
                / {segment}
              </Button>
            ))}
          </Group>
          <Group justify="space-between">
            <div>
              <Text fw={600} size="sm">{currentPath}</Text>
              <Text c="dimmed" size="xs">{files.length} item(s)</Text>
            </div>
            <Group gap="xs">
              <Button variant="light" leftSection={<IconRefresh size={17} />} disabled={busy} onClick={() => void loadFiles()}>Refresh</Button>
              <Button leftSection={<IconUpload size={17} />} loading={busy} onClick={() => inputRef.current?.click()}>Upload</Button>
              <input ref={inputRef} hidden type="file" multiple onChange={event => void uploadFiles(event.currentTarget.files)} />
            </Group>
          </Group>
          {error && <Alert color="red" icon={<IconAlertTriangle size={18} />}>{error}</Alert>}
          {loading ? (
            <Group justify="center" py="xl"><Loader /></Group>
          ) : files.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">This directory is empty.</Text>
          ) : (
            <Stack gap="xs">
              {files.map(file => {
                const href = file.path;
                const textFile = isViewableTextFile(file);
                return (
                  <Card
                    key={file.path}
                    withBorder
                    radius="md"
                    p="sm"
                    style={{ cursor: file.type === "directory" ? "pointer" : "default" }}
                    onClick={() => { if (file.type === "directory") setCurrentPath(file.path); }}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                        {file.type === "directory" ? (
                          <IconFolderOpen size={22} />
                        ) : isPreviewableImage(file) ? (
                          <img
                            src={href}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            style={{ width: 80, height: 60, objectFit: "contain", flex: "0 0 auto" }}
                          />
                        ) : (
                          <IconFile size={22} />
                        )}
                        <div style={{ minWidth: 0 }}>
                          <Text fw={600} truncate>{file.name}</Text>
                          <Text size="xs" c="dimmed">{file.type === "directory" ? "Directory" : formatFileSize(file.size)}</Text>
                        </div>
                      </Group>
                      <Group gap={6} wrap="nowrap">
                        {file.type === "file" && (
                          textFile ? (
                            <ActionIcon variant="light" aria-label={`Open ${file.name}`} onClick={event => { event.stopPropagation(); void openTextFile(file); }}>
                              <IconExternalLink size={17} />
                            </ActionIcon>
                          ) : (
                            <ActionIcon component="a" href={href} target="_blank" rel="noreferrer" variant="light" aria-label={`Open ${file.name}`} onClick={event => event.stopPropagation()}>
                              <IconExternalLink size={17} />
                            </ActionIcon>
                          )
                        )}
                        <ActionIcon color="red" variant="light" disabled={busy} aria-label={`Delete ${file.name}`} onClick={event => { event.stopPropagation(); void deleteFile(file); }}>
                          <IconTrash size={17} />
                        </ActionIcon>
                      </Group>
                    </Group>
                  </Card>
                );
              })}
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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function BackupPage({ onBack, onDataImported }: { onBack: () => void; onDataImported: () => Promise<void> }) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const exportData = async () => {
    try {
      const backup: LiteBackup = {
        format: "dcc-express-lite-backup",
        version: 2,
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
            if (!Array.isArray(locos)) throw new Error("invalid response");
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
            if (!isDeviceConfigurationDocument(devices)) throw new Error("invalid response");
            backup.devices = devices;
            exported.push(`${devices.devices.length} HAL devices`);
          } catch (error) {
            warnings.push(`HAL devices: ${errorMessage(error)}`);
          }
        })(),
      ]);

      if (exported.length === 0) throw new Error(`No backup data could be read. ${warnings.join("; ")}`);

      const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `dcc-express-lite-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
      showNotification({
        color: warnings.length > 0 ? "yellow" : "teal",
        title: warnings.length > 0 ? "Backup exported with warnings" : "Backup exported",
        message: `${exported.join(", ")} saved.${warnings.length > 0 ? ` Skipped: ${warnings.join("; ")}` : ""}`,
      });
    } catch (exportError) {
      showNotification({ color: "red", title: "Export failed", message: errorMessage(exportError) });
    }
  };

  const importData = async (file: File) => {
    setImporting(true);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isRecord(parsed)) {
        throw new Error("This is not a valid DCCExpressLite backup file.");
      }
      if (parsed.format !== undefined && parsed.format !== "dcc-express-lite-backup") {
        throw new Error("This is not a DCCExpressLite backup file.");
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
      if (!hasLayout && locos === null && images === null && signalLogic === null && devices === null) {
        throw new Error("The file contains no layout, locomotive, image, signal logic or HAL device data that this release understands.");
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

      if (imported.length === 0) throw new Error(`No data could be restored. ${warnings.join("; ")}`);
      if (locos !== null) await onDataImported();
      showNotification({
        color: warnings.length > 0 ? "yellow" : "teal",
        title: warnings.length > 0 ? "Backup imported with warnings" : "Backup imported",
        message: `${imported.join(", ")} restored.${warnings.length > 0 ? ` Skipped: ${warnings.join("; ")}` : ""}`,
      });
    } catch (importError) {
      showNotification({ color: "red", title: "Import failed", message: errorMessage(importError) });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  return (
    <Stack gap="lg">
      <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={18} />} onClick={onBack} className="back-button">
        Back to home
      </Button>
      <PageTitle icon={<IconDownload size={24} />} title="Export / Import" subtitle="Back up or restore all user data" />
      <Card withBorder radius={5} p="lg">
        <Stack gap="md">
          <div>
            <Title order={4}>Layout, locomotives, images, signal logic and devices</Title>
            <Text size="sm" c="dimmed" mt={4}>
              Export the complete layout, locomotive list, images, signal automation rules and HAL device configuration into one JSON file, or restore them from an earlier backup.
            </Text>
          </div>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Button size="lg" variant="light" color="teal" leftSection={<IconDownload size={18} />} onClick={() => void exportData()}>
              Export backup
            </Button>
            <Button size="lg" variant="light" color="blue" leftSection={<IconUpload size={18} />} loading={importing} onClick={() => importInputRef.current?.click()}>
              Import backup
            </Button>
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

      if (!response.ok) throw new Error("The device did not return its network settings.");

      const data = await response.json() as NetworkSettingsDto;
      setSettings(data);
      setSsid(data.ssid);
      setPassword("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load network settings.");
    } finally {
      setLoading(false);
    }
  }, []);

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
        title: "Network saved",
        message: "The EX-CSB1 is restarting. Reconnect through your local Wi-Fi and open dccex.local.",
        autoClose: 9000,
      });
      setSettings(current => current ? { ...current, configured: true, ssid: ssid.trim(), hasPassword: true, restartPending: true } : current);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save network settings.");
      setSaving(false);
    }
  };

  const resetSettings = async () => {
    if (!window.confirm("Clear the saved network and restart in DCCEX hotspot mode?")) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/settings/network/reset", { method: "POST" });
      const result = await response.json() as ApiResponse;

      if (!response.ok || !result.ok) throw new Error(result.message || "Could not clear network settings.");

      showNotification({
        color: "teal",
        title: "Hotspot mode restored",
        message: "The EX-CSB1 is restarting. Join its DCCEX hotspot again.",
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
        <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={18} />} onClick={onBack} className="back-button">
          Back to home
        </Button>
        <Badge
          color={statusColor(status)}
          variant={status === "connected" ? "light" : "filled"}
          className={status === "connected" ? "" : "lite-ws-alert"}
        >
          {formatStatus(status)}
        </Badge>
      </Group>

      <PageTitle icon={<IconSettings size={24} />} title="Settings" subtitle="Device and local network" />

      <Card withBorder radius="xl" p="lg">
        <Stack gap="md">
          <Group justify="space-between">
            <div>
              <Title order={4}>Local Wi-Fi network</Title>
              <Text size="sm" c="dimmed">Saved securely on the EX-CSB1</Text>
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
                <Alert color="teal" icon={<IconCheck size={18} />} title="Local network configured">
                  Currently saved: <strong>{settings.ssid}</strong>
                </Alert>
              )}

              {error && (
                <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Network settings">
                  {error}
                </Alert>
              )}

              <TextInput
                label="Wi-Fi name (SSID)"
                placeholder="Your local network"
                value={ssid}
                onChange={event => setSsid(event.currentTarget.value)}
                maxLength={32}
                leftSection={<IconRouter size={17} />}
                disabled={saving}
                required
              />

              <PasswordInput
                label="Wi-Fi password"
                placeholder={settings?.hasPassword ? "Leave blank to keep the saved password" : "8â€“63 characters"}
                description={settings?.hasPassword ? "The saved password is never sent back to the browser." : undefined}
                value={password}
                onChange={event => setPassword(event.currentTarget.value)}
                minLength={8}
                maxLength={63}
                disabled={saving}
              />

              <Alert color="blue" variant="light" icon={<IconWifi size={18} />}>
                After saving, the device restarts and this hotspot disappears. Join your local Wi-Fi, then open <strong>http://dccex.local</strong> or the IP shown on the EX-CSB1 display.
              </Alert>

              <Button
                size="md"
                leftSection={<IconDeviceFloppy size={19} />}
                loading={saving}
                disabled={!ssid.trim() || (!settings?.hasPassword && password.length < 8)}
                onClick={() => void saveSettings()}
              >
                Save network and restart
              </Button>

              <Divider label="Recovery" labelPosition="center" />

              <Button variant="light" color="red" disabled={saving || !settings?.configured} onClick={() => void resetSettings()}>
                Return to DCCEX hotspot mode
              </Button>
            </>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [status, setStatus] = useState<WsConnectionStatus>(wsClient.getStatus());
  const [locos, setLocos] = useState<Loco[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [locoEditorOpened, setLocoEditorOpened] = useState(false);
  const [driveLayoutOpen, setDriveLayoutOpen] = useState(false);
  const [version, setVersion] = useState("development");

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
    if (!response.ok) throw new Error("Could not load locomotives from the EX-CSB1.");
    return response.json() as Promise<Loco[]>;
  }, []);

  const saveLocosForEditor = useCallback(async (nextLocos: Loco[]): Promise<void> => {
    const response = await fetch("/api/locos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextLocos),
    });
    if (!response.ok) throw new Error("Could not save locomotives to the EX-CSB1.");
  }, []);

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
  }, [loadLocos]);

  const navigate = (nextPage: Page) => {
    if (nextPage !== "drive") setDriveLayoutOpen(false);
    window.location.hash = nextPage === "home" ? "" : nextPage;
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const renderPage = () => {
    if (page === "settings") return <SettingsPage onBack={() => navigate("home")} status={status} />;

    if (page === "files") return <FilesPage onBack={() => navigate("home")} />;

    if (page === "backup") return <BackupPage onBack={() => navigate("home")} onDataImported={loadLocos} />;

    if (page === "programming") return <ProgrammingPage onBack={() => navigate("home")} status={status} />;

    if (page === "device-config") return <DeviceConfigurationPage onBack={() => navigate("home")} />;

    if (page === "layout") return <LiteLayoutPage version={version} locos={locos} onBack={() => navigate("home")} onOpenLocoEditor={() => setLocoEditorOpened(true)} />;

    if (page === "drive") {
      return (
        <Stack className="mobile-drive-page" gap="md">
          <RuntimeLayoutOverlay
            locos={locos}
            open={driveLayoutOpen}
          />
          {/* <Card withBorder radius="lg" p="sm">
            <Group justify="space-between" align="center" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Back to home" onClick={() => navigate("home")}>
                  <IconArrowLeft size={21} />
                </ActionIcon>
                <Title order={3}>Mobile controller</Title>
              </Group>
              <Group gap="xs" wrap="nowrap">
                {status !== "connected" && (
                  <Badge color="red" variant="filled" className="lite-ws-alert">
                    {formatStatus(status)}
                  </Badge>
                )}
              </Group>
            </Group>
          </Card> */}

          <ActionIcon
            className="mobile-back-fab"
            size={46}
            radius="xl"
            variant="filled"
            color="dark"
            aria-label="Back to home"
            title="Back to home"
            onClick={() => navigate("home")}
          >
            <IconArrowLeft size={24} />
          </ActionIcon>
          {loadState === "loading" && locos.length === 0 ? (
            <Card withBorder radius="xl" p="xl"><Stack align="center"><Loader /><Text c="dimmed">Loading locomotivesâ€¦</Text></Stack></Card>
          ) : (
            <Box className="mobile-loco-panel">
              <LocoPanel locos={locos} mobileViewport />
            </Box>
          )}
          {loadState === "error" && (
            <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={() => void loadLocos()}>Retry loading locomotives</Button>
          )}
          <ActionIcon
            className="mobile-layout-fab"
            size={58}
            radius="xl"
            variant="filled"
            color={driveLayoutOpen ? "red" : "teal"}
            aria-label={driveLayoutOpen ? "Close layout panel" : "Open layout panel"}
            title={driveLayoutOpen ? "Close layout panel" : "Open layout panel"}
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
    // <Box className={`mobile-shell${page === "layout" ? " layout-shell" : ""}`}>
    <Box
      className={`mobile-shell${page === "layout" ? " layout-shell" : ""
        }${page === "drive" ? " drive-shell" : ""
        }${page === "device-config" ? " device-config-shell" : ""
        }`}
    >



      <Stack gap="md">
        <Box className="mobile-content">{renderPage()}</Box>
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
