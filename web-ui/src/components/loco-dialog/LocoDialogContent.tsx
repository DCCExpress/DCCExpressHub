import {
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Image,
  ScrollArea,
} from "@mantine/core";

import type { LocoTrainType } from "@domain/types";
import LocoActionsTab from "./LocoActionsTab";
import LocoFunctionsTab from "./LocoFunctionsTab";
import LocoGeneralTab from "./LocoGeneralTab";
import LocoCounterSettingsPanel from "./LocoCounterSettingsPanel";
import LocoStatisticsTable from "./LocoStatisticsTable";
import LocoCalibrationTab from "./LocoCalibrationTab";
import LocoDecoderProfileEditor from "./LocoDecoderProfileEditor";
import LocoListPanel from "./LocoListPanel";
import type { useLocoDialogState } from "./useLocoDialogState";

type TFunction = (key: string) => string;
type LocoDialogState = ReturnType<typeof useLocoDialogState>;

type LocoDialogContentProps = {
  state: LocoDialogState;
  t: TFunction;
};

const TRAIN_TYPE_OPTIONS: LocoTrainType[] = [
  "passenger",
  "freight",
  "mixed",
  "maintenance",
  "other",
];

const formatDateTime = (value: string | undefined): string => {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString();
};

export default function LocoDialogContent({
  state,
  t,
}: LocoDialogContentProps) {
  const {
    locos,
    functionBindings,
    setFunctionBindings,
    selectedId,
    setSelectedId,
    selectedLoco,
    activeActionHook,
    setActiveActionHook,
    functionOptions,
    updateSelectedLoco,
    addLoco,
    deleteSelectedLoco,
    addFunction,
    updateFunction,
    deleteFunction,
    updateActionsForHook,
    sendFunctionTest,
    setImageFromFile,
  } = state;

  const trainTypeOptions = TRAIN_TYPE_OPTIONS.map(value => ({
    value,
    label: t(`locodialog.trainTypes.${value}`),
  }));

  return (
    <Group className="loco-dialog-content" align="stretch" gap="md" wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
      <LocoListPanel
        locos={locos}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onAdd={addLoco}
        
        onDeleteSelected={deleteSelectedLoco}
        hasSelectedLoco={!!selectedLoco}
        t={t}
      />

      <Card withBorder p="md" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        {!selectedLoco ? (
          <Stack align="center" justify="center" h="100%">
            <Text fw={600}>{t("locodialog.noselectedloco")}.</Text>
          </Stack>
        ) : (
          <Tabs defaultValue="general" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <Tabs.List>
              <Tabs.Tab value="general">{t("locodialog.tabs.general")}</Tabs.Tab>
              <Tabs.Tab value="functions">{t("locodialog.tabs.functions")}</Tabs.Tab>
              <Tabs.Tab value="actions">{t("locodialog.tabs.actions")}</Tabs.Tab>
              <Tabs.Tab value="extended">{t("locodialog.extended_params")}</Tabs.Tab>
              <Tabs.Tab value="counters">Mechanical counters</Tabs.Tab>
              <Tabs.Tab value="calibration">{t("locodialog.tabs.calibration")}</Tabs.Tab>
              <Tabs.Tab value="decoder">Decoder CV</Tabs.Tab>
              <Tabs.Tab value="statistics" style={{ marginLeft: "auto" }}>
                {t("locodialog.tabs.statistics")}
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="general" pt="md" style={{ flex: 1, minHeight: 0 }}>
              <LocoGeneralTab
                loco={selectedLoco}
                onPatch={updateSelectedLoco}
                onImageFile={setImageFromFile}
                t={t}
              />
            </Tabs.Panel>

            <Tabs.Panel value="functions" pt="md" style={{ flex: 1, minHeight: 0 }}>
              <LocoFunctionsTab
                functions={selectedLoco.functions}
                functionBindings={functionBindings}
                onFunctionBindingsChange={setFunctionBindings}
                onAddFunction={addFunction}
                onUpdateFunction={updateFunction}
                onDeleteFunction={deleteFunction}
                onFunctionTest={(fn, active) => void sendFunctionTest(fn, active)}
                t={t}
              />
            </Tabs.Panel>

            <Tabs.Panel value="actions" pt="md" style={{ flex: 1, minHeight: 0 }}>
              <LocoActionsTab
                selectedLoco={selectedLoco}
                activeActionHook={activeActionHook}
                onActiveActionHookChange={setActiveActionHook}
                functionOptions={functionOptions}
                onUpdateActionsForHook={updateActionsForHook}
              />
            </Tabs.Panel>

            <Tabs.Panel
              value="extended"
              pt="md"
              style={{
                flex: 1,
                minHeight: 0,
              }}
            >
              <ScrollArea h="100%">
                <Stack gap="md" maw={620}>

                {/* <Card withBorder radius="md" p="xs">
                  <Image
                    src="/images/loco-info-card.png"
                    alt="Locomotive direction and occupancy sensor diagram"
                    fit="contain"
                    radius="sm"
                  />
                </Card> */}
                <Select
                  label={t("locodialog.train_type")}
                  data={trainTypeOptions}
                  value={selectedLoco.trainType ?? "passenger"}
                  allowDeselect={false}
                  onChange={value => updateSelectedLoco({ trainType: (value ?? "passenger") as LocoTrainType })}
                />

                <NumberInput
                  label="Train length (mm)"
                  value={selectedLoco.length}
                  min={1}
                  onChange={value => { const length = Math.max(1, Number(value) || 1); updateSelectedLoco({ length, ...(selectedLoco.trainDetectionOffsetMm !== undefined && selectedLoco.trainDetectionOffsetMm > length ? { trainDetectionOffsetMm: length } : {}) }); }}
                />

                <NumberInput
                  label="Detection point from train forward end (mm)"
                  description="Measured along the entire train from the end facing the locomotive's Forward direction. 0 = forward end; train length = reverse end."
                  value={selectedLoco.trainDetectionOffsetMm ?? ""}
                  min={0}
                  max={Math.max(0, selectedLoco.length)}
                  allowDecimal={true}
                  onChange={value => updateSelectedLoco({ trainDetectionOffsetMm: value === "" ? undefined : Math.max(0, Math.min(selectedLoco.length, Number(value) || 0)) })}
                />
                <NumberInput
                  label="Train clearance margin (mm)"
                  description="Additional distance reserved around the train envelope. Used by future block release safety logic."
                  value={selectedLoco.trainClearanceMarginMm ?? 30}
                  min={0}
                  max={2000}
                  onChange={value => updateSelectedLoco({ trainClearanceMarginMm: Math.max(0, Number(value) || 0) })}
                />
                <Text size="xs" c="dimmed">
                  The detection point must be confirmed for this train. Missing or uncertain geometry must not authorize automatic block release.
                </Text>

                </Stack>
              </ScrollArea>
            </Tabs.Panel>

            <Tabs.Panel value="counters" pt="md" style={{ flex: 1, minHeight: 0 }}>
              <ScrollArea h="100%" type="auto">
                <Stack gap="md" maw={620}>
                <TextInput
                  label={t("locodialog.last_run_at")}
                  value={formatDateTime(selectedLoco.lastRunAt)}
                  placeholder={t("locodialog.last_run_at_empty")}
                  disabled
                  readOnly
                />

                <LocoCounterSettingsPanel
                  loco={selectedLoco}
                  onPatch={updateSelectedLoco}
                  t={t}
                />
                </Stack>
              </ScrollArea>
            </Tabs.Panel>

            <Tabs.Panel
              value="calibration"
              pt="md"
              style={{
                flex: 1,
                minHeight: 0,
              }}
            >
              <LocoCalibrationTab
                loco={selectedLoco}
                onPatch={updateSelectedLoco}
              />
            </Tabs.Panel>

            <Tabs.Panel value="decoder" pt="md" style={{flex:1,minHeight:0}}>
              <ScrollArea h="100%" type="auto">
                <LocoDecoderProfileEditor loco={selectedLoco} />
              </ScrollArea>
            </Tabs.Panel>

            <Tabs.Panel
              value="statistics"
              pt="md"
              style={{
                flex: 1,
                minHeight: 0,
              }}
            >
              <LocoStatisticsTable
                locos={locos}
                t={t}
              />
            </Tabs.Panel>
          </Tabs>
        )}
      </Card>
    </Group>
  );
}
