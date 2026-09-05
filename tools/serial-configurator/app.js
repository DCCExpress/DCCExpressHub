(() => {
  "use strict";

  const RESPONSE_PREFIX = "@HUBCFG ";
  const BAUD_RATE = 115200;

  let port = null;
  let reader = null;
  let readLoopRunning = false;
  let lineBuffer = "";
  let nextRequestId = 1;
  let protocolAvailable = false;
  let resolvedFlashPort = "";
  let resolvedFlashDescription = "";
  let flashing = false;
  const pending = new Map();

  const $ = id => document.getElementById(id);

  const ui = {
    serialBadge: $("serialBadge"),
    protocolBadge: $("protocolBadge"),
    browserNotice: $("browserNotice"),
    connectButton: $("connectButton"),
    disconnectButton: $("disconnectButton"),
    refreshStatusButton: $("refreshStatusButton"),

    statusWifi: $("statusWifi"),
    statusIp: $("statusIp"),
    statusHostname: $("statusHostname"),
    statusHttp: $("statusHttp"),
    statusRssi: $("statusRssi"),
    statusHeap: $("statusHeap"),

    csbBadge: $("csbBadge"),
    statusCsbHost: $("statusCsbHost"),
    statusCsbResolved: $("statusCsbResolved"),
    statusCsbPort: $("statusCsbPort"),
    statusCsbState: $("statusCsbState"),

    flashDeviceBadge: $("flashDeviceBadge"),
    flashDeviceText: $("flashDeviceText"),
    flashMode: $("flashMode"),
    flashBaud: $("flashBaud"),
    firmwareFile: $("firmwareFile"),
    eraseFlash: $("eraseFlash"),
    flashFirmwareButton: $("flashFirmwareButton"),
    flashWarning: $("flashWarning"),
    flashProgress: $("flashProgress"),
    flashStatus: $("flashStatus"),
    flashPercent: $("flashPercent"),
    flashLog: $("flashLog"),

    wifiSsid: $("wifiSsid"),
    wifiPassword: $("wifiPassword"),
    hubHostname: $("hubHostname"),
    hubHttpPort: $("hubHttpPort"),
    useDhcp: $("useDhcp"),
    staticNetworkFields: $("staticNetworkFields"),
    hubIp: $("hubIp"),
    hubGateway: $("hubGateway"),
    hubSubnet: $("hubSubnet"),
    hubDns1: $("hubDns1"),
    hubDns2: $("hubDns2"),
    saveNetworkButton: $("saveNetworkButton"),
    saveNetworkRestartButton: $("saveNetworkRestartButton"),

    csbHost: $("csbHost"),
    csbPort: $("csbPort"),
    powerProg: $("powerProg"),
    testCsbButton: $("testCsbButton"),
    saveCsbButton: $("saveCsbButton"),

    testPanel: $("testPanel"),
    testTitle: $("testTitle"),
    testMessage: $("testMessage"),
    testReply: $("testReply"),
    testTime: $("testTime"),

    consoleOutput: $("consoleOutput"),
    consoleForm: $("consoleForm"),
    consoleInput: $("consoleInput"),
    consoleSendButton: $("consoleSendButton"),
    clearConsoleButton: $("clearConsoleButton"),
  };

  function appendConsole(line, kind = "") {
    const stamp = new Date().toLocaleTimeString();
    const prefix = kind ? `[${kind}] ` : "";
    ui.consoleOutput.textContent += `${stamp} ${prefix}${line}\n`;
    ui.consoleOutput.scrollTop = ui.consoleOutput.scrollHeight;
  }

  function appendFlashLog(line) {
    ui.flashLog.textContent += `${line}\n`;
    ui.flashLog.scrollTop = ui.flashLog.scrollHeight;
  }

  function updateControlAvailability() {
    const connected = Boolean(port?.readable || port?.writable);
    const configured = connected && protocolAvailable;

    ui.serialBadge.textContent = connected ? "CONNECTED" : "DISCONNECTED";
    ui.serialBadge.className =
      `badge ${connected ? "badge-online" : "badge-offline"}`;

    ui.protocolBadge.textContent =
      protocolAvailable ? "CONFIG MODE" : connected ? "RECOVERY MODE" : "NO PROTOCOL";
    ui.protocolBadge.className =
      `badge ${
        protocolAvailable
          ? "badge-online"
          : connected
            ? "badge-neutral"
            : "badge-neutral"
      }`;

    ui.connectButton.disabled = connected || flashing;
    ui.disconnectButton.disabled = !connected || flashing;

    ui.refreshStatusButton.disabled = !configured;
    ui.saveNetworkButton.disabled = !configured;
    ui.saveNetworkRestartButton.disabled = !configured;
    ui.testCsbButton.disabled = !configured;
    ui.saveCsbButton.disabled = !configured;
    ui.consoleInput.disabled = !connected;
    ui.consoleSendButton.disabled = !connected;

    ui.flashFirmwareButton.disabled =
      flashing || !resolvedFlashPort;
  }

  function setProtocolAvailable(value) {
    protocolAvailable = Boolean(value);
    updateControlAvailability();
  }

  function setConnectedUi() {
    updateControlAvailability();
  }

  function setFlashDevice(portName, description = "") {
    resolvedFlashPort = portName || "";
    resolvedFlashDescription = description || "";

    if (resolvedFlashPort) {
      ui.flashDeviceBadge.textContent = resolvedFlashPort;
      ui.flashDeviceBadge.className = "badge badge-online";
      ui.flashDeviceText.textContent =
        resolvedFlashDescription
          ? `${resolvedFlashPort} — ${resolvedFlashDescription}`
          : resolvedFlashPort;
    } else {
      ui.flashDeviceBadge.textContent = "NO DEVICE";
      ui.flashDeviceBadge.className = "badge badge-neutral";
      ui.flashDeviceText.textContent = "—";
    }

    updateControlAvailability();
  }

  function setCsbBadge(connected) {
    ui.csbBadge.textContent = connected ? "ONLINE" : "OFFLINE";
    ui.csbBadge.className =
      `badge ${connected ? "badge-online" : "badge-offline"}`;
  }

  function setTestPanel(mode, title, message, reply = "Reply: —", elapsed = "—") {
    ui.testPanel.classList.remove("test-idle", "test-ok", "test-fail");
    ui.testPanel.classList.add(
      mode === "ok"
        ? "test-ok"
        : mode === "fail"
          ? "test-fail"
          : "test-idle"
    );

    ui.testTitle.textContent = title;
    ui.testMessage.textContent = message;
    ui.testReply.textContent = reply;
    ui.testTime.textContent = elapsed;
  }

  function setFlashProgress(percent, status = null) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    ui.flashProgress.style.width = `${value}%`;
    ui.flashPercent.textContent = `${Math.round(value)}%`;

    if (status !== null) {
      ui.flashStatus.textContent = status;
    }
  }

  function toggleStaticFields() {
    ui.staticNetworkFields.hidden = ui.useDhcp.checked;
  }

  function updateFlashWarning() {
    if (ui.flashMode.value === "merged") {
      ui.flashWarning.innerHTML =
        "<strong>Factory merged:</strong> full recovery image. It contains bootloader, " +
        "partition table, application and LittleFS. Because it is written from address 0, " +
        "it also resets the NVS configuration. Reconnect after flashing and configure the Hub below.";
      return;
    }

    ui.flashWarning.innerHTML =
      "<strong>Application only:</strong> writes firmware.bin at 0x010000 and preserves NVS " +
      "settings. LittleFS / web UI is not updated by this mode.";
  }

  async function writeLine(line) {
    if (!port?.writable) {
      throw new Error("Serial port is not connected.");
    }

    const writer = port.writable.getWriter();

    try {
      const bytes = new TextEncoder().encode(`${line}\n`);
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  async function request(cmd, data = undefined, timeoutMs = 5000) {
    const id = nextRequestId++;
    const message = { id, cmd };

    if (data !== undefined) {
      message.data = data;
    }

    const promise = new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout waiting for ${cmd}.`));
      }, timeoutMs);

      pending.set(id, {
        resolve,
        reject,
        timer,
      });
    });

    await writeLine(JSON.stringify(message));
    return promise;
  }

  function handleProtocolLine(jsonText) {
    let message;

    try {
      message = JSON.parse(jsonText);
    } catch {
      appendConsole(jsonText, "BAD CFG");
      return;
    }

    appendConsole(JSON.stringify(message), "CFG");

    if (message.id !== undefined && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      entry.resolve(message);
    }
  }

  function handleIncomingLine(line) {
    if (line.startsWith(RESPONSE_PREFIX)) {
      handleProtocolLine(line.slice(RESPONSE_PREFIX.length));
      return;
    }

    appendConsole(line, "LOG");
  }

  async function readLoop() {
    readLoopRunning = true;

    try {
      while (port?.readable && readLoopRunning) {
        reader = port.readable.getReader();

        try {
          const decoder = new TextDecoder();

          while (readLoopRunning) {
            const { value, done } = await reader.read();

            if (done) break;
            if (!value) continue;

            lineBuffer += decoder.decode(value, { stream: true });

            for (;;) {
              const newline = lineBuffer.indexOf("\n");
              if (newline < 0) break;

              const line = lineBuffer.slice(0, newline).replace(/\r$/, "");
              lineBuffer = lineBuffer.slice(newline + 1);

              if (line.length > 0) {
                handleIncomingLine(line);
              }
            }
          }
        } finally {
          reader.releaseLock();
          reader = null;
        }
      }
    } catch (error) {
      if (readLoopRunning) {
        appendConsole(
          error instanceof Error ? error.message : String(error),
          "SERIAL ERROR"
        );
      }
    } finally {
      readLoopRunning = false;
    }
  }

  function sleep(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  async function resolveSelectedDevice(serialPort) {
    setFlashDevice("", "");

    const info = serialPort.getInfo();

    if (
      !Number.isInteger(info.usbVendorId) ||
      !Number.isInteger(info.usbProductId)
    ) {
      appendFlashLog(
        "The selected Web Serial device does not expose USB VID/PID, so automatic Windows COM mapping is unavailable."
      );
      return;
    }

    const query = new URLSearchParams({
      vendorId: String(info.usbVendorId),
      productId: String(info.usbProductId),
    });

    try {
      const response = await fetch(
        `/api/resolve-port?${query.toString()}`,
        { cache: "no-store" }
      );

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.message || `HTTP ${response.status}`);
      }

      setFlashDevice(
        result.port,
        result.description || ""
      );

      appendFlashLog(
        `Selected Web Serial device mapped automatically to ${result.port}.`
      );
    } catch (error) {
      setFlashDevice("", "");
      appendFlashLog(
        `Automatic COM mapping failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async function negotiateHubProtocol() {
    setProtocolAvailable(false);

    // Opening a USB-UART port can reset an ESP32 depending on the adapter and
    // DTR/RTS wiring. Do not assume the application is ready after 250 ms.
    await sleep(700);

    for (let attempt = 1; attempt <= 7; attempt += 1) {
      if (!port?.writable) {
        return false;
      }

      try {
        const hello = await request(
          "hello",
          undefined,
          900
        );

        if (hello?.ok) {
          setProtocolAvailable(true);

          appendConsole(
            `HUBCFG protocol ready (attempt ${attempt}).`,
            "CONFIG"
          );

          await Promise.all([
            loadConfig(),
            refreshStatus(),
          ]);

          return true;
        }
      } catch {
        // The Hub may still be rebooting. Retry below.
      }

      await sleep(300);
    }

    appendConsole(
      "HUBCFG protocol not detected. Serial port stays connected in RECOVERY MODE; logs and firmware flashing remain available.",
      "RECOVERY"
    );

    setProtocolAvailable(false);
    return false;
  }

  async function connectSerial() {
    if (!("serial" in navigator)) {
      ui.browserNotice.hidden = false;
      return;
    }

    const selectedPort =
      await navigator.serial.requestPort();

    // Resolve the Windows COM name while the browser has not opened/locked
    // the port yet. This is later used by PlatformIO/esptool.
    await resolveSelectedDevice(
      selectedPort
    );

    port = selectedPort;

    await port.open({
      baudRate: BAUD_RATE,
    });

    try {
      await port.setSignals({
        dataTerminalReady: false,
        requestToSend: false,
      });
    } catch {
      // Not every adapter/browser combination supports signal control.
    }

    lineBuffer = "";
    setProtocolAvailable(false);
    setConnectedUi();

    appendConsole(
      `Serial port opened at ${BAUD_RATE} baud.`,
      "SERIAL"
    );

    void readLoop();

    // Failure to negotiate the configuration protocol is NOT a connection
    // failure. Old/broken firmware must remain usable for recovery flashing.
    await negotiateHubProtocol();
  }

  async function disconnectSerial() {
    readLoopRunning = false;

    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancellation races.
      }
    }

    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Serial connection closed."));
    }
    pending.clear();

    if (port) {
      try {
        await port.close();
      } catch {
        // Port may already be closed.
      }
    }

    port = null;
    setProtocolAvailable(false);
    setConnectedUi();
    appendConsole("Disconnected.", "SERIAL");
  }

  async function loadConfig() {
    const response = await request("getConfig");

    if (!response.ok) {
      throw new Error(response.message || "Could not read configuration.");
    }

    const network = response.config?.network ?? {};
    const csb = response.config?.commandCenter ?? {};

    ui.wifiSsid.value = network.ssid ?? "";
    ui.wifiPassword.value = "";
    ui.wifiPassword.placeholder =
      network.passwordStored
        ? "Password stored — leave blank to keep it"
        : "Wi-Fi password";

    ui.hubHostname.value = network.hostname ?? "";
    ui.hubHttpPort.value = String(network.httpPort ?? 80);
    ui.useDhcp.checked = network.dhcp !== false;

    ui.hubIp.value = network.ip ?? "";
    ui.hubGateway.value = network.gateway ?? "";
    ui.hubSubnet.value = network.subnet ?? "255.255.255.0";
    ui.hubDns1.value = network.dns1 ?? "";
    ui.hubDns2.value = network.dns2 ?? "";

    ui.csbHost.value = csb.host ?? "";
    ui.csbPort.value = String(csb.port ?? 2560);
    ui.powerProg.checked = csb.powerIncludesProgramming !== false;

    toggleStaticFields();
  }

  async function refreshStatus() {
    const response = await request("status");

    if (!response.ok) {
      throw new Error(response.message || "Could not read Hub status.");
    }

    const status = response.status ?? {};

    ui.statusWifi.textContent =
      status.wifiConnected
        ? `${status.wifiSsid || "connected"}`
        : "OFFLINE";

    ui.statusIp.textContent = status.wifiIp || "—";
    ui.statusHostname.textContent = status.hubHostname || "—";
    ui.statusHttp.textContent = status.hubHttpPort
      ? `${status.wifiIp || "Hub"}:${status.hubHttpPort}`
      : "—";

    ui.statusRssi.textContent = Number.isFinite(status.wifiRssiDbm)
      ? `${status.wifiRssiDbm} dBm`
      : "—";

    ui.statusHeap.textContent = Number.isFinite(status.hubFreeHeapBytes)
      ? `${Math.round(status.hubFreeHeapBytes / 1024)} KB`
      : "—";

    ui.statusCsbHost.textContent = status.csbHost || "—";
    ui.statusCsbResolved.textContent = status.csbResolvedIp || "—";
    ui.statusCsbPort.textContent = status.csbPort ?? "—";
    ui.statusCsbState.textContent =
      status.csbConnected ? "DCC-EX ONLINE" : "OFFLINE";

    setCsbBadge(Boolean(status.csbConnected));
  }

  function networkPayload() {
    const data = {
      ssid: ui.wifiSsid.value.trim(),
      hostname: ui.hubHostname.value.trim(),
      dhcp: ui.useDhcp.checked,
      ip: ui.hubIp.value.trim(),
      gateway: ui.hubGateway.value.trim(),
      subnet: ui.hubSubnet.value.trim(),
      dns1: ui.hubDns1.value.trim(),
      dns2: ui.hubDns2.value.trim(),
      httpPort: Number(ui.hubHttpPort.value),
    };

    if (ui.wifiPassword.value.length > 0) {
      data.password = ui.wifiPassword.value;
    }

    return data;
  }

  async function saveNetwork(restartAfter) {
    const response = await request("setNetwork", networkPayload());

    if (!response.ok) {
      throw new Error(response.message || "Could not save network settings.");
    }

    appendConsole(
      restartAfter
        ? "Network settings saved; restarting Hub."
        : "Network settings saved; restart required.",
      "CONFIG"
    );

    ui.wifiPassword.value = "";

    if (restartAfter) {
      await request("restart", undefined, 1500).catch(() => {});
    }
  }

  function csbPayload() {
    return {
      host: ui.csbHost.value.trim(),
      port: Number(ui.csbPort.value),
      powerIncludesProgramming: ui.powerProg.checked,
    };
  }

  async function saveCsb() {
    const response = await request("setCommandCenter", csbPayload());

    if (!response.ok) {
      throw new Error(response.message || "Could not save EX-CSB1 settings.");
    }

    appendConsole("EX-CSB1 settings saved and applied.", "CONFIG");
    await refreshStatus();
  }

  async function testCsb() {
    setTestPanel(
      "idle",
      "Testing EX-CSB1...",
      "Resolving hostname and waiting for a DCC-EX <#> reply.",
      "Reply: —",
      "…"
    );

    const response = await request(
      "testCommandCenter",
      csbPayload(),
      7000
    );

    const ok = Boolean(response.dccExAlive);

    setTestPanel(
      ok ? "ok" : "fail",
      ok ? "DCC-EX connection OK" : "EX-CSB1 test failed",
      response.resolved
        ? response.tcpConnected
          ? ok
            ? `Resolved to ${response.resolvedIp}; TCP connected and DCC-EX replied.`
            : `Resolved to ${response.resolvedIp}; TCP connected but no valid DCC-EX reply.`
          : `Resolved to ${response.resolvedIp}; TCP connection failed.`
        : "Hostname/IP could not be resolved.",
      `Reply: ${response.reply || "—"}`,
      Number.isFinite(response.elapsedMs)
        ? `${response.elapsedMs} ms`
        : "—"
    );
  }

  function parseProgressLine(line) {
    const match = line.match(/\((\d+(?:\.\d+)?)\s*%\)/);

    if (match) {
      setFlashProgress(Number(match[1]));
    }
  }

  async function flashFirmware() {
    const file = ui.firmwareFile.files?.[0];

    if (!file) {
      throw new Error("Select a .bin file first.");
    }

    const selectedPort = resolvedFlashPort;

    if (!/^COM\d+$/i.test(selectedPort)) {
      throw new Error(
        "Connect the Hub with Connect configurator first so its Windows COM port can be identified automatically."
      );
    }

    if (file.size <= 0) {
      throw new Error("The selected BIN file is empty.");
    }

    if (file.size > 32 * 1024 * 1024) {
      throw new Error("The selected BIN file is unexpectedly large.");
    }

    if (port) {
      appendFlashLog("Releasing the Web Serial monitor before flashing...");
      await disconnectSerial();
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    flashing = true;
    updateControlAvailability();
    ui.flashLog.textContent = "";
    setFlashProgress(0, "Preparing firmware upload...");

    const params = new URLSearchParams({
      port: selectedPort,
      mode: ui.flashMode.value,
      baud: ui.flashBaud.value,
      erase: ui.eraseFlash.checked ? "1" : "0",
      filename: file.name,
    });

    const response = await fetch(`/api/flash?${params.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: file,
    });

    if (!response.body) {
      const text = await response.text();
      throw new Error(text || `Flash request failed: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let success = false;

    setFlashProgress(1, "Flashing...");

    for (;;) {
      const { value, done } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;

        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);

        if (!line) continue;

        appendFlashLog(line);
        parseProgressLine(line);

        if (line === "@FLASH_OK") {
          success = true;
        }

        if (line.startsWith("@FLASH_ERROR ")) {
          throw new Error(line.slice("@FLASH_ERROR ".length));
        }
      }
    }

    if (buffer.trim()) {
      appendFlashLog(buffer.trim());
      parseProgressLine(buffer.trim());
    }

    if (!response.ok || !success) {
      throw new Error(
        `Flashing did not complete successfully (HTTP ${response.status}).`
      );
    }

    setFlashProgress(
      100,
      ui.flashMode.value === "merged"
        ? "Factory image flashed. Reconnect and configure the Hub."
        : "Application firmware flashed. Reconnect the configurator."
    );

    appendFlashLog("");
    appendFlashLog("Flash completed successfully.");
    appendFlashLog("Use Connect configurator after the Hub has rebooted.");
  }

  async function sendConsoleCommand(raw) {
    const line = raw.trim();
    if (!line) return;

    appendConsole(line, "TX");

    if (line.startsWith("<")) {
      await request("dcc", { command: line });
      return;
    }

    if (line.startsWith("{")) {
      await writeLine(line);
      return;
    }

    await writeLine(line);
  }

  ui.connectButton.addEventListener("click", () => {
    connectSerial().catch(error => {
      appendConsole(
        error instanceof Error ? error.message : String(error),
        "SERIAL ERROR"
      );
      void disconnectSerial();
    });
  });

  ui.disconnectButton.addEventListener("click", () => {
    void disconnectSerial();
  });

  ui.refreshStatusButton.addEventListener("click", () => {
    refreshStatus().catch(error => {
      appendConsole(error.message || String(error), "ERROR");
    });
  });


  ui.flashMode.addEventListener("change", updateFlashWarning);

  ui.flashFirmwareButton.addEventListener("click", () => {
    flashFirmware()
      .catch(error => {
        setFlashProgress(0, "Flash failed.");
        appendFlashLog(
          `ERROR: ${error instanceof Error ? error.message : String(error)}`
        );
      })
      .finally(() => {
        flashing = false;
        updateControlAvailability();
      });
  });

  ui.useDhcp.addEventListener("change", toggleStaticFields);

  ui.saveNetworkButton.addEventListener("click", () => {
    saveNetwork(false).catch(error => {
      appendConsole(error.message || String(error), "ERROR");
    });
  });

  ui.saveNetworkRestartButton.addEventListener("click", () => {
    saveNetwork(true).catch(error => {
      appendConsole(error.message || String(error), "ERROR");
    });
  });

  ui.saveCsbButton.addEventListener("click", () => {
    saveCsb().catch(error => {
      appendConsole(error.message || String(error), "ERROR");
    });
  });

  ui.testCsbButton.addEventListener("click", () => {
    testCsb().catch(error => {
      setTestPanel(
        "fail",
        "EX-CSB1 test failed",
        error.message || String(error),
        "Reply: —",
        "—"
      );
    });
  });

  ui.clearConsoleButton.addEventListener("click", () => {
    ui.consoleOutput.textContent = "";
  });

  ui.consoleForm.addEventListener("submit", event => {
    event.preventDefault();

    const value = ui.consoleInput.value;
    ui.consoleInput.value = "";

    sendConsoleCommand(value).catch(error => {
      appendConsole(error.message || String(error), "ERROR");
    });
  });

  if (!("serial" in navigator)) {
    ui.browserNotice.hidden = false;
    ui.connectButton.disabled = true;
  }

  toggleStaticFields();
  updateFlashWarning();
  setFlashDevice("", "");
  setProtocolAvailable(false);
  setConnectedUi();
})();
