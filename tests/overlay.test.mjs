// Exercise the real QML lifecycle methods with asynchronous process completions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('overlay: close, desktop changes and repeated opens reject stale completions', () => {
  const qml = readFileSync(new URL('../WindowHints.qml', import.meta.url), 'utf8')
  const logic = readFileSync(new URL('../Logic.js', import.meta.url), 'utf8').replace(/^\.pragma library\s*$/m, '')
  const Logic = vm.createContext({})
  vm.runInContext(logic, Logic)
  const root = { opened: false, requested: false, loading: false, generation: 0, shell: null }
  const snapshot = { running: false, generation: 0 }
  const context = vm.createContext({ root, snapshot, Logic, shellConfig: { text: () => '{}' },
    Qt: { callLater: f => f() }, keyCatcher: { forceActiveFocus() {} } })
  for (const name of ['open', 'close', 'startQuery', 'dismiss', 'build', 'toggle']) {
    const method = qml.match(new RegExp('  function ' + name + '\\([^]*?^  }', 'm'))
    assert.ok(method, name)
    vm.runInContext(method[0], context)
    root[name] = context[name]
  }
  const exited = qml.match(/onExited: (function\(code\) \{[^]*?^    })/m)
  const exit = vm.runInContext('(' + exited[1] + ')', context)
  const event = qml.match(/function onRawEvent\(event\) \{[^]*?^    }/m)
  vm.runInContext(event[0], context)
  const result = gen => `${gen}\n[]\n__MOTIONS_SNAPSHOT__\n[]\n__MOTIONS_SNAPSHOT__\n[{"id":0,"name":"DP-1","focused":true}]`

  root.open('{}')
  const first = snapshot.generation
  root.close()
  root.build(result(first))
  assert.equal(root.opened, false)
  exit(0)

  root.open('{}')
  const second = snapshot.generation
  root.open('{"maximize":true}')
  root.build(result(second))
  assert.equal(root.opened, false)
  exit(0) // finishes the canceled query and starts the newest request
  assert.equal(snapshot.generation, root.generation)
  root.build(result(snapshot.generation))
  assert.equal(root.opened, true)
  assert.equal(root.maximize, true)
  exit(0)
  context.onRawEvent({ name: 'closewindow' })
  assert.equal(root.opened, false)
  root.build(result(snapshot.generation))
  assert.equal(root.opened, false)

  root.open('{}')
  root.build(result(snapshot.generation))
  exit(0)
  context.onRawEvent({ name: 'monitorremoved' })
  assert.equal(root.opened, false)
  root.open('{}')
  root.toggle()
  root.build(result(snapshot.generation))
  assert.equal(root.requested, false)
  assert.equal(root.opened, false)
})
