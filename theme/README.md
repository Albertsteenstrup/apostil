# Theme

The colour theme "Apostil Light" and the choice between three looks.

## Palette

| Name | Colour | Where it is used |
| --- | --- | --- |
| paper | `#fffefc` | Editor, panel, terminal, menus, hover and suggestion windows, inputs |
| stone | `#f3f0ea` | Side bar, activity bar, title bar, tabs row, status bar |
| region | `#f8f5f0` | Hover rows in lists and tabs |
| ink | `#1a2b24` | Text |
| soft | `#31423b` | Status bar text, icons, operators |
| muted | `#6b6b6b` | Quiet text, inactive tabs |
| faint | `#9a978f` | Placeholders, disabled text |
| faint code | `#8a877f` | Line numbers and comments (a little darker, so line numbers reach 3 to 1) |
| line | `#ddd6cc` | Hairline borders |
| line 2 | `#beb6ab` | Input and widget borders, scroll bars |
| teal | `#0f766e` | The one accent: active tab line, focus border, buttons, badges |
| teal ink | `#0b5f58` | Links, selected list text, functions |
| teal soft | `#e3f1ee` | Selected list item, editor selection |
| current line | `#f5f1eb` | Current line in the editor |
| green | `#047857` | Added files, and the counts of added lines |
| red | `#b42318` | Errors, and the counts of removed lines |
| VS Code's own | `#587c0c`, `#ad0707` | The diff of code: added and removed lines look as in the default light theme of VS Code ("Light 2026"). The theme sets no diff colour of its own. |
| purple | `#5b4b8a` | Keywords |
| brown | `#8a5a2b` | Strings |
| terracotta | `#9a4a1f` | Numbers, regular expressions |
| slate | `#2f5d7c` | Types and classes |
| plum | `#7a3e65` | Constants and decorators |

## The three looks

`apostil.chooseLook` shows them. Apostil asks once at the first start.

- Apostil: Apostil Light.
- VS Code default: the default dark theme of the VS Code that runs.
- Same as the computer: Apostil Light when the system is light, the default dark theme when it is dark.

## The check

`npm run check` checks the looks in its one real VS Code window (`view/window-check.mjs`): it chooses "VS Code default" and "Same as the computer" and reads the settings back. The window has its own user data and extensions folders, and never touches your own VS Code settings.
