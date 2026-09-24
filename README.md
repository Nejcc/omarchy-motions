# Omarchy motions

Keyboard-only window motions for [Omarchy](https://omarchy.org), so you never
reach for the mouse to change focus.

## Window hints

Press a key and every window gets a letter; press the letter to focus that
window.

- Windows on screen get a big letter drawn right on top of them.
- Windows on other workspaces show up in mini-maps along the bottom of the
  screen, one card per workspace. Pressing their letter switches workspace and
  focuses the window.
- Letters follow the home row (`a s d f g h j k l`, then the top and bottom
  rows), so windows on screen get the easiest keys.
- Hold `Shift` with the letter to also make the window full width (the same as
  Omarchy's `SUPER + ALT + F`). A window that is already full width stays as it is.
- `Esc`, a click or any other key cancels.
- Colors come from the current Omarchy theme.

## Install

```sh
omarchy plugin add https://github.com/Nejcc/omarchy-motions.git --enable
```

Then bind keys in `~/.config/hypr/bindings.lua`:

```lua
-- Window hints
o.bind("SUPER + SEMICOLON", "Jump to window", "omarchy-shell shell toggle nejcc.motions")

-- Window hints that always make the chosen window full width
o.bind("SUPER + SHIFT + SEMICOLON", "Jump to window, full width", "omarchy-shell shell toggle nejcc.motions '{\"maximize\":true}'")

-- Flip between the current and the previously focused window
o.bind("SUPER + APOSTROPHE", "Last window", function() hl.dispatch(hl.dsp.focus({ last = true })) end)
```

These keys are free in the default Omarchy bindings. Pick others if you prefer.
The last-window flip is plain Hyprland and needs no plugin code.

## Limitations

- Up to 26 windows get a letter.
- On-screen hints are drawn on the focused monitor only.
- Mini-maps are drawn at the focused monitor's aspect ratio.

## License

MIT
