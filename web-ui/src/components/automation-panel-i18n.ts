import i18next from "i18next";

export type AutomationPanelTextKey =
  | "controlTitle"
  | "running"
  | "paused"
  | "finishing"
  | "finishingDescription"
  | "startWithAll"
  | "startWithAllDescription"
  | "startAll"
  | "resumeAll"
  | "stopAll"
  | "abortAll"
  | "controlDescription"
  | "noStartableScripts"
  | "noPausedScripts"
  | "noRunningScripts"
  | "startAllStarted"
  | "resumeAllResumed"
  | "stopAllPaused"
  | "abortAllAborted"
  | "estopAlreadyActive"
  | "estopRequested"
  | "estopSendFailed"
  | "estopUnknown"
  | "settingSaveFailed";

type TranslationTable =
  Record<
    AutomationPanelTextKey,
    string
  >;

const translations:
  Record<
    "en" | "hu" | "de",
    TranslationTable
  > = {
    en: {
      controlTitle:
        "Automation control",
      running:
        "Running",
      paused:
        "Paused",
      finishing:
        "Finishing",
      finishingDescription:
        "Let active scripts finish their current sequence, but allow scripts to detect that no new sequence should be started.",
      startWithAll:
        "Start with All",
      startWithAllDescription:
        "Include this script when Start All is pressed.",
      startAll:
        "Start All",
      resumeAll:
        "Resume All",
      stopAll:
        "Stop All",
      abortAll:
        "Abort All",
      controlDescription:
        "Start All starts only enabled idle scripts. Resume All resumes every paused script. Stop All pauses every running script. Finishing lets scripts complete their current sequence without starting another one when they use isRunning()/isFinishing(). Abort All aborts every active script and requests Emergency Stop when safe.",
      noStartableScripts:
        "No enabled idle scripts can be started.",
      noPausedScripts:
        "No paused scripts.",
      noRunningScripts:
        "No running scripts.",
      startAllStarted:
        "{count} script(s) started.",
      resumeAllResumed:
        "{count} script(s) resumed.",
      stopAllPaused:
        "{count} running script(s) paused.",
      abortAllAborted:
        "{count} active script(s) aborted.",
      estopAlreadyActive:
        "E-STOP was already active.",
      estopRequested:
        "Emergency Stop requested.",
      estopSendFailed:
        "Emergency Stop could not be sent.",
      estopUnknown:
        "E-STOP state unknown; no toggle sent.",
      settingSaveFailed:
        "Start with All setting could not be saved.",
    },

    hu: {
      controlTitle:
        "Automatizálás vezérlés",
      running:
        "Fut",
      paused:
        "Szünetel",
      finishing:
        "Finishing",
      finishingDescription:
        "A futó szkriptek befejezhetik az aktuális szekvenciát, de a szkript érzékeli, hogy új szekvenciát már ne indítson.",
      startWithAll:
        "Start with All",
      startWithAllDescription:
        "A Start All ezt a szkriptet is elindíthatja.",
      startAll:
        "Start All",
      resumeAll:
        "Resume All",
      stopAll:
        "Stop All",
      abortAll:
        "Abort All",
      controlDescription:
        "A Start All csak az engedélyezett, álló szkripteket indítja. A Resume All minden szünetelő szkriptet folytat. A Stop All minden futó szkriptet megállít. Finishing módban az isRunning()/isFinishing() használatával az aktuális szekvencia még befejeződik, de új már nem indul. Az Abort All minden aktív szkriptet megszakít és biztonságosan E-STOP-ot kér.",
      noStartableScripts:
        "Nincs elindítható, engedélyezett szkript.",
      noPausedScripts:
        "Nincs szünetelő szkript.",
      noRunningScripts:
        "Nincs futó szkript.",
      startAllStarted:
        "{count} szkript elindítva.",
      resumeAllResumed:
        "{count} szkript folytatva.",
      stopAllPaused:
        "{count} futó szkript megállítva.",
      abortAllAborted:
        "{count} aktív szkript megszakítva.",
      estopAlreadyActive:
        "Az E-STOP már aktív volt.",
      estopRequested:
        "Vészleállítás elküldve.",
      estopSendFailed:
        "A vészleállítást nem sikerült elküldeni.",
      estopUnknown:
        "Az E-STOP állapota ismeretlen, ezért nem küldtem toggle parancsot.",
      settingSaveFailed:
        "A Start with All beállítást nem sikerült menteni.",
    },

    de: {
      controlTitle:
        "Automatisierungssteuerung",
      running:
        "Läuft",
      paused:
        "Pausiert",
      finishing:
        "Finishing",
      finishingDescription:
        "Laufende Skripte dürfen ihre aktuelle Sequenz beenden; Skripte können erkennen, dass keine neue Sequenz mehr gestartet werden soll.",
      startWithAll:
        "Start with All",
      startWithAllDescription:
        "Dieses Skript bei Start All mitstarten.",
      startAll:
        "Start All",
      resumeAll:
        "Resume All",
      stopAll:
        "Stop All",
      abortAll:
        "Abort All",
      controlDescription:
        "Start All startet nur aktivierte, wartende Skripte. Resume All setzt alle pausierten Skripte fort. Stop All pausiert alle laufenden Skripte. Im Finishing-Modus kann mit isRunning()/isFinishing() die aktuelle Sequenz beendet werden, ohne eine neue zu starten. Abort All bricht alle aktiven Skripte ab und fordert bei sicherem Zustand einen Notstopp an.",
      noStartableScripts:
        "Keine aktivierten wartenden Skripte können gestartet werden.",
      noPausedScripts:
        "Keine pausierten Skripte.",
      noRunningScripts:
        "Keine laufenden Skripte.",
      startAllStarted:
        "{count} Skript(e) gestartet.",
      resumeAllResumed:
        "{count} Skript(e) fortgesetzt.",
      stopAllPaused:
        "{count} laufende Skript(e) pausiert.",
      abortAllAborted:
        "{count} aktive Skript(e) abgebrochen.",
      estopAlreadyActive:
        "Der Notstopp war bereits aktiv.",
      estopRequested:
        "Notstopp angefordert.",
      estopSendFailed:
        "Der Notstopp konnte nicht gesendet werden.",
      estopUnknown:
        "Notstoppzustand unbekannt; kein Toggle gesendet.",
      settingSaveFailed:
        "Die Start-with-All-Einstellung konnte nicht gespeichert werden.",
    },
  };

function language():
  "en" | "hu" | "de" {
  const raw =
    (
      i18next.resolvedLanguage ||
      i18next.language ||
      "en"
    )
      .toLowerCase()
      .split("-")[0];

  return raw === "hu" ||
    raw === "de"
      ? raw
      : "en";
}

export function automationPanelText(
  key: AutomationPanelTextKey,
  values?: {
    count?: number;
  }
): string {
  let value =
    translations[
      language()
    ][key];

  if (
    values?.count !==
    undefined
  ) {
    value =
      value.replace(
        "{count}",
        String(
          values.count
        )
      );
  }

  return value;
}
