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

import {
  movementLegIgnoredSafetySensors,
  movementLegSafetySensors,
} from "../../services/movementSafety";

import MovementRouteRow from "./MovementRouteRow";
import MovementSelectedResourceEditor from "./MovementSelectedResourceEditor";

import {
  useMovementRuntimeState,
} from "./MovementRuntimeControls";

import {
  useMovementTranslation,
} from "./movementI18n";

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
  const mt =
    useMovementTranslation();

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

      void Promise.resolve()
        .then(
          () =>
            createCurrentClientLayoutSnapshot(
              layout
            )
        )
        .then(
          layoutSnapshot =>
            loadMovementPlan(
              page,
              layoutSnapshot
            )
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

  const selectedPhysicalResource =
    plan &&
    selectedResourceKey
      ? plan.resources.find(
          resource =>
            resource.key ===
            selectedResourceKey
        ) ??
        null
      : null;

  /*
   * Route-vector selection is keyed by the physical resource. A composite
   * SectionPart+Block node therefore selects the SectionPart first, then the
   * logical block overlay at the same physical routeOrder for editing block
   * conditions/actions.
   */
  const selectedResource =
    selectedPhysicalResource ===
      null ||
    plan ===
      null
      ? null
      : selectedPhysicalResource.kind ===
          "segment"
        ? (
            plan.blocks.find(
              block =>
                block.routeOrder ===
                  selectedPhysicalResource.routeOrder &&
                block.sensorAddress !==
                  null &&
                selectedPhysicalResource.detectors.includes(
                  block.sensorAddress
                )
            ) ??
            selectedPhysicalResource
          )
        : selectedPhysicalResource;

  const selectedSafetyLeg =
    selectedResource ===
      null ||
    plan ===
      null
      ? null
      : selectedResource.kind ===
          "block"
        ? (
            plan.legs.find(
              leg =>
                leg.from.key ===
                selectedResource.key
            ) ??
            null
          )
        : (
            plan.legs.find(
              leg =>
                leg.resources.some(
                  resource =>
                    resource.key ===
                    selectedResource.key
                )
            ) ??
            null
          );

  const selectedSafetySensors =
    selectedSafetyLeg ===
      null
      ? []
      : movementLegSafetySensors(
          selectedSafetyLeg
        );

  const selectedSafetyTargetName =
    selectedSafetyLeg?.to.name ??
    null;

  const selectedSafetyTargetSensor =
    selectedSafetyLeg?.to.sensorAddress ??
    null;

  const selectedIgnoredSafetySensors =
    selectedSafetyLeg ===
      null
      ? []
      : movementLegIgnoredSafetySensors(
          page,
          selectedSafetyLeg
        );

  const updateIgnoredSafetySensors =
    (
      ignoredSensors:
        number[]
    ): void => {
      if (
        selectedSafetyLeg?.from.blockId ===
          null ||
        selectedSafetyLeg?.from.blockId ===
          undefined ||
        selectedSafetyLeg.to.blockId ===
          null ||
        selectedSafetyLeg.to.blockId ===
          undefined
      ) {
        return;
      }

      const fromBlockId =
        selectedSafetyLeg.from.blockId;

      const toBlockId =
        selectedSafetyLeg.to.blockId;

      const nextRules =
        page.safetyRules.filter(
          rule =>
            !(
              rule.fromBlockId ===
                fromBlockId &&
              rule.toBlockId ===
                toBlockId
            )
        );

      const effectiveIgnoredSensors =
        ignoredSensors.filter(
          sensor =>
            selectedSafetySensors.includes(
              sensor
            )
        );

      if (
        effectiveIgnoredSensors.length >
          0
      ) {
        nextRules.push({
          fromBlockId,
          toBlockId,
          ignoredSensors:
            effectiveIgnoredSensors,
        });
      }

      onChange({
        ...page,
        safetyRules:
          nextRules,
      });
    };

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
              {mt("movementBuildingPlan")}
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
            {mt("movementLegacyTopologyHint")}
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
              {mt("movementSelectRouteBlocks")}
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
                    {mt("movementRouteSelectionHint")}
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
                    {mt("movementSelectedResourceMissing")}
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
                    safetySensors={
                      selectedSafetySensors
                    }
                    safetyTargetName={
                      selectedSafetyTargetName
                    }
                    safetyTargetSensor={
                      selectedSafetyTargetSensor
                    }
                    ignoredSafetySensors={
                      selectedIgnoredSafetySensors
                    }
                    onIgnoredSafetySensorsChange={
                      updateIgnoredSafetySensors
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
