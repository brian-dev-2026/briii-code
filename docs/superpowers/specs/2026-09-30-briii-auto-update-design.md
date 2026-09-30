# Briii Code auto-update

Date: 2026-09-30. Roadmap item 2. Status: design approved in chat, spec awaiting review.

## Goal

Briii Code stays up to date without the user doing anything. GitHub builds new installers, and
the app downloads the newest one in the background and installs it silently after the user
closes it. The next launch is on the new version.

## Decisions (approved)

- **Install mode:** download in the background, install when the app is closed. No prompts.
- **Build timing:** a daily check. Build when VSCodium has a new release, when the last Briii
  release is 7+ days old (keeps bundled extensions fresh), on every push to `main`, and on a
  manual run.
- **Licensing:** the repo and its releases are public. Claude Code ("all rights reserved") and
  GitLens (partly under the GitLens Pro licence) are no longer bundled in any installer. The app
  installs them from Open VSX on first launch, and they then update themselves.

## 1. Cloud build and release

New workflow `.github/workflows/release.yml`, on `windows-latest`.

- **Triggers:** `schedule` (daily, 05:00 UTC); `push` to `main` touching `brand/**`,
  `defaults/**`, `installer/**`, `scripts/**` or the workflow; `workflow_dispatch`.
- **Decide step** (PowerShell, before anything heavy):
  - latest VSCodium tag from `api.github.com/repos/VSCodium/vscodium/releases/latest`;
  - latest Briii release from this repo's releases API.
  - Build when the event is `push` or `workflow_dispatch`, or the VSCodium tag differs from the
    one in the last Briii release, or the last release is 7+ days old. Otherwise stop, which
    takes under a minute.
- **Release id:** `<vscodium>-<yyyymmdd>.<run_number>`, e.g. `1.135.06055-20261001.14`, and the
  git tag is `v<release id>`. A weekly rebuild on the same VSCodium therefore still counts as newer.
- **Build:** `choco install innosetup -y`, then `.\scripts\build.ps1 -Version <vscodium> -Release <id>`.
- **Check:** `.\scripts\verify.ps1 -NoGui` (see Testing). The workflow publishes only if it passes.
- **Publish:** `gh release create v<id>` (gh is preinstalled on the runner; it uses the built-in
  `GITHUB_TOKEN` with `contents: write`). The assets are `BriiiCode-Setup-x64-<id>.exe` and
  `BriiiCode-Setup-x64-<id>.exe.sha256` (hex digest), and the release is marked latest.
- **Prune:** keep the newest 10 releases and delete older ones with their tags.

`build.ps1` changes:
- **New `-Release <id>` parameter.** The default, for local builds, is `<vscodium>-local`. The id
  becomes the Inno `AppVersion`, goes into the installer file name, and goes into `product.json`
  as `briiiRelease`. `product.json` is not checksummed. The CLI `--version` still reports the
  VSCodium version.
- **First-launch extensions stay out:** `defaults/first-launch-extensions.txt` is not bundled.

## 2. In-app updater

New built-in extension `brand/extensions/briii-update` (plain JS, no build step, like
`briii-deploy`). `brand.json` gets `"updateRepo": "brian-dev-2026/briii-code"`, which
`rebrand.mjs` copies into `product.json` as `briiiUpdateRepo`.

**Versions.** A release id compares as the tuple (VSCodium version parts, date, run number).
Local builds (`-local`) are never auto-installed over. For them, the updater only offers a
notification ("A published build is available").

**Flow.**
1. Check 30 s after startup, then every 6 h. Call `GET https://api.github.com/repos/<repo>/releases/latest`
   (unauthenticated; 60 requests an hour is plenty).
   - A test override comes from the `BRIII_UPDATE_FEED` environment variable, a URL returning
     the same JSON.
2. If the release is newer than `briiiRelease`, download the `.exe` asset to
   `%LOCALAPPDATA%\Briii Code\updates\<id>.exe.part`.
   - Verify it against the `.sha256` asset, then rename it to `.exe`.
   - A failed or interrupted download starts again from the beginning at the next check.
   - Delete older installers in that folder.
3. Record `state.json` in the same folder: `{ pending: { id, path, sha256 }, failures, lastCheck }`.
4. Show a status-bar item: `$(cloud-download) Update ready`, with the tooltip "Briii Code
   <id> installs when you close the app". Clicking it offers *Install Now (restarts)*.
5. On `deactivate()` with a verified pending installer, spawn `install-on-exit.ps1`, detached
   and hidden (`powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass`), and return
   immediately. The script:
   - takes a lock file, so several windows closing start only one helper;
   - waits until no `Briii Code.exe` from this install folder is running (max 30 min);
   - runs `<installer> /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-`;
   - writes the exit code and time to `updates\install.log`;
   - on success deletes the installer and clears `pending`; on failure increments `failures`.

   Inno's `UsePreviousTasks`/`UsePreviousPrivileges` keep the user's install options.
6. On the next start, if `briiiRelease` equals the pending id, the update is done. Clear the
   state and write one line to the "Updates" output channel.

**Settings and commands.**
- `briii.update.mode`: `auto` (default) · `notify` (download, then ask) · `off`.
- Commands: *Briii: Check for Updates*, *Briii: Install Update Now*, *Briii: Show Update Log*.

**Edge cases.**
- **All-users installs** (install folder under `Program Files`) can't install silently without a
  UAC prompt. They behave as `notify`.
- **Three failed installs in a row:** stop auto-installing and show one notification with a link
  to the release page.
- **Offline or GitHub unreachable:** skip quietly and retry at the next interval.
- **Portable or dev runs** (`--extensionDevelopmentPath`, or no `briiiRelease`): the updater
  stays idle.
- **VSCodium's built-in updater stays disabled** (`updateUrl` removed, as today).

## 3. First-launch extensions

- `defaults/first-launch-extensions.txt` lists `anthropic.claude-code` and `eamodio.gitlens`,
  in the same format as `extensions.txt`. Both leave `extensions.txt`. `rebrand.mjs` copies the
  list into `briii-update`.
- **Installing:** on startup, `briii-update` installs each listed extension that isn't
  installed with `workbench.extensions.installExtension`, in the background, with one progress
  notification.
- **Only once:** each id is attempted until it succeeds once, recorded in `globalState`. If the
  user later uninstalls it, it is not reinstalled.
- **Offline:** retry on the next launch.
- **Updates:** these are normal user extensions, so VS Code's extension auto-update keeps them
  current.

## Testing

- **`verify.ps1 -NoGui`** (used in CI) runs the install, CLI, branding, checksum, extension list,
  Open VSX and `.vsix` checks, and then uninstalls. It skips the in-app smoke tests and
  screenshots, because the hosted runner has no interactive desktop.
- **Smoke tests** (local `verify.ps1`):
  - `briii-update` activates, and its commands are registered.
  - **Updater:** with `BRIII_UPDATE_FEED` pointing at a local HTTP server that serves a release
    JSON plus a small fake installer and its `.sha256`, *Check for Updates* finds the release,
    downloads and verifies it, and records it as pending. A second feed with a wrong checksum is
    rejected. Nothing is run.
  - **First launch:** Claude Code and GitLens are installed from Open VSX within 3 minutes, and
    the Claude CLI check uses the installed copy.
  - **Checks that change:** the built-in extension check no longer expects Claude Code or GitLens.
- **End-to-end, once, by hand:**
  - Install release N from GitHub, then trigger the workflow to publish N+1.
  - Open Briii Code, wait for "Update ready", then close it.
  - Open it again: *Help › About* shows N+1, and `updates\install.log` shows exit code 0.

## Out of scope

- Rolling back automatically if a new build fails to start. The manual fallback: install an
  older release from the Releases page.
- Code signing. Installers stay unsigned. The updater downloads with Node, so the files carry
  no "downloaded from the internet" mark and SmartScreen doesn't block the silent install.
- Delta or partial updates. Each update is the full installer, about 300 MB, at most once or
  twice a week.
