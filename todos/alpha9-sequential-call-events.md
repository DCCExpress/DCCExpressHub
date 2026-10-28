# Alpha9 TODO – Sequential Movement Call Events

Status: **Deferred to alpha9**. Do not implement in alpha8.

## Goal

Allow a Sequential Movement to call an existing enabled Script or Flow on selected sequence/block events. The event should use a stable target ID, not the display name.

## Proposed event types

- **On Enter**: the tracked train reaches the block.
- **On Stop**: the train has actually stopped in the block.
- **Before Departure**: just before departing the block.
- **On Exit**: the train has cleared the block.
- Optionally **Sequence Start** and **Sequence Finish** at the sequence level rather than attached to a block.

## Configuration

Each event should specify:

- Event type.
- Target type: Script or Flow.
- Target ID selected from enabled saved targets.
- Execution mode: **Wait for completion** or **Start and continue**.
- Failure policy: stop the sequence or skip the event and continue.

Allow more than one event per block, with explicitly defined order.

## Runtime requirements

- Execute via the authoritative .NET ScriptRuntime / FlowRuntime; do not create a second browser-side engine.
- Recheck target existence and **enabled** state immediately before execution.
- Handle missing/disabled targets, already-running scripts, cancellation, errors and timeouts explicitly.
- For callable Flows, use a dedicated **Call Trigger** so a call does not activate unrelated event branches.
- Define event semantics from real movement/tracking state, not simply a raw sensor edge.
- Ensure Stop / Abort / Finish behavior remains safe while waiting on an event.
- Add tests for serialization, event ordering, enable checks, repeat cycles and interruption.

## Notes

Inspired by Rocrail Actions / Action Control, but tailored to DCCExpress's Sequential Movement runtime. This is a design backlog item only, not an alpha8 implementation.
