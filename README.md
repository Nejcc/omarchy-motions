# Omarchy motions

Keyboard-only window motions for [Omarchy](https://omarchy.org), so you never
reach for the mouse to change focus.

![Window hints: letters on every window, other workspaces as mini-maps](preview.png)

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

## Requirements

Omarchy with its Quickshell-based shell, on Hyprland with Lua config (older
Hyprland releases fall back to the classic dispatchers). It calls `hyprctl`,
which ships with Hyprland. Nothing else to install.

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

## Usage

| Shortcut | Does |
|---|---|
| `SUPER + ;` | Letters on every window, including other workspaces; press one to jump there |
| `SUPER + SHIFT + ;` | The same, and the chosen window goes full width |
| `Shift` + letter | Full width for that one jump, from the normal hints |
| `SUPER + '` | Flip to the previously focused window; press again to flip back |
| `Esc` or any other key | Close the hints without moving |

## Uninstall

```sh
omarchy plugin remove nejcc.motions
```

Then delete the lines you added to `~/.config/hypr/bindings.lua`. The plugin
keeps no settings files.

## Tests

```sh
node --test tests/     # unit tests for the logic, no dependencies (also run in CI)
tests/smoke.sh         # live test against your running Omarchy shell
```

The unit tests cover letter assignment, workspace mini-maps, multiple monitors,
display scaling and broken `hyprctl` output. They also run the real focus
command against a fake `hyprctl`, including window addresses that try to inject
shell commands. The smoke test opens and closes the hints, presses real keys
with `wtype` (only the letter of the window that's already focused, so nothing
on screen changes) and hammers it with quick open/close cycles.

## Limitations

- Up to 26 windows get a letter.
- On-screen hints are drawn on the focused monitor only.
- Mini-maps are drawn at the focused monitor's aspect ratio.
- For a few seconds right after login or a shell restart, the key may do
  nothing while the Omarchy shell loads its plugins. This affects every shell
  plugin, not just this one.

## See also

[Keybindings hint](https://github.com/Nejcc/omarchy-keybindings-hint): hold
`SUPER` to see what every `SUPER + key` does, with suggestions for your next
move. It suggests `SUPER + ;` and `SUPER + '` when you have several windows open.

## License

MIT
