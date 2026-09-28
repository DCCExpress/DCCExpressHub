import {
  useEffect,
  useState,
} from "react";

import {
  Alert,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";

import type {
  LayoutView,
} from "../../models/editor/core/LayoutView";

import {
  createCurrentClientLayoutSnapshot,
} from "../../services/clientRouteGraphCache";

import type {
  MovementAction,
  MovementBlockRule,
  MovementPage,
  MovementResourceEventRule,
} from "../../domain/movement";

import {
  loadAutomationSensorCatalog,
  type AutomationSensorOption,
} from "../../services/automationSensorCatalog";

import {
  loadMovementPlan,
  type MovementPlan,
} from "../../services/movementPlan";

import MovementRouteRow from "./MovementRouteRow";
import MovementSelectedResourceEditor from "./MovementSelectedResourceEditor";

import {
  useMovementRuntimeState,
} from "./MovementRuntimeControls";

const SHOW_LEGACY_ROUTE_CARDS =
  false;

type Props = {
  page:
    MovementPage;
  selectedResourceKey:
    string | null;
  layout:
    LayoutView;
  onChange: (
    page:
      MovementPage
  ) => void;
};

export default function MovementRouteEditor({
  page,
  selectedResourceKey,
  layout,
  onChange,
}: Props) {
  const runtimeState =
    useMovementRuntimeState(
      page.id
    );

  const [
    sensorCatalog,
    setSensorCatalog,
  ] =
    useState<
      AutomationSensorOption[]
    >([]);

  const [
    plan,
    setPlan,
  ] =
    useState<
      MovementPlan |
      null
    >(
      null
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true
    );

  const [
    loadError,
    setLoadError,
  ] =
    useState<string | null>(
      null
    );

  useEffect(
    () => {
      let disposed =
        false;

      void loadAutomationSensorCatalog()
        .then(
          sensors => {
            if (
              !disposed
            ) {
              setSensorCatalog(
                sensors
              );
            }
          }
        )
        .catch(
          error => {
            if (
              !disposed
            ) {
              setLoadError(
                error instanceof Error
                  ? error.message
                  : String(
                      error
                    )
              );
            }
          }
        );

      return () => {
        disposed =
          true;
      };
    },
    []
  );

  const routeSignature =
    [
      page.routeKey,
      page.fromBlockId ??
        0,
      ...page.viaBlockIds,
      page.toBlockId ??
        0,
    ].join(
      ":"
    );

  useEffect(
    () => {
      let disposed =
        false;

      if (
        page.fromBlockId ===
          null ||
        page.toBlockId ===
          null
      ) {
        setPlan(
          null
        );

        setLoading(
          false
        );

        setLoadError(
          null
        );

        return () => {
          disposed =
            true;
        };
      }

      setLoading(
        true
      );

      setLoadError(
        null
      );

      const layoutSnapshot =
        createCurrentClientLayoutSnapshot(
          layout
        );

      void loadMovementPlan(
        page,
        layoutSnapshot
      )
        .then(
          nextPlan => {
            if (
              !disposed
            ) {
              setPlan(
                nextPlan
              );
            }
          }
        )
        .catch(
          error => {
            if (
              !disposed
            ) {
              setPlan(
                null
              );

              setLoadError(
                error instanceof Error
                  ? error.message
                  : String(
                      error
                    )
              );
            }
          }
        )
        .finally(
          () => {
            if (
              !disposed
            ) {
              setLoading(
                false
              );
            }
          }
        );

      return () => {
        disposed =
          true;
      };
    },
    [
      routeSignature,
      layout,
    ]
  );

  const updateResourceEventRules =
    (
      resourceKey: string,
      rules:
        MovementResourceEventRule[]
    ): void => {
      onChange({
        ...page,
        resourceEventRules: [
          ...page.resourceEventRules.filter(
            rule =>
              rule.resourceKey !==
              resourceKey
          ),
          ...rules,
        ],
      });
    };

  const updateRule =
    (
      rule:
        MovementBlockRule
    ): void => {
      const exists =
        page.blockRules.some(
          current =>
            current.blockId ===
            rule.blockId
        );

      onChange({
        ...page,
        blockRules:
          exists
            ? page.blockRules.map(
                current =>
                  current.blockId ===
                  rule.blockId
                    ? rule
                    : current
              )
            : [
                ...page.blockRules,
                rule,
              ],
      });
    };

  const updateActionsForResource =
    (
      resourceKey: string,
      actions:
        MovementAction[]
    ): void => {
      onChange({
        ...page,
        actions: [
          ...page.actions.filter(
            action =>
              action.resourceKey !==
              resourceKey
          ),
          ...actions,
        ],
      });
    };

  const selectedResource =
    plan &&
    selectedResourceKey
      ? plan.resources.find(
          resource =>
            resource.key ===
            selectedResourceKey
        ) ??
        null
      : null;

  const selectedDefaultRule:
    MovementBlockRule | null =
    selectedResource?.blockId !==
      null &&
    selectedResource?.blockId !==
      undefined &&
    plan
      ? {
          blockId:
            selectedResource.blockId,
          approachWhen:
            plan.legs.find(
              leg =>
                leg.to.blockId ===
                selectedResource.blockId
            )?.approachWhen.map(
              condition => ({
                ...condition,
              })
            ) ??
            [],
          arrivedWhen:
            plan.legs.find(
              leg =>
                leg.to.blockId ===
                selectedResource.blockId
            )?.arrivedWhen.map(
              condition => ({
                ...condition,
              })
            ) ??
            [],
          departWhen:
            plan.legs.find(
              leg =>
                leg.from.blockId ===
                selectedResource.blockId
            )?.departWhen.map(
              condition => ({
                ...condition,
              })
            ) ??
            [],
          leaveWhen:
            plan.legs.find(
              leg =>
                leg.from.blockId ===
                selectedResource.blockId
            )?.leaveWhen.map(
              condition => ({
                ...condition,
              })
            ) ??
            [],
        }
      : null;

  return (
    <Stack
      gap="sm"
      className="movement-route-editor"
    >
      {
        loading && (
          <Group
            gap="xs"
          >
            <Loader
              size="sm"
            />

            <Text
              size="sm"
              c="dimmed"
            >
              Building physical movement plan...
            </Text>
          </Group>
        )
      }

      {
        loadError && (
          <Alert
            color="red"
          >
            {
              loadError
            }
          </Alert>
        )
      }

      {
        plan &&
        plan.topologyVersion <
          3 && (
          <Alert
            color="yellow"
            variant="light"
          >
            Legacy route topology: generate and save the route graph once to store exact turnout passage order.
          </Alert>
        )
      }

      {
        page.fromBlockId ===
          null ||
        page.toBlockId ===
          null
          ? (
            <Alert
              color="blue"
              variant="light"
            >
              Select the route blocks in the page header.
            </Alert>
          )
          : plan && (
            <>
              {
                selectedResourceKey ===
                  null && (
                  <Alert
                    color="blue"
                    variant="light"
                    className="movement-vector-selection-hint"
                  >
                    Click a block or segment in the route vector above to edit its conditions, events and actions.
                  </Alert>
                )
              }

              {
                selectedResourceKey !==
                  null &&
                selectedResource ===
                  null && (
                  <Alert
                    color="orange"
                    variant="light"
                  >
                    The selected route-vector item is not available in the current movement plan. Select it again from the vector.
                  </Alert>
                )
              }

              {
                selectedResource && (
                  <MovementSelectedResourceEditor
                    resource={
                      selectedResource
                    }
                    isSource={
                      selectedResource.key ===
                      `block:${page.fromBlockId}`
                    }
                    isDestination={
                      selectedResource.key ===
                      `block:${page.toBlockId}`
                    }
                    rule={
                      selectedResource.blockId ===
                        null
                        ? null
                        : page.blockRules.find(
                            rule =>
                              rule.blockId ===
                              selectedResource.blockId
                          ) ??
                          null
                    }
                    defaultRule={
                      selectedDefaultRule
                    }
                    sensorCatalog={
                      sensorCatalog
                    }
                    resourceEventRules={
                      page.resourceEventRules.filter(
                        rule =>
                          rule.resourceKey ===
                          selectedResource.key
                      )
                    }
                    onResourceEventRulesChange={
                      rules =>
                        updateResourceEventRules(
                          selectedResource.key,
                          rules
                        )
                    }
                    actions={
                      page.actions.filter(
                        action =>
                          action.resourceKey ===
                          selectedResource.key
                      )
                    }
                    onRuleChange={
                      updateRule
                    }
                    onActionsChange={
                      actions =>
                        updateActionsForResource(
                          selectedResource.key,
                          actions
                        )
                    }
                  />
                )
              }

              {
                SHOW_LEGACY_ROUTE_CARDS && (
                  <div
                    className="movement-route-timeline movement-route-timeline-legacy"
                  >
                    {
                      plan.resources.map(
                        (
                          resource,
                          index
                        ) => {
                          const blockId =
                            resource.blockId;

                          return (
                            <MovementRouteRow
                              key={
                                `${resource.key}:${index}`
                              }
                              pageId={
                                page.id
                              }
                              resource={
                                resource
                              }
                              index={
                                index
                              }
                              isSource={
                                resource.key ===
                                `block:${page.fromBlockId}`
                              }
                              isDestination={
                                resource.key ===
                                `block:${page.toBlockId}`
                              }
                              isCurrent={
                                runtimeState.status !==
                                  "idle" &&
                                runtimeState.activeRouteResourceKey ===
                                  resource.key
                              }
                              rule={
                                blockId ===
                                null
                                  ? null
                                  : page.blockRules.find(
                                      rule =>
                                        rule.blockId ===
                                        blockId
                                    ) ??
                                    null
                              }
                              sensorCatalog={
                                sensorCatalog
                              }
                              actions={
                                page.actions.filter(
                                  action =>
                                    action.resourceKey ===
                                    resource.key
                                )
                              }
                              onRuleChange={
                                updateRule
                              }
                              onActionsChange={
                                actions =>
                                  updateActionsForResource(
                                    resource.key,
                                    actions
                                  )
                              }
                            />
                          );
                        }
                      )
                    }
                  </div>
                )
              }
            </>
          )
      }
    </Stack>
  );
}
