/*
 * Movement is declarative input only.
 *
 * Physical execution authority was moved to dispatcherExecutionRuntime.ts.
 * This file intentionally owns no locomotive throttle/direction commands,
 * block targets, safety waits, resource locks or turnout/SwitchMan control.
 *
 * Runtime consumers must enter through dispatcherRuntime.ts. Keeping this
 * marker module makes the architectural boundary explicit and prevents the
 * old Movement Engine from silently regaining execution responsibility.
 */
export {};
