#!/usr/bin/env bash
# DCCExpressHub Linux configuration — mirrors desktop launcher.
set -Eeuo pipefail
export NCURSES_NO_UTF8_ACS=1
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT/desktop/DCCExpressHub.Net/.env.linux"
BACKEND_DIR="$ROOT/desktop/DCCExpressHub.Net"
WEB_ROOT="$ROOT/web-ui/dist"
[[ -t 0 && -t 1 ]] || { echo 'Interactive terminal required.' >&2; exit 1; }
if ! command -v dialog >/dev/null 2>&1; then
  command -v apt-get >/dev/null 2>&1 || { echo 'dialog is required.' >&2; exit 1; }
  read -r -p 'Install dialog now? [y/N] ' answer
  [[ "${answer,,}" == y || "${answer,,}" == yes ]] || exit 1
  if (( EUID == 0 )); then
    apt-get update && apt-get install -y --no-install-recommends dialog
  else
    command -v sudo >/dev/null 2>&1 || { echo 'sudo is needed to install dialog.' >&2; exit 1; }
    sudo apt-get update && sudo apt-get install -y --no-install-recommends dialog
  fi
fi
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"
protocol="${CommandCenter__Protocol:-dccex}"
case "$protocol" in
  dccex|dcc-ex|tcp)
    [[ "${DccEx__Transport:-Tcp}" == Serial ]] && protocol=serial || protocol=tcp ;;
  yamorc7010) protocol=z21 ;; # legacy profiles are not new choices
  z21|serial|loconet|loconet-serial) ;;
  *) protocol=tcp ;;
esac
declare -A s=(
  [tcp_host]="${DccEx__Host:-127.0.0.1}" [tcp_port]="${DccEx__Port:-2560}"
  [serial]="${DccEx__SerialPort:-/dev/ttyACM0}"
  [z21_host]="${Z21__Host:-127.0.0.1}" [z21_port]="${Z21__Port:-21105}"
  [rbus]="${Z21__RBusOffset:-0}"
  [ln_host]="${LocoNet__Host:-127.0.0.1}" [ln_port]="${LocoNet__LbServerPort:-1234}"
  [ln_serial]="${LocoNet__SerialPort:-/dev/ttyUSB0}"
  [ln_offset]="${LocoNet__SensorOffset:-0}"
  [workspace]="${DCCEXPRESS_CONTENT_ROOT:-$BACKEND_DIR}"
)
url="${DCCEXPRESS_HTTP_URL:-http://0.0.0.0:5174}"
mode=server; http_port=5174
if [[ "$url" =~ ^http://(127\.0\.0\.1|0\.0\.0\.0):([0-9]+)$ ]]; then
  [[ "${BASH_REMATCH[1]}" == 127.0.0.1 ]] && mode=local
  http_port="${BASH_REMATCH[2]}"
fi
out="$(mktemp)"
trap 'rm -f -- "$out"; printf "\033[0m"' EXIT
dirty=0; saved=0
ui() { : > "$out"; dialog --ascii-lines --backtitle 'DCCExpressHub | Linux settings' --output-fd 3 "$@" 3>"$out"; }
readval() { REPLY="$(cat "$out")"; }
message() { dialog --ascii-lines --msgbox "$1" 10 72; }
edit() {
  local key="$1" label="$2" next
  if ui --title "$label" --inputbox "$label" 10 72 "${s[$key]}"; then
    readval; next="$REPLY"
    if [[ "$next" != "${s[$key]}" ]]; then s[$key]="$next"; dirty=1; fi
  fi
  return 0
}
change_protocol() {
  if ui --title 'Command station' --menu 'Select protocol' 17 76 6 \
    tcp 'DCC-EX TCP' serial 'DCC-EX Serial' z21 'Z21 + R-BUS' \
    loconet 'LocoNet TCP' loconet-serial 'LocoNet Serial'; then
    readval
    if [[ "$REPLY" != "$protocol" ]]; then protocol="$REPLY"; dirty=1; fi
  fi
  return 0
}
serial_devices() {
  local key="$1" file
  local -a items=(manual 'Enter device manually')
  for file in /dev/serial/by-id