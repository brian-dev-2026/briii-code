# Briii Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A built-in extension that syncs settings, keybindings, snippets and the extension list
through a secret GitHub Gist, with secrets kept local and a review before anything is overwritten.

**Architecture:** `brand/extensions/briii-sync`, plain JS like `briii-update`. Pure libraries
(`settings`, `plan`) are unit-tested directly; `files` and `gist` are tested against temp folders
and a local fake Gist API. `extension.js` wires them to commands, settings and a startup timer.
Smoke tests drive the real commands against an in-process fake API.

**Tech Stack:** Node (extension host), node:test, vendored `jsonc-parser` 3.3.1 (MIT), GitHub
Gist REST API, VS Code extension API.

**Spec:** `docs/superpowers/specs/2026-09-30-briii-sync-design.md`

## Global Constraints

- Scope `gist` only: `vscode.authentication.getSession('github', ['gist'], …)`.
- Gist description exactly `Briii Code settings`; created with `public: false`.
- Gist files: `settings.json`, `keybindings.json`, `snippets__<name>`, `extensions.json`
  (`[{ "id": "publisher.name" }]`, sorted), `meta.json` (`{ machine, time, briiiRelease, format: 1 }`).
- Secret pattern: `/token|password|passwd|secret|api[-_.]?key|credential/i`, plus exact keys in
  `briii.sync.ignoredSettings` (array, machine scope).
- `briii.sync.onStartup`: `off` (default) | `ask` | `pull`; runs 60 s after start, silent session only.
- Backups in `<globalStorage>\backups\<ISO time>\`, newest 10 kept.
- Every network call times out after 30 s.
- Nothing is ever uninstalled; snippet removals are unticked by default and never applied by `pull`.
- Test hooks: `BRIII_SYNC_API` (base URL instead of `https://api.github.com`) and
  `BRIII_SYNC_TOKEN` (instead of the sign-in), read at call time.
- Default profile only. `test/` is not shipped (the `rebrand.mjs` copy filter already skips it).

## Review Focus

- **Secrets nested inside objects** (e.g. REST Client's
  `"rest-client.environmentVariables": { "$shared": { "token": "…" } }`) must not be uploaded,
  and must come back from the local file on Sync Down. Test in Task 1.
- **Comments and trailing commas in `settings.json`** survive both directions. Test in Task 1.
- **A fresh PC** (no `keybindings.json`, no `snippets` folder) gets them created by Sync Down. Test
  in Task 2.
- **Line endings:** CRLF locally and LF on GitHub must not count as a difference. Test in Task 4.
- **A second PC's first Sync Up** (no `lastVersion` yet, Gist already written by another machine)
  is a conflict, not a silent overwrite. Test in Task 4.

---

### Task 1: Secret filtering that keeps comments

**Files:**
- Create: `brand/extensions/briii-sync/lib/vendor/jsonc-parser/` (the package's `lib/umd/` files
  from `npm pack jsonc-parser@3.3.1`) and `lib/vendor/jsonc-parser/LICENSE.md`
- Create: `brand/extensions/briii-sync/lib/settings.js`
- Test: `brand/extensions/briii-sync/test/settings.test.js`

**Interfaces:**
- Produces:
  - `isSecretKey(key: string, ignored: string[]): boolean`
  - `stripSecrets(text: string, ignored: string[]): { text: string, removed: string[] }`
    (`removed` = JSON paths joined with `.`, e.g. `rest-client.environmentVariables.$shared.token`)
  - `restoreSecrets(remoteText: string, localText: string, ignored: string[]): string`
    (local values of every secret path are written into the remote text)

- [ ] **Step 1: Write the failing tests**
  - `stripSecrets removes top-level secret keys and keeps comments`: input
    `'{\n  // my font\n  "editor.fontSize": 14,\n  "github.token": "abc",\n}'` → text contains
    `// my font` and `"editor.fontSize": 14`, not `abc`; `removed` = `['github.token']`.
  - `stripSecrets removes secrets nested in objects`: the REST Client example above → `removed`
    = `['rest-client.environmentVariables.$shared.token']`, other `$shared` keys kept.
  - `stripSecrets removes keys listed in ignoredSettings`: `ignored = ['window.zoomLevel']`.
  - `restoreSecrets puts local secret values back into the downloaded text`: remote without the
    token, local with `"github.token": "abc"` → result has `"github.token": "abc"` and the
    remote's comments.
  - `restoreSecrets drops nothing when local has no secrets` (returns remote text unchanged).
  - `isSecretKey` matches `apiKey`, `api_key`, `myPassword`, `credentials`; not `editor.tabSize`.
- [ ] **Step 2: Run** `node --test brand/extensions/briii-sync/test/settings.test.js` →
  FAIL (cannot find `../lib/settings`).
- [ ] **Step 3: Vendor jsonc-parser; implement `lib/settings.js`** with `parseTree`/`findNodeAtLocation`
  to walk properties at any depth and `modify` + `applyEdits` (formatting `{ insertSpaces: false,
  tabSize: 1 }` taken from the text) to remove or set them.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `briii-sync: secret filtering that keeps comments (vendored jsonc-parser)`.

### Task 2: The user folder: snapshot and apply with backup

**Files:**
- Create: `brand/extensions/briii-sync/lib/files.js`
- Test: `brand/extensions/briii-sync/test/files.test.js`

**Interfaces:**
- Produces:
  - `readSnapshot(userDir: string): { files: { [gistName: string]: string } }` — `settings.json`,
    `keybindings.json`, `snippets__<name>` for `snippets\*.json|*.code-snippets`; missing files omitted.
  - `applyChanges(userDir: string, backupRoot: string, changes: { name: string, content: string | null }[]): { backup: string }`
    (`content: null` deletes; backup of every touched existing file first; on a failed write it
    restores that file and throws `Error` naming it; keeps the newest 10 backup folders)
  - `localPath(userDir: string, gistName: string): string`

- [ ] **Step 1: Write the failing tests**
  - `readSnapshot maps snippets to snippets__ names and skips other files`.
  - `readSnapshot on a fresh profile returns only what exists` (empty folder → `{ files: {} }`).
  - `applyChanges creates missing files and the snippets folder` (fresh PC).
  - `applyChanges backs up touched files first` (backup folder has the old content).
  - `applyChanges deletes a snippet for content null`.
  - `applyChanges restores the file when a write fails` (target made a directory → throws with
    the file name; other files unchanged).
  - `applyChanges keeps the newest 10 backups` (12 runs → 10 folders).
- [ ] **Step 2: Run** `node --test brand/extensions/briii-sync/test/files.test.js` → FAIL.
- [ ] **Step 3: Implement `lib/files.js`**; backup folder name = ISO time with `:` replaced by `-`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `briii-sync: read the user folder, apply changes with backups`.

### Task 3: The Gist API

**Files:**
- Create: `brand/extensions/briii-sync/lib/gist.js`
- Create: `brand/extensions/briii-sync/test/fakeGist.js` (test helper: in-memory Gist API server)
- Test: `brand/extensions/briii-sync/test/gist.test.js`

**Interfaces:**
- Produces (`api = { base: string, token: string }`):
  - `findGist(api): Promise<{ id, version, htmlUrl } | null>` (paginated `GET /gists?per_page=100&page=N`)
  - `createGist(api, files: {[name]: string}): Promise<{ id, version, htmlUrl }>`
  - `getGist(api, id): Promise<{ id, version, htmlUrl, files: {[name]: string} }>` (follows
    `raw_url` when `truncated`)
  - `updateGist(api, id, files: {[name]: string | null}): Promise<{ id, version, htmlUrl }>`
  - errors: `GistError` with `status` and a user-facing `message`; `401` → "sign in again",
    `403`/`429` → "rate limited, retry after <time>" from `x-ratelimit-reset`.
  - `DESCRIPTION = 'Briii Code settings'`
- `fakeGist.js`: `startFakeGist({ gists?, pageSize? }) → { base, token, state, hits, close }`
  implementing list (with `Link` paging), create, get (with a `truncated` option), update
  (null deletes), and `401` for a wrong token.

- [ ] **Step 1: Write the failing tests**: `findGist finds the Briii gist on page 2`,
  `findGist returns null when there is none`, `createGist creates a secret gist with the description`
  (fake records `public: false`), `getGist follows raw_url for truncated files`,
  `updateGist deletes files set to null`, `a wrong token is a 401 GistError asking to sign in again`,
  `a 403 names the reset time`, `a stalled server times out` (timeout option `timeoutMs` for tests).
- [ ] **Step 2: Run** `node --test brand/extensions/briii-sync/test/gist.test.js` → FAIL.
- [ ] **Step 3: Implement `lib/gist.js`** with `fetch`, headers `authorization: Bearer <token>`,
  `accept: application/vnd.github+json`, `user-agent: briii-sync`; `version` = `history[0].version`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `briii-sync: GitHub Gist API client`.

### Task 4: The plan: differences, upload patch, conflicts

**Files:**
- Create: `brand/extensions/briii-sync/lib/plan.js`
- Test: `brand/extensions/briii-sync/test/plan.test.js`

**Interfaces:**
- Consumes: `stripSecrets`, `restoreSecrets` (Task 1).
- Produces:
  - `planDown({ local: {[name]: string}, remote: {[name]: string}, localExtensions: string[], ignored: string[] }): { items: Item[], extensions: string[] }`
    where `Item = { name, kind: 'changed'|'new'|'removed'|'invalid', content: string|null, picked: boolean }`;
    `settings.json` content is `restoreSecrets(remote, local)`; `removed` only for `snippets__*`,
    `picked: false`; `invalid` when `settings.json`/`keybindings.json`/`extensions.json` doesn't parse;
    `extensions` = remote ids not installed locally.
  - `planUp({ local, remote, localExtensions, ignored, meta }): { patch: {[name]: string|null}, removedSecrets: string[] }`
    (only changed files; snippets missing locally → `null`; `extensions.json` and `meta.json` built here)
  - `isConflict({ lastVersion: string|undefined, remoteVersion: string|undefined, remoteMachine: string|undefined, machine: string }): boolean`
  - `sameText(a, b): boolean` (ignores CRLF vs LF and a trailing newline)

- [ ] **Step 1: Write the failing tests**:
  `planDown lists changed, new and removed files` (removed unpicked), `planDown keeps local secrets in settings`,
  `planDown marks invalid JSON as invalid`, `planDown lists extensions to install and never uninstalls`,
  `planDown returns nothing when only line endings differ`,
  `planUp sends only changed files and deletes removed snippets`, `planUp leaves secrets out and reports them`,
  `planUp writes sorted extensions.json and meta.json`,
  `isConflict: another machine wrote a version we never saw`,
  `isConflict: our own last version is not a conflict`,
  `isConflict: a second PC's first Sync Up onto an existing gist is a conflict`,
  `isConflict: no gist yet is not a conflict`.
- [ ] **Step 2: Run** `node --test brand/extensions/briii-sync/test/plan.test.js` → FAIL.
- [ ] **Step 3: Implement `lib/plan.js`** (pure; no I/O). `meta.json` itself never counts as a
  difference in `planDown`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `briii-sync: plan differences, uploads and conflicts`.

### Task 5: The extension, smoke tests, bundle and CI

**Files:**
- Create: `brand/extensions/briii-sync/package.json`, `brand/extensions/briii-sync/extension.js`
- Modify: `defaults/extensions.txt` (remove `zokugun.sync-settings`, `zokugun.cron-tasks`),
  `scripts/verify.ps1` (built-in list gets `briii-sync`), `scripts/smoke/index.js`,
  `.github/workflows/release.yml` (step `Test built-in extensions` runs both test folders),
  `CLAUDE.md` (layout, commands, roadmap item 1 done)
- Test: `scripts/smoke/index.js`

**Interfaces:**
- Consumes: everything above.
- Produces commands (category `Briii Sync`): `briii.sync.up(opts?)`, `briii.sync.down(opts?)`,
  `briii.sync.showGist`, `briii.sync.openBackups`. For tests, `opts = { onConflict?: 'overwrite'|'down'|'cancel', pick?: 'default' }`
  skips the dialogs; both return `{ status: 'uploaded'|'downloaded'|'nothing'|'cancelled'|'failed', ... }`.
  Settings `briii.sync.onStartup`, `briii.sync.ignoredSettings`. `globalState` key `briii.sync.lastVersion`.
  Activation `onStartupFinished`. Machine name `os.hostname()`.

- [ ] **Step 1: Write the failing smoke checks** in `scripts/smoke/index.js` (in-process fake API
  like the updater's feed; set `process.env.BRIII_SYNC_API`/`BRIII_SYNC_TOKEN` before calling):
  - `Briii Sync: Sync Up uploads settings, snippets and extensions, not secrets`: write a snippet
    and a settings file with a comment and `"briii.test.token": "s3cret"` in the profile's User
    folder, `briii.sync.up` → status `uploaded`; fake state has `settings.json` without `s3cret`,
    `snippets__briii-smoke.code-snippets`, `extensions.json` containing a first-launch id.
  - `Briii Sync: Sync Down applies changes with a backup and keeps comments`: change the fake
    Gist's `settings.json`, `briii.sync.down({ pick: 'default' })` → `downloaded`; local file has the
    new value, the local comment line and `s3cret`; a backup folder exists.
  - add `briii.briii-sync` to the activation list and the four commands to the command check.
- [ ] **Step 2: Run** the smoke checks against the current staged build (no briii-sync yet):
  `scratchpad/e2e/smoke-stage.ps1 -Only "Briii Sync|activates|commands"` → the two Sync checks FAIL.
- [ ] **Step 3: Implement `package.json` and `extension.js`**: quick pick with *Show differences*
  button (`vscode.diff` of an `untitled`-free read-only virtual document via a
  `TextDocumentContentProvider` on scheme `briii-sync`), progress notifications, startup timer
  (60 s; `ask`/`pull` per spec), the first-Sync-Up notice listing left-out secret keys once.
  Remove the two zokugun lines; update verify, CI, CLAUDE.md.
- [ ] **Step 4: Build and run:** `.\scripts\build.ps1`, then the smoke-stage harness (all checks)
  → all PASS; `node --test "brand/extensions/*/test/*.test.js"` → all pass.
- [ ] **Step 5: Commit** `briii-sync: extension, smoke tests; drop Sync Settings from the bundle`.
