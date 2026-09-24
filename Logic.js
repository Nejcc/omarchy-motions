.pragma library

// Pure logic for window hints, kept free of QML so it can be tested with plain
// Node (see tests/). Nothing in here touches the screen or runs commands.

// Home row first so the common case stays under your fingers.
var KEYS = "asdfghjklqwertyuiopzxcvbnm"

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
  var t = String(title || "").replace(/^[\s\u2000-\u2BFF\uE000-\uF8FF\u2022\u00B7*]+/, "").trim()
  if (app) {
    var tail = t.match(/\s+[-–—|]\s+([^-–—|]+)$/)
    if (tail && tail[1].trim().toLowerCase().indexOf(app.toLowerCase()) === 0) t = t.slice(0, tail.index).trim()
  }
  return t
}

function isArray2(v) {
  return Array.isArray(v) && v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number"
}

// Turns `hyprctl clients -j` and `hyprctl monitors -j` into hints. Windows on
// screen are labeled first (home row); windows on other workspaces are grouped
// into one mini-map per workspace. Returns null when there's nothing to label.
function buildHints(clientsJson, monitorsJson) {
  var monitors = parseJson(monitorsJson, [])
  var clients = parseJson(clientsJson, [])
  if (!Array.isArray(monitors) || !Array.isArray(clients) || monitors.length === 0) return null

  var focused = monitors.find(function(m) { return m && m.focused }) || monitors[0]
  var monitorById = function(id) { return monitors.find(function(m) { return m && m.id === id }) || focused }
  // ponytail: in-place hints only on the focused monitor; one panel per screen if you add a second display.
  var visible = [
    focused.activeWorkspace ? focused.activeWorkspace.id : null,
    focused.specialWorkspace && focused.specialWorkspace.id ? focused.specialWorkspace.id : null
  ]
  var all = clients.filter(function(c) {
    return c && c.mapped && !c.hidden && c.workspace && typeof c.workspace.id === "number"
      && typeof c.address === "string" && isArray2(c.at) && isArray2(c.size)
  })
  var isVisible = function(c) { return visible.indexOf(c.workspace.id) !== -1 }
  // Visible windows first so they keep the home-row letters, then the rest by
  // workspace, each top-to-bottom then left-to-right.
  all.sort(function(a, b) {
    return (isVisible(b) - isVisible(a)) || (a.workspace.id - b.workspace.id)
      || a.at[1] - b.at[1] || a.at[0] - b.at[0]
  })
  all = all.slice(0, KEYS.length)
  if (all.length === 0) return null

  var hints = [], inPlace = [], others = [], byWs = {}
  all.forEach(function(c, i) {
    // Positions are relative to the window's own monitor; on-screen hints use
    // the focused one.
    var m = isVisible(c) ? focused : monitorById(c.monitor)
    var h = {
      key: KEYS[i], address: c.address, cls: String(c["class"] || ""), fullscreen: c.fullscreen || 0,
      app: appName(c["class"]), title: shortTitle(c.title, appName(c["class"])),
      x: c.at[0] - (m.x || 0), y: c.at[1] - (m.y || 0), w: c.size[0], h: c.size[1]
    }
    hints.push(h)
    if (isVisible(c)) return inPlace.push(h)
    var wsKey = "ws" + c.workspace.id
    if (!byWs[wsKey]) {
      byWs[wsKey] = { name: String(c.workspace.name || c.workspace.id).replace(/^special:?/, "S "), windows: [] }
      others.push(byWs[wsKey])
    }
    // ponytail: mini-maps assume every workspace has the focused monitor's size.
    byWs[wsKey].windows.push(h)
  })
  var scale = focused.scale > 0 ? focused.scale : 1
  return {
    hints: hints, inPlace: inPlace, others: others,
    screenW: (focused.width || 1920) / scale, screenH: (focused.height || 1080) / scale
  }
}

// The letter a key press picks, or "" for anything that isn't a hint letter.
function keyFor(text) {
  var k = String(text || "").toLowerCase()
  return k.length === 1 && KEYS.indexOf(k) !== -1 ? k : ""
}

// Shell script that focuses window "$1" and, when asked, makes it full width.
// The address is passed as an argument, never pasted into the script.
function jumpScript(maximize, fullscreen) {
  // Lua dispatcher on current Hyprland, classic dispatchers on older releases.
  var script = 'hyprctl dispatch "hl.dsp.focus({ window = \\"$1\\" })" >/dev/null 2>&1 || hyprctl dispatch focuswindow "$1"'
  // Only when not already full width: the dispatcher toggles.
  if (maximize && !fullscreen)
    script += '; hyprctl dispatch "hl.dsp.window.fullscreen({ mode = \\"maximized\\", window = \\"$1\\" })" >/dev/null 2>&1 || hyprctl dispatch fullscreen 1'
  return script
}
