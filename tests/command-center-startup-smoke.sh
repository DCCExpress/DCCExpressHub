#!/usr/bin/env bash
set -euo pipefail

# In-process backend acceptance test. No physical command station is needed:
# an unused TCP port is enough to verify the logical activation lifecycle.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
PORT=53174
BASE="http://127.0.0.1:${PORT}"

cleanup() {
  if [[ -n "${PID:-}" ]]; then kill "${PID}" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

export DCCEXPRESS_DESKTOP_URL="$BASE"
export ASPNETCORE_CONTENTROOT="$TMP"
export ASPNETCORE_WEBROOT="$TMP/wwwroot"
mkdir -p "$TMP/wwwroot"
dotnet "$ROOT/desktop/DCCExpressHub.Net/bin/Release/net10.0/DCCExpressHub.Net.dll" >"$TMP/backend.log" 2>&1 &
PID=$!

ready=0
for i in $(seq 1 60); do
  if curl -fsS --max-time 2 "$BASE/api/command-center/startup" >"$TMP/initial.json" 2>/dev/null; then
    ready=1; break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then break; fi
  sleep 0.25
done
if [[ "$ready" -ne 1 ]]; then
  cat "$TMP/backend.log"
  echo "ERROR: Backend startup endpoint unavailable" >&2
  exit 1
fi
grep -q '"started":false' "$TMP/initial.json"

BAD='vendor=dcc-ex&transport=z21&host=127.0.0.1&port=65001&serialPort=&rBusOffset=0&locoNetOffset=160&useLocoNet=false&commandIntervalMs=25'
code=$(curl -s -o "$TMP/bad.json" -w '%{http_code}' --max-time 5 -X POST -d "$BAD" "$BASE/api/command-center/startup/start")
if [[ "$code" != 400 ]]; then cat "$TMP/bad.json"; exit 1; fi

GOOD='vendor=dcc-ex&transport=tcp&host=127.0.0.1&port=65001&serialPort=&rBusOffset=0&locoNetOffset=160&useLocoNet=false&commandIntervalMs=25'
curl -fsS --max-time 5 -X POST -d "$GOOD" "$BASE/api/command-center/startup/start" >"$TMP/started.json"
grep -q '"started":true' "$TMP/started.json"

curl -fsS --max-time 3 "$BASE/api/command-center/startup" >"$TMP/active.json"
grep -q '"started":true' "$TMP/active.json"

curl -fsS --max-time 7 -X POST "$BASE/api/command-center/startup/stop" >"$TMP/stopped.json"
grep -q '"started":false' "$TMP/stopped.json"

curl -fsS --max-time 3 "$BASE/api/command-center/startup" >"$TMP/final.json"
grep -q '"started":false' "$TMP/final.json"

echo "Command Center startup smoke: initial disconnected -> reject invalid -> explicit OK -> stop -> disconnected PASS"
