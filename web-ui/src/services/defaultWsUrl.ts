// export function getDefaultWsUrl(): string {
//   /*
//    * Local Vite development talks directly to the Node mock.
//    * This deliberately bypasses the Vite WebSocket proxy so that
//    * stale/incorrect dev-server ports cannot silently route the UI
//    * to another backend.
//    */
//   if (import.meta.env.DEV) {
//     const mockUrl =
//       import.meta.env.VITE_MOCK_WS_URL as string | undefined;

//     return mockUrl?.trim() || "ws://127.0.0.1:3001/ws";
//   }

//   const protocol =
//     window.location.protocol === "https:"
//       ? "wss"
//       : "ws";

//   const configuredPort =
//     import.meta.env.VITE_WS_PORT as string | undefined;

//   const host = configuredPort
//     ? `${window.location.hostname}:${configuredPort}`
//     : window.location.host;

//   return `${protocol}://${host}/ws`;
// }
export function getDefaultWsUrl(): string {
  const protocol =
    window.location.protocol === "https:"
      ? "wss"
      : "ws";

  return `${protocol}://${window.location.host}/ws`;
}