import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";

import {
  showNotification,
} from "@mantine/notifications";

import {
  IconDeviceFloppy,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";

import {
  createMovementPage,
  normalizeMovementDocument,
  type MovementDocument,
  type MovementPage,
} from "../../domain/movement";

import {
  loadAutomationMovement,
  saveAutomationMovement,
} from "../../services/automationApi";

import MovementRouteEditor from "./MovementRouteEditor";

import "../../styles/movementEditor.css";

type Props = {
  opened: boolean;
  onClose: () => void;
  initialPageId?: string | null;
  onSaved?: (
    document:
      MovementDocument
  ) => void;
};

export default function MovementEditorDialog({
  opened,
  onClose,
  initialPageId,
  onSaved,
}: Props) {
  const [
    document,
    setDocument,
  ] =
    useState<MovementDocument>(
      () =>
        normalizeMovementDocument(
          null
        )
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      false
    );

  const [
    saving,
    setSaving,
  ] =
    useState(
      false
    );

  const activePage =
    document.pages.find(
      page =>
        page.id ===
        document.activePageId
    ) ??
    document.pages[0];

  const load =
    useCallback(
      async (): Promise<void> => {
        setLoading(
          true
        );

        try {
          const loaded =
            normalizeMovementDocument(
              await loadAutomationMovement()
            );

          const activePageId =
            initialPageId &&
            loaded.pages.some(
              page =>
                page.id ===
                initialPageId
            )
              ? initialPageId
              : loaded.activePageId;

          setDocument({
            ...loaded,
            activePageId,
          });
        } catch (error) {
          showNotification({
            color: "red",
            title:
              "Movement load failed",
            message:
              error instanceof Error
                ? error.message
                : String(
                    error
                  ),
          });
        } finally {
          setLoading(
            false
          );
        }
      },
      [
        initialPageId,
      ]
    );

  useEffect(
    () => {
      if (
        opened
      ) {
        void load();
      }
    },
    [
      opened,
      load,
    ]
  );

  const save =
    async (): Promise<void> => {
      setSaving(
        true
      );

      try {
        const normalized =
          normalizeMovementDocument(
            document
          );

        await saveAutomationMovement(
          normalized
        );

        setDocument(
          normalized
        );

        onSaved?.(
          normalized
        );

        showNotification({
          color: "teal",
          title:
            "Movement saved",
          message:
            activePage?.name ??
            "",
        });
      } catch (error) {
        showNotification({
          color: "red",
          title:
            "Movement save failed",
          message:
            error instanceof Error
              ? error.message
              : String(
                  error
                ),
        });
      } finally {
        setSaving(
          false
        );
      }
    };

  const updatePage =
    (
      next:
        MovementPage
    ): void => {
      setDocument(
        current => ({
          ...current,
          pages:
            current.pages.map(
              page =>
                page.id ===
                next.id
                  ? next
                  : page
            ),
        })
      );
    };

  const addPage =
    (): void => {
      const page =
        createMovementPage(
          `Movement ${document.pages.length + 1}`
        );

      setDocument(
        current => ({
          ...current,
          pages: [
            ...current.pages,
            page,
          ],
          activePageId:
            page.id,
        })
      );
    };

  const deletePage =
    (): void => {
      if (
        !activePage ||
        document.pages.length <=
          1
      ) {
        showNotification({
          color: "orange",
          title:
            "The last movement cannot be deleted",
          message:
            "",
        });

        return;
      }

      if (
        !window.confirm(
          `Delete movement "${activePage.name}"?`
        )
      ) {
        return;
      }

      const pages =
        document.pages.filter(
          page =>
            page.id !==
            activePage.id
        );

      setDocument(
        current => ({
          ...current,
          pages,
          activePageId:
            pages[0]!.id,
        })
      );
    };

  return (
    <Modal
      opened={
        opened
      }
      onClose={
        onClose
      }
      title="Movement / Dispatcher Editor"
      fullScreen
      returnFocus={
        false
      }
    >
      <Stack
        gap="sm"
        h="calc(100dvh - 76px)"
      >
        <Group
          justify="space-between"
          align="center"
          wrap="wrap"
        >
          <Group
            gap="xs"
          >
            <Button
              size="xs"
              variant="light"
              leftSection={
                <IconPlus
                  size={14}
                />
              }
              onClick={
                addPage
              }
            >
              New page
            </Button>

            <ActionIcon
              variant="light"
              color="red"
              disabled={
                document.pages.length <=
                1
              }
              onClick={
                deletePage
              }
              title="Delete page"
            >
              <IconTrash
                size={16}
              />
            </ActionIcon>
          </Group>

          <Group
            gap="xs"
          >
            <Button
              size="xs"
              variant="light"
              color="gray"
              leftSection={
                <IconRefresh
                  size={14}
                />
              }
              loading={
                loading
              }
              onClick={
                () =>
                  void load()
              }
            >
              Reload
            </Button>

            <Button
              size="xs"
              color="teal"
              leftSection={
                <IconDeviceFloppy
                  size={14}
                />
              }
              loading={
                saving
              }
              onClick={
                () =>
                  void save()
              }
            >
              Save
            </Button>
          </Group>
        </Group>

        <Tabs
          value={
            document.activePageId
          }
          onChange={
            value => {
              if (
                value
              ) {
                setDocument(
                  current => ({
                    ...current,
                    activePageId:
                      value,
                  })
                );
              }
            }
          }
          keepMounted={
            false
          }
        >
          <Tabs.List
            className="movement-page-tabs"
          >
            {
              document.pages.map(
                page => (
                  <Tabs.Tab
                    key={
                      page.id
                    }
                    value={
                      page.id
                    }
                  >
                    <Group
                      gap={6}
                      wrap="nowrap"
                    >
                      <span>
                        {
                          page.name
                        }
                      </span>

                      <span
                        className={
                          page.enabled
                            ? "movement-enabled-dot"
                            : "movement-disabled-dot"
                        }
                      />
                    </Group>
                  </Tabs.Tab>
                )
              )
            }
          </Tabs.List>
        </Tabs>

        {
          activePage && (
            <>
              <CardHeader
                page={
                  activePage
                }
                onChange={
                  updatePage
                }
              />

              <Divider />

              <ScrollArea
                style={{
                  flex: 1,
                  minHeight: 0,
                }}
                type="always"
              >
                <MovementRouteEditor
                  page={
                    activePage
                  }
                  onChange={
                    updatePage
                  }
                />
              </ScrollArea>
            </>
          )
        }
      </Stack>
    </Modal>
  );
}

function CardHeader({
  page,
  onChange,
}: {
  page:
    MovementPage;
  onChange: (
    page:
      MovementPage
  ) => void;
}) {
  return (
    <Group
      align="flex-end"
      wrap="wrap"
    >
      <TextInput
        label="Movement name"
        value={
          page.name
        }
        onChange={
          event =>
            onChange({
              ...page,
              name:
                event.currentTarget.value,
            })
        }
        style={{
          flex:
            "1 1 320px",
        }}
      />

      <NumberInput
        label="Cruise speed"
        description="DCC speed step (0..126)"
        min={0}
        max={126}
        value={
          page.speed
        }
        onChange={
          value =>
            onChange({
              ...page,
              speed:
                Math.max(
                  0,
                  Math.min(
                    126,
                    Math.round(
                      Number(value) ||
                      0
                    )
                  )
                ),
            })
        }
        w={150}
      />

      <Switch
        checked={
          page.enabled
        }
        color="green"
        label={
          page.enabled
            ? "Enabled"
            : "Disabled"
        }
        onChange={
          event =>
            onChange({
              ...page,
              enabled:
                event.currentTarget.checked,
            })
        }
      />

      <Text
        size="xs"
        c="dimmed"
      >
        Page ID: {page.id}
      </Text>
    </Group>
  );
}
