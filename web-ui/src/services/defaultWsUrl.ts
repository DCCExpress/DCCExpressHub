export function getDefaultWsUrl(): string {
  const protocol =
    window.location.protocol === "https:"
      ? "wss"
      : "ws";

  return `${protocol}://${window.location.host}/ws`;
}
