# Studio layout

Date: 2026-10-02. Status: approved in mockups (layout A, "Claude open" variant), spec awaiting review.
Mockups: https://claude.ai/artifact/W8FysVnYrcMYKchq1eEg35 (private).

## Goal

Briii Code still looks like plain VS Code: the icon strip down the left edge, a full-width
status bar and a ribbon of tabs. Studio keeps everything where people expect it (files left,
code centre) but redesigns those three parts, and gives Claude Code a card of its own on the
right that stays hidden until it is called. Nothing is removed: every tool, view and setting
still works, and the change is undone by settings.

## What changes

1. **Dock instead of the icon strip.** The activity bar moves to the bottom of the sidebar
   (`workbench.activityBar.location: "bottom"`, VS Code's own option) and is styled as a
   rounded pill, a dock, inside the sidebar card. VS Code fits as many icons as there is room
   for and puts the rest behind its own "…" button (about 8 of the 14 at the default sidebar
   width). The Accounts and Manage (gear) buttons go wherever VS Code places them in this mode
   (the title bar); the screenshots check that they are still reachable.
2. **Floating pill tabs.** The tabs keep the pill shape `apple.css` already gives them. The tab
   row takes the canvas colour, so the pills appear to float above the code card, and the active
   tab lifts out like a card (the existing shadow).
3. **Status bar as chips.** The status bar has no bar look: each item is a small rounded chip
   on the canvas, with a gap between items. Items that VS Code colours themselves (the remote
   indicator, error and warning states, the deploy pill) keep their colours.
4. **✳ Claude button in the title bar.** Extensions can't add title-bar buttons, so the title
   bar's existing "Toggle Secondary Side Bar" layout button is restyled as a "✳ Claude" pill.
   It and Ctrl+Alt+B (VS Code's own shortcut) show and hide the Claude card. The other layout
   buttons stay as they are.
5. **Claude card on the right.** Claude Code opens in the secondary sidebar, which modern UI
   already draws as a card; Studio tints it slightly (the accent at low opacity plus a thin
   inner border) so the chat reads as its own place. It stays hidden by default
   (`workbench.secondarySideBar.defaultVisibility: "hidden"`, unchanged).
   - `defaults/settings.json` sets `claudeCode.preferredLocation: "sidebar"` ("Sidebar
     (Right)" in Claude Code's own setting).
   - Claude Code writes that setting itself whenever Claude is opened somewhere new, so
     existing installs already have `"panel"` in their user settings and a default alone would
     not move them. A one-time step in `briii-update` (which already runs first-launch work)
     changes a user value of `"panel"` to `"sidebar"` once, records that in `globalState`
     (`briii.layout.studioApplied`), and never touches it again. Any other value, or a value
     set after that, is left alone.

## How it is built

- **Settings** in `defaults/settings.json`: `workbench.activityBar.location: "bottom"` and
  `claudeCode.preferredLocation: "sidebar"`.
- **Startup defaults** (`rebrand.mjs › jsPatches`): extension `configurationDefaults` apply
  only from the second launch and layout is decided before extensions load, so the default of
  `workbench.activityBar.location` is also flipped to `"bottom"` in `workbench.desktop.main.js`.
  The patch is optional, like the others: it warns when the pattern stops matching.
- **Splash** (`rebrand.mjs`, startup splash patch): the splash redraws the layout the previous
  session saved. A saved layout with an activity bar strip (`activityBarWidth > 0`) is dropped
  when the activity bar is not in its default place, so an upgrade does not open with the old
  strip and then jump; that one launch shows only the background, as for the modern UI patch.
- **CSS** in `brand/ui/apple.css`: dock, tab row, status chips, the ✳ Claude pill and the
  Claude card tint. Only VS Code class names and theme colour variables; `verify.ps1` already
  fails when a class in the selectors no longer exists in the VS Code being built.
- **One-time Claude move** in `brand/extensions/briii-update` as a small module with unit
  tests, called from activation next to the first-launch installs.

## Undoing it

Each part is a setting a person can override: `workbench.activityBar.location: "default"`
brings the strip back, and `claudeCode.preferredLocation: "panel"` (or opening Claude in a
tab) puts Claude back in the editor area. The chip and pill styling has no switch, like the
rest of `apple.css`.

## Testing

- **Unit tests** (node) for the one-time Claude move: `"panel"` becomes `"sidebar"` once; an
  unset value, `"sidebar"` or a second run changes nothing; a later user choice of `"panel"`
  is kept.
- **Smoke tests** (`scripts/smoke/index.js`): on a first launch the effective
  `workbench.activityBar.location` is `"bottom"`, and `workbench.action.toggleAuxiliaryBar`
  shows and hides the secondary sidebar.
- **verify.ps1**: the existing selector check covers the new CSS. The dark and light
  screenshots show the dock, chips and pill tabs, and a new `out/screenshot-claude.png` shows
  the secondary sidebar open (Claude Code isn't bundled, so it shows the empty card and the
  ✳ pill in its "on" state).
- **On the real PC**, after updating: Claude opens on the right, the dock's "…" lists the
  remaining tools, and Accounts and Manage are reachable.

## As built (2026-10-02)

- **Tabs:** modern UI draws the editor card's outline around the tab row too, so a tab row in the canvas colour read as a stripe inside the card (tried, then dropped). The tab row is the card colour, and the open tab is a soft pill (list.inactiveSelectionBackground).
- **✳ Claude pill:** it shows the codicon "sparkle" (the ✳ character falls back to a font
  without it) and turns the button colour while the card is open.
- **`out/screenshot-claude.png`** was not added: the change was checked live in both themes,
  with Claude closed and open, over the debugging port. The local `verify.ps1` run was skipped,
  because the PC's own Briii Code was in use. CI runs `verify.ps1 -NoGui`, which includes the
  selector check.

- **Claude card tint:** dropped. Claude Code's chat is a webview drawn in a layer above the card, so the tint and inner border only showed in the uncovered strips and made the edge uneven. The card matches the other cards.

- **Dock reverted (2026-10-06):** the bottom dock was far from where people look and hid 6 of the 14 tools behind "…", so the tool icons are VS Code's strip on the left again (the dock CSS stays for anyone who picks `bottom`). **Ctrl+Alt+W** toggles the code area (`defaults/keybindings.json`, shipped in `briii-defaults`), so Explorer and Claude can share the window; Ctrl+Alt+E was taken by REST Client.

## Out of scope

Layouts B (Focus) and C (Agent), new themes or colours, changing which tools exist, and a
title-bar button that isn't the existing layout control.
