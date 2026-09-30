# Briii Code brand: icon, wordmark and logo

Date: 2026-09-30. Roadmap item 6. Status: design approved in the visual companion, spec
awaiting review.

## Goal

Replace the placeholder "B" with the approved 2026 brand: an app icon, a wordmark and a logo
lockup, each for its own use. Everything is generated from source SVGs by one script, and
the build keeps working without that script's dependencies.

## The approved design

- **Tile:** rounded square with continuous corners
  (`M38 0 H90 C118 0 128 10 128 38 V90 …`, 128-unit grid). Vertical ink gradient
  `#1A2340 → #0D1326 → #060912`, a soft radial glow `#3FA8FF` at 28 % behind the glyph, and a
  1.6-unit top-edge highlight (white 22 % → 0).
- **Glyph:** a geometric B drawn as a 15-unit stroke along the centre line
  `M40 26 V102 M40 26 H64 A16 16 0 0 1 64 58 H40 M40 58 H68 A22 22 0 0 1 68 102 H40`
  (miter joins), filled with the Signal gradient `#5B8CFF → #3FB6FF → #47E6CF`, plus a glass
  sheen (white 38 % → 0 over the top half). The glyph is scaled to 74 % of the tile.
- **Circuit channels:** 2.2-unit ink channels along the centre line of the stem and top, the
  middle bar, the upper bowl arc and the lower bowl arc into the bottom bar. Seven vias (ink
  r3.3 with a glowing centre r1.15, `#9FF3E6` or `#CFE0FF`) and one junction on the stem.
- **Wordmark:** "Briii" in a tight grotesk (semibold, tracking −0.035 em, solid Paper
  `#EEF2FB` on dark or Ink `#0B1020` on light). The three i-dots are accent circles joined by
  a hairline trace that ends in a ring. Then "code" in lowercase monospace (light weight,
  muted `#8A96B3` / `#5A6682`) with an accent cursor bar.
- **Logo:** icon on the left, with "Briii" stacked over "code".
- **Tokens:** Ink `#080B14`, Night `#1A2340`, Signal `#5B8CFF → #47E6CF`, Paper `#EEF2FB`.

## Deliverables

| File | Use |
|---|---|
| `brand/icons/src/icon.svg` | Source: full icon (tile + glyph + channels). |
| `brand/icons/src/icon-small.svg` | Source: icon for 16–24 px. No channels or sheen, 17-unit stroke, so tiny sizes stay crisp. |
| `brand/icons/src/glyph.svg` | Source: the B alone, one flat colour. |
| `brand/icons/app.ico` | Program, installer and taskbar icon: 16, 20, 24, 32, 40, 48, 64, 128, 256 px (16–24 from `icon-small`). |
| `brand/icons/app_150x150.png`, `app_70x70.png` | Start-menu tiles (full icon on a transparent background). |
| `brand/icons/app-icon.svg` | Title-bar icon: a copy of `icon-small.svg` (shown at about 16 px). |
| `brand/icons/mark.svg` | Empty-editor watermark: `glyph.svg` with `fill-opacity="{{OPACITY}}"` and fill `#B2B2B2`, the same contract as today. |
| `brand/logo/wordmark-dark.svg`, `wordmark-light.svg` | Wordmark, text converted to outlines. |
| `brand/logo/logo-dark.svg`, `logo-light.svg` | Logo lockup, outlined. |
| `brand/logo/logo-dark.png` | 1200 px wide, for the README header. |

## Generator

`scripts/make-icons.mjs` (Node), run by hand when the artwork changes; its output is
committed.

- Renders SVG to PNG with `@resvg/resvg-js`, and writes `app.ico` itself (PNG-compressed ICO
  entries, no extra tool).
- Converts the wordmark text to outlines with `opentype.js`, using OFL fonts downloaded once
  into `.cache/fonts/`: **Inter SemiBold** for "Briii" and **Cascadia Code Light** for "code".
  These replace Segoe UI from the mockup, because Segoe's licence doesn't allow shipping
  it. They look very close.
- Dependencies live in a root `package.json` as devDependencies (`node_modules/` is already
  gitignored). `build.ps1` doesn't need them, because it only copies the committed files.

`scripts/make-placeholder-icon.py` and the `build.ps1` fallback that calls it are removed,
because the real icons are now committed. CLAUDE.md drops the Pillow requirement.

## Build integration

No change to `build.ps1`, `rebrand.mjs` or `setup.iss`: they already copy `app.ico`, the
PNGs, `app-icon.svg` and `mark.svg`. The README's placeholder-icon notes are updated, and it
gets `logo-dark.png` as its header image.

## Testing

- `make-icons.mjs` checks the ICO it wrote: the frame count and each frame's size.
- Rebuild and run `verify.ps1`, with all checks passing. Then look at the screenshots: title-bar
  icon, watermark in dark and light.
- Check the installed `.exe`, desktop shortcut and taskbar icon by eye.

## Out of scope

Installer wizard artwork, the welcome page (roadmap item 8) and animated or brand-motion
assets.
