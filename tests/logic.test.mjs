// Unit tests for Logic.js. Run with: node --test tests/*.test.mjs
// Logic.js is a QML JavaScript library, so it's loaded into a sandbox with its
// `.pragma library` line stripped. No dependencies needed.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, existsSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import vm from "node:vm"

const source = readFileSync(new URL("../Logic.js", import.meta.url), "utf8").replace(/^\.pragma library\s*$/m, "")
const L = vm.createContext({})
vm.runInContext(source, L)
const plain = (v) => JSON.parse(JSON.stringify(v))

// Shapes follow `hyprctl monitors -j` / `hyprctl clients -j`.
const monitor = (o = {}) => ({
  id: 0, name: "eDP-1", x: 0, y: 0, width: 1920, height: 1080, scale: 1, focused: true,
  activeWorkspace: { id: 1, name: "1" }, specialWorkspace: { id: 0, name: "" }, ...o
})
let n = 0
const win = (ws, at, o = {}) => ({
  address: "0x" + (++n).toString(16), mapped: true, hidden: false, at, size: [900, 500],
  workspace: { id: ws, name: String(ws) }, monitor: 0, class: "foot", fullscreen: 0, ...o
})
const build = (clients, monitors = [monitor()]) => L.buildHints(JSON.stringify(clients), JSON.stringify(monitors))

// --------------------------------------------------------------- buildHints

test("buildHints: windows on screen get home-row letters, top-left first", () => {
  const r = build([win(1, [960, 540]), win(1, [0, 540]), win(1, [960, 0]), win(1, [0, 0])])
  assert.deepEqual(plain(r.inPlace.map((h) => [h.key, h.x, h.y])),
    [["a", 0, 0], ["s", 960, 0], ["d", 0, 540], ["f", 960, 540]])
  assert.equal(r.others.length, 0)
})




test("buildHints: skips hidden and unmapped windows", () => {
  const r = build([win(1, [0, 0], { hidden: true }), win(1, [10, 0], { mapped: false }), win(1, [20, 0])])
  assert.equal(r.hints.length, 1)
  assert.equal(r.hints[0].x, 20)
})

test("buildHints: an open scratchpad counts as on screen", () => {
  const m = monitor({ specialWorkspace: { id: -98, name: "special:scratchpad" } })
  const r = build([win(-98, [100, 100], { workspace: { id: -98, name: "special:scratchpad" } })], [m])
  assert.equal(r.inPlace.length, 1)
})

test("buildHints: a hidden scratchpad shows as its own mini-map", () => {
  const r = build([win(-98, [100, 100], { workspace: { id: -98, name: "special:scratchpad" } }), win(1, [0, 0])])
  assert.deepEqual(plain(r.others.map((w) => w.name)), ["S scratchpad"])
})

test("buildHints: positions are relative to each window's own monitor", () => {
  const left = monitor({ id: 0, focused: true })
  const right = monitor({ id: 1, name: "HDMI-A-1", x: 1920, focused: false, activeWorkspace: { id: 2, name: "2" } })
  const r = build([win(1, [100, 50]), win(2, [2020, 60], { monitor: 1 })], [left, right])
  assert.deepEqual(plain([r.inPlace[0].x, r.inPlace[0].y]), [100, 50])
  const mini = r.others[0].windows[0]
  assert.deepEqual(plain([mini.x, mini.y]), [100, 60])
})

test("buildHints: uses the focused monitor, not the first one", () => {
  const a = monitor({ id: 0, focused: false, activeWorkspace: { id: 1, name: "1" } })
  const b = monitor({ id: 1, x: 1920, focused: true, activeWorkspace: { id: 5, name: "5" } })
  const onFive = win(5, [1920, 0], { monitor: 1 })
  const r = build([win(1, [0, 0]), onFive], [a, b])
  assert.equal(r.inPlace.length, 1)
  assert.equal(r.inPlace[0].address, onFive.address)
  assert.equal(r.inPlace[0].x, 0) // 1920 - monitor x
})

test("buildHints: screen size accounts for display scaling", () => {
  const r = build([win(1, [0, 0])], [monitor({ width: 2880, height: 1800, scale: 1.5 })])
  assert.deepEqual(plain([r.screenW, r.screenH]), [1920, 1200])
})

test("buildHints: with no windows it still shows the five workspaces", () => {
  for (const clients of [[], [win(1, [0, 0], { hidden: true })]]) {
    const r = build(clients)
    assert.equal(r.hints.length, 0)
    assert.deepEqual(plain(r.workspaces.map((w) => [w.name, w.windows.length])),
      [["1", 0], ["2", 0], ["3", 0], ["4", 0], ["5", 0]])
  }
})

// ------------------------------------------------------------------ overview

const names = (r) => r.workspaces.map((w) => w.name)

test("overview: always shows workspaces 1-5, marking the current one", () => {
  const r = build([win(1, [0, 0])], [monitor({ activeWorkspace: { id: 3, name: "3" } })])
  assert.deepEqual(plain(names(r)), ["1", "2", "3", "4", "5"])
  assert.deepEqual(plain(r.workspaces.map((w) => w.current)), [false, false, true, false, false])
})


test("overview: extra workspaces with windows follow 1-5, scratchpad last", () => {
  const r = build([
    win(-98, [0, 0], { workspace: { id: -98, name: "special:scratchpad" } }),
    win(9, [0, 0]), win(7, [0, 0]), win(1, [0, 0])
  ])
  assert.deepEqual(plain(names(r)), ["1", "2", "3", "4", "5", "7", "9", "S scratchpad"])
})

test("overview: cards carry the number key that jumps to them", () => {
  const r = build([win(10, [0, 0]), win(12, [0, 0])])
  assert.deepEqual(plain(r.workspaces.map((w) => w.digit)), ["1", "2", "3", "4", "5", "0", ""])
})

test("overview: every window appears in exactly one card", () => {
  const clients = Array.from({ length: 20 }, (_, i) => win(1 + (i % 8), [i * 10, 0]))
  const r = build(clients)
  const inCards = r.workspaces.flatMap((w) => w.windows.map((h) => h.key)).sort()
  assert.deepEqual(plain(inCards), plain(r.hints.map((h) => h.key).sort()))
})


test("buildHints: broken hyprctl output doesn't throw", () => {
  const cases = [["", ""], ["{", "["], ["null", "null"], ["[]", "[]"], ["{}", "{}"], ["[1,2]", "[3]"],
    [JSON.stringify([{ mapped: true }]), JSON.stringify([monitor()])],
    [JSON.stringify([win(1, [0, 0])]), JSON.stringify([{}])],
    [JSON.stringify([win(1, "x")]), JSON.stringify([monitor()])]]
  for (const [c, m] of cases) assert.doesNotThrow(() => L.buildHints(c, m), `${c} / ${m}`)
  assert.equal(L.buildHints("garbage", JSON.stringify([monitor()])), null)
  assert.equal(L.buildHints(JSON.stringify([win(1, [0, 0])]), "garbage"), null)
})

test("buildHints: a missing scale or size falls back sensibly", () => {
  const r = build([win(1, [0, 0])], [monitor({ scale: 0, width: undefined, height: undefined })])
  assert.deepEqual(plain([r.screenW, r.screenH]), [1920, 1080])
})

test("buildHints: many windows stay fast", () => {
  const clients = Array.from({ length: 5000 }, (_, i) => win(1 + (i % 10), [i % 1920, i % 1080]))
  const t0 = performance.now()
  build(clients)
  assert.ok(performance.now() - t0 < 500)
})

test("buildHints: each hint carries a readable app name and a short title", () => {
  const r = build([win(1, [0, 0]), win(2, [0, 0], { class: "brave-browser", title: "Nejcc (Nejc) - Brave" })])
  assert.deepEqual(plain([r.others[0].windows[0].app, r.others[0].windows[0].title]), ["Brave", "Nejcc (Nejc)"])
})

// ----------------------------------------------------------- appName/title

test("appName: turns window classes into readable names", () => {
  assert.equal(L.appName("brave-browser"), "Brave")
  assert.equal(L.appName("com.mitchellh.ghostty"), "Ghostty")
  assert.equal(L.appName("org.gnome.Nautilus"), "Nautilus")
  assert.equal(L.appName("foot"), "Foot")
  assert.equal(L.appName("google-chrome"), "Google chrome")
  assert.equal(L.appName("signal-desktop"), "Signal")
  for (const v of ["", null, undefined, "."]) assert.equal(L.appName(v), "")
})

test("shortTitle: drops leading status symbols", () => {
  assert.equal(L.shortTitle("✳ Omarchy setup", "Foot"), "Omarchy setup")
  assert.equal(L.shortTitle("◑ Grid navigation plugin", "Foot"), "Grid navigation plugin")
  assert.equal(L.shortTitle("\uf120  nvim README.md", "Foot"), "nvim README.md") // Nerd Font icon
  assert.equal(L.shortTitle("• notes", "Foot"), "notes")
})

test("shortTitle: drops a trailing app name but keeps other dashes", () => {
  assert.equal(L.shortTitle("Nejcc (Nejc) - Brave", "Brave"), "Nejcc (Nejc)")
  assert.equal(L.shortTitle("Inbox — Mozilla Firefox", "Firefox"), "Inbox — Mozilla Firefox") // not a prefix match
  assert.equal(L.shortTitle("Inbox - Firefox Nightly", "Firefox"), "Inbox")
  assert.equal(L.shortTitle("git log - main", "Foot"), "git log - main")
  assert.equal(L.shortTitle("A - B - Brave", "Brave"), "A - B")
})

test("shortTitle: keeps titles that are only the app name or empty", () => {
  assert.equal(L.shortTitle("Brave", "Brave"), "Brave")
  for (const v of ["", null, undefined, "   "]) assert.equal(L.shortTitle(v, "Foot"), "")
})

// ------------------------------------------------------------------ letters

test("letters: no m or r, which start commands", () => {
  assert.ok(!L.KEYS.includes("m") && !L.KEYS.includes("r"))
  assert.equal(new Set(L.KEYS).size, L.KEYS.length)
})

test("letters: restart at a in every workspace, windows on screen share one run", () => {
  const m = monitor({ activeWorkspace: { id: 5, name: "5" } })
  const r = build([win(3, [0, 0]), win(2, [0, 0]), win(2, [500, 0]), win(5, [500, 0]), win(5, [0, 0])], [m])
  assert.deepEqual(plain(r.inPlace.map((h) => [h.key, h.x])), [["a", 0], ["s", 500]])
  assert.deepEqual(plain(r.others.map((w) => [w.name, w.windows.map((h) => h.key)])), [["2", ["a", "s"]], ["3", ["a"]]])
})

test("letters: unique within each workspace", () => {
  const r = build(Array.from({ length: 30 }, (_, i) => win(1 + (i % 3), [i * 10, i])))
  for (const w of r.workspaces) {
    const keys = w.windows.map((h) => h.key)
    assert.equal(new Set(keys).size, keys.length, w.name)
  }
})

test("letters: stop at the end of the alphabet instead of running out", () => {
  const r = build(Array.from({ length: 40 }, (_, i) => win(1, [i, 0])))
  assert.equal(r.inPlace.length, L.KEYS.length)
  assert.equal(r.inPlace.map((h) => h.key).join(""), L.KEYS)
})

test("letters: an open scratchpad shares the on-screen run", () => {
  const m = monitor({ specialWorkspace: { id: -98, name: "special:scratchpad" } })
  const r = build([win(1, [0, 0]), win(-98, [100, 100], { workspace: { id: -98, name: "special:scratchpad" } })], [m])
  assert.deepEqual(plain(r.inPlace.map((h) => h.key)), ["a", "s"])
})

test("overview: the current workspace's card lists its windows too", () => {
  const r = build([win(1, [0, 0]), win(1, [960, 0]), win(2, [0, 0])])
  assert.deepEqual(plain(r.workspaces.find((w) => w.name === "1").windows.map((h) => h.key)), ["a", "s"])
  assert.deepEqual(plain(r.workspaces.find((w) => w.name === "2").windows.map((h) => h.key)), ["a"])
})

test("buildHints: windows with a non-hex address are skipped", () => {
  const r = build([win(1, [0, 0], { address: '0x1" }) hl.exec_cmd("x") --' }), win(1, [10, 0])])
  assert.equal(r.hints.length, 1)
  assert.equal(r.hints[0].x, 10)
})

// ---------------------------------------------------------------- tokenFor

test("tokenFor: letters and digits, lowercased", () => {
  assert.equal(L.tokenFor("A"), "a")
  assert.equal(L.tokenFor("7"), "7")
  for (const t of ["", null, undefined, ";", " ", "ab", "é", "\n"]) assert.equal(L.tokenFor(t), "", String(t))
})

// ------------------------------------------------------------- parseCommand

const parse = (s) => plain(L.parseCommand(s))

test("parseCommand: focus on screen and on another workspace", () => {
  assert.deepEqual(parse("a"), { state: "done", action: { type: "focus", ws: null, letter: "a" } })
  assert.deepEqual(parse("2k"), { state: "done", action: { type: "focus", ws: 2, letter: "k" } })
  assert.deepEqual(parse("0a"), { state: "done", action: { type: "focus", ws: 10, letter: "a" } })
})

test("parseCommand: a number then Enter goes to that workspace", () => {
  assert.deepEqual(parse("2"), { state: "pending" })
  assert.deepEqual(parse("2\n"), { state: "done", action: { type: "workspace", ws: 2 } })
})

test("parseCommand: move, with and without picking the window or a spot", () => {
  for (const p of ["m", "m3", "m32", "m3a", "m3a2"]) assert.deepEqual(parse(p), { state: "pending" }, p)
  assert.deepEqual(parse("m32b"), { state: "done", action: { type: "move", from: 3, fromLetter: null, to: 2, slot: "b" } })
  assert.deepEqual(parse("m3a2b"), { state: "done", action: { type: "move", from: 3, fromLetter: "a", to: 2, slot: "b" } })
  assert.deepEqual(parse("m32\n"), { state: "done", action: { type: "move", from: 3, fromLetter: null, to: 2, slot: null } })
})

test("parseCommand: resize in 12 Bootstrap columns", () => {
  for (const p of ["r", "rk", "rk1"]) assert.deepEqual(parse(p), { state: "pending" }, p)
  for (const [p, cols] of [["rk6", 6], ["rk4", 4], ["rk3", 3], ["rk8", 8], ["rk9", 9], ["rk10", 10], ["rk12", 12], ["rk1\n", 1]])
    assert.deepEqual(parse(p), { state: "done", action: { type: "resize", letter: "k", cols } }, p)
})

test("parseCommand: nonsense is invalid, never mistaken for a command", () => {
  for (const p of ["m", "r"]) assert.equal(parse(p).state, "pending")
  for (const p of ["mm", "rm", "rr", "2m", "2r", "ab", "22", "m3m", "m32m", "rk0", "rk13", "rk1a", "\n", "a\n", "m32b1", "rk66"])
    assert.equal(parse(p).state, "invalid", JSON.stringify(p))
})

test("parseCommand: every key sequence is pending, done or invalid, and prefixes of done commands were pending", () => {
  const alphabet = "asrm20\n".split("")
  const seqs = [""]
  for (let len = 0; len < 5; len++) for (const s of seqs.filter((x) => x.length === len)) for (const c of alphabet) seqs.push(s + c)
  for (const s of seqs) {
    const r = L.parseCommand(s)
    assert.ok(["pending", "done", "invalid"].includes(r.state), s)
    if (r.state === "done") for (let i = 1; i < s.length; i++)
      assert.equal(L.parseCommand(s.slice(0, i)).state, "pending", `${JSON.stringify(s)} prefix ${JSON.stringify(s.slice(0, i))}`)
  }
})

// ----------------------------------------------------------- resolveCommand

const resolve = (cmd, clients, m = [monitor()]) => L.resolveCommand(L.parseCommand(cmd).action, build(clients, m))

test("resolveCommand: focus picks the right window", () => {
  const here = win(1, [0, 0]), there = win(2, [0, 0]), there2 = win(2, [500, 0])
  assert.equal(resolve("a", [here, there, there2]).hint.address, here.address)
  assert.equal(resolve("2s", [here, there, there2]).hint.address, there2.address)
  assert.equal(resolve("1a", [here, there]).hint.address, here.address) // current workspace by number
  assert.match(resolve("2d", [here, there]).error, /No window d on workspace 2/)
  assert.match(resolve("s", [here]).error, /No window s on screen/)
})

test("resolveCommand: move takes the only window, or asks for a letter", () => {
  const two = win(2, [0, 0]), threeA = win(3, [0, 0]), threeB = win(3, [500, 0]), threeOnly = win(3, [0, 0])
  let r = resolve("m32a", [win(1, [0, 0]), two, threeOnly])
  assert.equal(r.kind, "move")
  assert.equal(r.window.address, threeOnly.address)
  assert.equal(r.slot.address, two.address)
  assert.equal(r.to, 2)
  assert.match(resolve("m32a", [two, threeA, threeB]).error, /has 2 windows: add a letter, like m3a2a/)
  assert.equal(resolve("m3s2a", [two, threeA, threeB]).window.address, threeB.address)
  assert.match(resolve("m42a", [two]).error, /Nothing to move on workspace 4/)
  assert.match(resolve("m32s", [two, threeOnly]).error, /No window s on workspace 2/)
  assert.equal(resolve("m32\n", [two, threeOnly]).slot, null)
})

test("resolveCommand: moving to the current workspace focuses the window", () => {
  const m = monitor({ activeWorkspace: { id: 2, name: "2" } })
  assert.equal(resolve("m32\n", [win(3, [0, 0])], [m]).focus, true)
  assert.equal(resolve("m34\n", [win(3, [0, 0])], [m]).focus, false)
})

test("resolveCommand: a window can't swap with itself", () => {
  const m = monitor({ activeWorkspace: { id: 3, name: "3" } })
  assert.match(resolve("m33a", [win(3, [0, 0])], [m]).error, /same window/)
})

test("resolveCommand: resize works on windows on screen", () => {
  const a = win(1, [0, 0])
  const r = resolve("ra6", [a, win(2, [0, 0])])
  assert.deepEqual(plain([r.kind, r.window.address, r.cols]), ["resize", a.address, 6])
  assert.match(resolve("rs6", [a]).error, /No window s on screen/)
})

// --------------------------------------------------------------- columnWidth

test("columnWidth: matches Hyprland's own half split and scales by columns", () => {
  const o = { screenW: 1920, gapsOut: 10, gapsIn: 5, border: 2 }
  assert.equal(L.columnWidth(6, o), 941) // what Hyprland gives each half of a split
  assert.equal(L.columnWidth(12, o), 1896)
  assert.ok(L.columnWidth(4, o) < L.columnWidth(6, o) && L.columnWidth(6, o) < L.columnWidth(8, o))
  // two windows at 6 + 6 fill the row exactly: widths + borders + gutter
  assert.equal(2 * (L.columnWidth(6, o) + 4) + 10, 1900)
})

// ------------------------------------------------------------ keyFor/payload



test("readPayload: only a literal true turns on full width", () => {
  assert.equal(L.readPayload('{"maximize":true}').maximize, true)
  for (const p of ["", "{}", '{"maximize":"true"}', '{"maximize":1}', "garbage", "null", "[]", null])
    assert.equal(L.readPayload(p).maximize, false, String(p))
})

// --------------------------------------------------------------- jumpScript

test("jumpScript: full width only when asked and not already full width", () => {
  assert.ok(!L.jumpScript(false, 0).includes("maximized"))
  assert.ok(L.jumpScript(true, 0).includes("maximized"))
  assert.ok(L.jumpScript(true, undefined).includes("maximized"))
  assert.ok(!L.jumpScript(true, 1).includes("maximized"))
})

// Runs the script the way the plugin does, with a fake hyprctl that records
// its arguments, so the real shell quoting is exercised.
function runJump(maximize, fullscreen, target, { luaFails = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "motions-test-"))
  const log = join(dir, "calls")
  writeFileSync(join(dir, "hyprctl"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n` +
    (luaFails ? `case "$2" in hl.*) exit 1;; esac\n` : "") + "exit 0\n")
  chmodSync(join(dir, "hyprctl"), 0o755)
  spawnSync("sh", ["-c", L.jumpScript(maximize, fullscreen), "sh", target], {
    cwd: dir, env: { PATH: `${dir}:/usr/bin:/bin` }
  })
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []
  const pwned = existsSync(join(dir, "pwned"))
  rmSync(dir, { recursive: true, force: true })
  return { calls, pwned }
}

test("jumpScript: focuses the window through hyprctl", () => {
  const { calls } = runJump(false, 0, "address:0x5a1b")
  assert.deepEqual(calls, ['dispatch hl.dsp.focus({ window = "address:0x5a1b" })'])
})

test("jumpScript: focus then full width in full-width mode", () => {
  const { calls } = runJump(true, 0, "address:0x5a1b")
  assert.deepEqual(calls, [
    'dispatch hl.dsp.focus({ window = "address:0x5a1b" })',
    'dispatch hl.dsp.window.fullscreen({ mode = "maximized", window = "address:0x5a1b" })'
  ])
})

test("jumpScript: falls back to classic dispatchers on older Hyprland", () => {
  const { calls } = runJump(true, 0, "address:0x5a1b", { luaFails: true })
  assert.ok(calls.includes("dispatch focuswindow address:0x5a1b"))
  assert.ok(calls.includes("dispatch fullscreen 1"))
})

// Same harness for the workspace switch.
function runWorkspace(target) {
  const dir = mkdtempSync(join(tmpdir(), "motions-test-"))
  const log = join(dir, "calls")
  writeFileSync(join(dir, "hyprctl"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexit 0\n`)
  chmodSync(join(dir, "hyprctl"), 0o755)
  spawnSync("sh", ["-c", L.workspaceScript(), "sh", target], { cwd: dir, env: { PATH: `${dir}:/usr/bin:/bin` } })
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []
  const pwned = existsSync(join(dir, "pwned"))
  rmSync(dir, { recursive: true, force: true })
  return { calls, pwned }
}

// Runs any of the scripts with arguments against the fake hyprctl.
function runScript(script, args) {
  const dir = mkdtempSync(join(tmpdir(), "motions-test-"))
  const log = join(dir, "calls")
  writeFileSync(join(dir, "hyprctl"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexit 0\n`)
  chmodSync(join(dir, "hyprctl"), 0o755)
  spawnSync("sh", ["-c", script, "sh", ...args], { cwd: dir, env: { PATH: `${dir}:/usr/bin:/bin` } })
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []
  const pwned = existsSync(join(dir, "pwned"))
  rmSync(dir, { recursive: true, force: true })
  return { calls, pwned }
}

test("moveScript: moves without following, then swaps into the spot", () => {
  const { calls } = runScript(L.moveScript(), ["address:0xa", "2", "address:0xb", "0"])
  assert.deepEqual(calls, [
    'dispatch hl.dsp.window.move({ workspace = "2", follow = false, window = "address:0xa" })',
    'dispatch hl.dsp.window.swap({ window = "address:0xa", target = "address:0xb" })'
  ])
})

test("moveScript: no spot means no swap; focus when moving here", () => {
  const { calls } = runScript(L.moveScript(), ["address:0xa", "2", "", "1"])
  assert.deepEqual(calls, [
    'dispatch hl.dsp.window.move({ workspace = "2", follow = false, window = "address:0xa" })',
    'dispatch hl.dsp.focus({ window = "address:0xa" })'
  ])
})

test("resizeScript: exact size for the window", () => {
  const { calls } = runScript(L.resizeScript(), ["address:0xa", "941", "1030", "0"])
  assert.deepEqual(calls, ['dispatch hl.dsp.window.resize({ x = 941, y = 1030, window = "address:0xa" })'])
})

test("resizeScript: a full-width window is restored before resizing", () => {
  const { calls } = runScript(L.resizeScript(), ["address:0xa", "941", "1030", "1"])
  assert.deepEqual(calls, [
    'dispatch hl.dsp.window.fullscreen({ mode = "maximized", window = "address:0xa" })',
    'dispatch hl.dsp.window.resize({ x = 941, y = 1030, window = "address:0xa" })'
  ])
})

test("scripts: hostile arguments can't run shell commands", () => {
  for (const evil of ["$(touch pwned)", "`touch pwned`", "x; touch pwned", "x' ; touch pwned; '"]) {
    assert.equal(runScript(L.moveScript(), [evil, evil, evil, "1"]).pwned, false, evil)
    assert.equal(runScript(L.resizeScript(), [evil, "1", "1"]).pwned, false, evil)
  }
})

test("workspaceScript: switches workspace through hyprctl", () => {
  assert.deepEqual(runWorkspace("3").calls, ['dispatch hl.dsp.focus({ workspace = "3" })'])
})

test("workspaceScript: a hostile value can't run commands", () => {
  for (const evil of ["$(touch pwned)", "`touch pwned`", "1; touch pwned"])
    assert.equal(runWorkspace(evil).pwned, false, evil)
})

test("jumpScript: a hostile window address can't run commands", () => {
  for (const evil of ["address:$(touch pwned)", "address:`touch pwned`", "address:x; touch pwned", "address:x\" })'; touch pwned; '"]) {
    const { pwned } = runJump(true, 0, evil)
    assert.equal(pwned, false, evil)
  }
})
