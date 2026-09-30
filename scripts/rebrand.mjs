// Rebrands an extracted VSCodium Windows build in place.
// Usage: node rebrand.mjs <stageDir> <brand.json> <defaultsDir>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [stageDir, brandPath, defaultsDir] = process.argv.slice(2);
if (!stageDir || !brandPath || !defaultsDir) {
	console.error('usage: node rebrand.mjs <stageDir> <brand.json> <defaultsDir>');
	process.exit(2);
}

const brand = JSON.parse(fs.readFileSync(brandPath, 'utf8'));
const brandDir = path.dirname(brandPath);
const appDir = path.join(stageDir, 'resources', 'app');
const outDir = path.join(appDir, 'out');
const mediaDir = path.join(outDir, 'media');
const productPath = path.join(appDir, 'product.json');
const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
const oldExe = `${product.nameShort}.exe`;
const oldApp = product.applicationName;
const newExe = `${brand.exeName}.exe`;
const guid = id => `{{${id}}`; // product.json stores Inno-escaped GUIDs

function must(cond, msg) {
	if (!cond) {
		throw new Error(msg);
	}
}

must(fs.existsSync(path.join(stageDir, oldExe)), `expected ${oldExe} in ${stageDir}`);

// --- product.json -----------------------------------------------------------
Object.assign(product, {
	nameShort: brand.nameShort,
	nameLong: brand.nameLong,
	applicationName: brand.applicationName,
	dataFolderName: brand.dataFolderName,
	sharedDataFolderName: brand.sharedDataFolderName,
	win32MutexName: brand.win32MutexName,
	win32DirName: brand.nameLong,
	win32NameVersion: brand.nameLong,
	win32RegValueName: brand.win32RegValueName,
	win32AppUserModelId: brand.win32AppUserModelId,
	win32ShellNameShort: brand.nameShort,
	win32x64AppId: guid(brand.ids.win32x64AppId),
	win32x64UserAppId: guid(brand.ids.win32x64UserAppId),
	win32arm64AppId: guid(brand.ids.win32arm64AppId),
	win32arm64UserAppId: guid(brand.ids.win32arm64UserAppId),
	win32AppId: guid(brand.ids.win32x64AppId),
	win32UserAppId: guid(brand.ids.win32x64UserAppId),
	win32ContextMenu: {
		x64: { clsid: brand.ids.contextMenuClsidX64 },
		arm64: { clsid: brand.ids.contextMenuClsidArm64 },
	},
	urlProtocol: brand.urlProtocol,
	linuxIconName: brand.applicationName,
});
// The built-in updater would replace Briii Code with stock VSCodium; updates come from rerunning build.ps1.
delete product.updateUrl;
delete product.downloadUrl;

// --- Apple-style stylesheet + Inter font ------------------------------------
// VS Code verifies these files against product.json checksums (sha256, base64, no padding)
// and shows "installation appears to be corrupt" on mismatch, so recompute after editing.
function updateChecksum(rel) {
	must(product.checksums && product.checksums[rel], `product.json has no checksum for ${rel}`);
	const file = path.join(outDir, ...rel.split('/'));
	product.checksums[rel] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('base64').replace(/=+$/, '');
}

const cssRel = 'vs/workbench/workbench.desktop.main.css';
const uiCss = fs.readFileSync(path.join(brandDir, 'ui', 'apple.css'), 'utf8');
fs.appendFileSync(path.join(outDir, ...cssRel.split('/')), '\n' + uiCss);
fs.copyFileSync(path.join(brandDir, 'ui', 'fonts', 'InterVariable.woff2'), path.join(mediaDir, 'briii-inter.woff2'));
fs.copyFileSync(path.join(brandDir, 'ui', 'fonts', 'Inter-LICENSE.txt'), path.join(mediaDir, 'briii-inter-LICENSE.txt'));
updateChecksum(cssRel);

// Built-in defaults that are read before extensions load (so defaults/settings.json is too late
// for them). Each patch is optional: if VS Code changes the code, warn instead of failing.
const jsRel = 'vs/workbench/workbench.desktop.main.js';
const jsPath = path.join(outDir, ...jsRel.split('/'));
const jsPatches = [{
	what: 'hide the (chat) secondary side bar by default',
	find: /("workbench\.secondarySideBar\.defaultVisibility":\{type:"string",enum:\[[^\]]*\],default:)"visibleInWorkspace"/,
	replace: '$1"hidden"',
}, {
	what: 'open localhost links in the Integrated Browser by default',
	find: /("workbench\.browser\.openLocalhostLinks":\{type:"boolean",default:)!1/,
	replace: '$1!0',
}, {
	what: 'use Material Icon Theme for files and folders from the first launch',
	find: /(FILE_ICON_THEME=)"vs-seti"/,
	replace: '$1"material-icon-theme"',
}];
let js = fs.readFileSync(jsPath, 'utf8');
for (const patch of jsPatches) {
	if (patch.find.test(js)) {
		js = js.replace(patch.find, patch.replace);
		console.log(`Patched: ${patch.what}`);
	} else {
		console.warn(`WARNING: could not ${patch.what} - pattern not found in this VS Code version`);
	}
}
fs.writeFileSync(jsPath, js);
updateChecksum(jsRel);

fs.writeFileSync(productPath, JSON.stringify(product, null, '\t') + '\n');

// --- logos: title bar icon and the empty-editor watermark -------------------
fs.copyFileSync(path.join(brandDir, 'icons', 'app-icon.svg'), path.join(mediaDir, 'code-icon.svg'));
const mark = fs.readFileSync(path.join(brandDir, 'icons', 'mark.svg'), 'utf8');
for (const [name, opacity] of [['light', '.1'], ['dark', '.18'], ['hcLight', '.5'], ['hcDark', '.5']]) {
	fs.writeFileSync(path.join(mediaDir, `letterpress-${name}.svg`), mark.replace('{{OPACITY}}', opacity));
}

// --- "VSCodium" in user-facing strings (not in URLs such as github.com/VSCodium) ----
const oldName = 'VSCodium';
const nameRe = new RegExp(`(?<![/\\w.-])${oldName}(?![\\w/-])`, 'g');
const nlsFiles = [path.join(outDir, 'nls.messages.json')];
for (const ext of fs.readdirSync(path.join(appDir, 'extensions'))) {
	nlsFiles.push(path.join(appDir, 'extensions', ext, 'package.nls.json'));
}
let replaced = 0;
for (const file of nlsFiles.filter(f => fs.existsSync(f))) {
	const text = fs.readFileSync(file, 'utf8');
	const next = text.replace(nameRe, () => (replaced++, brand.nameShort));
	if (next !== text) {
		fs.writeFileSync(file, next);
	}
}
console.log(`Replaced ${replaced} "${oldName}" strings`);

// --- Briii built-in extensions (themes, deploy) -----------------------------
const brandExtDir = path.join(brandDir, 'extensions');
for (const ext of fs.readdirSync(brandExtDir)) {
	fs.cpSync(path.join(brandExtDir, ext), path.join(appDir, 'extensions', ext), { recursive: true });
}

// --- executable and visual elements manifest --------------------------------
fs.renameSync(path.join(stageDir, oldExe), path.join(stageDir, newExe));

const oldManifest = path.join(stageDir, `${path.parse(oldExe).name}.VisualElementsManifest.xml`);
if (fs.existsSync(oldManifest)) {
	const xml = fs.readFileSync(oldManifest, 'utf8')
		.replace(/ShortDisplayName="[^"]*"/, `ShortDisplayName="${brand.nameShort}"`)
		.replace(/BackgroundColor="[^"]*"/, 'BackgroundColor="#6366F1"');
	fs.rmSync(oldManifest);
	fs.writeFileSync(path.join(stageDir, `${brand.exeName}.VisualElementsManifest.xml`), xml);
}

// --- command line launchers (bin/briii.cmd, bin/briii) ----------------------
const binDir = path.join(stageDir, 'bin');
const cmdSrc = path.join(binDir, `${oldApp}.cmd`);
const shSrc = path.join(binDir, oldApp);
must(fs.existsSync(cmdSrc) && fs.existsSync(shSrc), `expected bin/${oldApp}(.cmd)`);

const cmd = fs.readFileSync(cmdSrc, 'utf8').split(oldExe).join(newExe);
const sh = fs.readFileSync(shSrc, 'utf8')
	.replace(/^APP_NAME=".*"$/m, `APP_NAME="${brand.applicationName}"`)
	.replace(/^NAME=".*"$/m, `NAME="${brand.exeName}"`);
fs.rmSync(cmdSrc);
fs.rmSync(shSrc);
fs.writeFileSync(path.join(binDir, `${brand.applicationName}.cmd`), cmd);
fs.writeFileSync(path.join(binDir, brand.applicationName), sh);

// --- default settings, shipped as a built-in extension ----------------------
// configurationDefaults changes the *default* value, so anything the user sets still wins.
const settingsFile = path.join(defaultsDir, 'settings.json');
const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
const extDir = path.join(appDir, 'extensions', 'briii-defaults');
fs.mkdirSync(extDir, { recursive: true });
fs.writeFileSync(path.join(extDir, 'package.json'), JSON.stringify({
	name: 'briii-defaults',
	displayName: `${brand.nameShort} Defaults`,
	description: `Default settings shipped with ${brand.nameShort}.`,
	publisher: brand.applicationName,
	version: '1.0.0',
	license: 'MIT',
	engines: { vscode: '*' },
	categories: ['Other'],
	contributes: { configurationDefaults: settings },
}, null, '\t') + '\n');

console.log(`Rebranded ${oldExe} -> ${newExe} (${Object.keys(settings).length} default settings)`);
