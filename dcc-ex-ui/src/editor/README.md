# Original TrackCanvas integration boundary

The upstream editor is copied unchanged into `dcc-ex-ui/upstream-web-ui/src/` (from alpha6); there is **no new canvas renderer**.

For a working browser-only mount, the original `TrackCanvas` depends on `LayoutView`, `EditorTool`, `EditorSettingsContext`, `CommandCenterContext`, `trackCanvasDraw`, `trackCanvasMouseDown`, `trackCanvasMouseMove`, `trackCanvasKeyboard`, the original domain models, and the property editors. Its event handlers also pull in Movement, Dispatcher, Tracking and other backend services.

The port should reuse existing renderer, geometry, interactions, model and property editors. Remove automation-specific clickable actions and swap backend API calls for a browser adapter. Persist original layout DTO rather than inventing a new track schema. This is a dependency note, **not** a working UI.

Scope rule: edit only `dcc-ex-ui/`; do not change the original `web-ui/`.
