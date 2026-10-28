#!/usr/bin/env bash
# DCCExpressHub terminal configuration editor - Bash only, no dependencies.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${DCCEXPRESS_ENV_FILE:-$ROOT/desktop/DCCExpressHub.Net/.env.linux}"
if [[ ! -t 0 || ! -t 1 ]]; then
  echo "Interactive terminal is required." >&2; exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "No Linux configuration found: $ENV_FILE" >&2
  echo "Run ./run-linux.sh --configure first." >&2; exit 1
fi
[[ -w "$ENV_FILE" ]] || { echo "Not writable: $ENV_FILE" >&2; exit 1; }
mapfile -t lines < "$ENV_FILE"
keys=(); indexes=()
for i in "${!lines[@]}"; do
  if [[ "${lines[i]}" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]]; then
    keys+=("${BASH_REMATCH[2]}"); indexes+=("$i")
  fi
done
(("${#keys[@]}" > 0)) || { echo "No key=value entries found." >&2; exit 1; }
reset=$'\033[0m'; blue=$'\033[44;37m'; selected=$'\033[46;30m'
cleanup() { printf '%s\033[?25h' "$reset"; }
trap cleanup EXIT
current=0; dirty=0
secret() { [[ "$1" =~ (SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY|CREDENTIAL) ]]; }
raw_value() { REPLY="${lines[indexes[$1]]#*=}"; }
draw() {
  printf '\033[2J\033[H%s' "$blue"
  printf ' DCCExpressHub | Linux Configuration %s\n\n' "$reset"
  printf ' %s\n' "$ENV_FILE"
  printf ' Arrows: navigate | Enter: edit | S: save | Q: quit\n\n'
  local start=$((current > 7 ? current-7 : 0)) end key val n
  end=$((start+15)); ((end>${#keys[@]})) && end=${#keys[@]}
  for ((n=start;n<end;n++)); do
    key="${keys[n]}"; raw_value "$n"; val="$REPLY"
    if secret "$key"; then val='********'; fi
    (("${#val}" > 35)) && val="${val:0:32}..."
    if ((n==current)); then
      printf '%s > %-35s %-36s %s\n' "$selected" "$key" "$val" "$reset"
    else
      printf '   %-35s %-36s\n' "$key" "$val"
    fi
  done
  if ((dirty)); then printf '\n Unsaved changes\n'; else printf '\n No unsaved changes\n'; fi
}
edit_current() {
  local index="${indexes[current]}" key="${keys[current]}" previous new escaped prefix
  raw_value "$current"; previous="$REPLY"
  printf '\033[2J\033[HEditing %s\n\n' "$key"
  if secret "$key"; then
    printf 'Current value hidden. New value (blank = unchanged): '
    IFS= read -r -s new || return
    printf '\n'
  else
    printf 'Current shell value: %s\nNew value (blank = unchanged): ' "$previous"
    IFS= read -r new || return
  fi
  [[ -n "$new" ]] || return
  # run-linux.sh sources this file, so escape all user input as shell data.
  printf -v escaped '%q' "$new"
  prefix="${lines[index]%%=*}"
  lines[index]="${prefix}=${escaped}"
  dirty=1
}
save() {
  ((dirty)) || return 0
  local backup="$ENV_FILE.bak.$(date +%Y%m%d-%H%M%S)" temp="$ENV_FILE.tmp.$$"
  cp -p -- "$ENV_FILE" "$backup"
  (umask 077; printf '%s\n' "${lines[@]}" > "$temp")
  chmod --reference="$ENV_FILE" "$temp"
  mv -f -- "$temp" "$ENV_FILE"
  dirty=0
  printf '\033[2J\033[HSaved. Backup: %s\nPress Enter...' "$backup"
  IFS= read -r _ || true
}
while true; do
  draw
  IFS= read -rsn1 key || break
  if [[ "$key" == $'\033' ]]; then
    IFS= read -rsn1 -t 0.1 k2 || k2=''
    if [[ "$k2" == '[' ]]; then
      IFS= read -rsn1 -t 0.1 k3 || k3=''
      case "$k3" in
        A) ((current>0)) && current=$((current-1)) || true ;;
        B) ((current+1<${#keys[@]})) && current=$((current+1)) || true ;;
      esac
    fi
    continue
  fi
  case "$key" in
    '') edit_current ;;
    s|S) save ;;
    q|Q)
      if ((dirty)); then
        printf '\nSave changes? [y]es / [n]o / [c]ancel: '
        IFS= read -rsn1 answer || answer='c'
        case "$answer" in y|Y) save; break ;; n|N) break ;; esac
      else break; fi ;;
    j|J) ((current+1<${#keys[@]})) && current=$((current+1)) || true ;;
    k|K) ((current>0)) && current=$((current-1)) || true ;;
  esac
done
printf '\033[2J\033[H'
