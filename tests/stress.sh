#!/usr/bin/env bash
# Hard live stress test. TAKES OVER THE SCREEN for a few minutes: it switches
# to workspace 8, opens throwaway windows on workspaces 7, 8 and 9 (weird
# titles, more windows than letters), hammers the hints with random commands
# typed through wtype, and closes windows and switches workspaces while the
# hints are open. Typed commands only name workspaces 7-9, so your windows
# elsewhere are never touched, and the test checks that at the end.
# Needs workspaces 7, 8 and 9 to be empty. Don't type while it runs.
#
#   tests/stress.sh [rounds]        (default 300 random commands)
#   LOG=/path/to/log tests/stress.sh
set -uo pipefail

ID=nejcc.motions
ROUNDS=${1:-300}
LOG=${LOG:-$(mktemp /tmp/motions-stress.XXXXXX.log)}
PWNED=/tmp/motions-stress-pwned
pass=0 fail=0

log()  { echo "$(date +%T)  $*" | tee -a "$LOG"; }
ok()   { log "PASS  $1"; pass=$((pass + 1)); }
bad()  { log "FAIL  $1"; fail=$((fail + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

for cmd in hyprctl omarchy-shell wtype python3; do
  command -v "$cmd" >/dev/null || { echo "SKIP  needs $cmd"; exit 0; }
done
d() { hyprctl dispatch "$1" >/dev/null 2>&1; }
ours() { hyprctl clients -j | python3 -c "import json,sys;print(' '.join(str(c['pid']) for c in json.load(sys.stdin) if c['class'].startswith('stress-')))"; }
count_on() { hyprctl clients -j | python3 -c "import json,sys;print(sum(1 for c in json.load(sys.stdin) if c['workspace']['id']==$1))"; }
for ws in 7 8 9; do [ "$(count_on $ws)" = 0 ] || { echo "SKIP  workspace $ws isn't empty"; exit 0; }; done

shown() { hyprctl layers | grep -qE "namespace: ($ID|nejcc-motions)"; }
summon() { omarchy-shell shell summon "$ID" '{}' >/dev/null 2>&1; }
hide() { omarchy-shell shell hide "$ID" >/dev/null 2>&1; }
wait_shown() { for _ in $(seq 1 30); do shown && return 0; sleep 0.1; done; return 1; }
wait_hidden() { for _ in $(seq 1 30); do shown || return 0; sleep 0.1; done; return 1; }
shell_pid() { hyprctl layers | grep "namespace: omarchy-bar" | grep -oE "pid: [0-9]+" | head -1 | cut -d' ' -f2; }
shell_config() { ps -o args= -p "$(shell_pid)" | sed -nE 's/.* -p ([^ ]+).*/\1/p'; }
# Everything not on 7-9 and not ours: where it is, how big, full width or not.
others_snapshot() { hyprctl clients -j | python3 -c "
import json,sys
for c in sorted(json.load(sys.stdin), key=lambda c: c['address']):
    if c['workspace']['id'] in (7,8,9) or c['class'].startswith('stress-'): continue
    print(c['address'], c['workspace']['id'], c['at'], c['size'], c['fullscreen'], c['floating'])"; }

start_ws=$(hyprctl activeworkspace -j | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
start_win=$(hyprctl activewindow -j | python3 -c 'import json,sys;print(json.load(sys.stdin).get("address",""))')
cleanup() {
  restore_idle
  hide
  for pid in $(ours); do kill "$pid" 2>/dev/null; done
  d "hl.dsp.focus({ workspace = \"$start_ws\" })"
  [ -n "$start_win" ] && d "hl.dsp.focus({ window = \"address:$start_win\" })"
  rm -f "$PWNED"
}
trap cleanup EXIT

# Keep the screen awake: Omarchy's screensaver starting in the middle of a
# burst of workspace switches makes Hyprland drop the shell's event stream,
# which has nothing to do with the plugin but would fail the test.
if omarchy toggle idle status 2>/dev/null | grep -q '"enabled":false'; then
  omarchy toggle idle stay-awake >/dev/null 2>&1
  restore_idle() { omarchy toggle idle allow-idle >/dev/null 2>&1; }
else
  restore_idle() { :; }
fi

before=$(others_snapshot)
pid_before=$(shell_pid)
SHELL_PATH=$(shell_config)
log_before=$(qs log -p "$SHELL_PATH" 2>/dev/null | wc -l)
rss_before=$(ps -o rss= -p "$pid_before" | tr -d ' ')
rm -f "$PWNED"
log "stress test: $ROUNDS random commands; log at $LOG"

# --- a live view of this log, pinned so it shows on every workspace
d "hl.dsp.exec_cmd(\"[float; pin; size 760 460; move 1140 60] foot --app-id=stress-log -T 'Stress test' tail -n 40 -f $LOG\")"
d 'hl.dsp.focus({ workspace = "8" })'
sleep 1

# --- weird windows: long, emoji, right-to-left, quotes and command lookalikes
spawn() { d "hl.dsp.exec_cmd(\"[workspace $1 silent] foot --app-id=stress-win -T '$2' sh -c 'cat >/dev/null'\")"; }
spawn 7 "$(printf 'L%.0s' $(seq 1 400)) very long title"
spawn 7 "😀 emoji 🎉 title ✳"
spawn 7 "‮ right to left text"
spawn 8 "quote \\\" and \` backtick"
spawn 8 "\$(touch $PWNED) command lookalike"
spawn 8 "; touch $PWNED ;"
log "spawning 30 windows on workspace 9 (more than there are letters)"
for i in $(seq 1 30); do spawn 9 "crowd $i"; done
for _ in $(seq 1 60); do [ "$(count_on 9)" -ge 30 ] && break; sleep 0.3; done
check "30 windows opened on workspace 9" '[ "$(count_on 9)" -ge 30 ]'

# --- the hints open with all of that on screen
summon; check "hints open with weird titles and 36 windows around" wait_shown
hide; wait_hidden

# --- open/close abuse
log "150 rapid summon/hide/toggle calls, some overlapping"
for i in $(seq 1 150); do
  case $((RANDOM % 4)) in
    0) summon ;; 1) hide ;; 2) omarchy-shell shell toggle "$ID" >/dev/null 2>&1 ;; 3) summon & ;;
  esac
done
wait; sleep 1; hide
check "after the abuse the hints can be closed" wait_hidden
summon; check "…and opened again" wait_shown
hide; wait_hidden

# --- random commands, typed for real; digits only 7-9
log "typing $ROUNDS random commands (letters, 7-9, m, r, Enter, Backspace, Esc, Shift)"
keys=(a s d f g h j k l q w e t y u i o p z x c v b n 7 8 9 7 8 9 m r m r)
specials=(Return BackSpace Escape)
typed=0
for i in $(seq 1 "$ROUNDS"); do
  # Keep the view on 7-9 so letters only reach our windows.
  cur=$(hyprctl activeworkspace -j | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
  case $cur in 7|8|9) ;; *) d 'hl.dsp.focus({ workspace = "8" })'; sleep 0.2 ;; esac
  shown || { summon; wait_shown || continue; sleep 0.15; }
  n=$((1 + RANDOM % 5))
  for _ in $(seq 1 $n); do
    shown || break
    r=$((RANDOM % 20))
    if [ $r -lt 2 ]; then wtype -k "${specials[RANDOM % 3]}"
    elif [ $r -lt 3 ]; then wtype -M shift "${keys[RANDOM % 24]}" -m shift
    else wtype "${keys[RANDOM % ${#keys[@]}]}"; fi
    typed=$((typed + 1))
  done
  [ $((i % 50)) = 0 ] && log "  $i commands, $typed keys so far"
done
hide; wait_hidden
check "hints close after $typed random keys" '! shown'

# --- pull the rug: windows vanish and workspaces change while the hints are open
log "closing windows and switching workspaces while the hints are open"
for i in $(seq 1 10); do
  summon; wait_shown; sleep 0.2
  victim=$(hyprctl clients -j | python3 -c "import json,sys;w=[c for c in json.load(sys.stdin) if c['class']=='stress-win' and c['workspace']['id']==9];print(w[0]['pid'] if w else '')")
  [ -n "$victim" ] && kill "$victim"
  sleep 0.2
  shown && wtype 9a
  shown && d "hl.dsp.focus({ workspace = \"$(( 7 + RANDOM % 3 ))\" })"
  sleep 0.2; shown && wtype -k Escape; shown && wtype -k Escape
done
hide; wait_hidden
summon; check "still opens after windows vanished under it" wait_shown
hide; wait_hidden

# --- verdict
sleep 1
check "no command in a window title ran" '[ ! -e "$PWNED" ]'
check "the shell didn't restart or crash" '[ "$(shell_pid)" = "$pid_before" ]'
# Hyprland drops a client that reads its event stream too slowly; if that
# happened the whole shell stops seeing workspace changes until restarted.
check "Hyprland never dropped the shell's event stream" '! qs log -p "$SHELL_PATH" 2>/dev/null | tail -n +"$((log_before + 1))" | grep -q "event socket error"'
rss_after=$(ps -o rss= -p "$pid_before" | tr -d ' ')
log "shell memory: ${rss_before} KB -> ${rss_after} KB"
check "shell memory grew by less than 60 MB" '[ $(( rss_after - rss_before )) -lt 61440 ]'
new_warnings=$(qs log -p "$SHELL_PATH" 2>/dev/null | tail -n +"$((log_before + 1))" | grep -iE "warn|error" | grep -iE "WindowHints|$ID|Logic.js")
[ -n "$new_warnings" ] && log "$new_warnings"
check "no warnings or errors from the plugin in the shell log" '[ -z "$new_warnings" ]'
check "your windows outside workspaces 7-9 weren't touched" '[ "$(others_snapshot)" = "$before" ]'

log "$pass passed, $fail failed"
[ "$fail" = 0 ]
