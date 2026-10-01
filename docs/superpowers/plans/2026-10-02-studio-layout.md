# Studio Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Studio layout: tool dock at the bottom of the sidebar, floating pill tabs, status chips, a ✳ Claude title-bar pill and a tinted Claude card on the right.

**Architecture:** VS Code's own settings do the layout (`workbench.activityBar.location: "bottom"`, Claude Code's `preferredLocation: "sidebar"`), flipped early by `rebrand.mjs` patches; `apple.css` does the look; `briii-update` moves an existing user's Claude location once.

**Tech Stack:** plain JS (node:test), CSS, PowerShell (verify), Inno/VSCodium build as before.

**Spec:** `docs/superpowers/specs/2026-10-02-studio-layout-design.md`

## Global Constraints

- Never change `brand.json › ids`. Every file listed in `product.json › checksums` that changes needs `updateChecksum()`.
- `jsPatches` and the splash patch are optional: they warn, never fail, when a pattern stops matching.
- `apple.css` only uses VS Code class names and `--vscode-*` theme variables (verify.ps1 fails on stale classes).
- The one-time Claude move changes only a user value of exactly `"panel"`, once (`globalState` key `briii.layout.studioApplied`).
- `workbench.secondarySideBar.defaultVisibility` stays `"hidden"`.

## Review Focus

1. Claude Code not installed yet at activation (fresh PC): the move must not throw on an unregistered setting, and the default must still make Claude open on the right later.
2. A person who sets `workbench.activityBar.location` back to `"default"`: the splash must not blank on every launch (drop the saved layout once only).
3. Status items with their own backgrounds (remote indicator, error/warning, deploy pill, update item) must stay readable as chips.
4. Narrow sidebar: the dock overflows into "…" instead of clipping icons.
5. Light theme: the Claude tint and chips use theme variables, so they read in Briii Light too.

---

### Task 1: One-time Claude move

**Files:**
- Create: `brand/extensions/briii-update/lib/studioLayout.js`
- Test: `brand/extensions/briii-update/test/studioLayout.test.js`
- Modify: `brand/extensions/briii-update/extension.js` (call it from `activate`, after `installFirstLaunchExtensions()`)

**Interfaces:**
- Produces: `applyStudioOnce({ isDone: () => boolean, markDone: () => Promise, userValue: () => string|undefined, setUserValue: (v) => Promise }) → Promise<boolean>` (true when it changed the setting).

- [ ] **Step 1: Write the failing tests:** `"panel" becomes "sidebar" and is marked done`; `an unset value is left alone but marked done`; `"sidebar" is left alone`; `once done, a later "panel" is kept`; `a failing write is not marked done` (setUserValue rejects → returns false, markDone not called).
- [ ] **Step 2: Run** `node --test brand/extensions/briii-update/test/studioLayout.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `applyStudioOnce`; wire in `extension.js` with `vscode.workspace.getConfiguration('claudeCode')`: `userValue = inspect('preferredLocation')?.globalValue`, `setUserValue = v => update('preferredLocation', v, ConfigurationTarget.Global)`, done flag in `context.globalState`. Errors are logged to the Updates output, never shown.
- [ ] **Step 4: Run** the updater test suite. Expected: all pass.
- [ ] **Step 5: Commit** "briii-update: move Claude Code to the right-hand card once (Studio)".

### Task 2: Layout defaults and startup

**Files:**
- Modify: `defaults/settings.json` (add `"workbench.activityBar.location": "bottom"`, `"claudeCode.preferredLocation": "sidebar"`)
- Modify: `scripts/rebrand.mjs` (`jsPatches` entry flipping `"workbench.activityBar.location"` default `"default"` → `"bottom"`; splash patch also drops a saved layout with `activityBarWidth>0` once, remembered in the splash's `localStorage` key `briii.studioLayout`)
- Test: `scripts/smoke/index.js` (checks `studio: the tool icons are a dock at the bottom of the sidebar` — `getConfiguration('workbench').get('activityBar.location') === 'bottom'` — and `studio: Ctrl+Alt+B shows and hides the right-hand card` via `workbench.action.toggleAuxiliaryBar` and the `auxiliaryBarVisible` context, read through `getContext` if available, else just that the command runs twice without error)

- [ ] **Step 1: Write the smoke checks.** Run against the current stage (`scratchpad\e2e\smoke-stage.ps1`, `BRIII_SMOKE_ONLY=studio`). Expected: the dock check FAILS (`default`).
- [ ] **Step 2: Implement the settings and both patches; rebuild** (`.\scripts\build.ps1 -Version 1.135.06055`). Expected: build log prints both new `Patched:` lines.
- [ ] **Step 3: Run the smoke checks on the new stage.** Expected: PASS.
- [ ] **Step 4: Commit** "Studio: tool dock at the bottom of the sidebar, Claude on the right by default".

### Task 3: The Studio look

**Files:**
- Modify: `brand/ui/apple.css` (sections: dock, tab row, status chips, ✳ Claude pill on the layout control's secondary-sidebar toggle, Claude card tint)
- Modify: `scripts/verify.ps1` (third screenshot `out/screenshot-claude.png`: Briii Dark with `workbench.secondarySideBar.defaultVisibility: "visible"`)

- [ ] **Step 1: Find the class names** in the running stage (DevTools / the shipped CSS) for the bottom composite bar, status items and the layout-control toggle; write the CSS.
- [ ] **Step 2: Rebuild and run** `.\scripts\verify.ps1` (uninstall Briii Code first; keep `%APPDATA%\Briii Code` and `~\.briii`). Expected: all checks pass, including "apple.css only targets classes this VS Code has".
- [ ] **Step 3: Look at** `out/screenshot-dark.png`, `-light.png`, `-claude.png` against the mockup. Fix what differs; repeat Step 2 at most twice.
- [ ] **Step 4: Commit** "Studio: dock, pill tabs, status chips and the Claude card".

### Task 4: Docs, release, install

- [ ] **Step 1:** CLAUDE.md: layout gotchas (dock = bottom activity bar; ✳ pill is the restyled layout control; Claude Code rewrites `preferredLocation` itself) and the commands list. Commit with Task 3 or alone.
- [ ] **Step 2:** All unit tests + `helper.test.ps1` + `swap.test.ps1` pass; push `main`; watch CI to a published release.
- [ ] **Step 3:** Reinstall the user's Briii Code from the new release (consent from earlier: settings in `%APPDATA%\Briii Code` and `~\.briii` kept), or leave it to the auto-update if Briii Code is open.
