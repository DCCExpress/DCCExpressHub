#include "WsProtocol.h"
#include "Logger.h"

WsProtocol::WsProtocol(
    AsyncWebSocket& ws,
    DccExBridge& dcc,
    LayoutRuntime& runtime,
    RuntimeStateStore& stateStore)
    : _ws(ws), _dcc(dcc), _runtime(runtime), _stateStore(stateStore) {}

void WsProtocol::begin() {
  _ws.onEvent([this](
      AsyncWebSocket* server,
      AsyncWebSocketClient* client,
      AwsEventType type,
      void* arg,
      uint8_t* data,
      size_t len) {
    handleEvent(server, client, type, arg, data, len);
  });

  _dcc.onFrame([this](const String& frame) {
    handleDccFrame(frame);
  });
}

void WsProtocol::cleanupClients() {
  _ws.cleanupClients();
}

void WsProtocol::send(
    AsyncWebSocketClient* client,
    const char* type,
    JsonVariantConst data) {
  JsonDocument out;
  out["type"] = type;
  out["data"].set(data);

  String body;
  serializeJson(out, body);
  client->text(body);
}

void WsProtocol::broadcast(const char* type, JsonDocument& data) {
  JsonDocument out;
  out["type"] = type;
  out["data"].set(data.as<JsonVariantConst>());

  String body;
  serializeJson(out, body);
  _ws.textAll(body);
}

void WsProtocol::sendCommandCenterInfo(AsyncWebSocketClient* client) {
  JsonDocument data;
  data["alive"] = _dcc.connected();
  data["power"] = _trackPower;
  data["type"] = "dcc-ex-tcp";
  data["name"] = "DCC-EX CommandStation";
  data["ip"] = _dcc.host();
  data["port"] = _dcc.port();
  data["connectionString"] = _dcc.host() + ":" + String(_dcc.port());
  send(client, "commandCenterInfo", data.as<JsonVariantConst>());
}

void WsProtocol::sendPowerInfo(AsyncWebSocketClient* client) {
  JsonDocument data;
  data["emergencyStop"] = _emergencyStop;
  data["trackVoltageOn"] = _trackPower;
  data["trackVoltageOff"] = !_trackPower;
  data["shortCircuit"] = false;
  data["programmingModeActive"] = _programmingPower;
  send(client, "powerInfo", data.as<JsonVariantConst>());
}

void WsProtocol::broadcastPowerInfo() {
  JsonDocument data;
  data["emergencyStop"] = _emergencyStop;
  data["trackVoltageOn"] = _trackPower;
  data["trackVoltageOff"] = !_trackPower;
  data["shortCircuit"] = false;
  data["programmingModeActive"] = _programmingPower;
  broadcast("powerInfo", data);
}

void WsProtocol::sendRuntimeSnapshot(AsyncWebSocketClient* client) {
  sendCommandCenterInfo(client);
  sendPowerInfo(client);

  for (const auto& item : _runtime.accessories()) {
    JsonDocument data;

    switch (item.kind) {
      case RuntimeAccessoryKind::Turnout:
        data["address"] = item.address;
        data["closed"] = item.closed;
        send(client, "turnoutChanged", data.as<JsonVariantConst>());
        break;
      case RuntimeAccessoryKind::Signal:
        if (item.aspect >= 0) {
          data["address"] = item.address;
          data["aspect"] = item.aspect;
          send(client, "signalAspectChanged", data.as<JsonVariantConst>());
        }
        break;
      case RuntimeAccessoryKind::Accessory:
        data["address"] = item.address;
        data["active"] = item.active;
        send(client, "accessoryChanged", data.as<JsonVariantConst>());
        break;
      case RuntimeAccessoryKind::VPin:
        data["vpin"] = item.address;
        data["active"] = item.active;
        send(client, "vpinChanged", data.as<JsonVariantConst>());
        break;
    }
  }

  for (const auto& sensor : _runtime.sensors()) {
    JsonDocument data;
    data["address"] = sensor.address;
    data["on"] = sensor.on;
    send(client, "sensorChanged", data.as<JsonVariantConst>());
  }
}

void WsProtocol::broadcastRuntimeSnapshot() {
  JsonDocument cc;
  cc["alive"] = _dcc.connected();
  cc["power"] = _trackPower;
  cc["type"] = "dcc-ex-tcp";
  cc["name"] = "DCC-EX CommandStation";
  cc["ip"] = _dcc.host();
  cc["port"] = _dcc.port();
  broadcast("commandCenterInfo", cc);
  broadcastPowerInfo();

  for (const auto& item : _runtime.accessories()) {
    JsonDocument data;
    switch (item.kind) {
      case RuntimeAccessoryKind::Turnout:
        data["address"] = item.address;
        data["closed"] = item.closed;
        broadcast("turnoutChanged", data);
        break;
      case RuntimeAccessoryKind::Signal:
        if (item.aspect >= 0) {
          data["address"] = item.address;
          data["aspect"] = item.aspect;
          broadcast("signalAspectChanged", data);
        }
        break;
      case RuntimeAccessoryKind::Accessory:
        data["address"] = item.address;
        data["active"] = item.active;
        broadcast("accessoryChanged", data);
        break;
      case RuntimeAccessoryKind::VPin:
        data["vpin"] = item.address;
        data["active"] = item.active;
        broadcast("vpinChanged", data);
        break;
    }
  }

  for (const auto& sensor : _runtime.sensors()) {
    JsonDocument data;
    data["address"] = sensor.address;
    data["on"] = sensor.on;
    broadcast("sensorChanged", data);
  }
}

void WsProtocol::broadcastRawInfo(const String& raw) {
  JsonDocument data;
  data["raw"] = raw;
  broadcast("rawInfo", data);
}

WsProtocol::LocoState* WsProtocol::getLoco(uint16_t address, bool create) {
  for (size_t i = 0; i < _locoCount; ++i) {
    if (_locos[i].address == address) return &_locos[i];
  }
  if (!create || _locoCount >= MAX_LOCOS) return nullptr;
  _locos[_locoCount].address = address;
  return &_locos[_locoCount++];
}

void WsProtocol::broadcastLoco(const LocoState& loco) {
  JsonDocument data;
  JsonObject out = data["loco"].to<JsonObject>();
  out["address"] = loco.address;
  out["speed"] = loco.speed;
  out["direction"] = loco.forward ? "forward" : "reverse";
  broadcast("locoState", data);
}

void WsProtocol::handleDccFrame(const String& frame) {
  broadcastRawInfo(frame);

  // <p0>, <p1>, and track-specific variants such as <p1 MAIN>
  if (frame.startsWith("<p0")) {
    const bool wasOn = _trackPower;
    _trackPower = false;
    _emergencyStop = false;
    if (wasOn) _stateStore.save();  // POWER OFF persistence policy
    broadcastPowerInfo();
    return;
  }

  if (frame.startsWith("<p1")) {
    _trackPower = true;
    _emergencyStop = false;
    broadcastPowerInfo();
    return;
  }
}

void WsProtocol::handleEvent(
    AsyncWebSocket*,
    AsyncWebSocketClient* client,
    AwsEventType type,
    void* arg,
    uint8_t* data,
    size_t len) {
  if (type == WS_EVT_CONNECT) {
    Logger::info("WS client connected #" + String(client->id()));
    JsonDocument welcome;
    welcome["message"] = "DCCExpressHub";
    send(client, "ws:welcome", welcome.as<JsonVariantConst>());
    sendRuntimeSnapshot(client);
    return;
  }

  if (type == WS_EVT_DISCONNECT) {
    Logger::info("WS client disconnected #" + String(client->id()));
    return;
  }

  if (type != WS_EVT_DATA) return;

  AwsFrameInfo* info = static_cast<AwsFrameInfo*>(arg);
  if (!info->final || info->index != 0 || info->len != len || info->opcode != WS_TEXT) {
    Logger::warn("Ignoring fragmented/non-text WS message");
    return;
  }

  String payload;
  payload.reserve(len + 1);
  for (size_t i = 0; i < len; ++i) payload += static_cast<char>(data[i]);
  handleMessage(client, payload);
}

void WsProtocol::handleMessage(
    AsyncWebSocketClient* client,
    const String& payload) {
  JsonDocument message;
  DeserializationError error = deserializeJson(message, payload);

  if (error) {
    JsonDocument data;
    data["message"] = error.c_str();
    send(client, "error", data.as<JsonVariantConst>());
    return;
  }

  const char* type = message["type"] | "";
  JsonObjectConst data = message["data"];

  if (strcmp(type, "heartbeat") == 0) {
    JsonDocument empty;
    send(client, "heartbeatAck", empty.as<JsonVariantConst>());
    sendCommandCenterInfo(client);
    sendPowerInfo(client);
    return;
  }

  if (strcmp(type, "setTrackPower") == 0) {
    const bool on = data["on"] | false;

    // Save BEFORE issuing OFF, so even if DCC-EX disappears during shutdown,
    // the last runtime state is persisted.
    if (!on) _stateStore.save();

    if (_dcc.sendCommand(on ? "<1>" : "<0>")) {
      // Optimistic state; DCC-EX <p0>/<p1> will converge it.
      _trackPower = on;
      _emergencyStop = false;
      broadcastPowerInfo();
    }
    return;
  }

  if (strcmp(type, "setProgrammingPower") == 0) {
    _programmingPower = data["on"] | false;
    broadcastPowerInfo();
    return;
  }

  if (strcmp(type, "emergencyStop") == 0) {
    _dcc.sendCommand("<!>");
    _emergencyStop = true;
    broadcastPowerInfo();
    return;
  }

  if (strcmp(type, "writeDccExDirectCommand") == 0) {
    const String command = data["command"] | "";
    const bool ok = _dcc.sendCommand(command);
    JsonDocument out;
    out["response"] = ok ? "sent" : "send failed";
    send(client, "dccExDirectCommandResponse", out.as<JsonVariantConst>());
    return;
  }

  if (strcmp(type, "setLoco") == 0) {
    const uint16_t address = data["locoAddress"] | 0;
    const uint8_t speed = min(126, max(0, data["speed"].as<int>()));
    const bool forward = strcmp(data["direction"] | "forward", "reverse") != 0;
    auto* loco = getLoco(address, true);
    if (!loco) return;

    loco->speed = speed;
    loco->forward = forward;

    // DCC-EX throttle: <t cab speed direction>, direction 1=forward, 0=reverse.
    _dcc.sendCommand(
        "<t " + String(address) + " " + String(speed) + " " +
        String(forward ? 1 : 0) + ">");

    broadcastLoco(*loco);
    return;
  }

  if (strcmp(type, "getLoco") == 0) {
    const uint16_t address = data["locoAddress"] | 0;
    auto* loco = getLoco(address, true);
    if (loco) broadcastLoco(*loco);
    return;
  }

  if (strcmp(type, "setLocoFunction") == 0) {
    const uint16_t address = data["locoAddress"] | 0;
    const uint8_t fn = data["functionNumber"] | 0;
    const bool active = data["active"] | false;

    // DCC-EX function command.
    _dcc.sendCommand(
        "<F " + String(address) + " " + String(fn) + " " +
        String(active ? 1 : 0) + ">");
    return;
  }

  if (strcmp(type, "setTurnout") == 0) {
    const uint16_t address = data["address"] | 0;
    const bool physicalValue = data["closed"] | false;

    _runtime.setTurnout(address, physicalValue);

    // Basic DCC accessory: lowercase <a address 0|1>.
    _dcc.sendCommand(
        "<a " + String(address) + " " +
        String(physicalValue ? 1 : 0) + ">");

    JsonDocument out;
    out["address"] = address;
    out["closed"] = physicalValue;
    broadcast("turnoutChanged", out);
    return;
  }

  if (strcmp(type, "setSignalAspect") == 0) {
    const uint16_t address = data["address"] | 0;
    const int aspect = data["aspect"] | 0;

    _runtime.setSignal(address, aspect);

    // Extended accessory / signal aspect: uppercase A.
    _dcc.sendCommand(
        "<A " + String(address) + " " + String(aspect) + ">");

    JsonDocument out;
    out["address"] = address;
    out["aspect"] = aspect;
    broadcast("signalAspectChanged", out);

    // Extended turnout uses the same command, but frontend includes its physical
    // turnout value so every client can update the turnout drawing.
    if (!data["turnoutPhysicalValue"].isNull()) {
      const bool physicalValue = data["turnoutPhysicalValue"].as<bool>();
      _runtime.setTurnout(address, physicalValue);

      JsonDocument turnout;
      turnout["address"] = address;
      turnout["closed"] = physicalValue;
      broadcast("turnoutChanged", turnout);
    }
    return;
  }

  if (strcmp(type, "setBasicAccessory") == 0) {
    const uint16_t address = data["address"] | 0;
    const bool active = data["active"] | false;

    _runtime.setAccessory(address, active);

    _dcc.sendCommand(
        "<a " + String(address) + " " + String(active ? 1 : 0) + ">");

    JsonDocument out;
    out["address"] = address;
    out["active"] = active;
    broadcast("accessoryChanged", out);
    return;
  }

  if (strcmp(type, "setVpin") == 0) {
    const uint16_t vpin = data["vpin"] | 0;
    const bool active = data["active"] | false;

    _runtime.setVPin(vpin, active);
    _dcc.sendCommand("<z " + String(active ? vpin : -static_cast<int>(vpin)) + ">");

    JsonDocument out;
    out["vpin"] = vpin;
    out["active"] = active;
    broadcast("vpinChanged", out);
    return;
  }

  if (strcmp(type, "setSensor") == 0) {
    const uint16_t address = data["address"] | 0;
    const bool on = data["on"] | false;
    _runtime.setSensor(address, on);

    JsonDocument out;
    out["address"] = address;
    out["on"] = on;
    broadcast("sensorChanged", out);
    return;
  }

  if (strcmp(type, "getLayoutRuntimeSnapshot") == 0) {
    sendRuntimeSnapshot(client);
    return;
  }

  JsonDocument ack;
  ack["ok"] = true;
  ack["message"] = String("Not implemented yet: ") + type;
  send(client, "ack", ack.as<JsonVariantConst>());
}
