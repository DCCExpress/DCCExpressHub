import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import hu from "./i18n/hu.json";
import en from "./i18n/en.json";
import de from "./i18n/de.json";
import signalLogicHu from "./i18n/signalLogic.hu.json";
import signalLogicEn from "./i18n/signalLogic.en.json";
import signalLogicDe from "./i18n/signalLogic.de.json";

type SupportedLanguage = "en" | "hu" | "de";

const supportedLanguages: SupportedLanguage[] = ["en", "hu", "de"];

function normalizeLanguage(language: string | null | undefined): SupportedLanguage | null {
  const shortCode = language?.split("-")[0]?.toLowerCase();

  if (supportedLanguages.includes(shortCode as SupportedLanguage)) {
    return shortCode as SupportedLanguage;
  }

  return null;
}

function readInitialLanguage(): SupportedLanguage {
  const urlLanguage = normalizeLanguage(
    new URLSearchParams(window.location.search).get("lang")
  );

  if (urlLanguage) {
    localStorage.setItem("lang", urlLanguage);
    return urlLanguage;
  }

  return normalizeLanguage(localStorage.getItem("lang")) ?? "en";
}

const savedLang = readInitialLanguage();

const enTranslation = {
  ...en,
  home: {
    ...en.home,
    thanksDescription:
      "DCCExpress stands on the shoulders of excellent open-source tools, modern web technologies, and a good dose of AI-assisted brainstorming.",
  },
  homeHub: {
    commandStation: "EX-CSB1 command station",
    description: "Control locomotives, operate the layout and configure the EX-CSB1.",
    reloadPage: "Reload page",
    configureCsb1: "Configure EX-CSB1 connection",
    powerOnTitle: "Turn track power on",
    powerOffTitle: "Turn track power off",
    status: {
      connected: "Online",
      connecting: "Connecting",
      reconnecting: "Reconnecting",
      error: "Connection error",
      disconnected: "Offline",
    },
    cards: {
      layout: { title: "Layout Panel", description: "Build the track plan and operate turnouts" },
      mobile: {
        title: "Mobile controller",
        empty: "Open mobile throttle and function controls",
        withCount_one: "Drive {{count}} locomotive from your phone",
        withCount_other: "Drive {{count}} locomotives from your phone",
      },
      locoEditor: { title: "Locomotive editor", description: "Add locomotives and configure addresses, images and functions" },
      programming: { title: "Decoder programming", description: "Program locomotive, accessory and DigiTools decoders" },
      network: { title: "Network settings", description: "Join the EX-CSB1 to your local Wi-Fi network" },
      devices: { title: "Device configuration", description: "Configure external servo and input/output devices" },
      gamepad: { title: "Gamepad", description: "Test Bluetooth and USB game controllers" },
      console: { title: "Console", description: "Send raw DCC-EX commands and inspect WebSocket traffic" },
      files: { title: "Files", description: "Browse, upload and delete files across the complete LittleFS filesystem" },
      backup: { title: "Export / Import", description: "Back up or restore the layout, locomotives and images" },
    },
  },
  locodialog: {
    ...en.locodialog,
    tabs: { general: "General", functions: "Functions", actions: "Actions" },
    train_type: "Train type",
    occupancy_detection_position: "Occupancy detection position",
    last_run_at: "Last run / stopped at",
    last_run_at_empty: "Not recorded yet",
    trainTypes: {
      passenger: "Passenger",
      freight: "Freight",
      mixed: "Mixed",
      maintenance: "Maintenance",
      other: "Other",
    },
    occupancyDetectionPositions: {
      forward: "Forward end",
      reverse: "Reverse end",
      both: "Both ends",
    },
  },
  blockActions: {
    menu: "Blocks",
    managerTitle: "Block actions",
    blocks: "Blocks",
    emptyBlocks: "No blocks found on the layout.",
    selectBlock: "Select a block from the list or add blocks to the layout first.",
    blockDetails: "ID: {{id}} | Address: {{address}} | Sensor: {{sensor}}",
    totalActions: "{{count}} actions",
  },
  settings: {
    ...en.settings,
    languages: { en: "English", hu: "Magyar", de: "Deutsch" },
  },
  ...signalLogicEn,
};

const huTranslation = {
  ...hu,
  home: {
    ...hu.home,
    thanksDescription:
      "A DCCExpress kiváló nyílt forráskódú eszközökre, modern webes technológiákra és egy jó adag AI-segített ötletelésre épül.",
  },
  homeHub: {
    commandStation: "EX-CSB1 központ",
    description: "Mozdonyvezérlés, terepasztal-kezelés és az EX-CSB1 beállítása egy helyen.",
    reloadPage: "Oldal újratöltése",
    configureCsb1: "EX-CSB1 kapcsolat beállítása",
    powerOnTitle: "Pályafeszültség bekapcsolása",
    powerOffTitle: "Pályafeszültség kikapcsolása",
    status: {
      connected: "Online",
      connecting: "Kapcsolódás",
      reconnecting: "Újracsatlakozás",
      error: "Kapcsolati hiba",
      disconnected: "Offline",
    },
    cards: {
      layout: { title: "Terepasztal", description: "Vágányhálózat szerkesztése, váltók és jelzők kezelése" },
      mobile: {
        title: "Mobil vezérlő",
        empty: "Nyisd meg a mobil mozdonyvezérlőt és a funkciógombokat",
        withCount_one: "{{count}} mozdony vezérlése telefonról",
        withCount_other: "{{count}} mozdony vezérlése telefonról",
      },
      locoEditor: { title: "Mozdonyszerkesztő", description: "Mozdonyok, címek, képek és funkciók beállítása" },
      programming: { title: "Dekóderprogramozás", description: "Mozdony-, kiegészítő- és DigiTools dekóderek programozása" },
      network: { title: "Hálózati beállítások", description: "Az EX-CSB1 csatlakoztatása a helyi Wi-Fi hálózathoz" },
      devices: { title: "Eszközkonfiguráció", description: "Külső szervó- és bemenet/kimenet eszközök beállítása" },
      gamepad: { title: "Gamepad", description: "Bluetooth és USB játékvezérlők tesztelése" },
      console: { title: "Konzol", description: "Nyers DCC-EX parancsok küldése és WebSocket forgalom figyelése" },
      files: { title: "Fájlok", description: "A teljes LittleFS fájlrendszer böngészése, feltöltése és törlése" },
      backup: { title: "Export / Import", description: "Terepasztal, mozdonyok és képek mentése vagy visszaállítása" },
    },
  },
  locodialog: {
    ...hu.locodialog,
    tabs: { general: "Általános", functions: "Funkciók", actions: "Műveletek" },
    train_type: "Vonat típusa",
    occupancy_detection_position: "Foglaltság érzékelése",
    last_run_at: "Utolsó futás / megállás ideje",
    last_run_at_empty: "Még nincs rögzítve",
    trainTypes: {
      passenger: "Személy",
      freight: "Teher",
      mixed: "Vegyes",
      maintenance: "Üzemi / karbantartó",
      other: "Egyéb",
    },
    occupancyDetectionPositions: {
      forward: "Elöl (forward)",
      reverse: "Hátul (reverse)",
      both: "Mindkét végén",
    },
  },
  blockActions: {
    menu: "Blocks",
    managerTitle: "Block actionök",
    blocks: "Blokkok",
    emptyBlocks: "Nincs blokk a layouton.",
    selectBlock: "Válassz egy blokkot a listából, vagy előbb tegyél blokkokat a layoutra.",
    blockDetails: "ID: {{id}} | Cím: {{address}} | Szenzor: {{sensor}}",
    totalActions: "{{count}} action",
  },
  settings: {
    ...hu.settings,
    languages: { en: "English", hu: "Magyar", de: "Deutsch" },
  },
  ...signalLogicHu,
};

const deTranslation = {
  ...de,
  home: {
    ...de.home,
    thanksDescription:
      "DCCExpress baut auf hervorragenden Open-Source-Werkzeugen, modernen Webtechnologien und einer guten Portion KI-gestütztem Brainstorming auf.",
  },
  homeHub: {
    commandStation: "EX-CSB1 Zentrale",
    description: "Lokomotiven steuern, die Anlage bedienen und die EX-CSB1 konfigurieren.",
    reloadPage: "Seite neu laden",
    configureCsb1: "EX-CSB1 Verbindung konfigurieren",
    powerOnTitle: "Gleisspannung einschalten",
    powerOffTitle: "Gleisspannung ausschalten",
    status: {
      connected: "Online",
      connecting: "Verbindung wird hergestellt",
      reconnecting: "Erneute Verbindung",
      error: "Verbindungsfehler",
      disconnected: "Offline",
    },
    cards: {
      layout: { title: "Anlagensteuerung", description: "Gleisplan erstellen und Weichen sowie Signale bedienen" },
      mobile: {
        title: "Mobiler Regler",
        empty: "Mobilen Fahrregler und Funktionstasten öffnen",
        withCount_one: "{{count}} Lokomotive per Smartphone steuern",
        withCount_other: "{{count}} Lokomotiven per Smartphone steuern",
      },
      locoEditor: { title: "Lokomotiven-Editor", description: "Lokomotiven, Adressen, Bilder und Funktionen konfigurieren" },
      programming: { title: "Decoder-Programmierung", description: "Lok-, Zubehör- und DigiTools-Decoder programmieren" },
      network: { title: "Netzwerkeinstellungen", description: "Die EX-CSB1 mit dem lokalen WLAN verbinden" },
      devices: { title: "Gerätekonfiguration", description: "Externe Servo- und Ein-/Ausgabegeräte konfigurieren" },
      gamepad: { title: "Gamepad", description: "Bluetooth- und USB-Gamecontroller testen" },
      console: { title: "Konsole", description: "Direkte DCC-EX Befehle senden und WebSocket-Verkehr prüfen" },
      files: { title: "Dateien", description: "Das vollständige LittleFS-Dateisystem durchsuchen, hochladen und löschen" },
      backup: { title: "Export / Import", description: "Anlage, Lokomotiven und Bilder sichern oder wiederherstellen" },
    },
  },
  locodialog: {
    ...de.locodialog,
    tabs: { general: "Allgemein", functions: "Funktionen", actions: "Aktionen" },
    train_type: "Zugtyp",
    occupancy_detection_position: "Belegterkennung",
    last_run_at: "Letzte Fahrt / Halt um",
    last_run_at_empty: "Noch nicht erfasst",
    trainTypes: {
      passenger: "Personenzug",
      freight: "Güterzug",
      mixed: "Gemischt",
      maintenance: "Dienst-/Wartungszug",
      other: "Sonstiges",
    },
    occupancyDetectionPositions: {
      forward: "Vorne (forward)",
      reverse: "Hinten (reverse)",
      both: "An beiden Enden",
    },
  },
  blockActions: {
    menu: "Blöcke",
    managerTitle: "Blockaktionen",
    blocks: "Blöcke",
    emptyBlocks: "Keine Blöcke im Layout gefunden.",
    selectBlock: "Wähle einen Block aus der Liste aus oder füge zuerst Blöcke zum Layout hinzu.",
    blockDetails: "ID: {{id}} | Adresse: {{address}} | Sensor: {{sensor}}",
    totalActions: "{{count}} Aktionen",
  },
  settings: {
    ...de.settings,
    languages: { en: "English", hu: "Magyar", de: "Deutsch" },
  },
  ...signalLogicDe,
};

i18n.use(initReactI18next).init({
  resources: {
    hu: { translation: huTranslation },
    en: { translation: enTranslation },
    de: { translation: deTranslation },
  },
  lng: savedLang,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

document.documentElement.lang = savedLang;

export default i18n;
