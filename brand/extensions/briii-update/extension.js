// Briii Update - keeps Briii Code up to date from this repo's GitHub Releases, and installs the
// extensions that can't be bundled (see defaults/first-launch-extensions.txt) on first launch.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkForUpdate } = require('./lib/updater');
const { readState, writeState, trimLog, claimOnce } = require('./lib/state');
const { effectiveMode, isNewer } = require('./lib/version');
const firstLaunch = require('./lib/firstLaunch');
const { helperCommandLine, startDetached } = require('./lib/helperLaunch');
const { readyMessage } = require('./lib/messages');

const FIRST_CHECK_MS = 30 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const MAX_FAILURES = 3;
const DONE_KEY = 'briii.firstLaunch.done';

let context;
let product;
let output;
let statusItem;
const timers = [];
let helperStarted = false; // Install Now already started one; Quit must not start a second

// Test hooks: BRIII_UPDATE_FEED / BRIII_UPDATE_DIR point the updater at a local server and a temp
// folder. While a test feed is set, no installer is ever started unless BRIII_UPDATE_E2E=1.
const updateDir = () => process.env.BRIII_UPDATE_DIR ||
	path.join(process.env.LOCALAPPDATA || os.tmpdir(), product.nameLong, 'updates'); // setup.iss deletes it on uninstall
const feedUrl = () => process.env.BRIII_UPDATE_FEED ||
	`https://api.github.com/repos/${product.briiiUpdateRepo}/releases/latest`;
const mayRunInstaller = () => !process.env.BRIII_UPDATE_FEED || process.env.BRIII_UPDATE_E2E === '1';
const installDir = () => path.resolve(vscode.env.appRoot, '..', '..'); // appRoot is <install>\resources\app

function mode() {
	return effectiveMode({
		mode: vscode.workspace.getConfiguration('briii.update').get('mode', 'auto'),
		current: product.briiiRelease,
		appRoot: installDir(),
		programFiles: process.env.ProgramFiles,
		writable: canWrite(installDir()),
	});
}

/** Whether this user can write to the install folder (a silent update needs that). */
let writableCache;
function canWrite(dir) {
	if (writableCache === undefined) {
		const probe = path.join(dir, `.briii-write-test-${process.pid}`);
		try {
			fs.writeFileSync(probe, '');
			fs.rmSync(probe, { force: true });
			writableCache = true;
		} catch {
			writableCache = false;
		}
	}
	return writableCache;
}

function log(line) {
	output.appendLine(`[${new Date().toLocaleString()}] ${line}`);
}

function activate(ctx) {
	context = ctx;
	if (ctx.extensionMode !== vscode.ExtensionMode.Production) {
		return;
	}
	product = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8'));
	output = vscode.window.createOutputChannel('Updates');
	statusItem = vscode.window.createStatusBarItem('briii.update', vscode.StatusBarAlignment.Right, 1000);
	statusItem.name = 'Briii Update';
	statusItem.text = '$(cloud-download) Update ready';
	statusItem.command = 'briii.update.showReady';

	ctx.subscriptions.push(
		output,
		statusItem,
		vscode.commands.registerCommand('briii.update.check', () => runCheck(true)),
		vscode.commands.registerCommand('briii.update.installNow', installNow),
		vscode.commands.registerCommand('briii.update.showLog', () => output.show()),
		vscode.commands.registerCommand('briii.update.showReady', showReady),
		{ dispose: () => timers.forEach(t => clearTimeout(t)) },
	);

	finishPreviousInstall();
	trimLog(updateDir());
	installFirstLaunchExtensions();
	if (product.briiiRelease) {
		timers.push(setTimeout(() => runCheck(false), FIRST_CHECK_MS));
		timers.push(setInterval(() => runCheck(false), CHECK_EVERY_MS));
	}
}

/** Drops a pending installer that isn't newer than this build (it was updated, or updated by hand). */
function finishPreviousInstall() {
	const dir = updateDir();
	const state = readState(dir);
	if (state.pending && !isNewer(state.pending.id, product.briiiRelease)) {
		fs.rmSync(state.pending.path, { force: true });
		writeState(dir, { ...state, pending: null, failures: 0 });
	}
}

async function installFirstLaunchExtensions() {
	let ids = [];
	try {
		ids = JSON.parse(fs.readFileSync(path.join(context.extensionPath, 'first-launch.json'), 'utf8'));
	} catch {
		return;
	}
	const done = new Set(context.globalState.get(DONE_KEY, []));
	const missing = ids.filter(id => !done.has(id) && !vscode.extensions.getExtension(id));
	if (!missing.length) {
		// Record already-installed ones so a later uninstall is respected.
		ids.forEach(id => done.add(id));
		await context.globalState.update(DONE_KEY, [...done]);
		return;
	}
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: `Setting up ${product.nameLong}: installing extensions`,
	}, async progress => {
		const installed = await firstLaunch.run({
			ids,
			isInstalled: id => !!vscode.extensions.getExtension(id),
			install: id => {
				progress.report({ message: id });
				return vscode.commands.executeCommand('workbench.extensions.installExtension', id);
			},
			done,
			markDone: id => done.add(id),
		});
		await context.globalState.update(DONE_KEY, [...done]);
		if (installed.length) {
			log(`First launch: installed ${installed.join(', ')}.`);
		}
	});
}

/** One update check. Returns the checkForUpdate result (the smoke tests use it). */
async function runCheck(manual) {
	const m = mode();
	const result = await checkForUpdate({ feedUrl: feedUrl(), dir: updateDir(), current: product.briiiRelease, mode: m });
	if (result.status === 'failed') {
		log(`Update check failed: ${result.error}`);
	} else if (result.status === 'ready') {
		log(`Briii Code ${result.id} is downloaded and verified.`);
	}
	statusItem.tooltip = result.id ? readyMessage(m, result.id) : undefined;
	if (result.status === 'ready' && m !== 'off') {
		statusItem.show();
	} else {
		statusItem.hide();
	}

	const state = readState(updateDir());
	if (result.status === 'ready' && state.failures >= MAX_FAILURES) {
		notifyOnce(`failed:${result.id}`, `Briii Code couldn't install ${result.id} automatically.`,
			['Open Release Page', 'Show Update Log'], choice => {
				if (choice === 'Open Release Page') {
					vscode.env.openExternal(vscode.Uri.parse(result.pageUrl));
				} else if (choice) {
					output.show();
				}
			});
	} else if (result.status === 'ready' && m === 'notify') {
		const text = /-local$/.test(product.briiiRelease || '')
			? `A published Briii Code build is available: ${result.id}.`
			: `Briii Code ${result.id} is ready.`;
		notifyOnce(`ready:${result.id}`, text, ['Install Now (restarts)'], choice => choice && installNow());
	}

	if (manual) {
		if (result.status === 'none') {
			vscode.window.showInformationMessage('Briii Code is up to date.');
		} else if (result.status === 'failed') {
			vscode.window.showWarningMessage(`Couldn't check for updates: ${result.error}`, 'Show Update Log')
				.then(choice => choice && output.show());
		} else if (result.status === 'off') {
			vscode.window.showInformationMessage('Updates are switched off (setting "briii.update.mode").');
		}
	}
	return result;
}

/** Shows a notification once, in one window only (several windows check on their own). */
function notifyOnce(key, text, buttons, onChoice) {
	if (claimOnce(updateDir(), key)) {
		vscode.window.showInformationMessage(text, ...buttons).then(onChoice);
	}
}

async function showReady() {
	const state = readState(updateDir());
	if (!state.pending) {
		return;
	}
	const choice = await vscode.window.showInformationMessage(readyMessage(mode(), state.pending.id), 'Install Now (restarts)');
	if (choice) {
		await installNow();
	}
}

async function installNow() {
	let state = readState(updateDir());
	if (!state.pending || !fs.existsSync(state.pending.path)) {
		const result = await runCheck(true);
		if (result.status !== 'ready') {
			return;
		}
		state = readState(updateDir());
	}
	if (!mayRunInstaller()) {
		vscode.window.showInformationMessage('Test mode: the installer is not started.');
		return;
	}
	if (!isNewer(state.pending.id, product.briiiRelease)) {
		return;
	}
	startHelper(state.pending, true);
	// If the quit is cancelled (unsaved changes), that helper gives up after 60 s; after that a
	// normal close starts a fresh one again.
	setTimeout(() => { helperStarted = false; }, 70 * 1000);
	await vscode.commands.executeCommand('workbench.action.quit');
}

/** Starts install-on-exit.ps1 outside the extension host: it waits for Briii Code to close, then installs. */
function startHelper(pending, relaunch) {
	const ok = startDetached(helperCommandLine({
		script: path.join(context.extensionPath, 'install-on-exit.ps1'),
		installer: pending.path, appDir: installDir(), stateDir: updateDir(), id: pending.id, relaunch,
		exeName: appExeName(),
	}));
	// Also on disk: during shutdown the output channel may already be gone.
	fs.appendFileSync(path.join(updateDir(), 'install.log'),
		`${new Date().toISOString()} ${pending.id} helper ${ok ? 'started' : 'FAILED to start'}\n`);
	helperStarted = helperStarted || ok;
	log(ok ? `Installing ${pending.id} after Briii Code closes.` : `Couldn't start the update helper for ${pending.id}.`);
	return ok;
}

/** The app's exe name (the extension host runs as it), when it really is in the install folder. */
function appExeName() {
	const name = path.basename(process.execPath, '.exe');
	return fs.existsSync(path.join(installDir(), `${name}.exe`)) ? name : undefined;
}

function deactivate() {
	if (!product || helperStarted) {
		return;
	}
	const state = readState(updateDir());
	if (state.pending && isNewer(state.pending.id, product.briiiRelease) && fs.existsSync(state.pending.path) && mode() === 'auto' &&
		state.failures < MAX_FAILURES && mayRunInstaller()) {
		startHelper(state.pending, false);
	}
}

module.exports = { activate, deactivate };
