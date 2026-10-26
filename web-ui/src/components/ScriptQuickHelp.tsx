import { useState } from "react";
import i18next from "i18next";
import { Accordion, Alert, Button, Code, Group, List, ScrollArea, Stack, Table, Text, TextInput } from "@mantine/core";
import { IconBook2, IconHelpCircle, IconX } from "@tabler/icons-react";
import AppModal from "@/components/common/AppModal";

type ScriptHelpItem = {
  syntax: string;
  description: string;
  insert: string;
};

const SCRIPT_HELP_ITEMS: ScriptHelpItem[] = [
  {
    syntax: "async function name()",
    get description() { return i18next.t("ui.createsANamedAsynchronousTaskThatCanUseAwait"); },
    insert: "async function taskName() {\n  \n}",
  },
  {
    syntax: "await delay(ms)",
    get description() { return i18next.t("ui.waitsWithoutBlockingTheUiPauseResumeRemainsCooperativeAround"); },
    insert: "await delay(1000);",
  },
  {
    syntax: "await Promise.all([...])",
    get description() { return i18next.t("ui.runsMultipleAsynchronousTasksInParallelAndWaitsForAll"); },
    insert: "await Promise.all([\n  task1(),\n  task2(),\n]);",
  },
  {
    syntax: "isFinishing()",
    description: "Returns true when the global Automation Control Finishing mode is active.",
    insert: "if (isFinishing()) {\n  return;\n}",
  },
  {
    syntax: "isRunning()",
    description: "Returns true while global automation mode is normal. Use it around a sequence loop so Finishing completes the current sequence without starting another one.",
    insert: "while (isRunning()) {\n  await runSequence();\n}",
  },
  {
    syntax: "await switchMan([turnouts], async sw => { ... })",
    description:
      "Waits until every requested turnout is free, atomically locks the complete group, runs the callback, then automatically releases the group when the callback finishes or throws.",
    insert:
      "await switchMan([10, 11], async sw => {\n  setInfo(\"Váltókörzet beállítása\");\n\n  await sw.setTurnout(10, true);\n  await sw.setTurnout(11, false);\n\n  dcc.setLoco(18, 30, \"forward\");\n  await dcc.waitForSensor(33, true);\n});",
  },
  {
    syntax: "await switchMan([turnouts], async sw => { ... }, timeoutMs)",
    description:
      "Like switchMan(...), but throws when the complete turnout group cannot be acquired within timeoutMs.",
    insert:
      "await switchMan([10, 11], async sw => {\n  await sw.setTurnout(10, true);\n  await sw.setTurnout(11, false);\n  await dcc.waitForSensor(33, true);\n}, 30000);",
  },
  {
    syntax: "await sw.setTurnout(address, closed)",
    description:
      "Sets a turnout owned by the current SwitchMan section. Use this inside switchMan(...) instead of dcc.setTurnout(...).",
    insert: "await sw.setTurnout(10, true);",
  },
  {
    syntax: "await setRoute(name)",
    description:
      "Sets the named RouteButton with the default 250 ms delay between route turnout steps.",
    insert: 'await setRoute("Bejárat 1");',
  },
  {
    syntax: "await setRoute(name, delayMs)",
    description:
      "Sets the named RouteButton and waits delayMs between route turnout steps.",
    insert: 'await setRoute("Bejárat 1", 100);',
  },

  // Blocks
  {
    syntax: "dcc.clearBlock(blockName)",
    get description() { return i18next.t("ui.clearsTheLocomotiveAssignmentFromTheNamedLayoutBlock"); },
    insert: 'dcc.clearBlock("A2");',
  },
  {
    syntax: "dcc.clearBlockTargetLoco(blockName)",
    get description() { return i18next.t("ui.clearsTheCurrentTargetLocomotiveMarkerFromTheNamedBlock"); },
    insert: 'dcc.clearBlockTargetLoco("A2");',
  },
  {
    syntax: "dcc.getBlock(blockName)",
    get description() { return i18next.t("ui.returnsTheDccLocomotiveAddressInTheNamedBlockOr"); },
    insert: 'const locoAddress = dcc.getBlock("A1");',
  },
  {
    syntax: "dcc.getBlockTargetLoco(blockName)",
    get description() { return i18next.t("ui.returnsTheLocomotiveAddressTargetedToTheNamedBlockOr"); },
    insert: 'const targetLoco = dcc.getBlockTargetLoco("A2");',
  },
  {
    syntax: "dcc.resetBlocks()",
    get description() { return i18next.t("ui.clearsAllRuntimeBlockToLocomotiveAssignments"); },
    insert: "dcc.resetBlocks();",
  },
  {
    syntax: "dcc.setBlock(blockName, locoAddress)",
    get description() { return i18next.t("ui.movesTheLocomotiveAssignmentToTheNamedLayoutBlockBy"); },
    insert: 'dcc.setBlock("A2", 10);',
  },
  {
    syntax: "dcc.setBlockTargetLoco(blockName, locoAddress)",
    get description() { return i18next.t("ui.marksALocomotiveAsHeadingToTheNamedBlockUntil"); },
    insert: 'dcc.setBlockTargetLoco("A2", 10);',
  },

  // Sensors
  {
    syntax: "dcc.getSensor(address)",
    get description() { return i18next.t("ui.scriptGetSensorStatesHelp"); },
    insert: "const state = dcc.getSensor(1); // true=ON, false=OFF, null=UNKNOWN, undefined=NOT FOUND",
  },
  {
    syntax: "dcc.onSensorChanged(address, callback)",
    get description() { return i18next.t("ui.scriptOnSensorChangedHelp"); },
    insert: "dcc.onSensorChanged(1, async (on, address) => {\n  await dcc.setVpin(111, on);\n  log(`Sensor ${address}: ${on ? 'ON' : 'OFF'}`);\n});",
  },
  {
    syntax: "dcc.setSensor(address, on)",
    get description() { return i18next.t("ui.setsASensorStateThroughTheHubRuntimeApiPhysical"); },
    insert: "dcc.setSensor(100, true);",
  },
  {
    syntax: "dcc.waitForSensor(address, on, timeoutMs?)",
    get description() { return i18next.t("ui.waitsEventDrivenUntilTheCachedSensorStateMatchesThe"); },
    insert: "await dcc.waitForSensor(100, true, 10000);",
  },

  // Turnouts
  {
    syntax: "dcc.onTurnoutChanged(address, callback)",
    get description() {
      return i18next.language.startsWith("hu")
        ? "Váltóállapot-változás figyelése cím alapján. A callback (closed, address) paramétereket kap; a visszatérési érték egy leiratkozó függvény."
        : "Subscribe to turnout state changes by address. The callback receives (closed, address); returns an unsubscribe function.";
    },
    insert: "dcc.onTurnoutChanged(7, async (closed, address) => {\n  log(`Turnout ${address}: ${closed ? 'CLOSED' : 'THROWN'}`);\n});",
  },
  {
    syntax: "dcc.getTurnout(address)",
    get description() { return i18next.t("ui.returnsTheLogicalTurnoutStateFromTheLocalCacheTrue"); },
    insert: "const closed = dcc.getTurnout(20);",
  },
  {
    syntax: "dcc.isClosed(address)",
    get description() { return i18next.t("ui.returnsTrueWhenTheConfiguredTurnoutIsLogicallyClosed"); },
    insert: "if (dcc.isClosed(20)) {\n  \n}",
  },
  {
    syntax: "dcc.isThrown(address)",
    get description() { return i18next.t("ui.returnsTrueWhenTheConfiguredTurnoutIsLogicallyThrown"); },
    insert: "if (dcc.isThrown(20)) {\n  \n}",
  },
  {
    syntax: "dcc.setClosed(address)",
    get description() { return i18next.t("ui.setsTheTurnoutLogicallyClosedUsingItsLayoutOutputConfiguration"); },
    insert: "dcc.setClosed(20);",
  },
  {
    syntax: "dcc.setThrown(address)",
    get description() { return i18next.t("ui.setsTheTurnoutLogicallyThrownUsingItsLayoutOutputConfiguration"); },
    insert: "dcc.setThrown(20);",
  },
  {
    syntax: "dcc.setTurnout(address, closed)",
    get description() { return i18next.t("ui.setsTheLogicalTurnoutStateThroughTheLayoutConfigurationTrue"); },
    insert: "dcc.setTurnout(20, true);",
  },
  {
    syntax: "dcc.waitForClosed(address, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalTurnoutStateBecomesClosed"); },
    insert: "await dcc.waitForClosed(20, 10000);",
  },
  {
    syntax: "dcc.waitForThrown(address, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalTurnoutStateBecomesThrown"); },
    insert: "await dcc.waitForThrown(20, 10000);",
  },
  {
    syntax: "dcc.waitForTurnout(address, closed, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalTurnoutStateMatchesTheRequested"); },
    insert: "await dcc.waitForTurnout(20, true, 10000);",
  },

  // Signals
  {
    syntax: "dcc.getSignalState(address)",
    get description() { return i18next.t("ui.returnsTheLocallyCachedLogicalSignalStateLabelForExample"); },
    insert: "const state = dcc.getSignalState(100);",
  },
  {
    syntax: "dcc.isGreen(address)",
    get description() { return i18next.t("ui.returnsTrueWhenTheConfiguredSignalIsLogicallyGreen"); },
    insert: "if (dcc.isGreen(100)) {\n  \n}",
  },
  {
    syntax: "dcc.isRed(address)",
    get description() { return i18next.t("ui.returnsTrueWhenTheConfiguredSignalIsLogicallyRed"); },
    insert: "if (dcc.isRed(100)) {\n  \n}",
  },
  {
    syntax: "dcc.isSignalState(address, stateName)",
    get description() { return i18next.t("ui.returnsTrueWhenTheSignalSCachedLogicalStateMatches"); },
    insert: 'if (dcc.isSignalState(100, "Slow")) {\n  \n}',
  },
  {
    syntax: "dcc.isWhite(address)",
    get description() { return i18next.t("ui.returnsTrueWhenTheConfiguredSignalIsLogicallyWhite"); },
    insert: "if (dcc.isWhite(100)) {\n  \n}",
  },
  {
    syntax: "dcc.isYellow(address)",
    get description() { return i18next.t("ui.returnsTrueWhenTheConfiguredSignalIsLogicallyYellow"); },
    insert: "if (dcc.isYellow(100)) {\n  \n}",
  },
  {
    syntax: "dcc.setGreen(address)",
    get description() { return i18next.t("ui.setsTheConfiguredGreenStateBasicDccOutputPatternsAnd"); },
    insert: "dcc.setGreen(100);",
  },
  {
    syntax: "dcc.setRed(address)",
    get description() { return i18next.t("ui.setsTheConfiguredRedStateUsingTheSignalSLayout"); },
    insert: "dcc.setRed(100);",
  },
  {
    syntax: "dcc.setSignalAspect(address, aspect)",
    get description() { return i18next.t("ui.lowLevelEscapeHatchSendsAnExplicitDccExtendedSignal"); },
    insert: "dcc.setSignalAspect(100, 16);",
  },
  {
    syntax: "dcc.setSignalState(address, stateName)",
    get description() { return i18next.t("ui.setsAConfiguredLogicalSignalStateByNameTheLayout"); },
    insert: 'dcc.setSignalState(100, "Slow");',
  },
  {
    syntax: "dcc.setWhite(address)",
    get description() { return i18next.t("ui.setsTheConfiguredWhiteSignalState"); },
    insert: "dcc.setWhite(100);",
  },
  {
    syntax: "dcc.setYellow(address)",
    get description() { return i18next.t("ui.setsTheConfiguredYellowSignalState"); },
    insert: "dcc.setYellow(100);",
  },
  {
    syntax: "dcc.waitForGreen(address, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalSignalStateBecomesGreen"); },
    insert: "await dcc.waitForGreen(100, 10000);",
  },
  {
    syntax: "dcc.waitForRed(address, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalSignalStateBecomesRed"); },
    insert: "await dcc.waitForRed(100, 10000);",
  },
  {
    syntax: "dcc.waitForSignalState(address, stateName, timeoutMs?)",
    get description() { return i18next.t("ui.waitsEventDrivenUntilTheSignalReachesTheConfiguredLogical"); },
    insert: 'await dcc.waitForSignalState(100, "Slow", 10000);',
  },
  {
    syntax: "dcc.waitForWhite(address, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalSignalStateBecomesWhite"); },
    insert: "await dcc.waitForWhite(100, 10000);",
  },
  {
    syntax: "dcc.waitForYellow(address, timeoutMs?)",
    get description() { return i18next.t("ui.waitsUntilTheCachedLogicalSignalStateBecomesYellow"); },
    insert: "await dcc.waitForYellow(100, 10000);",
  },

  // Other explicit setters/actions
  {
    syntax: "dcc.emergencyStop()",
    get description() { return i18next.t("ui.sendsAnEmergencyStopCommand"); },
    insert: "dcc.emergencyStop();",
  },
  {
    syntax: 'dcc.sendRaw("<DCC-EX command>")',
    get description() { return i18next.t("ui.sendsARawDccExCommandThroughTheHub"); },
    insert: 'dcc.sendRaw("<s>");',
  },
  {
    syntax: "await dcc.setVpin(address, active)",
    get description() { return i18next.t("ui.scriptHelpSetVpin"); },
    insert: "await dcc.setVpin(111, true);",
  },
  {
    syntax: "dcc.setAccessory(address, active)",
    get description() { return i18next.t("ui.lowLevelBasicDccAccessorySetter"); },
    insert: "dcc.setAccessory(100, true);",
  },
  {
    syntax: 'dcc.setLoco(address, speed, "forward|reverse")',
    get description() { return i18next.t("ui.setsLocomotiveSpeedAndDirectionSpeedRangeIs0126"); },
    insert: 'dcc.setLoco(18, 30, "forward");',
  },
  {
    syntax: "dcc.setLocoFunction(address, function, active)",
    get description() { return i18next.t("ui.setsLocomotiveFunctionF0F28OnOrOff"); },
    insert: "dcc.setLocoFunction(18, 2, true);",
  },
  {
    syntax: "dcc.isPowerOn()",
    get description() { return i18next.language.startsWith("hu") ? "A MAIN pálya jelenlegi tápállapota: true = ON, false = OFF." : "Returns the current MAIN track power state: true = ON, false = OFF."; },
    insert: 'if (dcc.isPowerOn()) {\n  log("Track power is ON");\n}',
  },
  {
    syntax: "dcc.onPowerChanged(callback)",
    get description() { return i18next.language.startsWith("hu") ? "MAIN Power ON/OFF átmenetek figyelése. A callback (on) paramétert kap; a script leállításakor automatikusan leiratkozik." : "Subscribe to MAIN track Power ON/OFF transitions. The callback receives (on); automatically unsubscribes when the script stops."; },
    insert: 'dcc.onPowerChanged(async (on) => {\n  log(`POWER: ${on ? "ON" : "OFF"}`);\n});',
  },
  {
    syntax: "dcc.getVpin(address)",
    get description() { return i18next.language.startsWith("hu") ? "VPIN állapot a Hub gyorsítótárából: true = ON, false = OFF, undefined = ismeretlen. Nem közvetlen hardver-visszajelzés." : "Get cached VPIN state: true = ON, false = OFF, undefined = unknown. Not direct hardware feedback."; },
    insert: 'const on = dcc.getVpin(3000);\nlog(on === undefined ? "UNKNOWN" : on ? "ON" : "OFF");',
  },
  {
    syntax: "dcc.onVpinChanged(address, callback)",
    get description() { return i18next.language.startsWith("hu") ? "VPIN állapotváltozás figyelése. Callback: (on, address). A script leállításakor automatikusan leiratkozik." : "Subscribe to VPIN state changes. Callback: (on, address). Automatically unsubscribes when the script stops."; },
    insert: 'dcc.onVpinChanged(3000, async (on, address) => {\n  log(`VPIN ${address}: ${on ? "ON" : "OFF"}`);\n});',
  },
  {
    syntax: "dcc.setPower(on)",
    get description() { return i18next.t("ui.setsMainTrackPowerOnOrOff"); },
    insert: "dcc.setPower(true);",
  },
  {
    syntax: "dcc.setProgrammingPower(on)",
    get description() { return i18next.t("ui.setsProgrammingTrackPowerOnOrOff"); },
    insert: "dcc.setProgrammingPower(true);",
  },
  {
    syntax: "playAudio(name)",
    get description() { return i18next.t("ui.playsSdAudioNameMp3FromTheSdCardUse"); },
    insert: 'playAudio("mav_szignal");',
  },
  {
    syntax: "await playAudio(name)",
    get description() { return i18next.t("ui.waitsUntilAudioPlaybackFinishes"); },
    insert: 'await playAudio("mav_szignal");',
  },
  {
    syntax: "log(value, ...)",
    get description() { return i18next.t("ui.writesValuesToTheBrowserConsoleWithTheAutomationName"); },
    insert: 'log("Automation reached this point");',
  },
  {
    syntax: "setInfo(message)",
    get description() { return i18next.t("ui.showsATemporaryMessageOnTheRunningAutomationCardA"); },
    insert: 'setInfo("Mozdony indul a B1 blokkba");',
  },
].sort((a, b) =>
  a.syntax.localeCompare(b.syntax, undefined, {
    sensitivity: "base",
  })
);


type Props = { opened: boolean; onClose: () => void; onInsert: (snippet: string) => void; flowMode?: boolean };

export default function ScriptQuickHelp({ opened, onClose, onInsert, flowMode = false }: Props) {
  const [helpFilter, setHelpFilter] = useState("");
  return (
    <>
      <AppModal
        opened={opened}
        onClose={() => onClose()}
        closeOnClickOutside={false}
        closeOnEscape={false}
        title={
          <Group gap="xs" wrap="nowrap">
            <IconBook2 size={19} />
            <Text fw={700}>{i18next.t("ui.scriptQuickHelp")}</Text>
          </Group>
        }
        size="68vw"
        centered
        draggable
        resetPositionOnOpen
        styles={{
          content: {
            height: "70dvh",
            maxHeight: "70dvh",
            display: "flex",
            flexDirection: "column",
          },
          body: {
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          },
        }}
      >
        <Stack
          gap="xs"
          style={{ flex: 1, minHeight: 0 }}
        >
          <Text size="sm" c="dimmed"> {i18next.t("ui.clickARowToInsertItsSyntaxAtTheCurrent")} </Text>
          {flowMode && <Alert color="cyan" variant="light">{i18next.language.startsWith("hu") ? "Flow Function: a payload a bemenet; return payload továbbengedi az ágat, return null megállítja. A dcc API itt is használható." : "Flow Function: payload is the input; return payload continues the branch, return null stops it. The dcc API is available here too."}</Alert>}

          <Accordion variant="contained" radius="sm">
            <Accordion.Item value="script-guidance">
              <Accordion.Control icon={<IconHelpCircle size={19} />}>
                {flowMode ? (i18next.language.startsWith("hu") ? "Flow Function útmutató" : "Flow Function guidance") : (i18next.language.startsWith("hu") ? "Script útmutató és indítási módok" : "Script guidance and startup modes")}
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  <Alert color="blue" variant="light">
                    {i18next.t("ui.canonicalCommandsUseExplicitSetGetWaitNamesSignalAnd")}
                  </Alert>
                  {flowMode ? (
                    <Alert color="cyan" variant="light">
                      {i18next.language.startsWith("hu")
                        ? "Az engedélyezett Flow aktív és figyeli az eseményeket. A Function node kódja akkor fut le, amikor a Flow végrehajtása eléri a node-ot; nincs külön MANUAL vagy AUTOSTART indítási módja. A payload a bemenet, a return payload továbbengedi, a return null megállítja az ágat."
                        : "An enabled Flow stays active and listens for events. A Function node runs when flow execution reaches that node; it has no separate MANUAL or AUTOSTART script mode. The input is payload; return payload continues and return null stops the branch."}
                    </Alert>
                  ) : (
                    <>
                  <Text fw={600} size="sm">
                    {i18next.language.startsWith("hu") ? "Script indítási módok és Power" : "Script startup and track power"}
                  </Text>
                  <List size="sm" spacing="xs" withPadding>
                    {(i18next.language.startsWith("hu")
                      ? [
                          "MANUAL: kézzel vagy API-ból indul; Power OFF megszakítja, Power ON nem indítja újra.",
                          "AUTOSTART: az engedélyezett script a Hub indulásakor indul, Power OFF alatt is fut tovább; az onPowerChanged megkapja az OFF/ON átmeneteket.",
                          "Power ON nem indít második példányt; külön Power Start mód nincs.",
                          "A command station kapcsolatának megszakadása az AUTOSTART scripteket is leállíthatja.",
                          "A script forrásának vagy beállításainak módosítása csak a következő indításkor érvényesül. A már futó scriptpéldány változatlan marad; az új kód használatához le kell állítani és újra kell indítani.",
                        ]
                      : [
                          "MANUAL: starts manually or via API; Power OFF aborts it, and Power ON does not restart it.",
                          "AUTOSTART: an enabled script starts with the Hub and keeps running through Power OFF; onPowerChanged receives OFF/ON transitions.",
                          "Power ON does not start a second instance; there is no separate Power Start mode.",
                          "A command station disconnect may also stop AUTOSTART scripts.",
                          "Changes to script source or settings take effect only on the next start. Already running script instances remain unchanged; stop and restart to apply new code.",
                        ]).map((item, index) => (
                      <List.Item key={index}>{item}</List.Item>
                    ))}
                  </List>
                    </>
                  )}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>

          <TextInput
            aria-label={i18next.t("ui.scriptHelpSearch")}
            placeholder={i18next.t("ui.scriptHelpSearch")}
            value={helpFilter}
            onChange={event => setHelpFilter(event.currentTarget.value)}
          />

          <ScrollArea
            style={{ flex: 1, minHeight: 0 }}
            type="always"
            scrollbarSize={9}
          >
            <Table
              striped
              highlightOnHover
              withTableBorder
              withColumnBorders
              stickyHeader
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: "44%" }}> {i18next.t("ui.syntax")} </Table.Th>
                  <Table.Th>{i18next.t("ui.description")}</Table.Th>
                </Table.Tr>
              </Table.Thead>

              <Table.Tbody>
                {SCRIPT_HELP_ITEMS.filter(item => {
                  const search = helpFilter.trim().toLocaleLowerCase();
                  return !search || `${item.syntax} ${item.description}`.toLocaleLowerCase().includes(search);
                }).map(item => (
                  <Table.Tr key={item.syntax}>
                    <Table.Td
                      onClick={() => onInsert(item.insert)}
                      style={{ cursor: "pointer" }}
                    >
                      <Code>{item.syntax}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {item.description}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>

          <Group justify="space-between">
            <Text size="xs" c="dimmed"> {i18next.t("ui.entriesAreSortedAlphabeticallyBySyntaxLegacyShortSetterAliases")} </Text>
            <Button
              variant="default"
              leftSection={<IconX size={15} />}
              onClick={() => onClose()}
            > {i18next.t("ui.closeHelp")} </Button>
          </Group>
        </Stack>
      </AppModal>
    </>
  );
}
