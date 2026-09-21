# Firmware -> .NET parity audit

## Firmware HTTP API
[x] /api/command-center-info
[x] /api/locos GET/POST
[x] /api/layout GET/POST
[x] /api/signal-logic GET/POST
[x] /api/files/text
[x] /api/runtime
[x] /api/emergency-stop
[x] /api/status (native semantics)
[x] /fsinfo
[x] /list
[x] /delete
[x] /upload
[x] /api/storage/file
[x] /api/automations GET/POST
[x] /api/device-config GET/POST
[x] /api/s88-status
[x] /api/capabilities
[ ] /api/command-center-config GET/POST
[ ] /api/command-center-test
[ ] /api/script-info + SSE

## ESP-only HTTP
[not migrated] /api/settings/network - Wi-Fi provisioning is ESP-specific.
A native network/settings page should be a separate product-level decision rather than fake Wi-Fi state.

## Runtime / WebSocket
[x] core turnout/signal/accessory/vpin/sensor/block runtime
[x] core runtime snapshot
[x] block set/remove/reset/get
[ ] route graph, route locks and route reservations
[ ] loco reservations
[x] signal automation evaluator: NDJSON parser, sensor/turnout conditions, default/priority, extended/basic output, runtime-triggered evaluation
[ ] block automation
[ ] level crossing runtime
[ ] JS automation execution engine
[ ] script document/runtime engine
[ ] task manager
[ ] fast clock
[ ] runtime variables
[ ] app settings WS commands
[ ] file WS commands
[ ] full correlated programming state machine
[ ] exact DCC-EX telemetry polling / loco synchronization
[ ] server runtime stats

Important: HTTP signal-logic storage parity is implemented, but signal rule execution is not yet.

## Signal automation turnout parity fix
Fixed native LayoutRuntime turnout semantics to match firmware:
`setTurnout(address, physicalValue)` converts the decoder's physical bit to logical CLOSED/THROWN with
`logicalClosed = physicalValue == closedValue`.
This is required because compiled signal-logic turnout conditions are normalized against the same closedValue mapping.

## Full LayoutRuntime port
Replaced the earlier partial native LayoutRuntime with a direct C# port of the current firmware LayoutRuntime:
- exact deterministic numeric runtime-ID migration for UUID/string/missing/duplicate persisted IDs
- sensor-bearing element classification
- single and dual-motor turnout parsing and closedValue semantics
- signal/level-crossing parsing
- button runtime outputs
- live-state restoration across rebuilds
- duplicate physical sensor mirroring
- block single-locomotive authority semantics
- runtime diagnostics for turnout and signal automation evaluation

## ScriptInfoEndpoint port
Ported current firmware ScriptInfoEndpoint:
- GET /api/script-info
- POST /api/script-info
- SSE /api/script-info/events
- 32-entry runtime store
- exact executionId/ownerId/message length limits
- owner-safe clear and force-clear semantics
- snapshot and changed SSE events

## DCC-EX emergency pause/resume parity
Ported current CompiledCommandCenter emergency semantics:
- connection query: <!Q>
- first E-STOP toggle: <!P>
- second toggle: <!> followed by <!R>
- parse authoritative <!PAUSED> / <!RESUMED>
- power feedback no longer clears the emergency latch
- WebSocket powerInfo follows the authoritative pause state

## RuntimeStateStore port
Ported current firmware RuntimeStateStore:
- data/state/runtime-state.json
- version 2 persistence format
- turnout logical state persistence with physical closedValue conversion on restore
- signal/accessory/vpin/sensor state restore
- occupied block restore
- atomic temp-file save
- automatic save on MAIN power ON -> OFF transition
- startup restore

## Startup ordering fix
Matched firmware App.cpp startup order exactly:
LayoutRuntime -> RuntimeStateStore.Load -> SignalAutomationEngine.
Previously native instantiated SignalAutomation before restoring runtime state, allowing restore events/state to race with the automation engine and leave its applied-value cache inconsistent.

## CommandCenterEndpoint probe
Ported current DCC-EX `/api/command-center-test` behavior:
- form host/port validation
- DNS/IP resolution
- TCP probe independent of live command-center session
- sends `<#>`
- framed reply parser with `<` resync and 128-char guard
- success only on `<#...>` reply
- legacy response contract: tcpConnected, dccExAlive, reply, elapsedMs
- HTTP 200 success / 502 probe failure
