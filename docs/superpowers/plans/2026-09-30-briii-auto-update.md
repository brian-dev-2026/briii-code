# Briii Code Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub builds and publishes Briii Code installers. The app downloads the newest one in
the background and installs it silently after it is closed.

**Architecture:**
- **Cloud:** a GitHub Actions workflow decides whether a build is due, runs the existing
  `build.ps1` plus a no-GUI `verify.ps1`, and publishes a GitHub Release.
- **App:** a new plain-JS built-in extension `briii-update` checks the Releases API, downloads
  and SHA-256-verifies the installer, and on `deactivate()` hands off to a detached PowerShell
  helper, which waits for the app to exit and runs the installer with `/VERYSILENT`. The same
  extension installs Claude Code and GitLens from Open VSX on first launch.

**Tech Stack:** PowerShell 5.1, Node.js (`node:test` for unit tests), VS Code extension API,
Inno Setup 6, GitHub Actions (`windows-latest`, preinstalled `gh`).

**Spec:** `docs/superpowers/specs/2026-09-30-briii-auto-update-design.md`

## Global Constraints

- **Release id format:** `<vscodium>-<yyyymmdd>.<run_number>` (e.g. `1.135.06055-20261001.14`).
  The git tag is `v<id>`. Local builds use `<vscodium>-local`.
- **Asset names:** `BriiiCode-Setup-x64-<id>.exe` and `BriiiCode-Setup-x64-<id>.exe.sha256`
  (lower-case hex digest, first token of the file).
- **`product.json` fields:** `briiiRelease` (the id) and `briiiUpdateRepo`
  (`"brian-dev-2026/briii-code"`, from `brand.json › updateRepo`).
- **Update folder:** `%LOCALAPPDATA%\Briii Code\updates\`, overridable with `BRIII_UPDATE_DIR`
  (tests only). Feed override: `BRIII_UPDATE_FEED` (tests only). While `BRIII_UPDATE_FEED` is
  set, never launch an installer unless `BRIII_UPDATE_E2E=1` (the end-to-end test only).
- **Timing:** check 30 s after startup, then every 6 h. Stop auto-installing after 3 consecutive
  failures. The helper waits at most 30 min.
- **Setting:** `briii.update.mode`: `auto` (default) | `notify` | `off`.
- **Commands:** `briii.update.check` (returns the result object), `briii.update.installNow`,
  `briii.update.showLog`.
- **First-launch extensions:** `anthropic.claude-code`, `eamodio.gitlens`. Neither may appear in
  `defaults/extensions.txt`.
- **Never change `brand.json › ids`.** Write JSON without a BOM (PS 5.1: `[IO.File]::WriteAllText`
  with `UTF8Encoding($false)`).
- **Launching the GUI from a terminal:** clear `ELECTRON_RUN_AS_NODE` and `VSCODE_*` first
  (verify.ps1 already does).

## Review Focus

- **GitHub asset downloads redirect** (302 to `objects.githubusercontent.com`). The download must
  follow redirects. Test: feed server answers the installer URL with a 302.
- **Interrupted downloads** must never leave a `.exe` that looks verified. Test: the server closes
  mid-body, so `downloadVerified` rejects and only `.part` or nothing remains.
- **Several windows closing** must start one helper, not N installers. Test: the helper lock
  (`Enter-HelperLock` returns `$false` when the lock is held).
- **All-users installs** (install folder under `$env:ProgramFiles`) must not attempt a silent
  install. Test: `effectiveMode({ mode: 'auto', appRoot: 'C:\\Program Files\\Briii Code', ... }) === 'notify'`.
- **Local and dev builds must not be replaced silently.** Test: `effectiveMode` returns `notify`
  for `-local` ids and `off` when `briiiRelease` is missing.

---

## File Structure

| File | Responsibility |
|---|---|
| `brand/brand.json` | + `updateRepo` |
| `defaults/first-launch-extensions.txt` | New: ids installed on first launch |
| `defaults/extensions.txt` | − Claude Code, − GitLens |
| `scripts/build.ps1` | `-Release` parameter; passes the id to `rebrand.mjs` and Inno; installer file name |
| `scripts/rebrand.mjs` | 4th argument `releaseId`; writes `briiiRelease`/`briiiUpdateRepo`; writes `briii-update/first-launch.json`; skips `test/` when copying brand extensions |
| `brand/extensions/briii-update/package.json` | Manifest: commands, setting, `onStartupFinished` |
| `brand/extensions/briii-update/lib/version.js` | Parse and compare release ids; `effectiveMode` |
| `brand/extensions/briii-update/lib/feed.js` | Read the release feed; download and verify the installer |
| `brand/extensions/briii-update/lib/state.js` | Read/write `state.json` |
| `brand/extensions/briii-update/lib/updater.js` | `checkForUpdate` orchestration (no `vscode` import) |
| `brand/extensions/briii-update/lib/firstLaunch.js` | First-launch extension installs |
| `brand/extensions/briii-update/extension.js` | Activation, timers, status bar, commands, `deactivate` hand-off |
| `brand/extensions/briii-update/install-on-exit.ps1` | Detached helper: lock, wait, install, record result |
| `brand/extensions/briii-update/test/*.test.js` | `node --test` unit tests (not shipped) |
| `scripts/verify.ps1` | `-NoGui`; built-in list; first-launch list must not be bundled; smoke env |
| `scripts/smoke/index.js` | Updater check against a local feed; first-launch installs; Claude check |
| `scripts/ci-release-plan.ps1` | Decide whether to build; compute the id; write `GITHUB_OUTPUT` |
| `.github/workflows/release.yml` | Build, verify, publish, prune |
| `CLAUDE.md` | Docs (gitignored, local only) |

---

### Task 1: Release id and first-launch list in the build

**Files:**
- Modify: `brand/brand.json`, `defaults/extensions.txt`, `scripts/build.ps1`, `scripts/rebrand.mjs`
- Create: `defaults/first-launch-extensions.txt`

**Interfaces:**
- Produces: `product.json › briiiRelease`, `product.json › briiiUpdateRepo`,
  `resources/app/extensions/briii-update/first-launch.json` (JSON array of ids), installer
  `out/BriiiCode-Setup-x64-<id>.exe`, and `build.ps1 -Release <id>`.

- [ ] **Step 1:** Add `"updateRepo": "brian-dev-2026/briii-code"` to `brand.json` (outside `ids`).
- [ ] **Step 2:** Move `anthropic.claude-code` and `eamodio.gitlens` out of `extensions.txt` into
  the new `first-launch-extensions.txt`, same format and comment style. Explain that they install
  on first launch because their licences forbid public redistribution.
- [ ] **Step 3:** `build.ps1`: add `[string]$Release`. It defaults to `"$Version-local"` after
  `latest` is resolved. Pass it as the 4th argument to `rebrand.mjs`, use it for
  `#define AppVersion` and in `$outBase` (`...-Setup-x64-$Release`), and make the final
  "Built ..." line print the id. Keep the rcedit numeric version from `$Version`.
- [ ] **Step 4:** `rebrand.mjs`:
  - read `releaseId` (4th argument, required);
  - set `product.briiiRelease` and `product.briiiUpdateRepo = brand.updateRepo`;
  - after copying brand extensions (filter out any `test` directory), write
    `extensions/briii-update/first-launch.json` from `defaults/first-launch-extensions.txt`
    (same parsing as `build.ps1`: strip `#` comments, trim, drop `@version`);
  - usage line: `node rebrand.mjs <stageDir> <brand.json> <defaultsDir> <releaseId>`.
- [ ] **Step 5: Verify.** Run `.\scripts\build.ps1 -Release 1.135.06055-20260930.1`.
  Expected: `Built ...BriiiCode-Setup-x64-1.135.06055-20260930.1.exe`. Also
  `node -e "const p=require('./.cache/stage/1.135.06055/resources/app/product.json');console.log(p.briiiRelease,p.briiiUpdateRepo)"`
  prints the id and the repo, and the stage has no `anthropic.claude-code` or `eamodio.gitlens`
  folder. (Task 2 has to exist for the `first-launch.json` check; do this full build after Task 3.)
- [ ] **Step 6: Commit:** `Build: release ids, first-launch extension list`.

### Task 2: `briii-update` core library (versions, feed, state, orchestration)

**Files:**
- Create: `brand/extensions/briii-update/lib/{version,feed,state,updater}.js`,
  `brand/extensions/briii-update/test/{version,feed,updater}.test.js`

**Interfaces:**
- Produces:
  - `version.js`:
    - `parseRelease(id: string) -> { vscodium: number[], date: number, run: number, local: boolean } | null`
    - `isNewer(candidate: string, current: string) -> boolean`: compares tuples; a published id
      is newer than a `-local` id with the same or a lower VSCodium version.
    - `effectiveMode({ mode, current, appRoot, programFiles }) -> 'auto'|'notify'|'off'`:
      `off` if mode is off or `current` is missing; `notify` if `current` is local or `appRoot`
      starts with `programFiles` (case-insensitive); otherwise `mode`.
  - `feed.js`:
    - `fetchLatest(feedUrl: string) -> Promise<{ id, installerUrl, shaUrl, pageUrl } | null>`,
      mapped from GitHub release JSON: `tag_name` without the leading `v`, the assets named per
      Global Constraints, and `html_url`. `null` if assets are missing.
    - `downloadVerified(release, dir) -> Promise<string>`: writes `<id>.exe.part`, checks SHA-256
      against the `.sha256` asset, renames to `<id>.exe`, deletes other `*.exe` and `*.part` in
      `dir`, and returns the path. It rejects with `Error('checksum mismatch')` on a mismatch,
      and deletes the part file on any failure.
    - Use global `fetch` (follows redirects) and stream to disk.
  - `state.js`:
    - `readState(dir) -> { pending: {id,path,sha256}|null, failures: number, lastCheck: number }`,
      with defaults when the file is missing or invalid;
    - `writeState(dir, state)` writes atomically (tmp file, then rename).
  - `updater.js`:
    - `checkForUpdate({ feedUrl, dir, current, mode }) -> Promise<{ status: 'off'|'none'|'ready'|'failed', id?, pageUrl?, error? }>`.
    - `ready` means a verified installer is pending.
    - A pending entry that still exists and matches the latest id is reused without
      re-downloading.

- [ ] **Step 1: Write the failing tests.** Use `node:test` and `node:assert/strict`. Test names
  and assertions:
  - `parseRelease` round-trips `1.135.06055-20261001.14` to `{vscodium:[1,135,6055],date:20261001,run:14,local:false}`
    and `1.135.06055-local` to `local:true`, and returns `null` for `garbage`.
  - `isNewer('1.135.06055-20261002.1','1.135.06055-20261001.9') === true`;
    `isNewer('1.135.06055-20261001.9','1.135.06055-20261001.9') === false`;
    `isNewer('1.136.00100-20261001.1','1.135.06055-20261009.1') === true`;
    `isNewer('1.135.06055-20261001.1','1.135.06055-local') === true`.
  - `effectiveMode` covers each rule, including the Program Files case from Review Focus.
  - Feed tests run an `http.createServer` on `127.0.0.1:0` serving the release JSON, a 302 from
    the installer URL to `/blob`, `/blob` bytes and `/blob.sha256`:
    - *follows redirects and verifies*: the returned file exists and its content equals the bytes;
    - *rejects a wrong checksum*: rejects with `/checksum mismatch/`, and neither the `.exe` nor
      the `.part` exists;
    - *rejects a truncated body*: the server sends a `content-length` larger than the body, then
      destroys the socket; the call rejects and no `.exe` exists.
  - Updater tests, against the same server and a temp dir:
    - `none` when the feed id equals `current`;
    - `ready` after a download, and a second call makes no second request to `/blob`;
    - `off` when mode is `off`.
- [ ] **Step 2: Run:** `node --test brand/extensions/briii-update/test/`. Expected: FAIL
  (modules missing).
- [ ] **Step 3: Implement** the four modules with the signatures above. CommonJS, no dependencies.
- [ ] **Step 4: Run:** `node --test brand/extensions/briii-update/test/`. Expected: all pass.
- [ ] **Step 5: Commit:** `briii-update: release parsing, verified downloads, update state`.

### Task 3: Extension shell, first launch and the install-on-exit helper

**Files:**
- Create: `brand/extensions/briii-update/{package.json,extension.js,install-on-exit.ps1,lib/firstLaunch.js}`,
  `brand/extensions/briii-update/test/firstLaunch.test.js`,
  `brand/extensions/briii-update/test/helper.test.ps1`

**Interfaces:**
- Consumes: Task 2 modules, `product.json › briiiRelease/briiiUpdateRepo` (read with
  `require(path.join(vscode.env.appRoot, 'product.json'))`), and `first-launch.json`.
- Produces:
  - `firstLaunch.run({ ids, isInstalled: id => boolean, install: id => Promise<void>, done: Set<string>, markDone: id => void }) -> Promise<string[]>`
    installs each missing id not already in `done`, marks successes, and returns the installed
    ids. An id that is already installed is marked done without installing.
  - The helper takes `install-on-exit.ps1 -Installer <path> -AppDir <dir> -StateDir <dir> [-Relaunch]`,
    and dot-sources the function `Enter-HelperLock -StateDir <dir> -> bool`.

- [ ] **Step 1: Write the failing tests.**
  - `firstLaunch.test.js`:
    - installs only missing and not-done ids;
    - an install that throws is not marked done;
    - an already-installed id is marked done without calling `install`.
  - `helper.test.ps1` (plain PowerShell asserts, run with `powershell -File`):
    - dot-source the helper with `-DotSourceOnly`;
    - `Enter-HelperLock` returns `$true`, then `$false` while the lock file is fresh, and `$true`
      again when the lock is older than 35 min.
- [ ] **Step 2: Run** both, and expect FAIL.
- [ ] **Step 3: Implement.**
  - `package.json`: `"main": "./extension.js"`, `activationEvents: ["onStartupFinished"]`, the
    three commands (titles *Check for Updates*, *Install Update Now*, *Show Update Log*, category
    `Briii`), and the `briii.update.mode` enum with descriptions.
  - `extension.js`:
    - the output channel "Updates";
    - a status-bar item (`$(cloud-download) Update ready`, tooltip per spec) that shows only in
      `ready`;
    - timers (30 s, then 6 h);
    - first launch: run `firstLaunch.run` with
      `install = id => vscode.commands.executeCommand('workbench.extensions.installExtension', id)`
      inside `withProgress`, and `done` kept in `globalState` under `briii.firstLaunch.done`;
    - `deactivate()`: if the state has a pending id, `effectiveMode === 'auto'`,
      `BRIII_UPDATE_FEED` is unset and `failures < 3`, spawn the helper
      (`powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ...`,
      `detached: true`, `stdio: 'ignore'`, `windowsHide: true`, then `unref()`);
    - `installNow`: same spawn with `-Relaunch`, then `workbench.action.quit`;
    - on activation: if `briiiRelease === state.pending?.id`, log "Updated to <id>" and clear the
      state;
    - in `notify` mode, when `ready`, show one notification per id:
      - for local builds: "A published Briii Code build is available: <id>";
      - otherwise: "Briii Code <id> is ready";
      - both with *Install Now (restarts)*.
    - when `failures >= 3`, show one notification: "Briii Code couldn't install <id>
      automatically", with *Open Release Page* (`pageUrl`) and *Show Update Log*;
    - skip everything when `vscode.env.appRoot` is under an `--extensionDevelopmentPath` session
      (`context.extensionMode !== vscode.ExtensionMode.Production`).
  - `install-on-exit.ps1`:
    - `Enter-HelperLock` (lock file `helper.lock`, stale after 35 min);
    - wait up to 30 min until no `Briii Code` process whose `Path` starts with `-AppDir` is running;
    - `Start-Process -Wait` with `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-`;
    - append `<ISO time> <id> exit=<code>` to `install.log`;
    - on 0, delete the installer and clear `pending`; otherwise `failures++`;
    - with `-Relaunch`, start `<AppDir>\Briii Code.exe`;
    - remove the lock.
- [ ] **Step 4: Run** `node --test brand/extensions/briii-update/test/` and
  `powershell -NoProfile -File brand/extensions/briii-update/test/helper.test.ps1`. Expected:
  all pass.
- [ ] **Step 5: Commit:** `briii-update: extension, first-launch installs, install-on-exit helper`.

### Task 4: verify.ps1 `-NoGui` and in-app smoke checks

**Files:**
- Modify: `scripts/verify.ps1`, `scripts/smoke/index.js`

**Interfaces:**
- Consumes: the `briii.update.check` command (result object from Task 2), and
  `BRIII_UPDATE_FEED`/`BRIII_UPDATE_DIR`.

- [ ] **Step 1: Add the smoke checks** (they fail on the old build):
  - `first launch: Claude Code and GitLens installed from Open VSX`: poll up to 180 s for both
    `getExtension` results. Place it before `extension commands registered`.
  - `updater: finds, downloads and verifies a release`: start a local server like Task 2's feed
    test, with the release id `9.999.99999-20991231.1` and 1 KB of bytes. Set the feed with
    `process.env.BRIII_UPDATE_FEED` before calling `briii.update.check`. Assert
    `status === 'ready'` and that the pending file exists in `BRIII_UPDATE_DIR`.
  - `updater: rejects a wrong checksum`: a second server path with a bad `.sha256` gives
    `status === 'failed'` and no `.exe`.
  - The Claude CLI check keeps the same assertions, since it now finds the user-installed copy.
  - `briii.briii-update` joins the activation list.
- [ ] **Step 2: `verify.ps1`:**
  - add `[switch]$NoGui`, which skips the smoke block and the screenshot loop;
  - add `briii-update` to the built-in list;
  - add a check that no id from `first-launch-extensions.txt` exists under `resources\app\extensions`;
  - set `BRIII_UPDATE_DIR` (under `$Work`) and `BRIII_UPDATE_FEED` (a dead local URL,
    `http://127.0.0.1:9/`, so the real GitHub feed is never used) for the smoke run;
  - find the newest installer by `LastWriteTime`, as today.
- [ ] **Step 3: Run** `.\scripts\build.ps1; .\scripts\verify.ps1`. Expected: `All checks passed.`,
  including the three new app checks.
- [ ] **Step 4: Run** `.\scripts\verify.ps1 -NoGui`. Expected: passes, with no `app:` or GUI checks.
- [ ] **Step 5: Commit:** `verify: -NoGui mode, updater and first-launch smoke checks`.

### Task 5: Release workflow

**Files:**
- Create: `scripts/ci-release-plan.ps1`, `.github/workflows/release.yml`

**Interfaces:**
- Produces: `GITHUB_OUTPUT` keys `build` (`true`/`false`), `vscodium`, `release`.

- [ ] **Step 1: `ci-release-plan.ps1 -Event <name> -RunNumber <n> [-Repo owner/name]`:**
  - read VSCodium `releases/latest` and this repo's `releases/latest` (a 404 means no release
    yet, so build);
  - build if the event is `push` or `workflow_dispatch`, or the VSCodium tag differs from the
    last tag's VSCodium part, or the last `published_at` is 7+ days old;
  - `release = "$vscodium-$(Get-Date -AsUTC -Format yyyyMMdd).$RunNumber"`;
  - print the decision, and append to `$env:GITHUB_OUTPUT` when it is set;
  - send `Authorization: Bearer $env:GH_TOKEN` when set, to avoid rate limits.
- [ ] **Step 2: Run locally:**
  `powershell -File scripts/ci-release-plan.ps1 -Event schedule -RunNumber 1`. Expected: prints
  `build=true` (no releases yet), the VSCodium tag and an id matching the format.
- [ ] **Step 3: `release.yml`:**
  - triggers per spec (cron `0 5 * * *`, the push paths, `workflow_dispatch`);
  - `permissions: contents: write`, `concurrency: release`;
  - steps:
    1. checkout;
    2. plan (`GH_TOKEN: ${{ github.token }}`);
    3. `if: steps.plan.outputs.build == 'true'`: `choco install innosetup -y --no-progress`;
    4. `.\scripts\build.ps1 -Version ... -Release ...`;
    5. `.\scripts\verify.ps1 -NoGui`;
    6. write the `.sha256` (lower-case hex) next to the installer;
    7. `gh release create "v$id" <exe> <sha256> --title "Briii Code $id" --notes "Built from VSCodium $vscodium." --latest`;
    8. prune: `gh release list --limit 100 --json tagName --jq '.[10:][].tagName'`, then
       `gh release delete <tag> --yes --cleanup-tag` for each.
  - `timeout-minutes: 90`.
- [ ] **Step 4: Validate:** run
  `node -e "require('fs').readFileSync('.github/workflows/release.yml','utf8')"` plus a YAML
  parse with the repo's `node_modules` if available, otherwise a careful read. Every
  `${{ }}` expression refers to a defined step id or output.
- [ ] **Step 5: Commit:** `CI: build and publish releases`.

### Task 6: End-to-end, docs, publish

- [ ] **Step 1: Local end-to-end with a real installer.**
  - Build `-Release 1.135.06055-20260930.1` (N), then `-Release 1.135.06055-20260930.2` (N+1).
  - Install N silently into a temp folder (as `verify.ps1` does).
  - Serve N+1 with a local feed via `BRIII_UPDATE_FEED`, and set `BRIII_UPDATE_E2E=1` so the
    helper may run. Add that override to `deactivate()`, documented as tests only.
  - Launch, run *Check for Updates* (via the smoke harness or CDP), close.
  - Expected: `install.log` shows `exit=0`, and `product.json › briiiRelease` in the temp install
    is N+1.
  - Uninstall afterwards.
- [ ] **Step 2: Update CLAUDE.md:** mark roadmap item 2 done, and cover the release flow, the
  updater, first-launch extensions and the new gotchas.
- [ ] **Step 3: Full `.\scripts\verify.ps1`** on the final local build. Expected: all pass.
- [ ] **Step 4: Commit, then `git push origin main`.** Watch the workflow through
  `https://api.github.com/repos/brian-dev-2026/briii-code/actions/runs` until it completes, then
  confirm that the release `v<id>` has both assets and that the published `.sha256` matches the
  downloaded `.exe`.
