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
# Present full protocol names everywhere. Internal identifiers must never leak
# into user-facing menus (tcp vs loconet TCP would be ambiguous).
protocol_label() {
  case "$protocol" in
    tcp) printf 'DCC-EX TCP' ;;
    serial) printf 'DCC-EX Serial' ;;
    z21) printf 'Z21 + R-BUS' ;;
    loconet) printf 'LocoNet TCP' ;;
    loconet-serial) printf 'LocoNet Serial' ;;
  esac
}
connection_summary() {
  case "$protocol" in
    tcp) printf 'DCC-EX TCP (%s:%s)' "${s[tcp_host]}" "${s[tcp_port]}" ;;
    serial) printf 'DCC-EX Serial (%s)' "${s[serial]}" ;;
    z21) printf 'Z21 + R-BUS (%s:%s UDP)' "${s[z21_host]}" "${s[z21_port]}" ;;
    loconet) printf 'LocoNet TCP (%s:%s)' "${s[ln_host]}" "${s[ln_port]}" ;;
    loconet-serial) printf 'LocoNet Serial (%s)' "${s[ln_serial]}" ;;
  esac
}
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
  if ui --no-tags --title 'Command station' --menu 'Select protocol' 17 76 6 \
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
  for file in /dev/serial/by-id/* /dev/ttyACM* /dev/ttyUSB*; do
    [[ -e "$file" ]] && items+=("$file" 'Serial device')
  done
  if ui --title 'Serial devices' --menu 'Select device' 20 76 11 "${items[@]}"; then
    readval
    if [[ "$REPLY" == manual ]]; then edit "$key" 'Serial device'
    elif [[ "$REPLY" != "${s[$key]}" ]]; then s[$key]="$REPLY"; dirty=1
    fi
  fi
  return 0
}
connection() {
  local selected
  while true; do
    case "$protocol" in
      tcp)
        ui --title 'DCC-EX TCP' --menu 'Connection settings' 16 77 5 \
          1 'Protocol: DCC-EX TCP' 2 "IP / host: ${s[tcp_host]}" 3 "TCP port: ${s[tcp_port]}" || return 0 ;;
      serial)
        ui --title 'DCC-EX Serial' --menu 'Connection settings' 16 77 5 \
          1 'Protocol: DCC-EX Serial' 2 "Serial device: ${s[serial]}" 4 'Choose serial device' || return 0 ;;
      z21)
        ui --title 'Z21 + R-BUS' --menu 'Connection settings' 17 77 6 \
          1 'Protocol: Z21 + R-BUS' 2 "IP / host: ${s[z21_host]}" 3 "UDP port: ${s[z21_port]}" 5 "R-BUS offset: ${s[rbus]}" || return 0 ;;
      loconet)
        ui --title 'LocoNet TCP' --menu 'Connection settings' 17 77 6 \
          1 'Protocol: LocoNet TCP' 2 "IP / host: ${s[ln_host]}" 3 "TCP port: ${s[ln_port]}" 6 "Sensor offset: ${s[ln_offset]}" || return 0 ;;
      loconet-serial)
        ui --title 'LocoNet Serial' --menu 'Connection settings' 17 77 6 \
          1 'Protocol: LocoNet Serial' 2 "Serial device: ${s[ln_serial]}" 4 'Choose serial device' 6 "Sensor offset: ${s[ln_offset]}" || return 0 ;;
    esac
    readval; selected="$REPLY"
    case "$selected" in
      1) change_protocol ;;
      2) case "$protocol" in
           tcp) edit tcp_host 'IP / host' ;; serial) edit serial 'Serial device' ;;
           z21) edit z21_host 'IP / host' ;; loconet) edit ln_host 'IP / host' ;;
           loconet-serial) edit ln_serial 'Serial device' ;; esac ;;
      3) case "$protocol" in
           tcp) edit tcp_port 'TCP port' ;; z21) edit z21_port 'UDP port' ;;
           loconet) edit ln_port 'TCP port' ;; esac ;;
      4) [[ "$protocol" == serial ]] && serial_devices serial || serial_devices ln_serial ;;
      5) edit rbus 'R-BUS offset' ;;
      6) edit ln_offset 'Sensor offset' ;;
    esac
  done
}
web_settings() {
  local chosen
  while true; do
    ui --title 'Web server' --menu 'Local or LAN access' 15 76 5 \
      1 "Mode: $mode" 2 "HTTP port: $http_port" || return 0
    readval; chosen="$REPLY"
    case "$chosen" in
      1) if ui --title 'Run mode' --menu 'Select mode' 12 68 4 \
            local 'Local (127.0.0.1)' server 'Server (0.0.0.0)'; then
           readval
           if [[ "$REPLY" != "$mode" ]]; then mode="$REPLY"; dirty=1; fi
         fi ;;
      2) if ui --title 'HTTP port' --inputbox 'HTTP port' 10 70 "$http_port"; then
           readval
           if [[ "$REPLY" != "$http_port" ]]; then http_port="$REPLY"; dirty=1; fi
         fi ;;
    esac
  done
}
valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)); }
valid_offset() { [[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 <= $2)); }
valid_host() { [[ -n "$1" && ! "$1" =~ [[:space:]] ]]; }
validate() {
  valid_port "$http_port" || { message 'Invalid HTTP port (1-65535).'; return 1; }
  [[ "${s[workspace]}" == /* ]] || { message 'Workspace must be an absolute Linux path.'; return 1; }
  case "$protocol" in
    tcp) valid_host "${s[tcp_host]}" && valid_port "${s[tcp_port]}" || { message 'Invalid DCC-EX TCP host/port.'; return 1; } ;;
    serial) [[ -n "${s[serial]}" ]] || { message 'Serial device is required.'; return 1; } ;;
    z21) valid_host "${s[z21_host]}" && valid_port "${s[z21_port]}" && valid_offset "${s[rbus]}" 65375 || { message 'Invalid Z21 host/port/R-BUS offset.'; return 1; } ;;
    loconet) valid_host "${s[ln_host]}" && valid_port "${s[ln_port]}" && valid_offset "${s[ln_offset]}" 61439 || { message 'Invalid LocoNet host/port/offset.'; return 1; } ;;
    loconet-serial) [[ -n "${s[ln_serial]}" ]] && valid_offset "${s[ln_offset]}" 61439 || { message 'Invalid LocoNet serial/offset.'; return 1; } ;;
  esac
  return 0
}
connection_test() {
  validate || return 0
  local host port device
  case "$protocol" in
    tcp) host="${s[tcp_host]}"; port="${s[tcp_port]}" ;;
    loconet) host="${s[ln_host]}"; port="${s[ln_port]}" ;;
    serial) device="${s[serial]}" ;;
    loconet-serial) device="${s[ln_serial]}" ;;
    z21) message 'Z21 is UDP. A genuine Z21 response test is not yet implemented here.'; return 0 ;;
  esac
  if [[ -n "${device:-}" ]]; then
    if [[ -e "$device" && -r "$device" && -w "$device" ]]; then
      message "$(protocol_label): Serial device accessible: $device (protocol not verified)."
    else message "$(protocol_label): Serial device missing/inaccessible: $device"; fi
  elif command -v timeout >/dev/null 2>&1; then
    if timeout 3 bash -c 'exec 3<>/dev/tcp/"$1"/"$2"' _ "$host" "$port" 2>/dev/null; then
      message "$(protocol_label): TCP socket open: $host:$port (protocol not verified)."
    else message "$(protocol_label): TCP connection failed: $host:$port"; fi
  else message 'TCP test requires the standard timeout command.'; fi
}
known_key() {
  case "$1" in
    DCCEXPRESS_HTTP_URL|DCCEXPRESS_CONTENT_ROOT|DCCEXPRESS_WEB_ROOT|CommandCenter__Protocol|DccEx__Transport|DccEx__Host|DccEx__Port|DccEx__SerialPort|DccEx__BaudRate|Z21__Host|Z21__Port|Z21__RBusOffset|LocoNet__Host|LocoNet__LbServerPort|LocoNet__SensorOffset|LocoNet__LbServerFeedback|LocoNet__BinaryFeedback|LocoNet__BinaryPort|LocoNet__SerialPort|LocoNet__SerialBaudRate|LocoNet__SerialFeedback) return 0 ;;
    *) return 1 ;;
  esac
}
put() { printf 'export %s=%q\n' "$1" "$2" >> "$temp_env"; }
save_settings() {
  validate || return 0
  dialog --ascii-lines --yesno 'Save configuration? A backup of the current file will be created.' 9 72 || return 0
  local line key backup
  mkdir -p -- "$(dirname -- "$ENV_FILE")"
  temp_env="$(mktemp "$(dirname -- "$ENV_FILE")/.env.linux.tmp.XXXXXX")"
  chmod 600 "$temp_env"
  if [[ -f "$ENV_FILE" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]]; then
        key="${BASH_REMATCH[2]}"
        known_key "$key" && continue
      fi
      printf '%s\n' "$line" >> "$temp_env"
    done < "$ENV_FILE"
    backup="$ENV_FILE.bak.$(date +%Y%m%d-%H%M%S)"
    cp -p -- "$ENV_FILE" "$backup"
  fi
  put DCCEXPRESS_HTTP_URL "http://$([[ "$mode" == local ]] && printf 127.0.0.1 || printf 0.0.0.0):$http_port"
  put DCCEXPRESS_CONTENT_ROOT "${s[workspace]}"
  put DCCEXPRESS_WEB_ROOT "$WEB_ROOT"
  case "$protocol" in
    tcp) put CommandCenter__Protocol dccex; put DccEx__Transport Tcp; put DccEx__Host "${s[tcp_host]}"; put DccEx__Port "${s[tcp_port]}" ;;
    serial) put CommandCenter__Protocol dccex; put DccEx__Transport Serial; put DccEx__SerialPort "${s[serial]}" ;;
    z21) put CommandCenter__Protocol z21; put Z21__Host "${s[z21_host]}"; put Z21__Port "${s[z21_port]}"; put Z21__RBusOffset "${s[rbus]}" ;;
    loconet) put CommandCenter__Protocol loconet; put LocoNet__Host "${s[ln_host]}"; put LocoNet__LbServerPort "${s[ln_port]}"; put LocoNet__SensorOffset "${s[ln_offset]}"; put LocoNet__LbServerFeedback false; put LocoNet__BinaryFeedback false ;;
    loconet-serial) put CommandCenter__Protocol loconet-serial; put LocoNet__SerialPort "${s[ln_serial]}"; put LocoNet__SerialBaudRate 115200; put LocoNet__SerialFeedback true; put LocoNet__SensorOffset "${s[ln_offset]}"; put LocoNet__LbServerFeedback false; put LocoNet__BinaryFeedback false ;;
  esac
  mv -f -- "$temp_env" "$ENV_FILE"
  saved=1; dirty=0
  message 'Saved. Restart the Hub to apply changes.'
}
exit_menu() {
  if ((dirty)); then
    dialog --ascii-lines --yesno 'Discard unsaved changes and exit?' 9 63
  else return 0; fi
}
while true; do
  ui --title 'DCCExpressHub Linux' --menu 'Configuration' 19 80 8 \
    1 "Command station: $(connection_summary)" 2 "Web server: $mode / HTTP port $http_port" \
    3 "Workspace: ${s[workspace]}" 4 "Test $(protocol_label) connection" \
    5 'Save settings' 6 'Exit' || { exit_menu && break; continue; }
  readval
  case "$REPLY" in
    1) connection ;; 2) web_settings ;; 3) edit workspace 'Workspace directory' ;;
    4) connection_test ;; 5) save_settings ;; 6) exit_menu && break ;;
  esac
done
((saved)) && exit 0 || exit 2
