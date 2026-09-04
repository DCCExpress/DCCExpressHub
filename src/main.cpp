#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include "config.h"

namespace {
WebServer server(80);
WiFiClient csbClient;
Preferences prefs;

String csbHost = DEFAULT_CSB1_HOST;
uint16_t csbPort = DEFAULT_CSB1_PORT;
String rxLine;

constexpr size_t LOG_CAPACITY = 80;
String logLines[LOG_CAPACITY];
size_t logStart = 0;
size_t logCount = 0;

void addLog(const String &line) {
  String stamped = String(millis()) + " ms  " + line;
  if (logCount < LOG_CAPACITY) {
    logLines[(logStart + logCount) % LOG_CAPACITY] = stamped;
    ++logCount;
  } else {
    logLines[logStart] = stamped;
    logStart = (logStart + 1) % LOG_CAPACITY;
  }
  Serial.println(stamped);
}

void addCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

void sendJson(int code, JsonDocument &doc) {
  String body;
  serializeJson(doc, body);
  addCors();
  server.send(code, "application/json", body);
}

bool ensureCsbConnection() {
  if (csbClient.connected()) return true;
  csbClient.stop();
  addLog("CSB1 connecting to " + csbHost + ":" + String(csbPort));
  if (!csbClient.connect(csbHost.c_str(), csbPort, 1200)) {
    addLog("CSB1 connection failed");
    return false;
  }
  csbClient.setNoDelay(true);
  addLog("CSB1 connected");
  return true;
}

bool sendDccCommand(String command) {
  command.trim();
  if (command.isEmpty()) return false;
  if (!command.startsWith("<")) command = "<" + command;
  if (!command.endsWith(">")) command += ">";
  if (!ensureCsbConnection()) return false;

  size_t written = csbClient.print(command);
  csbClient.print('\n');
  if (written == 0) {
    addLog("TX failed: " + command);
    return false;
  }
  addLog("TX  " + command);
  return true;
}

void pollCsb() {
  if (!csbClient.connected()) return;
  while (csbClient.available()) {
    char c = static_cast<char>(csbClient.read());
    if (c == '\r') continue;
    if (c == '\n') {
      if (!rxLine.isEmpty()) {
        addLog("RX  " + rxLine);
        rxLine.clear();
      }
    } else {
      rxLine += c;
      if (rxLine.length() > 512) {
        addLog("RX  " + rxLine);
        rxLine.clear();
      }
    }
  }
}

void serveGzip(const char *path, const char *mime) {
  File file = LittleFS.open(path, "r");
  if (!file) {
    server.send(404, "text/plain", "Not found");
    return;
  }
  server.sendHeader("Content-Encoding", "gzip");
  server.sendHeader("Cache-Control", String(path).indexOf("/assets/") >= 0 ? "public, max-age=31536000, immutable" : "no-cache");
  server.streamFile(file, mime);
  file.close();
}

void setupApi() {
  server.on("/api/status", HTTP_GET, []() {
    JsonDocument doc;
    doc["wifiConnected"] = WiFi.status() == WL_CONNECTED;
    doc["wifiSsid"] = WiFi.SSID();
    doc["deviceIp"] = WiFi.localIP().toString();
    doc["rssi"] = WiFi.RSSI();
    doc["csbConnected"] = csbClient.connected();
    doc["csbHost"] = csbHost;
    doc["csbPort"] = csbPort;
    doc["uptimeMs"] = millis();
    sendJson(200, doc);
  });

  server.on("/api/config", HTTP_GET, []() {
    JsonDocument doc;
    doc["host"] = csbHost;
    doc["port"] = csbPort;
    sendJson(200, doc);
  });

  server.on("/api/config", HTTP_POST, []() {
    JsonDocument body;
    DeserializationError err = deserializeJson(body, server.arg("plain"));
    if (err || !body["host"].is<const char *>() || !body["port"].is<int>()) {
      JsonDocument out;
      out["ok"] = false;
      out["error"] = "Expected JSON: { host, port }";
      sendJson(400, out);
      return;
    }

    String newHost = body["host"].as<String>();
    int newPort = body["port"].as<int>();
    newHost.trim();
    if (newHost.isEmpty() || newPort < 1 || newPort > 65535) {
      JsonDocument out;
      out["ok"] = false;
      out["error"] = "Invalid host or port";
      sendJson(400, out);
      return;
    }

    csbHost = newHost;
    csbPort = static_cast<uint16_t>(newPort);
    prefs.putString("csbHost", csbHost);
    prefs.putUShort("csbPort", csbPort);
    csbClient.stop();
    addLog("Config saved: " + csbHost + ":" + String(csbPort));

    JsonDocument out;
    out["ok"] = true;
    out["host"] = csbHost;
    out["port"] = csbPort;
    sendJson(200, out);
  });

  server.on("/api/command", HTTP_POST, []() {
    JsonDocument body;
    DeserializationError err = deserializeJson(body, server.arg("plain"));
    String command = body["command"] | "";
    JsonDocument out;
    if (err || command.isEmpty()) {
      out["ok"] = false;
      out["error"] = "Expected JSON: { command }";
      sendJson(400, out);
      return;
    }
    out["ok"] = sendDccCommand(command);
    if (!out["ok"].as<bool>()) out["error"] = "CSB1 is not reachable";
    sendJson(out["ok"].as<bool>() ? 200 : 502, out);
  });

  server.on("/api/power", HTTP_POST, []() {
    JsonDocument body;
    deserializeJson(body, server.arg("plain"));
    bool on = body["on"] | false;
    bool ok = sendDccCommand(on ? "<1>" : "<0>");
    JsonDocument out;
    out["ok"] = ok;
    out["power"] = on;
    if (!ok) out["error"] = "CSB1 is not reachable";
    sendJson(ok ? 200 : 502, out);
  });

  server.on("/api/log", HTTP_GET, []() {
    JsonDocument doc;
    JsonArray lines = doc["lines"].to<JsonArray>();
    for (size_t i = 0; i < logCount; ++i) {
      lines.add(logLines[(logStart + i) % LOG_CAPACITY]);
    }
    sendJson(200, doc);
  });

  server.on("/api/log", HTTP_DELETE, []() {
    logStart = 0;
    logCount = 0;
    JsonDocument doc;
    doc["ok"] = true;
    sendJson(200, doc);
  });

  server.on("/api/connect", HTTP_POST, []() {
    JsonDocument doc;
    doc["ok"] = ensureCsbConnection();
    sendJson(doc["ok"].as<bool>() ? 200 : 502, doc);
  });

  server.on("/api/status", HTTP_OPTIONS, []() { addCors(); server.send(204); });
  server.on("/api/config", HTTP_OPTIONS, []() { addCors(); server.send(204); });
  server.on("/api/command", HTTP_OPTIONS, []() { addCors(); server.send(204); });
  server.on("/api/power", HTTP_OPTIONS, []() { addCors(); server.send(204); });
  server.on("/api/log", HTTP_OPTIONS, []() { addCors(); server.send(204); });
  server.on("/api/connect", HTTP_OPTIONS, []() { addCors(); server.send(204); });
}

void setupWeb() {
  setupApi();

  server.on("/", HTTP_GET, []() { serveGzip("/index.html.gz", "text/html"); });
  server.onNotFound([]() {
    String uri = server.uri();
    if (uri.startsWith("/api/")) {
      server.send(404, "application/json", "{\"error\":\"API route not found\"}");
      return;
    }
    String gzPath = uri + ".gz";
    if (LittleFS.exists(gzPath)) {
      const char *mime = "application/octet-stream";
      if (uri.endsWith(".js")) mime = "application/javascript";
      else if (uri.endsWith(".css")) mime = "text/css";
      else if (uri.endsWith(".svg")) mime = "image/svg+xml";
      else if (uri.endsWith(".html")) mime = "text/html";
      serveGzip(gzPath.c_str(), mime);
      return;
    }
    serveGzip("/index.html.gz", "text/html");
  });

  server.begin();
  addLog("HTTP server started on port 80");
}
} // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("DCCExpressHub booting...");

  prefs.begin("dccnano", false);
  csbHost = prefs.getString("csbHost", DEFAULT_CSB1_HOST);
  csbPort = prefs.getUShort("csbPort", DEFAULT_CSB1_PORT);

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed");
  }

  WiFi.mode(WIFI_STA);
  WiFi.setHostname(DEVICE_HOSTNAME);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.printf("Connecting to Wi-Fi '%s'", WIFI_SSID);
  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) {
    delay(300);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    addLog("Wi-Fi connected: " + WiFi.localIP().toString());
  } else {
    addLog("Wi-Fi connection failed; HTTP UI is unavailable until Wi-Fi connects");
  }

  setupWeb();
}

void loop() {
  server.handleClient();
  pollCsb();
  delay(1);
}
