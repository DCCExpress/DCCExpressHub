#!/usr/bin/env bash
# DCCExpressHub dialog configuration UI for Debian/Linux.
set -Eeuo pipefail
# Render Unicode box-drawing characters correctly over UTF-8 SSH terminals.
export NCURSES_NO_UTF8_ACS=1
# Force portable line drawing: avoids literal ACS letters (l, q, x, k) over SSH.
# ASCII corners/lines are preferable to broken terminal escape rendering.
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT/desktop/DCCExpressHub.Net/.env.linux"
BACKEND_DIR="$ROOT/desktop/DCCExpressHub.Net"
WEBUI_DIST="$ROOT/web-ui/dist"
export DIALOGRC="${DIALOGRC:-}"
if [[ ! -t 0 || ! -t 1 ]]; then echo "An interactive terminal (SSH with TTY) is required." >&2; exit 1; fi
if ! command -v dialog >/dev/null 2>&1; then
  echo "The small 'dialog' package is required for the terminal UI."
  if ! command -v apt-get >/dev/null 2>&1; then echo "Install dialog using your system package manager." >&2; exit 1; fi
  read -r -p "Install dialog now via apt-get? [y/N] " answer
  [[ "${answer,,}" == "y" || "${answer,,}" == "yes" ]] || exit 1
  if [[ "$EUID" -eq 0 ]]; then
    apt-get update && apt-get install -y --no-install-recommends dialog
  else
    command -v sudo >/dev/null 2>&1 || { echo "sudo is required to install dialog." >&2; exit 1; }
    sudo apt-get update && sudo apt-get install -y --no-install-recommends dialog
  fi
fi
command -v dialog >/dev/null 2>&1 || { echo "dialog unavailable." >&2; exit 1; }
declare -A values=()
declare -a originals=()
if [[ -f "$ENV_FILE" ]]; then
  mapfile -t originals < "$ENV_FILE"
  # Same trusted local shell-format config that run-linux.sh sources.
  set +u
  source "$ENV_FILE"
  set -u
fi
keys=(DCCEXPRESS_HTTP_URL CommandCenter__Protocol DccEx__Transport DccEx__Host DccEx__Port DccEx__SerialPort Z21__Host Z21__Port Z21__RBusOffset LocoNet__Host LocoNet__LbServerPort LocoNet__LbServerFeedback LocoNet__BinaryPort LocoNet__BinaryFeedback LocoNet__SensorOffset)
defaults=("http://0.0.0.0:5174" "dccex" "Tcp" "192.168.1.143" "2560" "/dev/ttyACM0" "192.168.1.111" "21105" "0" "192.168.1.123" "1234" "true" "5560" "false" "0")
for i in "${!keys[@]}"; do
  key="${keys[i]}"
  values["$key"]="${!key:-${defaults[i]}}"
done
values[DCCEXPRESS_CONTENT_ROOT]="$BACKEND_DIR"
values[DCCEXPRESS_WEB_ROOT]="$WEBUI_DIST"
dirty=0
temp_output="$(mktemp)"
cleanup() { rm -f -- "$temp_output"; clear || true; }
trap cleanup EXIT
ui() {
  : > "$temp_output"
  dialog --ascii-lines --backtitle "DCCExpressHub | Linux configuration" --output-fd 3 "$@" 3>"$temp_output"
}
ask() {
  local key="$1" title="$2" new
  if ui --title "$title" --inputbox "$key" 10 75 "${values[$key]}"; then
    new="$(cat "$temp_output")"
    if [[ "$new" != "${values[$key]}" ]]; then values["$key"]="$new"; dirty=1; fi
  fi
}
choose() {
  local key="$1" title="$2"; shift 2
  if ui --title "$title" --menu "Select value" 18 74 9 "$@"; then
    values["$key"]="$(cat "$temp_output")"; dirty=1
  fi
}
page() {
  local section="$1" item key
  while true; do
    case "$section" in
      server)
        ui --title "Server" --menu "HTTP / Web settings" 16 76 5 1 "Listen URL: ${values[DCCEXPRESS_HTTP_URL]}" 2 "Content root (managed)" 3 "Web root (managed)" || return 0
        item="$(cat "$temp_output")"
        case "$item" in
          1) ask DCCEXPRESS_HTTP_URL "Backend listen URL" ;;
          2|3) dialog --ascii-lines --msgbox "These paths are managed by the launcher, not editable here." 9 58 ;;
        esac ;;
      center)
        ui --title "Command center" --menu "Choose protocol" 16 74 5 1 "DCC-EX" 2 "Roco Z21" 3 "YaMoRC YD7010" || return 0
        case "$(cat "$temp_output")" in
          1) values[CommandCenter__Protocol]="dccex" ;;
          2) values[CommandCenter__Protocol]="z21" ;;
          3) values[CommandCenter__Protocol]="yamorc7010" ;;
        esac
        dirty=1 ;;
      dccex)
        ui --title "DCC-EX" --menu "Connection settings" 18 76 7 1 "Transport: ${values[DccEx__Transport]}" 2 "Host: ${values[DccEx__Host]}" 3 "TCP port: ${values[DccEx__Port]}" 4 "Serial device: ${values[DccEx__SerialPort]}" || return 0
        case "$(cat "$temp_output")" in
          1) choose DccEx__Transport "DCC-EX transport" Tcp "TCP" Serial "USB / serial" ;;
          2) ask DccEx__Host "DCC-EX host" ;;
          3) ask DccEx__Port "DCC-EX TCP port" ;;
          4) ask DccEx__SerialPort "DCC-EX serial device" ;;
        esac ;;
      z21)
        ui --title "Z21" --menu "Z21 and R-BUS settings" 16 76 5 1 "Host: ${values[Z21__Host]}" 2 "UDP port: ${values[Z21__Port]}" 3 "R-BUS offset: ${values[Z21__RBusOffset]}" || return 0
        case "$(cat "$temp_output")" in
          1) ask Z21__Host "Z21 host" ;;
          2) ask Z21__Port "Z21 UDP port" ;;
          3) ask Z21__RBusOffset "R-BUS offset" ;;
        esac ;;
      loconet)
        ui --title "LocoNet" --menu "LocoNet feedback settings" 19 78 8 1 "Host: ${values[LocoNet__Host]}" 2 "LBServer TCP: ${values[LocoNet__LbServerPort]}" 3 "LBServer feedback: ${values[LocoNet__LbServerFeedback]}" 4 "Binary port: ${values[LocoNet__BinaryPort]}" 5 "Binary feedback: ${values[LocoNet__BinaryFeedback]}" 6 "Sensor offset: ${values[LocoNet__SensorOffset]}" || return 0
        case "$(cat "$temp_output")" in
          1) ask LocoNet__Host "LocoNet host" ;;
          2) ask LocoNet__LbServerPort "LBServer TCP port" ;;
          3) choose LocoNet__LbServerFeedback "LBServer feedback" true "Enabled" false "Disabled" ;;
          4) ask LocoNet__BinaryPort "Binary TCP port" ;;
          5) choose LocoNet__BinaryFeedback "Binary feedback" true "Enabled" false "Disabled" ;;
          6) ask LocoNet__SensorOffset "Sensor offset" ;;
        esac ;;
    esac
  done
}
validate() {
  local key
  for key in DccEx__Port Z21__Port LocoNet__LbServerPort LocoNet__BinaryPort; do
    [[ "${values[$key]}" =~ ^[0-9]+$ ]] && ((10#${values[$key]} >= 1 && 10#${values[$key]} <= 65535)) || {
      dialog --ascii-lines --msgbox "Invalid port: $key = ${values[$key]}" 9 65; return 1;
    }
  done
  [[ "${values[DCCEXPRESS_HTTP_URL]}" == http://* || "${values[DCCEXPRESS_HTTP_URL]}" == https://* ]] || {
    dialog --ascii-lines --msgbox "Listen URL must begin with http:// or https://" 8 65; return 1;
  }
}
save() {
  validate || return
  if ! dialog --ascii-lines --yesno "Save configuration to .env.linux? A backup will be created if it exists." 9 70; then return; fi
  local dir tmp backup key line prefix found escaped
  dir="$(dirname "$ENV_FILE")"; mkdir -p "$dir"
  tmp="$(mktemp "$dir/.env.linux.tmp.XXXXXX")"
  chmod 600 "$tmp"
  if [[ -f "$ENV_FILE" ]]; then
    backup="$ENV_FILE.bak.$(date +%Y%m%d-%H%M%S)"
    cp -p -- "$ENV_FILE" "$backup"
  fi
  declare -A written=()
  for line in "${originals[@]}"; do
    if [[ "$line" =~ ^([[:space:]]*export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]]; then
      key="${BASH_REMATCH[2]}"
      if [[ -v values[$key] ]]; then
        printf -v escaped '%q' "${values[$key]}"
        printf 'export %s=%s\n' "$key" "$escaped" >> "$tmp"
        written["$key"]=1
        continue
      fi
    fi
    printf '%s\n' "$line" >> "$tmp"
  done
  for key in "${keys[@]}" DCCEXPRESS_CONTENT_ROOT DCCEXPRESS_WEB_ROOT; do
    if [[ ! -v written[$key] ]]; then
      printf -v escaped '%q' "${values[$key]}"
      printf 'export %s=%s\n' "$key" "$escaped" >> "$tmp"
    fi
  done
  mv -f -- "$tmp" "$ENV_FILE"
  dirty=0
  dialog --ascii-lines --msgbox "Linux configuration saved. Restart the Hub to apply changes." 9 65
}
while true; do
  ui --title "DCCExpressHub" --menu "Configuration | ${values[CommandCenter__Protocol]}" 20 80 10 1 "General / HTTP" 2 "Command center" 3 "DCC-EX" 4 "Z21 / R-BUS" 5 "LocoNet / YaMoRC" 6 "Save configuration" 7 "Exit" || choice=7
  choice="${choice:-$(cat "$temp_output")}"
  case "$choice" in
    1) page server || true ;; 2) page center || true ;; 3) page dccex || true ;; 4) page z21 || true ;; 5) page loconet || true ;;
    6) save ;;
    7)
      if ((dirty)); then
        if dialog --ascii-lines --yesno "Unsaved changes. Exit without saving?" 9 60; then break; fi
      else break; fi ;;
  esac
  choice=''
done
