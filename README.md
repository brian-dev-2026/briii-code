<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo/logo-dark.png">
    <img src="brand/logo/logo-light.png" alt="Briii Code" width="420">
  </picture>
</p>

# Briii Code

A personal, branded build of VS Code for Windows. It repackages the official
[VSCodium](https://github.com/VSCodium/vscodium) release (VS Code's MIT-licensed source,
without Microsoft branding and telemetry) under the Briii Code name, with its own layout,
themes and built-in tools, and ships it as a normal Windows installer. Extensions come from
[Open VSX](https://open-vsx.org).

## Install

Download `BriiiCode-Setup-x64-<version>.exe` from the
[latest release](https://github.com/brian-dev-2026/briii-code/releases/latest) and run it. It
installs just for you (no admin prompt), with Start menu entries, "Open with Briii Code" in
Explorer, the `briii` command on PATH (`briii .` opens a folder), and an uninstaller.

The installer is unsigned, so the first time you run it Windows SmartScreen shows
"Windows protected your PC". Click **More info → Run anyway**.

**Updates install themselves.**
- Briii Code checks for a new release 30 seconds after it starts, then every 6 hours.
- It downloads the release in the background and checks its SHA-256.
- The update installs when you close the app, and your settings and extensions are kept.
- An **Update ready** item in the status bar offers **Install Now**.
- `briii.update.mode` switches this to `notify` or `off`.

## The look

Briii Code doesn't look like stock VS Code:

- **macOS title bar:** red, yellow and green window buttons on the left (× − + on hover), a
  search box in the middle, and nothing else.
- **Cursor-style workbench:** a near-black, monochrome Briii Dark theme with flat panels
  separated by thin lines. The **☰ menu and the tool icons sit in one row at the top of the
  sidebar.**
- **Claude Code** opens in its own panel on the right. Use the **✳ Claude Code** item in the
  status bar, **Ctrl+Alt+B**, or the Claude button on the Explorer's header (hover the
  Explorer). The **×** in Claude's panel, or the same Explorer button, closes it.
- **The code area hides when you close your last file,** so the Explorer, Claude and the terminal
  get the room. Opening a file brings it back. **Ctrl+Alt+W** hides or shows it by hand, and
  `briii.layout.hideEmptyCodeArea: false` turns the automatic hiding off.
- **Briii Light and Briii Dark** follow Windows' light/dark setting. The UI uses the Inter font
  and Material Icon Theme file icons.

To get Windows' own window buttons back (with Snap Layouts), set `"window.controlsStyle": "native"`.
## What's built in

- **Claude Code**, Anthropic's coding agent, installed on first launch. It opens in the
  right-hand card.
- **Windsurf (formerly Codeium)**, free Copilot-style suggestions as you type, installed on
  first launch. Click **Windsurf: Login** in the status bar and sign in with a free Windsurf
  account; then press **Tab** to accept a grey suggestion. Code you're editing is sent to
  Windsurf's servers to make the suggestions.
- **Briii Sync:** your settings, keybindings, snippets and extensions, synced between PCs
  through a secret GitHub Gist.
  - Use *Briii Sync: Sync Up* and *Sync Down*.
  - Sync Down shows what will change and keeps a backup.
  - Tokens, passwords and other secrets never leave the PC.
  - `briii.sync.onStartup` can ask or pull automatically.
- **Briii Deploy (Vercel):** click **▲ Deploy** in the status bar, or run *Vercel: Deploy
  Preview* or *Vercel: Deploy to Production*. The first run walks you through the Vercel CLI,
  `vercel login` and `vercel link`.
- **Integrated Browser:** a real Chromium view with DevTools and device emulation. `localhost`
  links (for example from `npm run dev`) open in it.
- **Web development:** Prettier (formats on save), ESLint, Tailwind CSS, Error Lens, GitLens,
  Pretty TypeScript Errors, React snippets, Auto Rename Tag, Path Intellisense, REST Client,
  Todo Tree, Vitest and Playwright test explorers, npm IntelliSense, dotenv, YAML, TOML,
  GitHub Actions and Project Manager.
- **Python:** the Python extension, the debugger and basedpyright (instead of Pylance), with
  Ruff for formatting and organising imports.
- **GitHub:** click **Accounts** (top right), then **Sign in with GitHub**. Briii Code
  isn't a Microsoft build, so GitHub uses a one-time code:
  - Click **Copy & Continue to GitHub**, paste the code on the page that opens and click
    **Authorize**.
  - Then go back to Briii Code and wait for the sign-in to finish.

  The bundled GitHub Pull Requests extension adds PRs and issues to the sidebar.

All bundled extensions work offline from the first launch.

## Extensions

- **Online:** the Extensions view searches Open VSX.
- **Offline:** Extensions view → `…` → **Install from VSIX…**, or `briii --install-extension file.vsix`.
- **Not available:** Microsoft-only extensions and services (Settings Sync, Pylance, C# Dev Kit,
  Remote-SSH, Live Share, Copilot, the MS C/C++ debugger) are licensed only for Microsoft's VS
  Code. Briii Sync, basedpyright, clangd and Open Remote SSH cover most of them, Claude Code and
  Windsurf replace Copilot.

Your settings live in `%APPDATA%\Briii Code` and extensions in `~\.briii\extensions`,
separate from any VS Code install.

## Build it yourself

Requirements: Node.js and Inno Setup 6 (`winget install --id JRSoftware.InnoSetup -e --scope user`).

```powershell
.\scripts\build.ps1                        # latest VSCodium release
.\scripts\build.ps1 -Version 1.135.06055   # a specific release
.\scripts\verify.ps1                       # install, test and uninstall the newest installer
```

The installer lands in `out\BriiiCode-Setup-x64-<version>.exe`. Local builds only *notify*
about updates.

GitHub Actions also builds and publishes a release:
- daily, when VSCodium has a new release or the last release is a week old;
- on every push to `main`.

Each release passes the unit tests and `verify.ps1` first.

## Customize

| File | What it controls |
|---|---|
| `brand/brand.json` | Name, CLI command, data folders, URL protocol. **Never change `ids`**, because Windows uses them to recognise upgrades. |
| `brand/icons/src/` | The icon artwork: `icon.svg` (full icon), `icon-small.svg` (16-24 px) and `glyph.svg` (the B alone). After editing, run `npm install` once, then `npm run icons`. That regenerates `brand/icons/` and `brand/logo/`. Commit the output. |
| `defaults/settings.json` | Default settings (plain JSON). Anything you set in the app still wins. |
| `defaults/extensions.txt` | Open VSX extensions bundled into the installer. |
| `defaults/first-launch-extensions.txt` | Extensions installed on first launch instead, because their licences don't allow bundling (Claude Code, GitLens, Windsurf). |
| `brand/extensions/` | Briii's own built-in extensions: `briii-theme` (colours), `briii-deploy` (Vercel), `briii-update` (updates and first launch), `briii-sync` (Briii Sync) and `briii-layout` (Claude buttons, hiding the empty code area). |
| `brand/ui/apple.css` | The look: macOS window buttons, the sidebar tool row, type, menus and popups. It targets VS Code internals, and the build warns when a class it uses disappears. |
