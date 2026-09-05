(() => {
  "use strict";

  const RESPONSE_PREFIX = "@HUBCFG ";
  const BAUD_RATE = 115200;

  const RELEASES_URL =
    "https://api.github.com/repos/DCCExpress/DCCExpressHub/releases?per_page=30";

  const PAGES_BASE =
    "https://dccexpress.github.io/DCCExpressHub";

  let port = null;
  let reader = null;
  let readLoopRunning = false;
  let lineBuffer = "";
  let nextRequestId = 1;
  let protocolAvailable = false;
  let protocolBootstrapRunning = false;

  let installerSource = "published";
  let localFirmwareUrl = null;
  let localManifestUrl = null;

  const pending = new Map();

  const $ = id =>
    document.getElementById(id);

  const ui = {
    browserWarning:
      $("browserWarning"),

    serialBadge:
      $("serialBadge"),

    protocolBadge:
      $("protocolBadge"),

    publishedTab:
      $("publishedTab"),

    localTab:
      $("localTab"),

    publishedPanel:
      $("publishedPanel"),

    localPanel:
      $("localPanel"),

    releaseSelect:
      $("releaseSelect"),

    releaseStatus:
      $("releaseStatus"),

    localFirmwareFile:
      $("localFirmwareFile"),

    localImageType:
      $("localImageType"),

    localFirmwareWarning:
      $("localFirmwareWarning"),

    localFirmwareStatus:
      $("localFirmwareStatus"),

    connectButton:
      $("connectButton"),

    disconnectButton:
      $("disconnectButton"),

    refreshStatusButton:
      $("refreshStatusButton"),

    statusWifi:
      $("statusWifi"),

    statusIp:
      $("statusIp"),

    statusHostname:
      $("statusHostname"),

    statusHttp:
      $("statusHttp"),

    statusRssi:
      $("statusRssi"),

    statusHeap:
      $("statusHeap"),

    csbBadge:
      $("csbBadge"),

    statusCsbHost:
      $("statusCsbHost"),

    statusCsbResolved:
      $("statusCsbResolved"),

    statusCsbPort:
      $("statusCsbPort"),

    statusCsbState:
      $("statusCsbState"),

    wifiSsid:
      $("wifiSsid"),

    wifiPassword:
      $("wifiPassword"),

    hubHostname:
      $("hubHostname"),

    hubHttpPort:
      $("hubHttpPort"),

    useDhcp:
      $("useDhcp"),

    staticNetworkFields:
      $("staticNetworkFields"),

    hubIp:
      $("hubIp"),

    hubGateway:
      $("hubGateway"),

    hubSubnet:
      $("hubSubnet"),

    hubDns1:
      $("hubDns1"),

    hubDns2:
      $("hubDns2"),

    saveNetworkButton:
      $("saveNetworkButton"),

    saveNetworkRestartButton:
      $("saveNetworkRestartButton"),

    csbHost:
      $("csbHost"),

    csbPort:
      $("csbPort"),

    powerProg:
      $("powerProg"),

    testCsbButton:
      $("testCsbButton"),

    saveCsbButton:
      $("saveCsbButton"),

    testPanel:
      $("testPanel"),

    testTitle:
      $("testTitle"),

    testMessage:
      $("testMessage"),

    testReply:
      $("testReply"),

    testTime:
      $("testTime"),

    consoleOutput:
      $("consoleOutput"),

    consoleForm:
      $("consoleForm"),

    consoleInput:
      $("consoleInput"),

    consoleSendButton:
      $("consoleSendButton"),

    clearConsoleButton:
      $("clearConsoleButton"),
  };

  function getInstallButton() {
    return document.getElementById(
      "installButton",
    );
  }

  function appendConsole(
    line,
    kind = "",
  ) {
    const stamp =
      new Date()
        .toLocaleTimeString();

    const prefix =
      kind
        ? `[${kind}] `
        : "";

    ui.consoleOutput.textContent +=
      `${stamp} ${prefix}${line}\n`;

    ui.consoleOutput.scrollTop =
      ui.consoleOutput.scrollHeight;
  }

  function sleep(ms) {
    return new Promise(
      resolve =>
        window.setTimeout(
          resolve,
          ms,
        ),
    );
  }

  function setProtocolAvailable(
    value,
  ) {
    protocolAvailable =
      Boolean(value);

    updateControlAvailability();
  }

  function updateControlAvailability() {
    const connected =
      Boolean(
        port?.readable ||
        port?.writable,
      );

    const configured =
      connected &&
      protocolAvailable;

    ui.serialBadge.textContent =
      connected
        ? "SERIAL CONNECTED"
        : "SERIAL OFFLINE";

    ui.serialBadge.className =
      `badge ${
        connected
          ? "badge-online"
          : "badge-offline"
      }`;

    ui.protocolBadge.textContent =
      protocolAvailable
        ? "CONFIG MODE"
        : connected
          ? "RECOVERY MODE"
          : "NO PROTOCOL";

    ui.protocolBadge.className =
      `badge ${
        protocolAvailable
          ? "badge-online"
          : "badge-neutral"
      }`;

    ui.connectButton.disabled =
      connected;

    ui.disconnectButton.disabled =
      !connected;

    ui.refreshStatusButton.disabled =
      !configured;

    ui.saveNetworkButton.disabled =
      !configured;

    ui.saveNetworkRestartButton.disabled =
      !configured;

    ui.testCsbButton.disabled =
      !configured;

    ui.saveCsbButton.disabled =
      !configured;

    ui.consoleInput.disabled =
      !connected;

    ui.consoleSendButton.disabled =
      !connected;
  }

  function setCsbBadge(
    connected,
  ) {
    ui.csbBadge.textContent =
      connected
        ? "ONLINE"
        : "OFFLINE";

    ui.csbBadge.className =
      `badge ${
        connected
          ? "badge-online"
          : "badge-offline"
      }`;
  }

  function setTestPanel(
    mode,
    title,
    message,
    reply = "Reply: —",
    elapsed = "—",
  ) {
    ui.testPanel.classList.remove(
      "test-idle",
      "test-ok",
      "test-fail",
    );

    ui.testPanel.classList.add(
      mode === "ok"
        ? "test-ok"
        : mode === "fail"
          ? "test-fail"
          : "test-idle",
    );

    ui.testTitle.textContent =
      title;

    ui.testMessage.textContent =
      message;

    ui.testReply.textContent =
      reply;

    ui.testTime.textContent =
      elapsed;
  }

  function toggleStaticFields() {
    ui.staticNetworkFields.hidden =
      ui.useDhcp.checked;
  }

  function revokeLocalFirmwareObjects() {
    if (localManifestUrl) {
      URL.revokeObjectURL(
        localManifestUrl,
      );

      localManifestUrl = null;
    }

    if (localFirmwareUrl) {
      URL.revokeObjectURL(
        localFirmwareUrl,
      );

      localFirmwareUrl = null;
    }
  }

  function setInstallManifest(
    manifestUrl,
  ) {
    const oldButton =
      getInstallButton();

    const newButton =
      oldButton.cloneNode(true);

    newButton.setAttribute(
      "manifest",
      manifestUrl,
    );

    oldButton.replaceWith(
      newButton,
    );
  }

  function useInstallerSource(
    source,
  ) {
    installerSource =
      source;

    const published =
      source === "published";

    ui.publishedPanel.hidden =
      !published;

    ui.localPanel.hidden =
      published;

    ui.publishedTab.classList.toggle(
      "active",
      published,
    );

    ui.localTab.classList.toggle(
      "active",
      !published,
    );

    if (published) {
      const selected =
        ui.releaseSelect
          .selectedOptions[0];

      const manifestUrl =
        selected?.dataset
          ?.manifestUrl;

      setInstallManifest(
        manifestUrl ||
        "manifest.json",
      );
    } else {
      prepareLocalFirmwareManifest();
    }
  }

  function updateLocalFirmwareWarning() {
    const merged =
      ui.localImageType.value ===
      "merged";

    ui.localFirmwareWarning.textContent =
      merged
        ? "Factory / merged image: flashed at 0x000000. It can erase NVS configuration and stored layout data."
        : "Application-only image: flashed at 0x010000. NVS configuration is preserved, but LittleFS / web UI is not updated.";
  }

  function prepareLocalFirmwareManifest() {
    if (
      installerSource !== "local"
    ) {
      return;
    }

    revokeLocalFirmwareObjects();

    const file =
      ui.localFirmwareFile
        .files?.[0];

    if (!file) {
      ui.localFirmwareStatus.textContent =
        "Select a local firmware file to prepare the installer.";

      setInstallManifest(
        "manifest.json",
      );

      return;
    }

    if (
      !file.name
        .toLowerCase()
        .endsWith(".bin")
    ) {
      ui.localFirmwareStatus.textContent =
        "Select a .bin firmware file.";

      return;
    }

    const merged =
      ui.localImageType.value ===
      "merged";

    localFirmwareUrl =
      URL.createObjectURL(
        file,
      );

    const manifest = {
      name:
        "DCCExpressHub local firmware",

      version:
        "local",

      new_install_prompt_erase:
        merged,

      builds: [
        {
          chipFamily:
            "ESP32",

          improv:
            false,

          parts: [
            {
              path:
                localFirmwareUrl,

              offset:
                merged
                  ? 0
                  : 0x10000,
            },
          ],
        },
      ],
    };

    localManifestUrl =
      URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              manifest,
            ),
          ],
          {
            type:
              "application/json",
          },
        ),
      );

    setInstallManifest(
      localManifestUrl,
    );

    ui.localFirmwareStatus.textContent =
      `${file.name} · ${Math.round(file.size / 1024)} KB · ${
        merged
          ? "factory @ 0x000000"
          : "application @ 0x010000"
      }`;
  }

  async function loadPublishedReleases() {
    let entries = [];

    try {
      const localIndex =
        await fetch(
          "releases.json",
          {
            cache:
              "no-store",
          },
        );

      if (localIndex.ok) {
        const parsed =
          await localIndex.json();

        if (Array.isArray(parsed)) {
          entries =
            parsed;
        }
      }
    } catch {
      // GitHub Pages release index is optional during development.
    }

    if (
      entries.length === 0
    ) {
      try {
        const response =
          await fetch(
            RELEASES_URL,
            {
              cache:
                "no-store",
            },
          );

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`,
          );
        }

        const releases =
          await response.json();

        if (Array.isArray(releases)) {
          entries =
            releases
              .filter(
                release =>
                  !release.draft,
              )
              .filter(
                release =>
                  Array.isArray(
                    release.assets,
                  ) &&
                  release.assets.some(
                    asset =>
                      /^DCCExpressHub-.+-merged\.bin$/i
                        .test(
                          asset.name,
                        ),
                  ),
              )
              .map(
                release => ({
                  tagName:
                    release.tag_name,

                  prerelease:
                    Boolean(
                      release.prerelease,
                    ),

                  manifestUrl:
                    `${PAGES_BASE}/firmware/${release.tag_name}/manifest.json`,
                }),
              );
        }
      } catch {
        entries = [];
      }
    }

    ui.releaseSelect.innerHTML =
      "";

    if (
      entries.length === 0
    ) {
      const option =
        document.createElement(
          "option",
        );

      option.value =
        "";

      option.textContent =
        "Latest installer manifest";

      option.dataset.manifestUrl =
        "manifest.json";

      ui.releaseSelect
        .appendChild(
          option,
        );

      ui.releaseSelect.disabled =
        false;

      ui.releaseStatus.textContent =
        "Release list unavailable; the latest published manifest can still be used.";

      setInstallManifest(
        "manifest.json",
      );

      return;
    }

    for (
      const [index, release]
      of entries.entries()
    ) {
      const option =
        document.createElement(
          "option",
        );

      option.value =
        release.tagName;

      option.dataset.manifestUrl =
        release.manifestUrl;

      option.textContent =
        `${release.tagName}${
          release.prerelease
            ? " · test"
            : " · stable"
        }${
          index === 0
            ? " · latest"
            : ""
        }`;

      ui.releaseSelect
        .appendChild(
          option,
        );
    }

    ui.releaseSelect.disabled =
      false;

    const first =
      ui.releaseSelect
        .selectedOptions[0];

    ui.releaseStatus.textContent =
      first?.textContent ??
      "";

    setInstallManifest(
      first?.dataset
        ?.manifestUrl ||
      "manifest.json",
    );
  }

  async function writeLine(
    line,
  ) {
    if (!port?.writable) {
      throw new Error(
        "Serial port is not connected.",
      );
    }

    const writer =
      port.writable
        .getWriter();

    try {
      const bytes =
        new TextEncoder()
          .encode(
            `${line}\n`,
          );

      await writer.write(
        bytes,
      );
    } finally {
      writer.releaseLock();
    }
  }

  async function request(
    cmd,
    data = undefined,
    timeoutMs = 5000,
  ) {
    const id =
      nextRequestId++;

    const message = {
      id,
      cmd,
    };

    if (
      data !== undefined
    ) {
      message.data =
        data;
    }

    const promise =
      new Promise(
        (
          resolve,
          reject,
        ) => {
          const timer =
            window.setTimeout(
              () => {
                pending.delete(
                  id,
                );

                reject(
                  new Error(
                    `Timeout waiting for ${cmd}.`,
                  ),
                );
              },
              timeoutMs,
            );

          pending.set(
            id,
            {
              resolve,
              reject,
              timer,
            },
          );
        },
      );

    await writeLine(
      JSON.stringify(
        message,
      ),
    );

    return promise;
  }

  async function bootstrapProtocolState() {
    if (
      protocolBootstrapRunning ||
      !port?.writable
    ) {
      return;
    }

    protocolBootstrapRunning =
      true;

    try {
      await Promise.all([
        loadConfig(),
        refreshStatus(),
      ]);
    } catch (error) {
      appendConsole(
        error instanceof Error
          ? error.message
          : String(error),
        "CONFIG ERROR",
      );
    } finally {
      protocolBootstrapRunning =
        false;
    }
  }

  function recognizeHubConfigProtocol(
    message,
  ) {
    const wasAvailable =
      protocolAvailable;

    if (!wasAvailable) {
      setProtocolAvailable(
        true,
      );

      appendConsole(
        "HUBCFG protocol detected. Configuration controls enabled.",
        "CONFIG",
      );

      // The initial hello can miss the ESP32 because opening USB serial may
      // reset the board. Any later valid @HUBCFG frame is authoritative proof
      // that the configuration protocol is alive, so enable the UI immediately
      // and refresh all editable values/status in the background.
      window.setTimeout(
        () => {
          void bootstrapProtocolState();
        },
        0,
      );
    }

    // An unsolicited firmware ready frame is emitted after boot. Refresh again
    // even when CONFIG MODE was already active because a reboot can change
    // runtime network / CSB1 status.
    if (
      message?.type === "ready" &&
      wasAvailable
    ) {
      window.setTimeout(
        () => {
          void bootstrapProtocolState();
        },
        0,
      );
    }
  }

  function handleProtocolLine(
    jsonText,
  ) {
    let message;

    try {
      message =
        JSON.parse(
          jsonText,
        );
    } catch {
      appendConsole(
        jsonText,
        "BAD CFG",
      );

      return;
    }

    appendConsole(
      JSON.stringify(
        message,
      ),
      "CFG",
    );

    recognizeHubConfigProtocol(
      message,
    );

    if (
      message.id !== undefined &&
      pending.has(
        message.id,
      )
    ) {
      const entry =
        pending.get(
          message.id,
        );

      pending.delete(
        message.id,
      );

      clearTimeout(
        entry.timer,
      );

      entry.resolve(
        message,
      );
    }
  }

  function handleIncomingLine(
    line,
  ) {
    if (
      line.startsWith(
        RESPONSE_PREFIX,
      )
    ) {
      handleProtocolLine(
        line.slice(
          RESPONSE_PREFIX.length,
        ),
      );

      return;
    }

    appendConsole(
      line,
      "LOG",
    );
  }

  async function readLoop() {
    readLoopRunning =
      true;

    try {
      while (
        port?.readable &&
        readLoopRunning
      ) {
        reader =
          port.readable
            .getReader();

        try {
          const decoder =
            new TextDecoder();

          while (
            readLoopRunning
          ) {
            const {
              value,
              done,
            } =
              await reader.read();

            if (done) {
              break;
            }

            if (!value) {
              continue;
            }

            lineBuffer +=
              decoder.decode(
                value,
                {
                  stream:
                    true,
                },
              );

            for (;;) {
              const newline =
                lineBuffer.indexOf(
                  "\n",
                );

              if (
                newline < 0
              ) {
                break;
              }

              const line =
                lineBuffer
                  .slice(
                    0,
                    newline,
                  )
                  .replace(
                    /\r$/,
                    "",
                  );

              lineBuffer =
                lineBuffer.slice(
                  newline + 1,
                );

              if (
                line.length > 0
              ) {
                handleIncomingLine(
                  line,
                );
              }
            }
          }
        } finally {
          reader.releaseLock();
          reader = null;
        }
      }
    } catch (error) {
      if (
        readLoopRunning
      ) {
        appendConsole(
          error instanceof Error
            ? error.message
            : String(error),
          "SERIAL ERROR",
        );
      }
    } finally {
      readLoopRunning =
        false;
    }
  }

  async function negotiateHubProtocol() {
    setProtocolAvailable(
      false,
    );

    await sleep(
      700,
    );

    for (
      let attempt = 1;
      attempt <= 7;
      attempt += 1
    ) {
      if (!port?.writable) {
        return false;
      }

      try {
        const hello =
          await request(
            "hello",
            undefined,
            900,
          );

        if (hello?.ok) {
          setProtocolAvailable(
            true,
          );

          appendConsole(
            `HUBCFG protocol ready (attempt ${attempt}).`,
            "CONFIG",
          );

          await bootstrapProtocolState();

          return true;
        }
      } catch {
        // ESP32 may still be rebooting after opening the USB serial port.
      }

      await sleep(
        300,
      );
    }

    appendConsole(
      "HUBCFG protocol not detected. The port remains open in RECOVERY MODE.",
      "RECOVERY",
    );

    setProtocolAvailable(
      false,
    );

    return false;
  }

  async function connectSerial() {
    if (
      !navigator.serial
    ) {
      ui.browserWarning.hidden =
        false;

      return;
    }

    port =
      await navigator.serial
        .requestPort();

    await port.open({
      baudRate:
        BAUD_RATE,
    });

    try {
      await port.setSignals({
        dataTerminalReady:
          false,

        requestToSend:
          false,
      });
    } catch {
      // Optional on some USB-UART implementations.
    }

    lineBuffer =
      "";

    setProtocolAvailable(
      false,
    );

    updateControlAvailability();

    appendConsole(
      `Serial port opened at ${BAUD_RATE} baud.`,
      "SERIAL",
    );

    void readLoop();

    await negotiateHubProtocol();
  }

  async function disconnectSerial() {
    readLoopRunning =
      false;

    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // Ignore close race.
      }
    }

    for (
      const entry
      of pending.values()
    ) {
      clearTimeout(
        entry.timer,
      );

      entry.reject(
        new Error(
          "Serial connection closed.",
        ),
      );
    }

    pending.clear();

    if (port) {
      try {
        await port.close();
      } catch {
        // Device may already be closed.
      }
    }

    port = null;

    protocolBootstrapRunning =
      false;

    setProtocolAvailable(
      false,
    );

    updateControlAvailability();

    appendConsole(
      "Disconnected.",
      "SERIAL",
    );
  }

  async function loadConfig() {
    const response =
      await request(
        "getConfig",
      );

    if (!response.ok) {
      throw new Error(
        response.message ||
        "Could not read configuration.",
      );
    }

    const network =
      response.config
        ?.network ?? {};

    const csb =
      response.config
        ?.commandCenter ?? {};

    ui.wifiSsid.value =
      network.ssid ??
      "";

    ui.wifiPassword.value =
      "";

    ui.wifiPassword.placeholder =
      network.passwordStored
        ? "Password stored — leave blank to keep it"
        : "Wi-Fi password";

    ui.hubHostname.value =
      network.hostname ??
      "";

    ui.hubHttpPort.value =
      String(
        network.httpPort ??
        80,
      );

    ui.useDhcp.checked =
      network.dhcp !==
      false;

    ui.hubIp.value =
      network.ip ??
      "";

    ui.hubGateway.value =
      network.gateway ??
      "";

    ui.hubSubnet.value =
      network.subnet ??
      "255.255.255.0";

    ui.hubDns1.value =
      network.dns1 ??
      "";

    ui.hubDns2.value =
      network.dns2 ??
      "";

    ui.csbHost.value =
      csb.host ??
      "";

    ui.csbPort.value =
      String(
        csb.port ??
        2560,
      );

    ui.powerProg.checked =
      csb.powerIncludesProgramming !==
      false;

    toggleStaticFields();
  }

  async function refreshStatus() {
    const response =
      await request(
        "status",
      );

    if (!response.ok) {
      throw new Error(
        response.message ||
        "Could not read Hub status.",
      );
    }

    const status =
      response.status ??
      {};

    ui.statusWifi.textContent =
      status.wifiConnected
        ? (
            status.wifiSsid ||
            "connected"
          )
        : "OFFLINE";

    ui.statusIp.textContent =
      status.wifiIp ||
      "—";

    ui.statusHostname.textContent =
      status.hubHostname ||
      "—";

    ui.statusHttp.textContent =
      status.hubHttpPort
        ? `${status.wifiIp || "Hub"}:${status.hubHttpPort}`
        : "—";

    ui.statusRssi.textContent =
      Number.isFinite(
        status.wifiRssiDbm,
      )
        ? `${status.wifiRssiDbm} dBm`
        : "—";

    ui.statusHeap.textContent =
      Number.isFinite(
        status.hubFreeHeapBytes,
      )
        ? `${Math.round(status.hubFreeHeapBytes / 1024)} KB`
        : "—";

    ui.statusCsbHost.textContent =
      status.csbHost ||
      "—";

    ui.statusCsbResolved.textContent =
      status.csbResolvedIp ||
      "—";

    ui.statusCsbPort.textContent =
      status.csbPort ??
      "—";

    ui.statusCsbState.textContent =
      status.csbConnected
        ? "DCC-EX ONLINE"
        : "OFFLINE";

    setCsbBadge(
      Boolean(
        status.csbConnected,
      ),
    );
  }

  function networkPayload() {
    const data = {
      ssid:
        ui.wifiSsid.value
          .trim(),

      hostname:
        ui.hubHostname.value
          .trim(),

      dhcp:
        ui.useDhcp.checked,

      ip:
        ui.hubIp.value
          .trim(),

      gateway:
        ui.hubGateway.value
          .trim(),

      subnet:
        ui.hubSubnet.value
          .trim(),

      dns1:
        ui.hubDns1.value
          .trim(),

      dns2:
        ui.hubDns2.value
          .trim(),

      httpPort:
        Number(
          ui.hubHttpPort.value,
        ),
    };

    if (
      ui.wifiPassword.value
        .length > 0
    ) {
      data.password =
        ui.wifiPassword.value;
    }

    return data;
  }

  async function saveNetwork(
    restartAfter,
  ) {
    const response =
      await request(
        "setNetwork",
        networkPayload(),
      );

    if (!response.ok) {
      throw new Error(
        response.message ||
        "Could not save network settings.",
      );
    }

    appendConsole(
      restartAfter
        ? "Network settings saved; restarting Hub."
        : "Network settings saved; restart required.",
      "CONFIG",
    );

    ui.wifiPassword.value =
      "";

    if (restartAfter) {
      await request(
        "restart",
        undefined,
        1500,
      ).catch(
        () => {},
      );
    }
  }

  function csbPayload() {
    return {
      host:
        ui.csbHost.value
          .trim(),

      port:
        Number(
          ui.csbPort.value,
        ),

      powerIncludesProgramming:
        ui.powerProg.checked,
    };
  }

  async function saveCsb() {
    const response =
      await request(
        "setCommandCenter",
        csbPayload(),
      );

    if (!response.ok) {
      throw new Error(
        response.message ||
        "Could not save EX-CSB1 settings.",
      );
    }

    appendConsole(
      "EX-CSB1 settings saved and applied.",
      "CONFIG",
    );

    await refreshStatus();
  }

  async function testCsb() {
    setTestPanel(
      "idle",
      "Testing EX-CSB1...",
      "Resolving hostname and waiting for a DCC-EX <#> reply.",
      "Reply: —",
      "…",
    );

    const response =
      await request(
        "testCommandCenter",
        csbPayload(),
        7000,
      );

    const ok =
      Boolean(
        response.dccExAlive,
      );

    setTestPanel(
      ok
        ? "ok"
        : "fail",

      ok
        ? "DCC-EX connection OK"
        : "EX-CSB1 test failed",

      response.resolved
        ? response.tcpConnected
          ? ok
            ? `Resolved to ${response.resolvedIp}; TCP connected and DCC-EX replied.`
            : `Resolved to ${response.resolvedIp}; TCP connected but no valid DCC-EX reply.`
          : `Resolved to ${response.resolvedIp}; TCP connection failed.`
        : "Hostname/IP could not be resolved.",

      `Reply: ${response.reply || "—"}`,

      Number.isFinite(
        response.elapsedMs,
      )
        ? `${response.elapsedMs} ms`
        : "—",
    );
  }

  async function sendConsoleCommand(
    raw,
  ) {
    const line =
      raw.trim();

    if (!line) {
      return;
    }

    appendConsole(
      line,
      "TX",
    );

    if (
      line.startsWith("<")
    ) {
      await request(
        "dcc",
        {
          command:
            line,
        },
      );

      return;
    }

    if (
      line.startsWith("{")
    ) {
      await writeLine(
        line,
      );

      return;
    }

    await writeLine(
      line,
    );
  }

  ui.publishedTab.addEventListener(
    "click",
    () =>
      useInstallerSource(
        "published",
      ),
  );

  ui.localTab.addEventListener(
    "click",
    () =>
      useInstallerSource(
        "local",
      ),
  );

  ui.releaseSelect.addEventListener(
    "change",
    () => {
      const selected =
        ui.releaseSelect
          .selectedOptions[0];

      ui.releaseStatus.textContent =
        selected?.textContent ??
        "";

      if (
        installerSource ===
        "published"
      ) {
        setInstallManifest(
          selected?.dataset
            ?.manifestUrl ||
          "manifest.json",
        );
      }
    },
  );

  ui.localFirmwareFile.addEventListener(
    "change",
    prepareLocalFirmwareManifest,
  );

  ui.localImageType.addEventListener(
    "change",
    () => {
      updateLocalFirmwareWarning();
      prepareLocalFirmwareManifest();
    },
  );

  ui.connectButton.addEventListener(
    "click",
    () => {
      connectSerial()
        .catch(
          error => {
            appendConsole(
              error instanceof Error
                ? error.message
                : String(error),
              "SERIAL ERROR",
            );

            void disconnectSerial();
          },
        );
    },
  );

  ui.disconnectButton.addEventListener(
    "click",
    () => {
      void disconnectSerial();
    },
  );

  ui.refreshStatusButton.addEventListener(
    "click",
    () => {
      refreshStatus()
        .catch(
          error => {
            appendConsole(
              error instanceof Error
                ? error.message
                : String(error),
              "ERROR",
            );
          },
        );
    },
  );

  ui.useDhcp.addEventListener(
    "change",
    toggleStaticFields,
  );

  ui.saveNetworkButton.addEventListener(
    "click",
    () => {
      saveNetwork(
        false,
      ).catch(
        error => {
          appendConsole(
            error instanceof Error
              ? error.message
              : String(error),
            "ERROR",
          );
        },
      );
    },
  );

  ui.saveNetworkRestartButton.addEventListener(
    "click",
    () => {
      saveNetwork(
        true,
      ).catch(
        error => {
          appendConsole(
            error instanceof Error
              ? error.message
              : String(error),
            "ERROR",
          );
        },
      );
    },
  );

  ui.saveCsbButton.addEventListener(
    "click",
    () => {
      saveCsb()
        .catch(
          error => {
            appendConsole(
              error instanceof Error
                ? error.message
                : String(error),
              "ERROR",
            );
          },
        );
    },
  );

  ui.testCsbButton.addEventListener(
    "click",
    () => {
      testCsb()
        .catch(
          error => {
            setTestPanel(
              "fail",
              "EX-CSB1 test failed",
              error instanceof Error
                ? error.message
                : String(error),
              "Reply: —",
              "—",
            );
          },
        );
    },
  );

  ui.clearConsoleButton.addEventListener(
    "click",
    () => {
      ui.consoleOutput.textContent =
        "";
    },
  );

  ui.consoleForm.addEventListener(
    "submit",
    event => {
      event.preventDefault();

      const value =
        ui.consoleInput.value;

      ui.consoleInput.value =
        "";

      sendConsoleCommand(
        value,
      ).catch(
        error => {
          appendConsole(
            error instanceof Error
              ? error.message
              : String(error),
            "ERROR",
          );
        },
      );
    },
  );

  window.addEventListener(
    "beforeunload",
    revokeLocalFirmwareObjects,
  );

  if (
    !navigator.serial
  ) {
    ui.browserWarning.hidden =
      false;

    ui.connectButton.disabled =
      true;
  }

  toggleStaticFields();
  updateLocalFirmwareWarning();
  updateControlAvailability();
  void loadPublishedReleases();
})();
