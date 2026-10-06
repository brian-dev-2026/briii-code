# macOS title bar + Cursor-style workbench

Date: 2026-10-06. Status: built. Chosen from the style mockups (options H "Cursor-style" and
I "macOS VS Code", https://claude.ai/artifact/MMPqKfU3i38vYB9GYt3pbQ, private) and approved
after trying a live prototype. It replaces the Studio look
(`2026-10-02-studio-layout-design.md`), whose floating cards, bottom dock and title-bar Claude
pill people found hard to use.

## What it looks like

- **Title bar (macOS):** red, yellow and green window buttons on the left in macOS order,
  with × − + on hover and grey while the window is inactive. Nothing else except the search box
  in the middle and Accounts / Manage on the right. There is no app icon, no ☰, no layout buttons
  and no Claude pill.
- **Sidebar (Cursor):** ☰ (the whole menu) followed by the tool icons in one row at the top of
  the sidebar. The active tool gets a soft square. The tools that don't fit are behind "⋯".
- **Workbench (Cursor):** flat panels separated by 1 px lines (no modern-UI cards), with plain
  tabs and a plain status bar. Briii Dark is near-black and monochrome (#141414 chrome, #181818
  editor, #262626 lines, light-grey primary buttons).
- **Claude:** in the right-hand secondary sidebar as before, hidden by default. It opens with:
  - the **✳ Claude Code** item in the status bar (Claude Code's own);
  - **Ctrl+Alt+B**;
  - a **Claude button on the Explorer's header**, which appears when the pointer is over the
    Explorer, next to New File / New Folder.
- **Ctrl+Alt+W** still hides and shows the code area.

## How it is built

| Part | Where |
|---|---|
| Window buttons drawn by VS Code (`window.controlsStyle: custom`) | `rebrand.mjs`: the setting's registered default, plus the decision function in both `workbench.desktop.main.js` and `out/main.js` (main process; it reads only user settings). It's an application setting, so extension defaults are ignored. "native" in settings still wins. |
| Traffic-light look, left placement | `apple.css` (`.window-controls-container`, `.window-icon.window-*`) |
| Tool row at the top, ☰ beside it | `activityBar.location: top` in `defaults/settings.json` and `jsPatches`; `window.menuBarVisibility: compact` in `jsPatches` only (application setting) |
| Clean title bar | `workbench.layoutControl.enabled: false` (settings + `jsPatches`) |
| Flat workbench | the modern-UI patch and setting were removed. The splash patch now drops a saved modern-UI layout, so the first launch after the upgrade doesn't show cards and then jump. |
| Cursor colours | `brand/extensions/briii-theme/themes/briii-dark.json` |
| Claude button | `defaults/menus.json` → `briii-defaults › contributes.menus`, `view/title` on `workbench.explorer.fileView` with Claude Code's own `claude-vscode.sidebar.open` (and its logo). It's hidden until Claude Code is installed. |

## Limits found while building

- **Snap Layouts:** Windows 11's flyout on the maximize button needs native buttons, so it goes
  away. Win+arrow snapping still works.
- **The Claude button can't sit in the sidebar's top row or its "EXPLORER ⋯" line.**
  - The top row only holds view containers.
  - `viewContainer/title` is a proposed menu that VS Code restricts to the Run and Debug
    container (`viewContainer == workbench.view.debug`), even when the proposal is enabled.
  - So the button sits on the Explorer's file-view header and shows on hover, like the other
    Explorer buttons.
  - `workbench.view.alwaysShowHeaderActions: true` would make all of these header buttons always
    visible.
- **Briii Light keeps its existing colours** (now flat); only Briii Dark got the Cursor palette.

## Testing

- **Smoke tests:** default settings, the top tool row, the Claude menu item (and that Claude Code
  still has the command), Ctrl+Alt+W, and the right-hand card.
- **Checked live over CDP:**
  - the traffic lights active, inactive and on hover;
  - a fresh profile's first launch, showing flat panels, ☰ in the sidebar row and a clean title bar;
  - the Claude button appearing on hover.
