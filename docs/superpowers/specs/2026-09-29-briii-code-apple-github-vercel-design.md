# Briii Code – Apple look, GitHub, Vercel deploy

Date: 2026-09-29 · Status: approved in chat

## Goal
Make Briii Code (personal, branded VSCodium repackage for Windows) look Apple-like in both
light and dark mode (following Windows), work with a GitHub account, and deploy to Vercel in
one click. Remove the VSCodium branding left over from the first build.

## Scope
1. **Branding fixes** – replace `out/media/letterpress-*.svg` (empty-editor watermark) and
   `code-icon.svg` (title bar) with the Briii "B"; replace the word "VSCodium" in built-in
   extension strings (`extensions/*/package.nls.json`, `out/nls.messages.json`), leaving URLs.
2. **Apple look**
   - Built-in extension `briii-theme` with "Briii Light" / "Briii Dark" colour themes
     (macOS system palette, accent `#007AFF` / `#0A84FF`, Xcode-like syntax colours).
   - Defaults: `window.autoDetectColorScheme: true`, preferred light/dark = Briii themes.
   - `brand/ui/apple.css` appended to `workbench.desktop.main.css` at build time, with the
     Inter variable font (OFL) copied to `out/media/`. The file's sha256 in
     `product.json › checksums` is recomputed so no "installation is corrupt" warning appears.
   - Known risk: the CSS targets VS Code's internal class names and may need touch-ups when
     VSCodium updates.
3. **GitHub** – built-in GitHub authentication (Accounts › Sign in with GitHub, callback via
   the installer-registered `briii://` protocol) plus the bundled
   `GitHub.vscode-pull-request-github` from Open VSX. Settings Sync and Copilot are out of
   scope (Microsoft-only / not on Open VSX).
4. **Briii Deploy** – built-in extension `briii-deploy` (plain JS, no build step):
   - Status bar `▲ Deploy` when a folder is open → Preview / Production.
   - Runs `vercel deploy [--prod] --yes` in the workspace folder, streams to an output channel,
     then a notification with Open / Copy URL.
   - Missing CLI → offer `npm i -g vercel` in a terminal; not logged in → `vercel login` in a
     terminal; folder not linked (`.vercel/project.json` missing) → `vercel link` in a terminal.
   - Commands: Deploy Preview, Deploy to Production, Open Vercel Dashboard, Show Last Deployment.

## Build / test
- `rebrand.mjs` performs all file changes; `build.ps1` is unchanged apart from calling it.
- `verify.ps1` adds: CSS checksum matches product.json, themes and deploy extension present,
  no "VSCodium" in user-facing strings, and screenshots of the running app in light and dark
  (`out/screenshot-*.png`).
- Manual: GitHub sign-in, a real Vercel deploy.
