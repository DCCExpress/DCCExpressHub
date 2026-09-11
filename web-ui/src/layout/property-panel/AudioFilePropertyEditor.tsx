import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconDeviceSdCard,
  IconFolder,
  IconFolderOpen,
  IconPlayerPlayFilled,
  IconRefresh,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { BaseElementView } from "../../models/editor/core/BaseElementView";
import type { IEditableProperty } from "../../models/editor/elements/PropertyDescriptor";
import type { PropertyChangeHandler } from "./propertyPanelTypes";

type StorageEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
};

type StorageListing = {
  path: string;
  available?: boolean;
  message?: string;
  entries: StorageEntry[];
};

type AudioFilePropertyEditorProps = {
  prop: IEditableProperty;
  selectedElement: BaseElementView;
  onChange: PropertyChangeHandler;
};

const AUDIO_EXTENSIONS = /\.(?:mp3|wav|ogg|flac|m4a|aac)$/i;
const DEFAULT_AUDIO_PATH = "/sd/audio";
const SD_ROOT = "/sd";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parentPath(path: string): string {
  if (path === SD_ROOT || path === "/") return SD_ROOT;

  const normalized = path.replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");

  if (slash <= SD_ROOT.length) {
    return SD_ROOT;
  }

  return normalized.slice(0, slash);
}

export default function AudioFilePropertyEditor({
  prop,
  selectedElement,
  onChange,
}: AudioFilePropertyEditorProps) {
  const value = String((selectedElement as any)[prop.key] ?? "");
  const [opened, setOpened] = useState(false);
  const [currentPath, setCurrentPath] = useState(DEFAULT_AUDIO_PATH);
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(async (path: string, allowAudioFallback = false) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/list?path=${encodeURIComponent(path)}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        if (allowAudioFallback && path === DEFAULT_AUDIO_PATH) {
          setCurrentPath(SD_ROOT);
          await loadDirectory(SD_ROOT, false);
          return;
        }

        throw new Error(`Could not open ${path} (HTTP ${response.status}).`);
      }

      const listing = await response.json() as StorageListing;

      if (listing.available === false) {
        setEntries([]);
        setError(listing.message || "SD card is not available.");
        return;
      }

      const visibleEntries = (listing.entries ?? [])
        .filter(entry => entry.type === "directory" || AUDIO_EXTENSIONS.test(entry.name))
        .sort((left, right) => {
          if (left.type !== right.type) {
            return left.type === "directory" ? -1 : 1;
          }

          return left.name.localeCompare(right.name);
        });

      setEntries(visibleEntries);
    } catch (loadError) {
      setEntries([]);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!opened) return;

    setCurrentPath(DEFAULT_AUDIO_PATH);
    void loadDirectory(DEFAULT_AUDIO_PATH, true);
  }, [opened, loadDirectory]);

  const selectedName = useMemo(() => {
    if (!value) return "No audio file selected";
    const parts = value.split("/").filter(Boolean);
    return parts.at(-1) ?? value;
  }, [value]);

  const chooseFile = (entry: StorageEntry) => {
    onChange(prop, entry.path);
    setOpened(false);
  };

  return (
    <>
      <Stack gap={6}>
        <TextInput
          label={prop.label}
          value={value}
          placeholder="/sd/audio/horn.mp3"
          readOnly={prop.readonly === true}
          onChange={event => onChange(prop, event.currentTarget.value)}
          rightSection={
            <Group gap={2} wrap="nowrap">
              <ActionIcon
                size="sm"
                variant="subtle"
                title="Choose audio from Hub SD card"
                disabled={prop.readonly === true}
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpened(true);
                }}
              >
                <IconFolderOpen size={16} />
              </ActionIcon>

              <ActionIcon
                size="sm"
                variant="subtle"
                title="Test audio"
                disabled={!value}
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  prop.callback?.();
                }}
              >
                <IconPlayerPlayFilled size={16} />
              </ActionIcon>
            </Group>
          }
          rightSectionWidth={68}
        />

        <Text size="xs" c="dimmed">
          Selected: {selectedName}. The picker reads audio files directly from the Hub SD card.
        </Text>
      </Stack>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Choose audio from SD card"
        size="lg"
        centered
        returnFocus={false}
      >
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              <IconDeviceSdCard size={20} />
              <Text fw={700} truncate>{currentPath}</Text>
            </Group>

            <Group gap={6} wrap="nowrap">
              <ActionIcon
                variant="light"
                title="Parent folder"
                disabled={currentPath === SD_ROOT || loading}
                onClick={() => {
                  const nextPath = parentPath(currentPath);
                  setCurrentPath(nextPath);
                  void loadDirectory(nextPath);
                }}
              >
                <IconArrowLeft size={17} />
              </ActionIcon>

              <ActionIcon
                variant="light"
                title="Refresh"
                loading={loading}
                onClick={() => void loadDirectory(currentPath)}
              >
                <IconRefresh size={17} />
              </ActionIcon>
            </Group>
          </Group>

          {error && (
            <Alert color="red" icon={<IconAlertTriangle size={18} />}>
              {error}
            </Alert>
          )}

          <ScrollArea.Autosize mah="55vh">
            {loading ? (
              <Group justify="center" py="xl"><Loader /></Group>
            ) : entries.length === 0 ? (
              <Text c="dimmed" ta="center" py="xl">
                No supported audio files or folders found here.
              </Text>
            ) : (
              <Stack gap={6}>
                {entries.map(entry => (
                  <Card
                    key={entry.path}
                    withBorder
                    p="sm"
                    radius="sm"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      if (entry.type === "directory") {
                        setCurrentPath(entry.path);
                        void loadDirectory(entry.path);
                      } else {
                        chooseFile(entry);
                      }
                    }}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                        {entry.type === "directory" ? (
                          <IconFolder size={20} />
                        ) : (
                          <IconPlayerPlayFilled size={18} />
                        )}

                        <div style={{ minWidth: 0 }}>
                          <Text fw={600} truncate>{entry.name}</Text>
                          <Text size="xs" c="dimmed">
                            {entry.type === "directory" ? "Directory" : formatFileSize(entry.size)}
                          </Text>
                        </div>
                      </Group>

                      {entry.type === "file" && (
                        <Badge variant="light" color="violet">AUDIO</Badge>
                      )}
                    </Group>
                  </Card>
                ))}
              </Stack>
            )}
          </ScrollArea.Autosize>

          <Group justify="space-between">
            <Button
              variant="subtle"
              onClick={() => {
                setCurrentPath(SD_ROOT);
                void loadDirectory(SD_ROOT);
              }}
            >
              SD root
            </Button>
            <Button variant="default" onClick={() => setOpened(false)}>Cancel</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
