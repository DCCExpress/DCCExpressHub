#include "JsSandboxEndpoint.h"

#if HUB_JS_SANDBOX

#include <ArduinoJson.h>

#include "Logger.h"

void JsSandboxEndpoint::sendJson(
    AsyncWebServerRequest* request,
    int status,
    JsonDocument& document) {
  String body;

  serializeJson(
      document,
      body);

  auto* response =
      request
          ->beginResponse(
              status,
              "application/json",
              body);

  response
      ->addHeader(
          "Cache-Control",
          "no-store");

  request
      ->send(
          response);
}

String JsSandboxEndpoint::defaultSource() {
  return
      R"JS(hub.log("Async Sandbox started");

async function task1() {
  for (let i = 0; i < 8; i++) {
    hub.log(`task1 ${i}`);
    hub.setLocoFunction(18, 0, (i % 2) === 0);
    await hub.delay(1000);
  }

  hub.setLocoFunction(18, 0, false);
  hub.log("task1 finished");
}

async function task2() {
  for (let i = 0; i < 16; i++) {
    hub.log(`task2 ${i}`);
    await hub.delay(500);
  }

  hub.log("task2 finished");
}

async function main() {
  await Promise.all([
    task1(),
    task2(),
  ]);

  hub.log("All async tasks finished");
}

main();
)JS";
}

JsSandboxEndpoint::JsSandboxEndpoint(
    AsyncWebServer& server,
    ICommandCenter& commandCenter,
    LayoutRuntime& runtime)
    : _sandbox(
          commandCenter,
          runtime) {
  _sandbox.begin();
  registerRoutes(
      server);
}

void JsSandboxEndpoint::registerRoutes(
    AsyncWebServer& server) {
  server.on(
      "/api/dev/js-sandbox/status",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        sendStatus(
            request);
      });

  server.on(
      "/api/dev/js-sandbox/source",
      HTTP_GET,
      [](
          AsyncWebServerRequest* request) {
        String source;

        if (
            LittleFS.exists(
                SOURCE_PATH)
        ) {
          File file =
              LittleFS.open(
                  SOURCE_PATH,
                  "r");

          if (file) {
            source =
                file.readString();

            file.close();
          }
        }

        if (source.isEmpty()) {
          source =
              defaultSource();
        }

        JsonDocument document;
        document["ok"] =
            true;
        document["source"] =
            source;

        sendJson(
            request,
            200,
            document);
      });

  server.on(
      "/api/dev/js-sandbox/source",
      HTTP_POST,
      [](
          AsyncWebServerRequest* request) {
        JsonDocument document;

        if (
            !request->hasParam(
                "code",
                true)
        ) {
          document["ok"] =
              false;
          document["message"] =
              "Missing form field: code";

          sendJson(
              request,
              400,
              document);

          return;
        }

        const String source =
            request
                ->getParam(
                    "code",
                    true)
                ->value();

        if (
            source.length() >
            32768U
        ) {
          document["ok"] =
              false;
          document["message"] =
              "Sandbox source exceeds 32 KB";

          sendJson(
              request,
              413,
              document);

          return;
        }

        if (
            !LittleFS.exists(
                "/scripts")
        ) {
          LittleFS.mkdir(
              "/scripts");
        }

        File file =
            LittleFS.open(
                SOURCE_PATH,
                "w");

        if (!file) {
          document["ok"] =
              false;
          document["message"] =
              "Could not open sandbox.js for writing";

          sendJson(
              request,
              500,
              document);

          return;
        }

        const size_t written =
            file.print(
                source);

        file.flush();
        file.close();

        const bool ok =
            written ==
            source.length();

        document["ok"] =
            ok;
        document["bytes"] =
            written;

        if (!ok) {
          document["message"] =
              "Sandbox source write was incomplete";
        }

        sendJson(
            request,
            ok
                ? 200
                : 500,
            document);
      });

  server.on(
      "/api/dev/js-sandbox/start",
      HTTP_POST,
      [this](
          AsyncWebServerRequest* request) {
        JsonDocument document;

        if (
            !request->hasParam(
                "code",
                true)
        ) {
          document["ok"] =
              false;
          document["message"] =
              "Missing form field: code";

          sendJson(
              request,
              400,
              document);

          return;
        }

        String error;

        const bool ok =
            _sandbox.start(
                request
                    ->getParam(
                        "code",
                        true)
                    ->value(),
                error);

        document["ok"] =
            ok;

        if (!ok) {
          document["message"] =
              error;
        }

        sendJson(
            request,
            ok
                ? 202
                : 409,
            document);
      });

  server.on(
      "/api/dev/js-sandbox/pause",
      HTTP_POST,
      [this](
          AsyncWebServerRequest* request) {
        String error;
        const bool ok =
            _sandbox.pause(
                error);

        JsonDocument document;
        document["ok"] = ok;

        if (!ok) {
          document["message"] = error;
        }

        sendJson(
            request,
            ok ? 200 : 409,
            document);
      });

  server.on(
      "/api/dev/js-sandbox/resume",
      HTTP_POST,
      [this](
          AsyncWebServerRequest* request) {
        String error;
        const bool ok =
            _sandbox.resume(
                error);

        JsonDocument document;
        document["ok"] = ok;

        if (!ok) {
          document["message"] = error;
        }

        sendJson(
            request,
            ok ? 200 : 409,
            document);
      });

  server.on(
      "/api/dev/js-sandbox/stop",
      HTTP_POST,
      [this](
          AsyncWebServerRequest* request) {
        String error;
        const bool ok =
            _sandbox.stop(
                error);

        JsonDocument document;
        document["ok"] = ok;

        if (!ok) {
          document["message"] = error;
        }

        sendJson(
            request,
            ok ? 200 : 409,
            document);
      });

  server.on(
      "/api/dev/js-sandbox/abort",
      HTTP_POST,
      [this](
          AsyncWebServerRequest* request) {
        String error;
        const bool ok =
            _sandbox.abort(
                error);

        JsonDocument document;
        document["ok"] = ok;

        if (!ok) {
          document["message"] = error;
        }

        sendJson(
            request,
            ok ? 200 : 409,
            document);
      });
}

void JsSandboxEndpoint::sendStatus(
    AsyncWebServerRequest* request) {
  const JsSandboxSnapshot snapshot =
      _sandbox.snapshot();

  JsonDocument document;
  document["ok"] =
      true;
  document["state"] =
      snapshot.stateText;
  document["error"] =
      snapshot.lastError;
  document["log"] =
      snapshot.log;
  document["startedAtMs"] =
      snapshot.startedAtMs;
  document["finishedAtMs"] =
      snapshot.finishedAtMs;
  document["totalHeap"] =
      snapshot.totalHeap;
  document["freeHeap"] =
      snapshot.freeHeap;
  document["minFreeHeap"] =
      snapshot.minFreeHeap;
  document["largestFreeHeapBlock"] =
      snapshot.largestFreeHeapBlock;

  document["totalPsram"] =
      snapshot.totalPsram;
  document["freePsram"] =
      snapshot.freePsram;
  document["minFreePsram"] =
      snapshot.minFreePsram;
  document["largestFreePsramBlock"] =
      snapshot.largestFreePsramBlock;

  document["baselineFreeHeap"] =
      snapshot.baselineFreeHeap;
  document["baselineFreePsram"] =
      snapshot.baselineFreePsram;
  document["heapDeltaSinceStart"] =
      snapshot.heapDeltaSinceStart;
  document["psramDeltaSinceStart"] =
      snapshot.psramDeltaSinceStart;

  document["sourceBytes"] =
      snapshot.sourceBytes;
  document["vmMemoryLimitBytes"] =
      snapshot.vmMemoryLimitBytes;
  document["taskStackBytes"] =
      snapshot.taskStackBytes;

  sendJson(
      request,
      200,
      document);
}

#else

JsSandboxEndpoint::JsSandboxEndpoint(
    AsyncWebServer&,
    ICommandCenter&,
    LayoutRuntime&) {}

#endif
