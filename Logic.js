.pragma library

// Pure logic for window hints, kept free of QML so it can be tested with plain
// Node (see tests/). Nothing in here touches the screen or runs commands.

// Home row first so the common case stays under your fingers. No "m" or "r":
// they start the move and resize commands.
var KEYS = "asdfghjklqwetyuiopzxcvbn"

// Workspaces always shown in the overview, like Omarchy's bar.
var ALWAYS_SHOWN = 5

function parseJson(text, fallback) {
  try {
    var v = JSON.parse(text)
    return v === null || v === undefined ? fallback : v
  } catch (e) {
    return fallback
  }
}

// `{"maximize": true}` opens the hints in full-width mode.
function readPayload(json) {
  var p = parseJson(json || "{}", {})
  return { maximize: !!p && typeof p === "object" && p.maximize === true }
}

// A readable app name from a window class: "brave-browser" -> "Brave",
// "com.mitchellh.ghostty" -> "Ghostty", "org.gnome.Nautilus" -> "Nautilus".
function appName(cls) {
  var name = String(cls || "").split(".").pop().replace(/-(browser|desktop|bin)$/i, "").replace(/[-_]+/g, " ").trim()
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : ""
}

// A window title trimmed for a small card: drops leading status symbols
// (spinners, icons) and a trailing " - App" that repeats the app name.
function shortTitle(title, app) {
  var t = String(title || "").replace(/^[\s -⯿-•·*]+/, "").trim()
  if (app) {
    var tail = t.match(/\s+[-–—|]\s+([^-–—|]+)$/)
    if (tail && tail[1].trim().toLowerCase().indexOf(app.toLowerCase()) === 0) t = t.slice(0, tail.index).trim()
  }
  return t
}

// A finite number, or the fallback for anything else (strings, NaN, null...).
function numberOr(v, fallback) {
  return typeof v === "number" && isFinite(v) ? v : fallback
}

function isArray2(v) {
  return Array.isArray(v) && v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number"
    && isFinite(v[0]) && isFinite(v[1])
}

// Turns `hyprctl clients -j` and `hyprctl monitors -j` into hints and the
// workspace overview. Letters restart at "a" in every workspace; the windows
// on screen share one run of letters. Returns null if hyprctl output is
// unreadable.
function buildHints(clientsJson, monitorsJson) {
  // Unreadable output means hyprctl failed: show nothing rather than a
  // misleading "everything is empty" overview.
  var monitors = parseJson(monitorsJson, null)
  var clients = parseJson(clientsJson, null)
  if (!Array.isArray(monitors) || !Array.isArray(clients)) return null
  monitors = monitors.filter(function(m) { return m && typeof m === "object" && !Array.isArray(m) })
  if (monitors.length === 0) return null

  var focused = monitors.find(function(m) { return m && m.focused }) || monitors[0]
  var monitorById = function(id) { return monitors.find(function(m) { return m && m.id === id }) || focused }
  var current = focused.activeWorkspace && Number.isInteger(focused.activeWorkspace.id) ? focused.activeWorkspace.id : null
  // ponytail: in-place hints only on the focused monitor; one panel per screen if you add a second display.
  var visible = [current, focused.specialWorkspace && Number.isInteger(focused.specialWorkspace.id) && focused.specialWorkspace.id !== 0 ? focused.specialWorkspace.id : null]
  var isVisible = function(c) { return visible.indexOf(c.workspace.id) !== -1 }

  var all = clients.filter(function(c) {
    return c && c.mapped && !c.hidden && c.workspace && Number.isInteger(c.workspace.id)
      // Addresses end up inside Lua strings sent to Hyprland; real ones are
      // always hex, so anything else is skipped rather than escaped.
      && typeof c.address === "string" && /^0x[0-9a-fA-F]+$/.test(c.address)
      && isArray2(c.at) && isArray2(c.size)
  })
  // Top-to-bottom, then left-to-right, within each workspace.
  all.sort(function(a, b) {
    return (a.workspace.id - b.workspace.id) || a.at[1] - b.at[1] || a.at[0] - b.at[0]
  })

  var byWs = {}
  var card = function(id, name) {
    var key = "ws" + id
    if (!byWs[key]) {
      byWs[key] = {
        id: id, name: String(name || id).replace(/^special:?/, "S "),
        digit: id >= 1 && id <= 10 ? String(id % 10) : "",
        current: visible.indexOf(id) !== -1, windows: []
      }
    }
    return byWs[key]
  }
  for (var n = 1; n <= ALWAYS_SHOWN; n++) card(n, String(n))

  // One run of letters per group: "here" (everything on screen), then one
  // per other workspace.
  var used = {}
  var hints = [], inPlace = [], others = []
  // On-screen windows first so the order within "here" is stable.
  var ordered = all.filter(isVisible).concat(all.filter(function(c) { return !isVisible(c) }))
  ordered.forEach(function(c) {
    var here = isVisible(c)
    var group = here ? "here" : "ws" + c.workspace.id
    var i = used[group] || 0
    if (i >= KEYS.length) return
    used[group] = i + 1
    // Positions are relative to the window's own monitor; on-screen hints use
    // the focused one.
    var m = here ? focused : monitorById(c.monitor)
    var h = {
      key: KEYS[i], ws: c.workspace.id, here: here, address: c.address,
      cls: String(c["class"] || ""), fullscreen: c.fullscreen || 0,
      app: appName(c["class"]), title: shortTitle(c.title, appName(c["class"])),
      x: c.at[0] - numberOr(m.x, 0), y: c.at[1] - numberOr(m.y, 0), w: c.size[0], h: c.size[1]
    }
    hints.push(h)
    if (here) inPlace.push(h)
    var ws = card(c.workspace.id, c.workspace.name)
    // ponytail: mini-maps assume every workspace has the focused monitor's size.
    ws.windows.push(h)
    if (!here && others.indexOf(ws) === -1) others.push(ws)
  })
  // The overview: 1-5 always, then any other workspace with windows;
  // numbered ones in order, special ones (scratchpad) last.
  var workspaces = Object.keys(byWs).map(function(k) { return byWs[k] }).sort(function(a, b) {
    return ((a.id < 0) - (b.id < 0)) || (a.id < 0 ? b.id - a.id : a.id - b.id)
  })
  var positiveOr = function(v, fallback) { var n = numberOr(v, 0); return n > 0 ? n : fallback }
  var scale = positiveOr(focused.scale, 1)
  var width = positiveOr(focused.width, 1920)
  var height = positiveOr(focused.height, 1080)
  return {
    hints: hints, inPlace: inPlace, others: others, workspaces: workspaces, current: current,
    screenW: width / scale, screenH: height / scale
  }
}

// ------------------------------------------------------------------ commands
//
// Typed after the hints open, vim style:
//   a        window a on screen
//   2a       window a on workspace 2
//   2 Enter  go to workspace 2
//   m32b     move workspace 3's only window to workspace 2, into window b's spot
//   m3a2b    the same, picking window a on workspace 3
//   m32 Enter  move it to workspace 2 without picking a spot
//   rk6      resize window k (on screen) to 6 of 12 columns, like Bootstrap;
//            rk12 is full width, rk1 Enter is 1/12
// "0" means workspace 10. Enter is written "\n".

// The character a key press adds to the command, or "" if it adds nothing.
function tokenFor(text) {
  var k = String(text == null ? "" : text).toLowerCase()
  return /^[a-z0-9]$/.test(k) ? k : ""
}

function wsNumber(digit) {
  return digit === "0" ? 10 : Number(digit)
}

// Reads a typed command. Returns { state: "pending" } while more keys are
// needed, { state: "done", action } when complete, or { state: "invalid" }.
function parseCommand(buf) {
  var s = String(buf == null ? "" : buf)
  var m
  if (s === "") return { state: "pending" }
  if (/^[a-z]$/.test(s) && s !== "m" && s !== "r") return { state: "done", action: { type: "focus", ws: null, letter: s } }
  if (/^[0-9]$/.test(s)) return { state: "pending" }
  if ((m = s.match(/^([0-9])([a-z])$/)) && m[2] !== "m" && m[2] !== "r") return { state: "done", action: { type: "focus", ws: wsNumber(m[1]), letter: m[2] } }
  if ((m = s.match(/^([0-9])\n$/))) return { state: "done", action: { type: "workspace", ws: wsNumber(m[1]) } }
  var L = "[a-ln-qs-z]"   // window letters: anything but m and r
  if (new RegExp("^m([0-9](" + L + "?([0-9])?)?)?$").test(s)) return { state: "pending" }
  if ((m = s.match(new RegExp("^m([0-9])(" + L + "?)([0-9])(" + L + "|\n)$")))) {
    return { state: "done", action: {
      type: "move", from: wsNumber(m[1]), fromLetter: m[2] || null, to: wsNumber(m[3]),
      slot: m[4] === "\n" ? null : m[4]
    } }
  }
  // Resize: r, a letter, then 1-12 columns. "1" alone waits, since 10-12 start
  // with it; Enter after it means 1.
  if (new RegExp("^r(" + L + "(1)?)?$").test(s)) return { state: "pending" }
  if ((m = s.match(new RegExp("^r(" + L + ")([2-9]|1[0-2]|1\n)$")))) {
    return { state: "done", action: { type: "resize", letter: m[1], cols: parseInt(m[2], 10) } }
  }
  return { state: "invalid" }
}

// Outer width for a window taking `cols` of 12 columns, Bootstrap style.
// o: { screenW, gapsOut, gapsIn, border } in logical pixels.
function columnWidth(cols, o) {
  var positive = function(v, fallback) { return Math.max(0, numberOr(v, fallback)) }
  var usable = positive(o.screenW, 1920) - positive(o.gapsOut, 0) * 2
  var gutter = positive(o.gapsIn, 0) * 2
  var w = Math.round((usable + gutter) * numberOr(cols, 12) / 12 - gutter - positive(o.border, 0) * 2)
  return isFinite(w) ? Math.max(1, w) : 1
}

// Turns a parsed action into concrete windows, using the result of
// buildHints. Returns { kind: "focus"|"workspace"|"move", ... } or
// { error: "message" }.
function resolveCommand(action, r) {
  if (!action || !r) return { error: "Nothing to do" }
  var hints = r.hints || []
  // Letters for a workspace: the on-screen run if it's the current one.
  var inWs = function(ws) {
    return ws === null || ws === r.current
      ? hints.filter(function(h) { return h.here })
      : hints.filter(function(h) { return !h.here && h.ws === ws })
  }
  var find = function(ws, letter) {
    return inWs(ws).find(function(h) { return h.key === letter }) || null
  }
  var where = function(ws) { return ws === null || ws === r.current ? "on screen" : "on workspace " + ws }

  if (action.type === "focus") {
    var hit = find(action.ws, action.letter)
    return hit ? { kind: "focus", hint: hit } : { error: "No window " + action.letter + " " + where(action.ws) }
  }
  if (action.type === "workspace") return { kind: "workspace", ws: action.ws }
  if (action.type === "resize") {
    var win = find(null, action.letter)
    if (!win) return { error: "No window " + action.letter + " on screen" }
    if (!(action.cols >= 1 && action.cols <= 12)) return { error: "Columns go from 1 to 12" }
    return { kind: "resize", window: win, cols: action.cols }
  }
  if (action.type === "move") {
    var from = inWs(action.from)
    var win
    if (action.fromLetter) {
      win = find(action.from, action.fromLetter)
      if (!win) return { error: "No window " + action.fromLetter + " " + where(action.from) }
    } else if (from.length === 1) {
      win = from[0]
    } else {
      return { error: from.length === 0
        ? "Nothing to move " + where(action.from)
        : "Workspace " + action.from + " has " + from.length + " windows: add a letter, like m"
          + (action.from % 10) + "a" + (action.to % 10) + (action.slot || "") }
    }
    var slot = null
    if (action.slot) {
      slot = find(action.to, action.slot)
      if (!slot) return { error: "No window " + action.slot + " " + where(action.to) }
      if (slot.address === win.address) return { error: "That's the same window" }
    }
    return { kind: "move", window: win, to: action.to, slot: slot, focus: action.to === r.current }
  }
  return { error: "Unknown command" }
}

// ------------------------------------------------------------------ scripts
// All take their values as arguments ("$1", "$2", ...), never pasted into the
// script, so a window title or address can't inject commands.

// Focuses window "$1" and, when asked, makes it full width.
function jumpScript(maximize, fullscreen) {
  // Lua dispatcher on current Hyprland, classic dispatchers on older releases.
  var script = 'hyprctl dispatch "hl.dsp.focus({ window = \\"$1\\" })" >/dev/null 2>&1 || hyprctl dispatch focuswindow "$1"'
  // Only when not already full width: the dispatcher toggles.
  if (maximize && !fullscreen)
    script += '; hyprctl dispatch "hl.dsp.window.fullscreen({ mode = \\"maximized\\", window = \\"$1\\" })" >/dev/null 2>&1 || hyprctl dispatch fullscreen 1'
  return script
}

// Switches to workspace "$1".
function workspaceScript() {
  return 'hyprctl dispatch "hl.dsp.focus({ workspace = \\"$1\\" })" >/dev/null 2>&1 || hyprctl dispatch workspace "$1"'
}

// Resizes window "$1" to "$2" x "$3" pixels. When "$4" is 1 the window is
// full width first, which Hyprland undoes before resizing (it ignores a resize
// while maximized).
function resizeScript() {
  return 'if [ "$4" = 1 ]; then hyprctl dispatch "hl.dsp.window.fullscreen({ mode = \\"maximized\\", window = \\"$1\\" })" >/dev/null 2>&1; fi'
    + '; hyprctl dispatch "hl.dsp.window.resize({ x = $2, y = $3, window = \\"$1\\" })" >/dev/null 2>&1'
    + ' || hyprctl dispatch resizewindowpixel "exact $2 $3,$1"'
}

// Moves window "$1" to workspace "$2" without following it, swaps it into the
// spot of window "$3" when given, and focuses it when "$4" is 1.
function moveScript() {
  return 'hyprctl dispatch "hl.dsp.window.move({ workspace = \\"$2\\", follow = false, window = \\"$1\\" })" >/dev/null 2>&1'
    + ' || hyprctl dispatch movetoworkspacesilent "$2,$1"'
    + '; if [ -n "$3" ]; then hyprctl dispatch "hl.dsp.window.swap({ window = \\"$1\\", target = \\"$3\\" })" >/dev/null 2>&1; fi'
    + '; if [ "$4" = 1 ]; then hyprctl dispatch "hl.dsp.focus({ window = \\"$1\\" })" >/dev/null 2>&1 || hyprctl dispatch focuswindow "$1"; fi'
}
