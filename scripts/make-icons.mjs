// Generates the Briii Code icons, wordmark and logo from brand/icons/src/*.svg.
// Run by hand when the artwork changes (npm install, then npm run icons) and commit the
// output; scripts/build.ps1 only copies the committed files and needs none of this.
//
// Output: brand/icons/app.ico, app_150x150.png, app_70x70.png, app-icon.svg, mark.svg and
// brand/logo/{wordmark,logo}-{dark,light}.svg plus logo-{dark,light}.png.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import opentype from 'opentype.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'brand', 'icons');
const srcDir = path.join(iconsDir, 'src');
const logoDir = path.join(root, 'brand', 'logo');
const fontDir = path.join(root, '.cache', 'fonts');

// --- fonts (OFL), downloaded once --------------------------------------------------------
const fonts = {
	display: {
		file: 'InterDisplay-SemiBold.ttf', member: 'extras/ttf/InterDisplay-SemiBold.ttf',
		zip: 'https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip',
	},
	mono: {
		file: 'CascadiaCode-Light.ttf', member: 'ttf/static/CascadiaCode-Light.ttf',
		zip: 'https://github.com/microsoft/cascadia-code/releases/download/v2407.24/CascadiaCode-2407.24.zip',
	},
};

async function ensureFont({ file, member, zip }) {
	const target = path.join(fontDir, file);
	if (fs.existsSync(target)) return target;
	fs.mkdirSync(fontDir, { recursive: true });
	const zipPath = path.join(fontDir, `${file}.zip`);
	console.log(`Downloading ${zip}`);
	const res = await fetch(zip);
	if (!res.ok) throw new Error(`download failed: ${res.status} ${zip}`);
	fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
	// Windows' bsdtar reads zip archives.
	const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
	execFileSync(tar, ['-xf', zipPath, '-C', fontDir, member]);
	fs.renameSync(path.join(fontDir, member), target);
	fs.rmSync(zipPath);
	fs.rmSync(path.join(fontDir, member.split('/')[0]), { recursive: true, force: true });
	return target;
}

// --- rendering -----------------------------------------------------------------------------
function renderPng(svg, width) {
	return new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'rgba(0,0,0,0)' }).render().asPng();
}

// An ICO whose entries are PNG images (supported by Windows Vista and later).
function writeIco(file, frames) {
	const header = Buffer.alloc(6 + 16 * frames.length);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(frames.length, 4);
	let offset = header.length;
	frames.forEach(({ size, png }, i) => {
		const e = 6 + 16 * i;
		header.writeUInt8(size >= 256 ? 0 : size, e);
		header.writeUInt8(size >= 256 ? 0 : size, e + 1);
		header.writeUInt8(0, e + 2);
		header.writeUInt8(0, e + 3);
		header.writeUInt16LE(1, e + 4);
		header.writeUInt16LE(32, e + 6);
		header.writeUInt32LE(png.length, e + 8);
		header.writeUInt32LE(offset, e + 12);
		offset += png.length;
	});
	fs.writeFileSync(file, Buffer.concat([header, ...frames.map(f => f.png)]));
}

function checkIco(file, sizes) {
	const b = fs.readFileSync(file);
	const count = b.readUInt16LE(4);
	if (b.readUInt16LE(2) !== 1 || count !== sizes.length) throw new Error(`${file}: ${count} frames, want ${sizes.length}`);
	for (let i = 0; i < count; i++) {
		const e = 6 + 16 * i;
		const size = b.readUInt8(e) || 256;
		const len = b.readUInt32LE(e + 8), off = b.readUInt32LE(e + 12);
		const png = b.subarray(off, off + len);
		if (png.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: frame ${i} is not a PNG`);
		const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
		if (size !== sizes[i] || w !== size || h !== size) throw new Error(`${file}: frame ${i} is ${w}x${h}, want ${sizes[i]}`);
	}
}

// --- wordmark ------------------------------------------------------------------------------
const palettes = {
	dark: { name: '#EEF2FB', accent: '#47D4E6', code: '#8A96B3' },
	light: { name: '#0B1020', accent: '#2F7BFF', code: '#5A6682' },
};

// Lays out a run of text as outlines. tracking is in em of this run.
function textRun(font, text, x, baseline, size, tracking) {
	const scale = size / font.unitsPerEm;
	const glyphs = [];
	let pen = x;
	for (const ch of text) {
		const g = font.charToGlyph(ch);
		glyphs.push({ g, x: pen });
		pen += g.advanceWidth * scale + tracking * size;
	}
	const d = glyphs.map(({ g, x: gx }) => g.getPath(gx, baseline, size).toPathData(2)).join('');
	return { d, glyphs, end: pen, scale };
}

// "Briii" + via dots + "code" and a cursor. Returns SVG elements and the bounding box.
function wordmark(display, mono, x, baseline, size, colors, { stacked = false } = {}) {
	const br = textRun(display, 'Br', x, baseline, size, -0.035);
	const iii = textRun(display, '\u0131\u0131\u0131', br.end, baseline, size, -0.01);
	// The dots sit exactly where the font's own i-dot would.
	const dotless = display.charToGlyph('\u0131').getBoundingBox();
	const stemCenter = (dotless.x1 + dotless.x2) / 2 * iii.scale;
	const dotY = baseline - 0.662 * size;
	const r = 0.073 * size;
	const dots = iii.glyphs.map(({ x: gx }) => gx + stemCenter);
	const ringX = iii.end + 0.3 * size;
	const ringR = 0.0575 * size, ringW = 0.035 * size;
	const traceStart = br.end + 0.1 * size, traceEnd = ringX - ringR - ringW / 2;

	const codeSize = 0.62 * size;
	const codeX = stacked ? x + 0.02 * size : iii.end + 0.7 * codeSize;
	const codeBase = stacked ? baseline + 0.74 * size : baseline;
	const code = textRun(mono, 'code', codeX, codeBase, codeSize, 0.02);
	const caret = { x: code.end + 0.08 * codeSize, w: 0.09 * codeSize, h: 0.62 * codeSize, y: codeBase + 0.04 * codeSize - 0.62 * codeSize };

	const f = n => +n.toFixed(2);
	const svg = [
		`<path fill="${colors.name}" d="${br.d}${iii.d}"/>`,
		`<rect x="${f(traceStart)}" y="${f(dotY - 0.015 * size)}" width="${f(traceEnd - traceStart)}" height="${f(0.03 * size)}" fill="${colors.accent}" fill-opacity=".75"/>`,
		...dots.map(cx => `<circle cx="${f(cx)}" cy="${f(dotY)}" r="${f(r)}" fill="${colors.accent}"/>`),
		`<circle cx="${f(ringX)}" cy="${f(dotY)}" r="${f(ringR)}" fill="none" stroke="${colors.accent}" stroke-width="${f(ringW)}"/>`,
		`<path fill="${colors.code}" d="${code.d}"/>`,
		`<rect x="${f(caret.x)}" y="${f(caret.y)}" width="${f(caret.w)}" height="${f(caret.h)}" rx="${f(0.02 * codeSize)}" fill="${colors.accent}">` +
			`<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;.5;.5;1" dur="1.1s" repeatCount="indefinite"/></rect>`,
	];
	const top = dotY - r;
	const right = Math.max(ringX + ringR + ringW / 2, caret.x + caret.w);
	const bottom = Math.max(baseline, codeBase + 0.04 * codeSize);
	return { svg: svg.join('\n  '), box: { x, y: top, w: right - x, h: bottom - top } };
}

function svgDoc(box, pad, body, title) {
	const x = box.x - pad, y = box.y - pad, w = box.w + 2 * pad, h = box.h + 2 * pad;
	const n = v => +v.toFixed(2);
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" width="${n(w)}" height="${n(h)}">
  <title>${title}</title>
  ${body}
</svg>
`;
}

// The icon's inner markup, namespaced so it can sit inside another SVG.
function embedIcon(iconSvg, x, y, size, ns) {
	const inner = iconSvg
		.replace(/^[\s\S]*?<svg[^>]*>/, '')
		.replace(/<\/svg>\s*$/, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/id="([^"]+)"/g, `id="${ns}-$1"`)
		.replace(/url\(#([^)]+)\)/g, `url(#${ns}-$1)`);
	return `<g transform="translate(${x} ${y}) scale(${size / 128})">${inner}</g>`;
}

// --- main ----------------------------------------------------------------------------------
const display = opentype.loadSync(await ensureFont(fonts.display));
const mono = opentype.loadSync(await ensureFont(fonts.mono));
const icon = fs.readFileSync(path.join(srcDir, 'icon.svg'), 'utf8');
const iconSmall = fs.readFileSync(path.join(srcDir, 'icon-small.svg'), 'utf8');
const glyph = fs.readFileSync(path.join(srcDir, 'glyph.svg'), 'utf8');

const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const icoPath = path.join(iconsDir, 'app.ico');
writeIco(icoPath, icoSizes.map(size => ({ size, png: renderPng(size <= 24 ? iconSmall : icon, size) })));
checkIco(icoPath, icoSizes);
fs.writeFileSync(path.join(iconsDir, 'app_150x150.png'), renderPng(icon, 150));
fs.writeFileSync(path.join(iconsDir, 'app_70x70.png'), renderPng(icon, 70));
fs.copyFileSync(path.join(srcDir, 'icon-small.svg'), path.join(iconsDir, 'app-icon.svg'));
fs.writeFileSync(path.join(iconsDir, 'mark.svg'),
	glyph.replace(/<!--[\s\S]*?-->\s*/g, '').replace('stroke="#B2B2B2"', 'stroke="#B2B2B2" stroke-opacity="{{OPACITY}}"'));

fs.mkdirSync(logoDir, { recursive: true });
const S = 100;
for (const [theme, colors] of Object.entries(palettes)) {
	const line = wordmark(display, mono, 0, 0, S, colors);
	fs.writeFileSync(path.join(logoDir, `wordmark-${theme}.svg`), svgDoc(line.box, 0.12 * S, line.svg, 'Briii Code'));

	// Lockup: icon on the left, "Briii" over "code", centred on the icon.
	const iconSize = 1.93 * S, gap = 0.45 * S;
	const stack = wordmark(display, mono, iconSize + gap, 0, S, colors, { stacked: true });
	const iconY = stack.box.y + stack.box.h / 2 - iconSize / 2;
	const body = `${embedIcon(icon, 0, +iconY.toFixed(2), iconSize, 'i')}\n  ${stack.svg}`;
	const box = { x: 0, y: iconY, w: stack.box.x + stack.box.w, h: iconSize };
	const logoSvg = svgDoc(box, 0.12 * S, body, 'Briii Code');
	fs.writeFileSync(path.join(logoDir, `logo-${theme}.svg`), logoSvg);
	fs.writeFileSync(path.join(logoDir, `logo-${theme}.png`), renderPng(logoSvg, 1200));
}

console.log(`Wrote ${path.relative(root, icoPath)} (${icoSizes.join(', ')} px), Start tiles, app-icon.svg, mark.svg`);
console.log(`Wrote ${path.relative(root, logoDir)}: wordmark-{dark,light}.svg, logo-{dark,light}.svg/.png`);
