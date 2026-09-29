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
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";

import {
  showNotification,
} from "@mantine/notifications";

import i18next from "i18next";

import {
  IconCode,
  IconDeviceFloppy,
  IconListCheck,
  IconPlus,
  IconQuestionMark,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";

import type {
  LayoutView,
} from "../../models/editor/core/LayoutView";

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

import {
  loadAutomationBlockCatalog,
  type AutomationBlockOption,
} from "../../services/automationBlockCatalog";

import {
  getMovementEngineState,
} from "../../services/movementEngine";

import AppModal from "../common/AppModal";

import MovementExecutionScriptDialog from "./MovementExecutionScriptDialog";
import MovementRouteEditor from "./MovementRouteEditor";
import MovementRouteSelectDialog from "./MovementRouteSelectDialog";
import MovementRouteVectorPreview from "./MovementRouteVectorPreview";
import MovementSidebarCard from "./MovementSidebarCard";
import {
  useMovementTranslation,
} from "./movementI18n";

import "../../styles/movementEditor.css";

type Props = {
  opened: boolean;
  onClose: () => void;
  initialPageId?: string | null;
  layout:
    LayoutView;
  onSaved?: (
    document:
      MovementDocument
  ) => void;
};

export default function MovementEditorDialog({
  opened,
  onClose,
  initialPageId,
  layout,
  onSaved,
}: Props) {
  const mt =
    useMovementTranslation();

  const helpLanguage =
    (
      i18next.resolvedLanguage ??
      i18next.language ??
      "en"
    )
      .split("-")[0]
      ?.toLowerCase() ===
      "hu"
      ? "hu"
      : (
          i18next.resolvedLanguage ??
          i18next.language ??
          "en"
        )
            .split("-")[0]
            ?.toLowerCase() ===
          "de"
        ? "de"
        : "en";

  const helpUrl =
    `/help/movement.${helpLanguage}.html`;

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
    catalog,
    setCatalog,
  ] =
    useState<
      AutomationBlockOption[]
    >([]);

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

  const [
    routeSelectOpened,
    setRouteSelectOpened,
  ] =
    useState(
      false
    );

  const [
    executionScriptOpened,
    setExecutionScriptOpened,
  ] =
    useState(
      false
    );

  const [
    helpOpened,
    setHelpOpened,
  ] =
    useState(
      false
    );

  const [
    selectedRouteVectorKey,
    setSelectedRouteVectorKey,
  ] =
    useState<string | null>(
      null
    );

  const activePage =
    document.pages.find(
      page =>
        page.id ===
        document.activePageId
    ) ??
    document.pages[0];

  const activeRouteSignature =
    activePage
      ? [
          activePage.id,
          activePage.routeKey,
          activePage.fromBlockId ??
            0,
          ...activePage.viaBlockIds,
          activePage.toBlockId ??
            0,
        ].join(
          ":"
        )
      : "";

  useEffect(
    () => {
      setSelectedRouteVectorKey(
        null
      );
    },
    [
      activeRouteSignature,
    ]
  );


  const activeRouteNames =
    activePage
      ? [
          ...(activePage.fromBlockId ===
            null
            ? []
            : [
                activePage.fromBlockId,
              ]),
          ...activePage.viaBlockIds,
          ...(activePage.toBlockId ===
            null
            ? []
            : [
                activePage.toBlockId,
              ]),
        ].map(
          blockId =>
            catalog.find(
              block =>
                block.id ===
                blockId
            )?.name ??
            mt("movementBlockNumber", { id: blockId })
        )
      : [];

  const load =
    useCallback(
      async (): Promise<void> => {
        setLoading(
          true
        );

        try {
          const [
            loadedMovement,
            blocks,
          ] =
            await Promise.all([
              loadAutomationMovement(),
              loadAutomationBlockCatalog(),
            ]);

          const loaded =
            normalizeMovementDocument(
              loadedMovement
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

          setCatalog(
            blocks
          );

        } catch (error) {
          showNotification({
            color: "red",
            title:
              mt("movementLoadFailed"),
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
          normalizeMovementDocument({
            ...document,
            pages:
              document.pages.map(
                page => {
                  const runtime =
                    getMovementEngineState(
                      page.id
                    );

                  if (
                    runtime.startedAt ===
                    null
                  ) {
                    return page;
                  }

                  return {
                    ...page,
                    startedAt:
                      runtime.startedAt,
                    stoppedAt:
                      runtime.stoppedAt,
                  };
                }
              ),
          });

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
            mt("movementSaved"),
          message:
            activePage?.name ??
            mt("movementSavedCount", { count: 0 }),
        });
      } catch (error) {
        showNotification({
          color: "red",
          title:
            mt("movementSaveFailed"),
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
          mt("movementDefaultName", { number: document.pages.length + 1 })
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
        !activePage
      ) {
        return;
      }

      const runtimeState =
        getMovementEngineState(
          activePage.id
        );

      if (
        runtimeState.status ===
          "running" ||
        runtimeState.status ===
          "stopping"
      ) {
        showNotification({
          color: "orange",
          title:
            mt("movementRunningTitle"),
          message:
            mt("movementStopBeforeDelete"),
        });

        return;
      }

      if (
        !window.confirm(
          mt("movementDeleteConfirm", { name: activePage.name })
        )
      ) {
        return;
      }

      const currentIndex =
        document.pages.findIndex(
          page =>
            page.id ===
            activePage.id
        );

      const pages =
        document.pages.filter(
          page =>
            page.id !==
            activePage.id
        );

      const nextIndex =
        Math.max(
          0,
          Math.min(
            currentIndex,
            pages.length -
              1
          )
        );

      setDocument(
        current => ({
          ...current,
          pages,
          activePageId:
            pages[
              nextIndex
            ]?.id ??
            "",
        })
      );

      setSelectedRouteVectorKey(
        null
      );
    };

  return (
    <>
      <AppModal
        opened={
          helpOpened
        }
        onClose={
          () =>
            setHelpOpened(
              false
            )
        }
        title={mt("movementGeneralHelpTitle")}
        size="xl"
        centered
        draggable
        zIndex={4200}
        styles={{
          content: {
            height:
              "min(820px, 90vh)",
            overflow:
              "hidden",
          },
          body: {
            height:
              "calc(100% - 48px)",
            padding:
              0,
            overflow:
              "hidden",
          },
        }}
      >
        {
          helpOpened && (
            <iframe
              title={mt("movementGeneralHelpTitle")}
              src={
                helpUrl
              }
              className="movement-help-frame"
            />
          )
        }
      </AppModal>

      <Modal
      opened={
        opened
      }
      onClose={
        onClose
      }
      title={mt("movementEditorTitle")}
      fullScreen
      classNames={{
        header:
          "app-fullscreen-modal-header",
      }}
      returnFocus={
        false
      }
    >
      <div
        className="movement-editor-header-help"
      >
        <Tooltip
          label={mt("movementGeneralHelpButton")}
        >
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            aria-label={mt("movementGeneralHelpButton")}
            onClick={
              () =>
                setHelpOpened(
                  true
                )
            }
          >
            <IconQuestionMark
              size={16}
            />
          </ActionIcon>
        </Tooltip>
      </div>

      <div
        className="movement-editor-shell"
      >
        <aside
          className="movement-editor-sidebar"
        >
          <Text
            size="sm"
            fw={700}
          >
            {mt("movementMovementsTitle")}
          </Text>

          <Text
            size="xs"
            c="dimmed"
          >
            {
              mt(
                "movementSavedShort",
                {
                  count:
                    document.pages.length,
                }
              )
            }
          </Text>

          <ScrollArea
            className="movement-editor-sidebar-list"
            type="auto"
          >
            <Stack
              gap={6}
              py="xs"
            >
              {
                document.pages.map(
                  page => (
                    <MovementSidebarCard
                      key={
                        page.id
                      }
                      page={
                        page
                      }
                      catalog={
                        catalog
                      }
                      active={
                        page.id ===
                        document.activePageId
                      }
                      onSelect={
                        () =>
                          setDocument(
                            current => ({
                              ...current,
                              activePageId:
                                page.id,
                            })
                          )
                      }
                    />
                  )
                )
              }
            </Stack>
          </ScrollArea>

          <Group
            gap={6}
            grow
            className="movement-editor-sidebar-actions"
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
              {mt("movementNewMovement")}
            </Button>

            <Button
              size="xs"
              variant="light"
              color="red"
              leftSection={
                <IconTrash
                  size={14}
                />
              }
              onClick={
                deletePage
              }
            >
              {mt("movementDelete")}
            </Button>
          </Group>
        </aside>

        <section
          className="movement-editor-main"
        >
          {
            !activePage && (
              <Stack
                align="center"
                justify="center"
                gap="sm"
                h="100%"
                p="xl"
              >
                <Text
                  fw={700}
                >
                  {mt("movementNoConfigured")}
                </Text>

                <Text
                  size="sm"
                  c="dimmed"
                  ta="center"
                >
                  {mt("movementEmptyListValid")}
                </Text>

                <Group
                  gap="sm"
                >
                  <Button
                    size="sm"
                    leftSection={
                      <IconPlus
                        size={16}
                      />
                    }
                    onClick={
                      addPage
                    }
                  >
                    {mt("movementNewMovement")}
                  </Button>

                  <Button
                    size="sm"
                    color="teal"
                    leftSection={
                      <IconDeviceFloppy
                        size={16}
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
                    {mt("movementSaveEmptyList")}
                  </Button>
                </Group>
              </Stack>
            )
          }

          {
            activePage && (
              <>
                <div
                  className="movement-editor-page-header"
                >
                  <Group
                    align="flex-end"
                    wrap="wrap"
                    gap="sm"
                  >
                    <TextInput
                      label={mt("movementName")}
                      value={
                        activePage.name
                      }
                      onChange={
                        event =>
                          updatePage({
                            ...activePage,
                            name:
                              event.currentTarget.value,
                          })
                      }
                      className="movement-editor-name"
                    />

                    <NumberInput
                      label={mt("movementCruiseSpeed")}
                      min={0}
                      max={126}
                      value={
                        activePage.speed
                      }
                      onChange={
                        value =>
                          updatePage({
                            ...activePage,
                            speed:
                              Math.max(
                                0,
                                Math.min(
                                  126,
                                  Math.round(
                                    Number(
                                      value
                                    ) ||
                                    0
                                  )
                                )
                              ),
                          })
                      }
                      w={120}
                    />

                    <Switch
                      checked={
                        activePage.enabled
                      }
                      color="green"
                      label={
                        activePage.enabled
                          ? mt("enabled")
                          : mt("disabled")
                      }
                      onChange={
                        event =>
                          updatePage({
                            ...activePage,
                            enabled:
                              event.currentTarget.checked,
                          })
                      }
                    />

                    <Button
                      size="xs"
                      variant="light"
                      leftSection={
                        <IconListCheck
                          size={14}
                        />
                      }
                      onClick={
                        () =>
                          setRouteSelectOpened(
                            true
                          )
                      }
                    >
                      {
                        mt("movementSelectRoute")
                      }
                    </Button>

                    <Button
                      size="xs"
                      variant="light"
                      color="violet"
                      leftSection={
                        <IconCode
                          size={14}
                        />
                      }
                      disabled={
                        activePage.fromBlockId ===
                          null ||
                        activePage.toBlockId ===
                          null
                      }
                      onClick={
                        () =>
                          setExecutionScriptOpened(
                            true
                          )
                      }
                    >
                      {mt("movementScript")}
                    </Button>

                    <div
                      className="movement-editor-header-spacer"
                    />

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
                      {mt("movementReload")}
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
                      {mt("movementSave")}
                    </Button>
                  </Group>

                  <Group
                    gap="xs"
                    mt="sm"
                    wrap="wrap"
                  >
                    <Text
                      size="xs"
                      fw={700}
                      c="dimmed"
                    >
                      {
                        mt("movementRoute")
                      }
                    </Text>

                    <Text
                      size="sm"
                      fw={700}
                    >
                      {
                        activeRouteNames.length >
                          0
                          ? activeRouteNames.join(
                              " → "
                            )
                          : mt("movementNoRouteSelected")
                      }
                    </Text>
                  </Group>

                  <MovementRouteVectorPreview
                    page={
                      activePage
                    }
                    layout={
                      layout
                    }
                    selectedKey={
                      selectedRouteVectorKey
                    }
                    onItemClick={
                      item =>
                        setSelectedRouteVectorKey(
                          item.key
                        )
                    }
                  />

                  <MovementExecutionScriptDialog
                    opened={
                      executionScriptOpened
                    }
                    page={
                      activePage
                    }
                    onClose={
                      () =>
                        setExecutionScriptOpened(
                          false
                        )
                    }
                  />

                  <MovementRouteSelectDialog
                    opened={
                      routeSelectOpened
                    }
                    document={
                      document
                    }
                    page={
                      activePage
                    }
                    layout={
                      layout
                    }
                    onClose={
                      () =>
                        setRouteSelectOpened(
                          false
                        )
                    }
                    onSelect={
                      updatePage
                    }
                  />
                </div>

                <Divider />

                <ScrollArea
                  className="movement-editor-content"
                  type="always"
                >
                  <MovementRouteEditor
                    page={
                      activePage
                    }
                    layout={
                      layout
                    }
                    selectedResourceKey={
                      selectedRouteVectorKey
                    }
                    onChange={
                      updatePage
                    }
                  />
                </ScrollArea>
              </>
            )
          }
        </section>
      </div>
    </Modal>
    </>
  );
}
