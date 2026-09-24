import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import "Logic.js" as Logic

// Press the bound key and every window gets a letter; type a command (see
// Logic.js): a letter to jump, 2a for another workspace, m32b to move, rk6
// to resize. Esc cancels.
Item {
  id: root

  property var shell: null
  property var manifest: null
  property bool opened: false
  property var hints: []    // every labeled window: { key, address, cls, fullscreen, x, y, w, h }
  property bool maximize: false  // also make the target full width (SUPER + ALT + F) after focusing
  property var inPlace: []  // hints drawn over windows on screen
  property var workspaces: []  // overview cards: [{ name, digit, current, windows: [hint] }]
  property real screenW: 1920
  property real screenH: 1080
  property var result: null     // latest buildHints() result, for resolving commands
  property string command: ""   // keys typed so far ("\n" is Enter)
  property string commandError: ""
  // Workspace numbers typed so far, to light up their cards.
  readonly property var litDigits: command.replace(/[^0-9]/g, "").split("")
  // Gap and border sizes for column widths; read from Hyprland at startup.
  property int gapsIn: 5
  property int borderSize: 2
  // Mini-map cards are up to 340px wide, narrower when many workspaces need
  // to fit across the screen.
  readonly property real miniScale: {
    var n = Math.max(1, workspaces.length)
    var room = (panel.width - Style.gapsOut * 4 - Style.spacing.md * (n - 1)) / n - Style.space(16)
    return Math.max(Style.space(120), Math.min(Style.space(340), room)) / screenW
  }

  // Theme accent on the menu background, so hints read over any window.
  readonly property color accent: Color.menu.selectedText

  function open(payloadJson) {
    root.maximize = Logic.readPayload(payloadJson).maximize
    root.command = ""
    root.commandError = ""
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
    root.result = r
    root.hints = r.hints
    root.inPlace = r.inPlace
    root.workspaces = r.workspaces
    root.screenW = r.screenW
    root.screenH = r.screenH
    root.opened = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function run(script, args) {
    root.dismiss()
    Quickshell.execDetached(["sh", "-c", script, "sh"].concat(args))
  }

  // One key of a command. Unknown or impossible commands show why and start
  // over, keeping the hints open.
  function feed(token, shift) {
    var next = root.command + token
    var parsed = Logic.parseCommand(next)
    root.commandError = ""
    if (parsed.state === "pending") return root.command = next
    root.command = ""
    if (parsed.state === "invalid") return root.commandError = "Unknown command " + next.replace("\n", "⏎")
    var r = Logic.resolveCommand(parsed.action, root.result)
    if (r.error) return root.commandError = r.error
    var addr = function(h) { return "address:" + h.address }
    if (r.kind === "focus")
      // Shift + letter, or opening with {"maximize": true}, also makes it full width.
      return root.run(Logic.jumpScript(root.maximize || shift, r.hint.fullscreen), [addr(r.hint)])
    if (r.kind === "workspace") return root.run(Logic.workspaceScript(), [String(r.ws)])
    if (r.kind === "move")
      return root.run(Logic.moveScript(), [addr(r.window), String(r.to), r.slot ? addr(r.slot) : "", r.focus ? "1" : "0"])
    if (r.kind === "resize") {
      if (r.cols === 12) return root.run(Logic.jumpScript(true, r.window.fullscreen), [addr(r.window)])
      var w = Logic.columnWidth(r.cols, { screenW: root.screenW, gapsOut: Style.gapsOut, gapsIn: root.gapsIn, border: root.borderSize })
      return root.run(Logic.resizeScript(), [addr(r.window), String(w), String(Math.round(r.window.h)), r.window.fullscreen ? "1" : "0"])
    }
  }

  function onKey(event) {
    var shift = (event.modifiers & Qt.ShiftModifier) !== 0
    if (event.key === Qt.Key_Escape) {
      if (root.command !== "" || root.commandError !== "") { root.command = ""; root.commandError = "" }
      else root.dismiss()
    } else if (event.key === Qt.Key_Backspace) {
      root.command = root.command.slice(0, -1)
      root.commandError = ""
    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      root.feed("\n", shift)
    } else {
      var token = Logic.tokenFor(event.text)
      if (token) root.feed(token, shift)
      // Any other key closes the hints, unless a command is under way.
      else if (event.text && root.command === "") root.dismiss()
    }
  }

  Component.onCompleted: hyprOptions.running = true

  Process {
    id: hyprOptions
    command: ["sh", "-c", "hyprctl getoption general:gaps_in -j; hyprctl getoption general:border_size -j"]
    stdout: StdioCollector {
      onStreamFinished: {
        var gaps = text.match(/"css":\s*"(\d+)/) || text.match(/"custom":\s*"(\d+)/)
        var border = text.match(/"int":\s*(\d+)/)
        if (gaps) root.gapsIn = parseInt(gaps[1], 10)
        if (border) root.borderSize = parseInt(border[1], 10)
      }
    }
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
        root.onKey(event)
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
      // Command line near the top: what's typed so far, why a command failed,
      // or a reminder of the commands.
      Rectangle {
        anchors.top: parent.top
        anchors.topMargin: Style.space(48)
        anchors.horizontalCenter: parent.horizontalCenter
        width: Math.min(commandText.implicitWidth + Style.spacing.xl * 2, parent.width - Style.space(32))
        height: commandText.implicitHeight + Style.spacing.md * 2
        radius: Style.cornerRadius
        color: Color.menu.background
        border.color: root.commandError !== "" || root.command !== "" ? root.accent : Color.menu.border
        border.width: root.commandError !== "" || root.command !== "" ? 2 : 1

        Text {
          id: commandText
          anchors.centerIn: parent
          width: Math.min(implicitWidth, parent.parent.width - Style.space(32) - Style.spacing.xl * 2)
          elide: Text.ElideRight
          color: root.commandError !== "" || root.command !== "" ? root.accent : Color.menu.text
          opacity: root.commandError !== "" || root.command !== "" ? 1 : 0.7
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.title
          font.bold: root.command !== ""
          text: root.commandError !== "" ? root.commandError
            : root.command !== "" ? "› " + root.command.replace("\n", "⏎") + "▏"
            : "a jump  ·  2a on workspace 2  ·  2⏎ go there  ·  m32b move  ·  rk6 resize (of 12)  ·  Esc close"
        }
      }

      // Overview along the bottom: one mini-map card per workspace (1-5 always,
      // plus any other with windows). The current one is highlighted.
    Row {
      anchors.bottom: parent.bottom
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottomMargin: Style.gapsOut * 2
      spacing: Style.spacing.md

      Repeater {
        model: root.workspaces
        delegate: Rectangle {
          id: wsCard
          required property var modelData
          width: root.screenW * root.miniScale + Style.space(16)
          height: root.screenH * root.miniScale + Style.space(44)
          radius: Style.cornerRadius
          color: Color.menu.background
          // Lit while its number is part of the command being typed.
          readonly property bool lit: modelData.digit !== "" && root.litDigits.indexOf(modelData.digit) !== -1
          border.color: modelData.current || lit ? root.accent : Color.menu.border
          border.width: modelData.current || lit ? 3 : 2

          // Header: the number key that goes there, and the workspace name.
          Row {
            x: Style.space(8); y: Style.space(6)
            spacing: Style.spacing.md
            Rectangle {
              visible: wsCard.modelData.digit !== ""
              width: Math.max(Style.space(22), digitText.implicitWidth + Style.spacing.md * 2)
              height: digitText.implicitHeight + Style.spacing.xs * 2
              radius: Math.max(3, Style.cornerRadius / 2)
              color: wsCard.modelData.current ? root.accent : "transparent"
              border.color: root.accent
              border.width: 1
              Text {
                id: digitText
                anchors.centerIn: parent
                text: wsCard.modelData.digit
                color: wsCard.modelData.current ? Color.menu.background : root.accent
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.title
                font.bold: true
              }
            }
            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: wsCard.modelData.current ? "here" : (wsCard.modelData.digit === "" ? wsCard.modelData.name : "")
              color: Color.menu.text
              opacity: 0.6
              font.family: Style.font.menuFamily
              font.pixelSize: Style.font.body
            }
          }

          Text {
            anchors.centerIn: parent
            anchors.verticalCenterOffset: Style.space(14)
            visible: wsCard.modelData.windows.length === 0
            text: "Empty"
            color: Color.menu.text
            opacity: 0.4
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.body
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
