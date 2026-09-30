# Briii Sync

Date: 2026-09-30. Roadmap item 1. Status: design approved in chat, spec awaiting review.

## Goal

A person's Briii Code setup follows them: on another PC, or after a reinstall, one command brings
back their settings, keybindings, snippets and extensions. Setup is just the GitHub sign-in that
Briii Code already has. Nothing is overwritten without a chance to see what changes.

## Decisions (approved)

- **Build Briii Sync** as a built-in extension, `brand/extensions/briii-sync` (plain JS, no build
  step, like `briii-update`).
- **Storage:** one *secret* GitHub Gist through the existing GitHub sign-in, scope `gist` only.
  Not a repo (that needs the broad `repo` scope) and not the bundled Sync Settings (manual setup).
- **Remove Sync Settings** (`zokugun.sync-settings` and its dependency `zokugun.cron-tasks`) from
  `defaults/extensions.txt` once Briii Sync ships: two sync extensions would confuse.
- **Default profile only.** VS Code profiles are out of scope.

## 1. What syncs

| Local (in the user folder, `…\User\`) | Gist file |
| --- | --- |
| `settings.json` | `settings.json` |
| `keybindings.json` | `keybindings.json` |
| `snippets\<name>` (`*.json`, `*.code-snippets`) | `snippets__<name>` |
| user-installed extensions | `extensions.json`: `[{ "id": "publisher.name" }]`, sorted |
| (written on every Sync Up) | `meta.json`: `{ "machine", "time", "briiiRelease", "format": 1 }` |

- The user folder is found from the extension's own `globalStorageUri` (`…\User\globalStorage\
  <ext>` → two levels up), so `--user-data-dir` works too.
- **User-installed extensions:** `vscode.extensions.all` minus built-ins (those under
  `vscode.env.appRoot`). Every Briii install already has the built-ins. Disabled extensions aren't
  visible to the API and are not synced.
- Gist file names can't contain folders, hence the `snippets__` prefix.

## 2. Secrets stay local

A secret Gist isn't listed publicly, but anyone with its link can read it. So:

- Settings whose key matches `/token|password|passwd|secret|api[-_.]?key|credential/i` are never
  uploaded, nor are keys listed in the new setting `briii.sync.ignoredSettings` (array of exact
  keys; machine scope).
- **Comments and formatting are kept.** `settings.json` is JSONC. `jsonc-parser` (MIT, from the VS
  Code team) is vendored as one file in `lib/vendor/` with its licence. Its `modify`/`applyEdits`
  remove ignored keys from the uploaded text, and on Sync Down put the local values of ignored
  keys back into the downloaded text, so both ends keep their comments.
- The first Sync Up shows the list of keys it left out, once.

## 3. Commands

All under the **Briii Sync** category. The first use asks for the GitHub sign-in
(`vscode.authentication.getSession('github', ['gist'], { createIfNone: true })`).

- **Sync Up**
  - Finds the Gist by its description `Briii Code settings` (`GET /gists`, paginated), or creates
    it (`POST /gists`, `public: false`).
  - **Conflict check:** each PC stores the Gist version it last synced (`globalState`,
    `briii.sync.lastVersion`; `globalState` itself isn't synced). If the Gist's current version is
    different and was written by another machine, Sync Up asks: *Overwrite* / *Sync Down first* /
    *Cancel*, naming that machine and time from `meta.json`.
  - Uploads changed files with `PATCH /gists/:id`; a snippet deleted locally is deleted from the
    Gist (file set to `null`). Nothing is sent when nothing changed.
- **Sync Down**
  - Fetches the Gist (following `raw_url` for files GitHub marks `truncated`).
  - Builds the list of differences: each file *changed*, *new* or *removed on GitHub*, plus
    *extensions to install*. Nothing differs → "Already in sync".
  - A quick pick shows them, all ticked, with a *Show differences* button per file that opens
    `vscode.diff` (GitHub version vs local).
  - **Apply:** first a backup of every file it will touch, in `globalStorage\backups\<ISO time>\`
    (the newest 10 are kept), then writes the files. A snippet *removed on GitHub* is deleted only
    if ticked (unticked by default).
  - Missing extensions install through `workbench.extensions.installExtension` (Open VSX).
    **Nothing is ever uninstalled.** Extensions installed locally but not on GitHub are left alone.
  - Records the Gist version as `lastVersion`.
- **Show Gist**: opens the Gist page in the browser.
- **Open Backups Folder**.

## 4. On startup

Setting `briii.sync.onStartup`: `off` (default) | `ask` | `pull`.

- Runs 60 s after start, only when a GitHub session with `gist` scope already exists
  (`getSession(..., { silent: true })`); it never prompts for sign-in.
- If the Gist's version differs from `lastVersion` and its content differs from local:
  - `ask`: a notification "Your synced settings changed on <machine>." with *Review* (opens the Sync
    Down list) and *Not now*.
  - `pull`: applies everything that *Sync Down* would tick by default, backup included, then says
    what changed. Snippet removals are never applied automatically.

## 5. Errors

- No network / GitHub down: a warning with the reason; nothing local changes.
- Sign-in cancelled: nothing happens.
- `401`: the session is stale; ask to sign in again.
- `403`/`429` (rate limit): say so and when to retry (from `x-ratelimit-reset`).
- A file on GitHub that isn't valid JSONC (`settings.json`, `keybindings.json`, `extensions.json`)
  is shown in the list as *invalid on GitHub* and cannot be applied.
- A failed write during Apply stops, restores that file from the backup, and names it.
- Every network call has a timeout (30 s).

## 6. Structure

- `extension.js`: commands, settings, startup timer, UI (quick pick, diffs, notifications).
- `lib/files.js`: read and write the user folder: collect the local snapshot, apply a set of
  changes with backup and restore.
- `lib/settings.js`: secret filtering and restoring (uses the vendored `jsonc-parser`).
- `lib/gist.js`: the GitHub API (find, create, get, update), injectable base URL and token.
- `lib/plan.js`: pure: local snapshot + Gist snapshot → list of differences and the upload patch.
- `lib/vendor/jsonc-parser.js` + `LICENSE`.
- `test/`: node:test unit tests, not shipped (the `rebrand.mjs` copy filter already skips `test/`).
- **Test hook:** `BRIII_SYNC_API` replaces `https://api.github.com`, and `BRIII_SYNC_TOKEN`
  replaces the sign-in, for unit and smoke tests.

## 7. Testing

- **Unit (node:test)**, against a local fake Gist API server:
  - snapshot packing: snippet naming, sorting, user vs built-in extensions;
  - secret filtering keeps comments, removes matching keys, and restores local values on download;
  - the plan: changed / new / removed / invalid files, extensions to install, nothing to do;
  - conflict detection: another machine's version vs our `lastVersion`;
  - gist: find by description across pages, create, update with deletions, truncated files,
    `401`/`403` handling;
  - apply: backup written first, a failed write restores the file, only 10 backups kept.
- **Smoke** (`scripts/smoke/index.js`, fake API through `BRIII_SYNC_API`/`BRIII_SYNC_TOKEN`): Sync Up
  from a profile with a snippet and a secret setting (the secret isn't on the fake server), then
  change local files and Sync Down with an answer injected for the quick pick; check files,
  backup and that comments survived.
- **verify.ps1:** `briii-sync` is in the built-in list; Sync Settings is no longer bundled.
- **CI:** the `Test the updater` step becomes `Test built-in extensions` and also runs
  `brand/extensions/briii-sync/test/*.test.js`.

## Out of scope

VS Code profiles, UI state (open editors, layout), `tasks.json` and `launch.json` in the user
folder, automatic sync on every change, uninstalling extensions, encryption of the Gist.
