#!/usr/bin/env bash
# Live smoke test against a running Omarchy shell with this plugin enabled.
# Opens and closes the hints, presses keys with wtype (only the letter of the
# window that's already focused, so nothing on screen changes) and hammers it.
#
#   tests/smoke.sh
set -uo pipefail

ID=nejcc.motions
HERE=$(cd "$(dirname "$0")/.." && pwd)
pass=0 fail=0

ok()   { echo "PASS  $1"; pass=$((pass + 1)); }
bad()  { echo "FAIL  $1"; fail=$((fail + 1)); }
skip() { echo "SKIP  $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

for cmd in hyprctl omarchy-shell; do
  command -v "$cmd" >/dev/null || { skip "$cmd not found; needs a running Omarchy session"; exit 0; }
done

shown() { hyprctl layers | grep -qE "namespace: ($ID|nejcc-motions)"; }
wait_shown() { for _ in $(seq 1 30); do shown && return 0; sleep 0.1; done; return 1; }
wait_hidden() { for _ in $(seq 1 30); do shown || return 0; sleep 0.1; done; return 1; }
summon() { local p='{}'; [ $# -gt 0 ] && p=$1; omarchy-shell shell summon "$ID" "$p" >/dev/null 2>&1; }
hide() { omarchy-shell shell hide "$ID" >/dev/null 2>&1; }
active() { hyprctl activewindow -j | sed -nE 's/.*"address": "([^"]+)".*/\1/p' | head -1; }
active_fullscreen() { hyprctl activewindow -j | sed -nE 's/.*"fullscreen": ([0-9]+).*/\1/p' | head -1; }
shell_pid() { hyprctl layers | grep "namespace: omarchy-bar" | grep -oE "pid: [0-9]+" | head -1 | cut -d' ' -f2; }
shell_config() { ps -o args= -p "$(shell_pid)" | sed -nE 's/.* -p ([^ ]+).*/\1/p'; }

# Right after a (re)start the shell reloads its plugins and drops requests for
# a few seconds. Wait until three open/close rounds in a row work.
settled=0
for _ in $(seq 1 60); do
  summon; if wait_shown; then settled=$((settled + 1)); else settled=0; fi
  hide; wait_hidden
  [ "$settled" -ge 3 ] && break
  sleep 0.5
done
[ "$settled" -ge 3 ] || { echo "SKIP  the shell never settled; try again in a moment"; exit 0; }
hide; wait_hidden
pid_before=$(shell_pid)
SHELL_PATH=$(shell_config)
[ -n "$pid_before" ] && [ -n "$SHELL_PATH" ] || { skip "can't find the running Omarchy shell"; exit 0; }
log_before=$(qs log -p "$SHELL_PATH" 2>/dev/null | wc -l)
start=$(active)
[ -n "$start" ] || { skip "no focused window to test against"; exit 0; }

# --- open and close
summon; check "summon shows the hints" wait_shown
hide;   check "hide removes them" wait_hidden
summon '{"maximize":true}'; check "full-width mode opens too" wait_shown
hide;   wait_hidden

# --- real key presses (only on the already-focused window)
if command -v wtype >/dev/null && command -v node >/dev/null; then
  key=$(node -e '
    const fs = require("fs"), vm = require("vm"), { execFileSync } = require("child_process")
    const L = vm.createContext({})
    vm.runInContext(fs.readFileSync(process.argv[1], "utf8").replace(/^\.pragma library\s*$/m, ""), L)
    const r = L.buildHints(execFileSync("hyprctl", ["clients", "-j"], { encoding: "utf8" }),
                           execFileSync("hyprctl", ["monitors", "-j"], { encoding: "utf8" }))
    const hit = r && r.hints.find((h) => h.address === process.argv[2])
    process.stdout.write(hit ? hit.key : "")
  ' "$HERE/Logic.js" "$start")
  if [ -n "$key" ]; then
    fs_before=$(active_fullscreen)
    summon; wait_shown; sleep 0.3
    wtype "$key"
    check "pressing a letter closes the hints" wait_hidden
    sleep 0.3
    check "…and focuses that letter's window" '[ "$(active)" = "$start" ]'
    check "…without changing full width" '[ "$(active_fullscreen)" = "$fs_before" ]'
    summon; wait_shown; sleep 0.3
    wtype ";"
    check "a key that isn't part of a command just closes them" wait_hidden
    check "…and leaves focus alone" '[ "$(active)" = "$start" ]'
  else
    skip "focused window has no letter (more than 26 windows?)"
  fi
else
  skip "key presses (needs wtype and node)"
fi

# --- commands on hidden workspaces 7 and 8 (nothing on screen moves)
d() { hyprctl dispatch "$1" >/dev/null 2>&1; }
typed() { shown || return 1; wtype "$@"; }
on_ws() { hyprctl clients -j | python3 -c "import json,sys;print(sum(1 for c in json.load(sys.stdin) if c['class']=='motions-smoke' and c['workspace']['id']==$1))"; }
addr_at() { hyprctl clients -j | python3 -c "import json,sys;print(next((c['address'] for c in json.load(sys.stdin) if c['class']=='motions-smoke' and c['workspace']['id']==$1 and c['at']==[$2,$3]),''))"; }
if [ "$(on_ws 7)" = 0 ] && [ "$(on_ws 8)" = 0 ] && command -v wtype >/dev/null && command -v python3 >/dev/null \
   && ! hyprctl clients -j | grep -qE '"id": (7|8),'; then
  d 'hl.dsp.exec_cmd("[workspace 7 silent] foot --app-id=motions-smoke")'; sleep 0.8
  d 'hl.dsp.exec_cmd("[workspace 8 silent] foot --app-id=motions-smoke")'; sleep 0.8
  d 'hl.dsp.exec_cmd("[workspace 8 silent] foot --app-id=motions-smoke")'
  for _ in $(seq 1 30); do [ "$(on_ws 7)$(on_ws 8)" = 12 ] && break; sleep 0.2; done
  cleanup_windows() { for pid in $(hyprctl clients -j | python3 -c "import json,sys;print(' '.join(str(c['pid']) for c in json.load(sys.stdin) if c['class']=='motions-smoke'))"); do kill "$pid"; done; }
  trap cleanup_windows EXIT

  summon; wait_shown; sleep 0.3; typed m78; typed -k Return; sleep 1
  check "m78 Enter moves workspace 7's window to 8 without going there" '[ "$(on_ws 7)$(on_ws 8)" = 03 ] && [ "$(active)" = "$start" ]'
  summon; wait_shown; sleep 0.3; typed m8a7; typed -k Return; sleep 1
  check "m8a7 Enter moves window a of workspace 8 to 7" '[ "$(on_ws 7)$(on_ws 8)" = 12 ]'

  moving=$(hyprctl clients -j | python3 -c "import json,sys;print(next(c['address'] for c in json.load(sys.stdin) if c['class']=='motions-smoke' and c['workspace']['id']==7))")
  spot=$(hyprctl clients -j | python3 -c "import json,sys;w=sorted([c for c in json.load(sys.stdin) if c['class']=='motions-smoke' and c['workspace']['id']==8],key=lambda c:(c['at'][1],c['at'][0]));print(*w[0]['at'])")
  summon; wait_shown; sleep 0.3; typed m78a; sleep 1
  check "m78a moves it into window a's spot on workspace 8" '[ "$(addr_at 8 ${spot% *} ${spot#* })" = "$moving" ]'

  summon; wait_shown; sleep 0.3; typed 7z; sleep 0.5
  check "an impossible command keeps the hints open" shown
  typed -k Escape; sleep 0.2; typed -k Escape
  check "Esc clears it, a second Esc closes" wait_hidden
  cleanup_windows; trap - EXIT
else
  skip "move commands (needs empty workspaces 7 and 8, wtype and python3)"
fi

# --- hammer it
for _ in $(seq 1 40); do summon; hide; done
sleep 1
hide
check "40 quick open/close cycles leave nothing on screen" wait_hidden
summon; check "still opens after the hammering" wait_shown
hide; wait_hidden
check "focus is where it started" '[ "$(active)" = "$start" ]'
check "the shell didn't restart or crash" '[ "$(shell_pid)" = "$pid_before" ]'
new_warnings=$(qs log -p "$SHELL_PATH" 2>/dev/null | tail -n +"$((log_before + 1))" | grep -iE "warn|error" | grep -ciE "WindowHints|$ID|Logic.js")
check "no new warnings or errors from the plugin in the shell log" '[ "$new_warnings" = 0 ]'

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
