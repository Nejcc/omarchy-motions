# Window hints for Omarchy

Keyboard-only window switching for [Omarchy](https://omarchy.org). Press a key
and every window gets a letter; press the letter to focus that window.

- Windows on screen get a big letter drawn right on top of them.
- Windows on other workspaces show up in mini-maps along the bottom of the
  screen, one card per workspace. Pressing their letter switches workspace and
  focuses the window.
- Letters follow the home row (`a s d f g h j k l`, then the top and bottom
  rows), so windows on screen get the easiest keys.
- `Esc`, a click or any other key cancels.
- Colors come from the current Omarchy theme.

## Install

```sh
omarchy plugin add https://github.com/Nejcc/omarchy-window-hint.git --enable
```

Then bind a key in `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + SEMICOLON", "Jump to window", "omarchy-shell shell toggle nejcc.window-hints")
```

`SUPER + ;` is free in the default Omarchy bindings. Pick any other key if you
prefer.

## Limitations

- Up to 26 windows get a letter.
- On-screen hints are drawn on the focused monitor only.
- Mini-maps are drawn at the focused monitor's aspect ratio.

## License

MIT
