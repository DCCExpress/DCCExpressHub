# Original alpha6 editor source snapshot

This directory is a **read-only reference copy**, imported from `web-ui/` on the alpha7 branch base. The original `web-ui` has not been changed.

Source: `src/components/TrackCanvas.tsx`, `src/components/track-canvas/`, `src/models/editor/`, `src/layout/`, and `src/styles/`.

It is deliberately outside `dcc-ex-ui/src` because the original editor imports backend WebSocket services, automation state, context providers, and many other modules. Compiling it directly as a browser-only feature would be broken.

Next porting work must move the necessary editor components into `dcc-ex-ui/src`, replace backend services with IndexedDB/project state and manual DCC-EX commands, and remove automation dependencies. Do not edit `web-ui` or other top-level directories.
