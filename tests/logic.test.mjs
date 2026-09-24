// Unit tests for Logic.js. Run with: node --test tests/
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

test("buildHints: windows on screen keep the easy letters over other workspaces", () => {
  // On screen is workspace 5, so plain workspace order would put 2 and 3 first.
  const m = monitor({ activeWorkspace: { id: 5, name: "5" } })
  const r = build([win(3, [0, 0]), win(2, [0, 0]), win(5, [500, 0])], [m])
  assert.deepEqual(plain(r.inPlace.map((h) => [h.key, h.x])), [["a", 500]])
  assert.deepEqual(plain(r.others.map((w) => [w.name, w.windows.map((h) => h.key)])), [["2", ["s"]], ["3", ["d"]]])
})

test("buildHints: every window gets a different letter", () => {
  const clients = Array.from({ length: 26 }, (_, i) => win(1 + (i % 5), [i * 10, i * 10]))
  const keys = build(clients).hints.map((h) => h.key)
  assert.equal(new Set(keys).size, 26)
  assert.equal(keys.join(""), L.KEYS)
})

test("buildHints: stops at 26 windows instead of running out of letters", () => {
  const r = build(Array.from({ length: 40 }, (_, i) => win(1, [i, 0])))
  assert.equal(r.hints.length, 26)
  assert.ok(r.hints.every((h) => h.key.length === 1))
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

test("buildHints: nothing to label gives null", () => {
  assert.equal(build([]), null)
  assert.equal(build([win(1, [0, 0], { hidden: true })]), null)
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

// ------------------------------------------------------------ keyFor/payload

test("keyFor: letters pick hints, case-insensitively", () => {
  assert.equal(L.keyFor("a"), "a")
  assert.equal(L.keyFor("A"), "a")
})

test("keyFor: anything else picks nothing", () => {
  for (const t of ["", null, undefined, "1", ";", " ", "ab", "é", "\n"]) assert.equal(L.keyFor(t), "", String(t))
})

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

test("jumpScript: a hostile window address can't run commands", () => {
  for (const evil of ["address:$(touch pwned)", "address:`touch pwned`", "address:x; touch pwned", "address:x\" })'; touch pwned; '"]) {
    const { pwned } = runJump(true, 0, evil)
    assert.equal(pwned, false, evil)
  }
})
