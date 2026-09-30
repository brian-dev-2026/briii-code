// Briii Update - keeps Briii Code up to date from this repo's GitHub Releases, and installs the
// extensions that can't be bundled (see defaults/first-launch-extensions.txt) on first launch.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkForUpdate } = require('./lib/updater');
const { readState, writeState } = require('./lib/state');
const { effectiveMode } = require('./lib/version');
const firstLaunch = require('./lib/firstLaunch');
const { helperCommandLine, startDetached } = require('./lib/helperLaunch');

const FIRST_CHECK_MS = 30 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const MAX_FAILURES = 3;
const DONE_KEY = 'briii.firstLaunch.done';
const NOTIFIED_KEY = 'briii.update.notified';

let context;
let product;
let output;
let statusItem;
const timers = [];

// Test hooks: BRIII_UPDATE_FEED / BRIII_UPDATE_DIR point the updater at a local server and a temp
// folder. While a test feed is set, no installer is ever started unless BRIII_UPDATE_E2E=1.
const updateDir = () => process.env.BRIII_UPDATE_DIR ||
	path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Briii Code', 'updates');
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
	});
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
	installFirstLaunchExtensions();
	if (product.briiiRelease) {
		timers.push(setTimeout(() => runCheck(false), FIRST_CHECK_MS));
		timers.push(setInterval(() => runCheck(false), CHECK_EVERY_MS));
	}
}

/** After an update the app starts on the pending version: record that and tidy up. */
function finishPreviousInstall() {
	const dir = updateDir();
	const state = readState(dir);
	if (state.pending && state.pending.id === product.briiiRelease) {
		log(`Updated to ${product.briiiRelease}.`);
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
		title: 'Setting up Briii Code: installing Claude Code and GitLens',
	}, async () => {
		const installed = await firstLaunch.run({
			ids,
			isInstalled: id => !!vscode.extensions.getExtension(id),
			install: id => vscode.commands.executeCommand('workbench.extensions.installExtension', id),
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
	statusItem.tooltip = result.id ? `Briii Code ${result.id} installs when you close the app` : undefined;
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

function notifyOnce(key, text, buttons, onChoice) {
	const seen = context.globalState.get(NOTIFIED_KEY, []);
	if (seen.includes(key)) {
		return;
	}
	context.globalState.update(NOTIFIED_KEY, [...seen, key].slice(-20));
	vscode.window.showInformationMessage(text, ...buttons).then(onChoice);
}

async function showReady() {
	const state = readState(updateDir());
	if (!state.pending) {
		return;
	}
	const choice = await vscode.window.showInformationMessage(
		`Briii Code ${state.pending.id} is ready. It installs when you close the app.`, 'Install Now (restarts)');
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
	startHelper(state.pending, true);
	await vscode.commands.executeCommand('workbench.action.quit');
}

/** Starts install-on-exit.ps1 outside the extension host: it waits for Briii Code to close, then installs. */
function startHelper(pending, relaunch) {
	const ok = startDetached(helperCommandLine({
		script: path.join(context.extensionPath, 'install-on-exit.ps1'),
		installer: pending.path, appDir: installDir(), stateDir: updateDir(), id: pending.id, relaunch,
	}));
	// Also on disk: during shutdown the output channel may already be gone.
	fs.appendFileSync(path.join(updateDir(), 'install.log'),
		`${new Date().toISOString()} ${pending.id} helper ${ok ? 'started' : 'FAILED to start'}\n`);
	log(ok ? `Installing ${pending.id} after Briii Code closes.` : `Couldn't start the update helper for ${pending.id}.`);
	return ok;
}

function deactivate() {
	if (!product) {
		return;
	}
	const state = readState(updateDir());
	if (state.pending && fs.existsSync(state.pending.path) && mode() === 'auto' &&
		state.failures < MAX_FAILURES && mayRunInstaller()) {
		startHelper(state.pending, false);
	}
}

module.exports = { activate, deactivate };
