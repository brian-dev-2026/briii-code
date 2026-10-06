// Rebrands an extracted VSCodium Windows build in place.
// Usage: node rebrand.mjs <stageDir> <brand.json> <defaultsDir> <releaseId>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [stageDir, brandPath, defaultsDir, releaseId] = process.argv.slice(2);
if (!stageDir || !brandPath || !defaultsDir || !releaseId) {
	console.error('usage: node rebrand.mjs <stageDir> <brand.json> <defaultsDir> <releaseId>');
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

// Extensions that can't be redistributed are installed from Open VSX on first launch instead
// (by the briii-update extension). Parsed like build.ps1 parses extensions.txt.
const readIdList = file => fs.existsSync(file)
	? fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.replace(/#.*$/, '').trim()).filter(Boolean).map(l => l.split('@')[0])
	: [];
const firstLaunch = readIdList(path.join(defaultsDir, 'first-launch-extensions.txt'));
// VS Code asks "Do you trust the publisher ...?" before installing from a new publisher, which
// would turn the silent first-launch setup into dialogs. Pre-trust exactly these publishers.
const firstLaunchPublishers = [...new Set(firstLaunch.map(id => id.split('.')[0].toLowerCase()))];

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
	// Read by the briii-update extension: which build this is, and where releases come from.
	briiiRelease: releaseId,
	briiiUpdateRepo: brand.updateRepo,
	trustedExtensionPublishers: [...new Set([...(product.trustedExtensionPublishers || []), ...firstLaunchPublishers])],
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
const jsRel = 'vs/workbench/workbench.desktop.main.js';
const jsPath = path.join(outDir, ...jsRel.split('/'));
const uiCss = fs.readFileSync(path.join(brandDir, 'ui', 'apple.css'), 'utf8');

// apple.css targets VS Code's internal class names. Warn about any that this VS Code no longer
// has (neither its stylesheet nor its code mentions them), so a VSCodium update that renames
// something shows up here instead of as a quietly broken look. verify.ps1 checks the same.
const selectorClasses = css => [...new Set(css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^{}]*\}/g, '{}')
	.match(/\.[a-zA-Z_-][\w-]*/g) || [])].map(c => c.slice(1));
{
	const stockCss = fs.readFileSync(path.join(outDir, ...cssRel.split('/')), 'utf8');
	const stockJs = fs.readFileSync(jsPath, 'utf8');
	const stale = selectorClasses(uiCss).filter(c => !stockCss.includes(`.${c}`) && !stockJs.includes(c));
	if (stale.length) {
		console.warn(`WARNING: apple.css uses classes this VS Code no longer has: ${stale.join(', ')}`);
	}
}
fs.appendFileSync(path.join(outDir, ...cssRel.split('/')), '\n' + uiCss);
fs.copyFileSync(path.join(brandDir, 'ui', 'fonts', 'InterVariable.woff2'), path.join(mediaDir, 'briii-inter.woff2'));
fs.copyFileSync(path.join(brandDir, 'ui', 'fonts', 'Inter-LICENSE.txt'), path.join(mediaDir, 'briii-inter-LICENSE.txt'));
updateChecksum(cssRel);

// Built-in defaults that are read before extensions load (so defaults/settings.json is too late
// for them). Each patch is optional: if VS Code changes the code, warn instead of failing.
const jsPatches = [{
	what: 'put the tool icons in a row at the top of the sidebar (Cursor-style)',
	find: /("workbench\.activityBar\.location":\{type:"string",enum:\["default","top","bottom","hidden"\],default:)"default"/,
	replace: '$1"top"',
}, {
	what: 'show the menu as a ☰ beside those tools (compact menu bar)',
	find: /("window\.menuBarVisibility":\{type:"string",enum:\["classic","visible","toggle","hidden","compact"\],markdownEnumDescriptions:\[[^\]]*\],default:)[\w$]+\?"compact":"classic"/,
	replace: '$1"compact"',
}, {
	what: 'keep the title bar clean (no layout buttons)',
	find: /("workbench\.layoutControl\.enabled":\{type:"boolean",default:)!0/,
	replace: '$1!1',
}, {
	what: 'default window.controlsStyle to "custom" (an application setting: extension defaults are ignored)',
	find: /("window\.controlsStyle":\{type:"string",enum:\["native","custom","hidden"\],default:)"native"/,
	replace: '$1"custom"',
}, {
	what: "draw VS Code's own window buttons, styled as macOS traffic lights",
	find: /\?\.controlsStyle;return ([\w$]+)==="custom"\|\|\1==="hidden"\?\1:"native"/,
	replace: '?.controlsStyle;return $1==="native"||$1==="hidden"?$1:"custom"',
}, {
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
}, {
	what: 'stop the welcome page fetching VSCodium announcements',
	find: /("workbench\.welcomePage\.extraAnnouncements":\{scope:\d+,type:"boolean",default:)!0/,
	replace: '$1!1',
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

// The main process decides the window buttons before any settings defaults load, with the same
// code: default it to VS Code's own (custom) buttons too. "native" in settings still wins.
{
	const mainPath = path.join(outDir, 'main.js');
	const main = fs.readFileSync(mainPath, 'utf8');
	const find = /\?\.controlsStyle;return ([\w$]+)==="custom"\|\|\1==="hidden"\?\1:"native"/;
	if (find.test(main)) {
		fs.writeFileSync(mainPath, main.replace(find, '?.controlsStyle;return $1==="native"||$1==="hidden"?$1:"custom"')); // not in product.json checksums
		console.log("Patched: draw VS Code's own window buttons (main process)");
	} else {
		console.warn('WARNING: could not default the window buttons in the main process - pattern not found');
	}
}

// The startup splash redraws the layout saved by the previous session. Briii used VS Code's modern
// UI (floating cards) until 2026-10-06 and is flat now, so after that upgrade the window would open
// with cards and then jump. Drop saved layouts that are modern UI (as VS Code already does when
// developing extensions); that launch shows only the background colour.
const splashRel = 'vs/code/electron-browser/workbench/workbench.js';
const splashPath = path.join(outDir, ...splashRel.split('/'));
const splash = fs.readFileSync(splashPath, 'utf8');
const splashFind = /([\w$]+)&&[\w$]+\.extensionDevelopmentPath&&\(\1\.layoutInfo=void 0\)/;
if (splashFind.test(splash)) {
	fs.writeFileSync(splashPath, splash.replace(splashFind,
		(m, r) => `${m},${r}&&${r}.layoutInfo&&${r}.layoutInfo.modernUI===!0&&(${r}.layoutInfo=void 0)`));
	updateChecksum(splashRel);
	console.log('Patched: ignore saved startup layouts from the modern UI (cards)');
} else {
	console.warn('WARNING: could not patch the startup splash - pattern not found in this VS Code version');
}

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
	const src = path.join(brandExtDir, ext);
	fs.cpSync(src, path.join(appDir, 'extensions', ext), {
		recursive: true,
		filter: from => path.relative(src, from).split(path.sep)[0] !== 'test', // unit tests aren't shipped
	});
}

const updateExtDir = path.join(appDir, 'extensions', 'briii-update');
must(fs.existsSync(updateExtDir), 'brand/extensions/briii-update is missing');
fs.writeFileSync(path.join(updateExtDir, 'first-launch.json'), JSON.stringify(firstLaunch, null, '\t') + '\n');

// --- executable and visual elements manifest --------------------------------
fs.renameSync(path.join(stageDir, oldExe), path.join(stageDir, newExe));

const oldManifest = path.join(stageDir, `${path.parse(oldExe).name}.VisualElementsManifest.xml`);
if (fs.existsSync(oldManifest)) {
	const xml = fs.readFileSync(oldManifest, 'utf8')
		.replace(/ShortDisplayName="[^"]*"/, `ShortDisplayName="${brand.nameShort}"`)
		.replace(/BackgroundColor="[^"]*"/, 'BackgroundColor="#080B14"'); // brand Ink, behind the ink tile
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
// Default keyboard shortcuts ship the same way; the user's own keybindings.json still wins.
const keybindingsFile = path.join(defaultsDir, 'keybindings.json');
const keybindings = fs.existsSync(keybindingsFile) ? JSON.parse(fs.readFileSync(keybindingsFile, 'utf8')) : [];
// Extra menu items, e.g. Claude Code's own "Open in Side Bar" in the Explorer's header. An item
// whose command isn't installed (Claude Code before its first-launch install) simply doesn't show.
const menusFile = path.join(defaultsDir, 'menus.json');
const menus = fs.existsSync(menusFile) ? JSON.parse(fs.readFileSync(menusFile, 'utf8')) : {};
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
	contributes: { configurationDefaults: settings, keybindings, menus },
}, null, '\t') + '\n');

console.log(`Rebranded ${oldExe} -> ${newExe} (${Object.keys(settings).length} default settings)`);
