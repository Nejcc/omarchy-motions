import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import "Logic.js" as Logic

// Press the bound key, every window on the visible workspace(s) gets a letter,
// press the letter to focus it. Esc or any other key cancels.
Item {
  id: root

  property var shell: null
  property var manifest: null
  property bool opened: false
  property var hints: []    // every labeled window: { key, address, cls, fullscreen, x, y, w, h }
  property bool maximize: false  // also make the target full width (SUPER + ALT + F) after focusing
  property var inPlace: []  // hints drawn over windows on screen
  property var others: []   // [{ name, windows: [hint] }] for workspaces not on screen
  property real screenW: 1920
  property real screenH: 1080
  // Mini-map cards are up to 340px wide, narrower when many workspaces need
  // to fit across the screen.
  readonly property real miniScale: {
    var n = Math.max(1, others.length)
    var room = (panel.width - Style.gapsOut * 4 - Style.spacing.md * (n - 1)) / n - Style.space(16)
    return Math.max(Style.space(120), Math.min(Style.space(340), room)) / screenW
  }

  // Theme accent on the menu background, so hints read over any window.
  readonly property color accent: Color.menu.selectedText

  function open(payloadJson) {
    root.maximize = Logic.readPayload(payloadJson).maximize
    clients.running = true
  }

  function close() {
    root.opened = false
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide((root.manifest && root.manifest.id) || "nejcc.motions")
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function build(clientsJson, monitorsJson) {
    var r = Logic.buildHints(clientsJson, monitorsJson)
    if (!r) return root.dismiss()
    root.hints = r.hints
    root.inPlace = r.inPlace
    root.others = r.others
    root.screenW = r.screenW
    root.screenH = r.screenH
    root.opened = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  // Shift + letter, or opening with {"maximize": true}, also makes the window full width.
  function jump(key, maximize) {
    var hit = root.hints.find(function(h) { return h.key === key })
    root.dismiss()
    if (!hit) return
    Quickshell.execDetached(["sh", "-c", Logic.jumpScript(maximize, hit.fullscreen), "sh", "address:" + hit.address])
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
    WlrLayershell.namespace: "nejcc.motions"
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
        root.jump(Logic.keyFor(event.text), root.maximize || (event.modifiers & Qt.ShiftModifier) !== 0)
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

        // One card: the letter on the left, what's open there on the right.
        Rectangle {
          id: card
          anchors.centerIn: parent
          width: Math.min(cardRow.implicitWidth + Style.spacing.md * 2, parent.width - Style.space(16))
          height: cardRow.implicitHeight + Style.spacing.md * 2
          radius: Style.cornerRadius
          color: Color.menu.background
          border.color: root.accent
          border.width: 3

          Row {
            id: cardRow
            x: Style.spacing.md
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.spacing.lg

            Rectangle {
              id: letterBox
              width: Style.space(72); height: width
              radius: Style.cornerRadius
              color: root.accent
              Text {
                anchors.centerIn: parent
                text: modelData.key.toUpperCase()
                color: Color.menu.background
                font.family: Style.font.menuFamily
                font.pixelSize: Style.space(46)
                font.bold: true
              }
            }

            Column {
              id: labels
              anchors.verticalCenter: parent.verticalCenter
              visible: modelData.app !== "" || modelData.title !== ""
              // Text as wide as it needs, up to what fits in the window.
              readonly property real room: card.parent.width - Style.space(16) - Style.spacing.md * 2
                - letterBox.width - cardRow.spacing
              width: Math.max(0, Math.min(Math.max(appLabel.implicitWidth, titleLabel.implicitWidth), room, Style.space(360)))
              spacing: Style.spacing.xs

              Text {
                id: appLabel
                width: parent.width
                text: modelData.app
                color: Color.menu.text
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.heading
                font.bold: true
                elide: Text.ElideRight
                visible: text !== ""
              }
              Text {
                id: titleLabel
                width: parent.width
                text: modelData.title
                color: Color.menu.text
                opacity: 0.75
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.title
                wrapMode: Text.Wrap
                maximumLineCount: 2
                elide: Text.ElideRight
                visible: text !== ""
              }
            }
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

                // Letter, then what's open there: app name and the window title.
                Column {
                  id: miniInfo
                  anchors.centerIn: parent
                  width: parent.width - Style.space(8)
                  spacing: 1
                  Text {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    text: modelData.key.toUpperCase()
                    color: root.accent
                    font.family: Style.font.menuFamily
                    font.pixelSize: Math.min(Style.space(28), Math.max(Style.space(14), parent.parent.height * 0.3))
                    font.bold: true
                  }
                  Text {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    text: modelData.app
                    color: Color.menu.text
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.space(11)
                    font.bold: true
                    elide: Text.ElideRight
                    visible: text !== ""
                  }
                  Text {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    text: modelData.title
                    color: Color.menu.text
                    opacity: 0.75
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.space(10)
                    wrapMode: Text.Wrap
                    maximumLineCount: 2
                    elide: Text.ElideRight
                    // Only when the window is tall enough to show it.
                    visible: text !== "" && parent.parent.height > Style.space(46)
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
