import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons

// Press the bound key, every window on the visible workspace(s) gets a letter,
// press the letter to focus it. Esc or any other key cancels.
Item {
  id: root

  property var shell: null
  property var manifest: null
  property bool opened: false
  property var hints: []    // every labeled window: { key, address, cls, x, y, w, h }
  property var inPlace: []  // hints drawn over windows on screen
  property var others: []   // [{ name, windows: [hint] }] for workspaces not on screen
  property real screenW: 1920
  property real screenH: 1080
  readonly property real miniScale: Style.space(260) / screenW

  // Home row first so the common case stays under your fingers.
  // Theme accent on the menu background, so hints read over any window.
  readonly property color accent: Color.menu.selectedText

  readonly property string keys: "asdfghjklqwertyuiopzxcvbnm"

  function open(payloadJson) {
    clients.running = true
  }

  function close() {
    root.opened = false
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide((root.manifest && root.manifest.id) || "nejcc.window-hints")
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function build(clientsJson, monitorsJson) {
    var monitors = JSON.parse(monitorsJson)
    var focused = monitors.find(function(m) { return m.focused }) || monitors[0]
    // ponytail: in-place hints only on the focused monitor; one panel per screen if you add a second display.
    var visible = [focused.activeWorkspace.id, focused.specialWorkspace.id]
    var all = JSON.parse(clientsJson).filter(function(c) { return c.mapped && !c.hidden })
    var isVisible = function(c) { return visible.indexOf(c.workspace.id) !== -1 }
    // Visible windows first so they keep the home-row letters, then the rest by workspace.
    all.sort(function(a, b) {
      return (isVisible(b) - isVisible(a)) || (a.workspace.id - b.workspace.id)
        || a.at[1] - b.at[1] || a.at[0] - b.at[0]
    })
    all = all.slice(0, root.keys.length)

    var hints = [], byWs = {}, wsOrder = []
    all.forEach(function(c, i) {
      var h = { key: root.keys[i], address: c.address, cls: c.class,
                x: c.at[0] - focused.x, y: c.at[1] - focused.y, w: c.size[0], h: c.size[1] }
      hints.push(h)
      if (isVisible(c)) return
      if (!byWs[c.workspace.id]) {
        byWs[c.workspace.id] = { name: c.workspace.name.replace(/^special:?/, "S "), windows: [] }
        wsOrder.push(c.workspace.id)
      }
      // ponytail: mini-maps assume every workspace has the focused monitor's size.
      var m = monitors.find(function(mm) { return mm.id === c.monitor }) || focused
      h.x = c.at[0] - m.x; h.y = c.at[1] - m.y
      byWs[c.workspace.id].windows.push(h)
    })
    root.hints = hints
    root.inPlace = hints.filter(function(h) { return !wsOrder.some(function(id) { return byWs[id].windows.indexOf(h) !== -1 }) })
    root.others = wsOrder.map(function(id) { return byWs[id] })
    root.screenW = focused.width / focused.scale
    root.screenH = focused.height / focused.scale
    if (hints.length === 0) return root.dismiss()
    root.opened = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function jump(key) {
    var hit = root.hints.find(function(h) { return h.key === key })
    root.dismiss()
    if (!hit) return
    // Lua dispatcher on current Hyprland, classic focuswindow on older releases.
    var target = "address:" + hit.address
    Quickshell.execDetached(["sh", "-c", 'hyprctl dispatch "hl.dsp.focus({ window = \\"$1\\" })" >/dev/null 2>&1 || hyprctl dispatch focuswindow "$1"', "sh", target])
  }

  Process {
    id: clients
    command: ["hyprctl", "clients", "-j"]
    stdout: StdioCollector { id: clientsOut; onStreamFinished: monitors.running = true }
  }

  Process {
    id: monitors
    command: ["hyprctl", "monitors", "-j"]
    stdout: StdioCollector { onStreamFinished: root.build(clientsOut.text, text) }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "nejcc.window-hints"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    MouseArea { anchors.fill: parent; onClicked: root.dismiss() }

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: true
      Keys.onPressed: function(event) {
        event.accepted = true
        root.jump(event.text.toLowerCase())
      }
    }

    Repeater {
      model: root.inPlace
      delegate: Item {
        required property var modelData
        x: modelData.x; y: modelData.y; width: modelData.w; height: modelData.h

        Rectangle {
          anchors.fill: parent
          color: "transparent"
          border.color: root.accent
          border.width: 3
          radius: Style.cornerRadius
        }

        Rectangle {
          anchors.centerIn: parent
          width: Style.space(96); height: width
          radius: Style.cornerRadius
          color: Color.menu.background
          border.color: root.accent
          border.width: 3
          Text {
            anchors.centerIn: parent
            text: modelData.key.toUpperCase()
            color: root.accent
            font.family: Style.font.menuFamily
            font.pixelSize: Style.space(56)
            font.bold: true
          }
        }
      }
    }
      // Workspaces that are not on screen: one mini-map card each, along the bottom.
    Row {
      anchors.bottom: parent.bottom
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottomMargin: Style.gapsOut * 2
      spacing: Style.spacing.md

      Repeater {
        model: root.others
        delegate: Rectangle {
          required property var modelData
          width: root.screenW * root.miniScale + Style.space(16)
          height: root.screenH * root.miniScale + Style.space(44)
          radius: Style.cornerRadius
          color: Color.menu.background
          border.color: Color.menu.border
          border.width: 2

          Text {
            x: Style.space(8); y: Style.space(6)
            text: modelData.name
            color: Color.menu.text
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.title
          }

          Item {
            x: Style.space(8); y: Style.space(36)
            width: root.screenW * root.miniScale; height: root.screenH * root.miniScale

            Repeater {
              model: modelData.windows
              delegate: Rectangle {
                required property var modelData
                x: modelData.x * root.miniScale; y: modelData.y * root.miniScale
                width: modelData.w * root.miniScale; height: modelData.h * root.miniScale
                radius: Style.cornerRadius / 2
                color: Color.menu.selectedBackground
                border.color: root.accent
                border.width: 2
                clip: true

                Column {
                  anchors.centerIn: parent
                  Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: modelData.key.toUpperCase()
                    color: root.accent
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.space(28)
                    font.bold: true
                  }
                  Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: modelData.cls
                    color: Color.menu.text
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.space(11)
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
