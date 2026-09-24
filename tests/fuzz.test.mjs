// Fuzz tests for Logic.js: random and hostile hyprctl output and random key
// sequences, checked against invariants. Seeded, so failures reproduce.
// Run with: node --test tests/*.test.mjs   (FUZZ_ROUNDS=200000 for a long run)
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

const source = readFileSync(new URL("../Logic.js", import.meta.url), "utf8").replace(/^\.pragma library\s*$/m, "")
const L = vm.createContext({})
vm.runInContext(source, L)
const ROUNDS = Number(process.env.FUZZ_ROUNDS || 20000)

function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}
const pick = (r, a) => a[Math.floor(r() * a.length)]

// Values hyprctl might send, plus things it shouldn't.
const junk = [null, undefined, 0, -1, 1.5, NaN, Infinity, "", "x", "0x", "0xZZ", [], {}, true, "1e999", -0, 2 ** 53, "𝕏", "‮rtl", "$(x)"]
function num(r) { return r() < 0.8 ? Math.floor(r() * 3000) - 200 : pick(r, junk) }
function address(r) { return r() < 0.85 ? "0x" + Math.floor(r() * 2 ** 40).toString(16) : pick(r, junk.concat(['0x1" })--', "0x1\n", " 0x1"])) }
function title(r) {
  return pick(r, ["", "nvim README.md", "✳ Claude", "a".repeat(5000), "Page - Brave", "‮ backwards", "😀🎉", "x - y - z",
    "$(touch pwned)", "`id`", "\"quoted\"", "tab\there", "new\nline", "\u0000nul", null, 42])
}
function client(r, wsIds) {
  const ws = r() < 0.9 ? pick(r, wsIds) : pick(r, junk)
  const c = {
    address: address(r), mapped: r() < 0.9, hidden: r() < 0.1,
    at: r() < 0.9 ? [num(r), num(r)] : pick(r, junk), size: r() < 0.9 ? [num(r), num(r)] : pick(r, junk),
    workspace: r() < 0.95 ? { id: ws, name: typeof ws === "number" && ws < 0 ? "special:x" : String(ws) } : pick(r, junk),
    monitor: r() < 0.9 ? Math.floor(r() * 3) : pick(r, junk),
    class: r() < 0.9 ? pick(r, ["foot", "brave-browser", "com.mitchellh.ghostty", "", ".", "a.b.c-desktop"]) : pick(r, junk),
    title: title(r), fullscreen: r() < 0.8 ? Math.floor(r() * 3) : pick(r, junk)
  }
  if (r() < 0.05) delete c.address
  return c
}
function monitor(r, i, wsIds) {
  const m = {
    id: i, x: num(r), y: num(r), width: num(r), height: num(r), scale: r() < 0.8 ? pick(r, [1, 1.25, 1.5, 2]) : pick(r, junk),
    focused: r() < 0.5, activeWorkspace: r() < 0.95 ? { id: pick(r, wsIds), name: "" } : pick(r, junk),
    specialWorkspace: r() < 0.9 ? { id: pick(r, [0, 0, 0, -98]), name: "" } : pick(r, junk)
  }
  return r() < 0.97 ? m : pick(r, junk)
}
function scene(r) {
  const wsIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, -98, 0]
  const monitors = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => monitor(r, i, wsIds))
  const clients = Array.from({ length: Math.floor(r() * 60) }, () => client(r, wsIds))
  const raw = (v) => (r() < 0.03 ? pick(r, ["", "{", "null", "[1,", "\"s\""]) : JSON.stringify(v))
  return { clientsJson: raw(clients), monitorsJson: raw(monitors) }
}

test("fuzz buildHints: never throws, and every hint is well-formed", () => {
  const r = rng(1)
  for (let i = 0; i < ROUNDS / 4; i++) {
    const { clientsJson, monitorsJson } = scene(r)
    let res
    assert.doesNotThrow(() => { res = L.buildHints(clientsJson, monitorsJson) }, `round ${i}`)
    if (!res) continue
    const groups = {}
    for (const h of res.hints) {
      assert.match(h.address, /^0x[0-9a-fA-F]+$/, `round ${i}: bad address ${h.address}`)
      assert.ok(L.KEYS.includes(h.key) && h.key.length === 1, `round ${i}: bad key ${h.key}`)
      for (const k of ["x", "y", "w", "h"]) assert.ok(Number.isFinite(h[k]), `round ${i}: ${k}=${h[k]}`)
      assert.equal(typeof h.app, "string")
      assert.equal(typeof h.title, "string")
      const g = h.here ? "here" : "ws" + h.ws
      groups[g] = groups[g] || new Set()
      assert.ok(!groups[g].has(h.key), `round ${i}: duplicate letter ${h.key} in ${g}`)
      groups[g].add(h.key)
    }
    assert.ok(Number.isFinite(res.screenW) && res.screenW > 0, `round ${i}: screenW ${res.screenW}`)
    assert.ok(Number.isFinite(res.screenH) && res.screenH > 0, `round ${i}: screenH ${res.screenH}`)
    const inCards = res.workspaces.reduce((n, w) => n + w.windows.length, 0)
    assert.equal(inCards, res.hints.length, `round ${i}: cards hold ${inCards} of ${res.hints.length} windows`)
    for (const w of res.workspaces) assert.ok(/^[0-9]?$/.test(w.digit), `round ${i}: digit ${w.digit}`)
  }
})

test("fuzz commands: any key sequence parses and resolves to something safe", () => {
  const r = rng(2)
  const keys = "asdfmrkzqb0123456789\n".split("")
  for (let i = 0; i < ROUNDS; i++) {
    const { clientsJson, monitorsJson } = scene(r)
    const res = L.buildHints(clientsJson, monitorsJson)
    const buf = Array.from({ length: 1 + Math.floor(r() * 6) }, () => pick(r, keys)).join("")
    let parsed
    assert.doesNotThrow(() => { parsed = L.parseCommand(buf) }, JSON.stringify(buf))
    assert.ok(["pending", "done", "invalid"].includes(parsed.state))
    if (parsed.state !== "done") continue
    let out
    assert.doesNotThrow(() => { out = L.resolveCommand(parsed.action, res) }, `round ${i} ${JSON.stringify(buf)}`)
    if (out.error) { assert.equal(typeof out.error, "string"); continue }
    const known = new Set((res ? res.hints : []).map((h) => h.address))
    if (out.kind === "focus") assert.ok(known.has(out.hint.address))
    if (out.kind === "workspace") assert.ok(out.ws >= 1 && out.ws <= 10)
    if (out.kind === "move") {
      assert.ok(known.has(out.window.address))
      assert.ok(out.to >= 1 && out.to <= 10)
      if (out.slot) { assert.ok(known.has(out.slot.address)); assert.notEqual(out.slot.address, out.window.address) }
    }
    if (out.kind === "resize") {
      assert.ok(known.has(out.window.address) && out.window.here)
      assert.ok(Number.isInteger(out.cols) && out.cols >= 1 && out.cols <= 12)
    }
  }
})

test("fuzz columnWidth: always a positive whole number of pixels", () => {
  const r = rng(3)
  for (let i = 0; i < ROUNDS; i++) {
    const o = { screenW: num(r), gapsOut: num(r), gapsIn: num(r), border: num(r) }
    const w = L.columnWidth(1 + Math.floor(r() * 12), o)
    assert.ok(Number.isInteger(w) && w >= 1, `${JSON.stringify(o)} -> ${w}`)
  }
})

test("fuzz strings: tokenFor, appName, shortTitle and readPayload never throw", () => {
  const r = rng(4)
  for (let i = 0; i < ROUNDS; i++) {
    const v = pick(r, junk.concat([title(r), String.fromCharCode(Math.floor(r() * 65536)), "{\"maximize\":" + pick(r, ["true", "1", "{}", "[", "null"]) + "}"]))
    assert.doesNotThrow(() => { L.tokenFor(v); L.appName(v); L.shortTitle(v, L.appName(v)); L.readPayload(v) }, String(v))
    const t = L.tokenFor(v)
    assert.ok(t === "" || /^[a-z0-9]$/.test(t))
  }
})
