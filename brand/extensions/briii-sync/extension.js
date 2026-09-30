// Briii Sync - settings, keybindings, snippets and the extension list, synced through one secret
// GitHub Gist with the GitHub sign-in Briii Code already has. Secrets stay on this PC, and a Sync
// Down shows what changes (with a backup) before anything is overwritten.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSnapshot, applyChanges, localPath } = require('./lib/files');
const gist = require('./lib/gist');
const { planDown, planUp, isConflict } = require('./lib/plan');

const LAST_VERSION = 'briii.sync.lastVersion';
const SECRETS_NOTICE = 'briii.sync.secretsNoticeShown';
const STARTUP_DELAY_MS = 60 * 1000;
const SCHEME = 'briii-sync';

let context;
const virtualDocs = new Map();

const userDir = () => path.resolve(context.globalStorageUri.fsPath, '..', '..'); // …\User\globalStorage\<ext>
const backupRoot = () => path.join(context.globalStorageUri.fsPath, 'backups');
const machine = () => os.hostname();
const ignored = () => vscode.workspace.getConfiguration('briii.sync').get('ignoredSettings', []);

function product() {
	try {
		return JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8'));
	} catch {
		return {};
	}
}

/** Extensions the user installed (built-ins and development extensions are left out). */
function localExtensions() {
	const appRoot = vscode.env.appRoot.toLowerCase();
	return vscode.extensions.all
		.filter(e => !e.extensionPath.toLowerCase().startsWith(appRoot) &&
			path.basename(e.extensionPath).toLowerCase().startsWith(`${e.id.toLowerCase()}-`))
		.map(e => e.id);
}

/** GitHub access: the test hooks, or the GitHub session with `gist` scope. Null when not signed in. */
async function api(interactive) {
	const base = process.env.BRIII_SYNC_API || 'https://api.github.com';
	if (process.env.BRIII_SYNC_TOKEN) {
		return { base, token: process.env.BRIII_SYNC_TOKEN };
	}
	const session = await vscode.authentication.getSession('github', ['gist'], interactive ? { createIfNone: true } : { silent: true });
	return session ? { base, token: session.accessToken } : null;
}

function parseMeta(files) {
	try {
		return JSON.parse(files['meta.json'] || '{}');
	} catch {
		return {};
	}
}

const when = iso => (iso ? new Date(iso).toLocaleString() : 'an unknown time');

async function guarded(fn) {
	try {
		return await fn();
	} catch (err) {
		if (err && /cancel/i.test(err.message || '')) {
			return { status: 'cancelled' };
		}
		vscode.window.showErrorMessage(`Briii Sync: ${err && err.message || err}`);
		return { status: 'failed', error: String(err && err.message || err) };
	}
}

/** Uploads this PC's files. opts.onConflict ('overwrite' | 'down' | 'cancel') skips the question (tests). */
function syncUp(opts = {}) {
	return guarded(() => vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Briii Sync: uploading' }, async () => {
		const a = await api(true);
		if (!a) {
			return { status: 'cancelled' };
		}
		const found = await gist.findGist(a);
		const remote = found ? await gist.getGist(a, found.id) : null;
		const meta = remote ? parseMeta(remote.files) : {};
		if (isConflict({ lastVersion: context.globalState.get(LAST_VERSION), remoteVersion: remote && remote.version, remoteMachine: meta.machine, machine: machine() })) {
			const choice = opts.onConflict || await vscode.window.showWarningMessage(
				`Your synced settings were changed on ${meta.machine || 'another PC'} (${when(meta.time)}). Uploading replaces them.`,
				{ modal: true }, 'Overwrite', 'Sync Down First')
				.then(c => (c === 'Overwrite' ? 'overwrite' : c === 'Sync Down First' ? 'down' : 'cancel'));
			if (choice === 'down') {
				return syncDown(opts);
			}
			if (choice !== 'overwrite') {
				return { status: 'cancelled', userDir: userDir() };
			}
		}
		const { patch, removedSecrets } = planUp({
			local: readSnapshot(userDir()).files,
			remote: remote ? remote.files : {},
			localExtensions: localExtensions(),
			ignored: ignored(),
			meta: { machine: machine(), time: new Date().toISOString(), briiiRelease: product().briiiRelease, format: 1 },
		});
		if (!Object.keys(patch).length) {
			if (remote) {
				await context.globalState.update(LAST_VERSION, remote.version);
			}
			if (!opts.onConflict) {
				vscode.window.showInformationMessage('Briii Sync: already up to date on GitHub.');
			}
			return { status: 'nothing', userDir: userDir() };
		}
		const result = remote
			? await gist.updateGist(a, remote.id, patch)
			: await gist.createGist(a, Object.fromEntries(Object.entries(patch).filter(([, c]) => c !== null)));
		await context.globalState.update(LAST_VERSION, result.version);
		if (removedSecrets.length && !context.globalState.get(SECRETS_NOTICE)) {
			await context.globalState.update(SECRETS_NOTICE, true);
			vscode.window.showInformationMessage(`Briii Sync kept these settings on this PC (they look like secrets): ${removedSecrets.join(', ')}.`);
		} else if (!opts.onConflict) {
			vscode.window.showInformationMessage(`Briii Sync: uploaded ${Object.keys(patch).length - 1} file(s).`);
		}
		return { status: 'uploaded', userDir: userDir(), version: result.version, files: Object.keys(patch) };
	}));
}

const KIND_TEXT = { changed: 'changed on GitHub', new: 'new on GitHub', removed: 'deleted on GitHub', invalid: "invalid on GitHub, can't be applied" };

function virtualUri(name, content) {
	const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${name}`, query: String(Date.now()) });
	virtualDocs.set(uri.toString(), content);
	return uri;
}

function showDiff(item) {
	const local = localPath(userDir(), item.name);
	const left = fs.existsSync(local) ? vscode.Uri.file(local) : virtualUri(item.name, '');
	const right = virtualUri(item.name, item.content === null ? '' : item.content);
	vscode.commands.executeCommand('vscode.diff', left, right, `${item.name}: this PC ↔ GitHub`);
}

/** Lets the person choose; resolves with the chosen items and extension ids, or null. */
function choose(items, extensions, meta) {
	return new Promise(resolve => {
		const qp = vscode.window.createQuickPick();
		const diffButton = { iconPath: new vscode.ThemeIcon('diff'), tooltip: 'Show differences' };
		const entries = items.map(item => ({
			label: item.name.replace(/^snippets__/, 'snippets/'),
			description: KIND_TEXT[item.kind],
			buttons: item.content !== null || item.kind === 'removed' ? [diffButton] : [],
			item,
		}));
		if (extensions.length) {
			entries.push({ label: `Install ${extensions.length} extension(s)`, description: extensions.join(', '), extensions });
		}
		qp.title = `Briii Sync: changes from ${meta.machine || 'GitHub'} (${when(meta.time)})`;
		qp.placeholder = 'Ticked items are applied. Your current files are backed up first.';
		qp.canSelectMany = true;
		qp.items = entries;
		qp.selectedItems = entries.filter(e => e.extensions || e.item.picked);
		let done = false;
		qp.onDidTriggerItemButton(e => showDiff(e.item.item));
		qp.onDidAccept(() => {
			done = true;
			const sel = qp.selectedItems;
			qp.hide();
			resolve({
				items: sel.filter(e => e.item && e.item.kind !== 'invalid').map(e => e.item),
				extensions: sel.some(e => e.extensions) ? extensions : [],
			});
		});
		qp.onDidHide(() => {
			qp.dispose();
			if (!done) {
				resolve(null);
			}
		});
		qp.show();
	});
}

/** Reviews and applies the Gist. opts.pick === 'default' applies the default selection (tests, pull on startup). */
function syncDown(opts = {}) {
	return guarded(async () => {
		const a = await api(!opts.silent);
		if (!a) {
			return { status: 'cancelled' };
		}
		const found = await gist.findGist(a);
		if (!found) {
			if (!opts.pick) {
				vscode.window.showInformationMessage('Briii Sync: nothing synced yet. Run "Sync Up" on the PC you want to copy from.');
			}
			return { status: 'nothing', userDir: userDir() };
		}
		const remote = await gist.getGist(a, found.id);
		const meta = parseMeta(remote.files);
		const plan = planDown({ local: readSnapshot(userDir()).files, remote: remote.files, localExtensions: localExtensions(), ignored: ignored() });
		if (!plan.items.length && !plan.extensions.length) {
			await context.globalState.update(LAST_VERSION, remote.version);
			if (!opts.pick) {
				vscode.window.showInformationMessage('Briii Sync: already in sync.');
			}
			return { status: 'nothing', userDir: userDir() };
		}
		const chosen = opts.pick === 'default'
			? { items: plan.items.filter(i => i.picked), extensions: plan.extensions }
			: await choose(plan.items, plan.extensions, meta);
		if (!chosen) {
			return { status: 'cancelled', userDir: userDir() };
		}
		let backup;
		if (chosen.items.length) {
			backup = applyChanges(userDir(), backupRoot(), chosen.items.map(i => ({ name: i.name, content: i.content }))).backup;
		}
		const installed = [];
		for (const id of chosen.extensions) {
			try {
				await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
				installed.push(id);
			} catch (err) {
				vscode.window.showWarningMessage(`Briii Sync: couldn't install ${id}: ${err && err.message || err}`);
			}
		}
		await context.globalState.update(LAST_VERSION, remote.version);
		const summary = [chosen.items.length && `${chosen.items.length} file(s)`, installed.length && `${installed.length} extension(s)`].filter(Boolean).join(' and ');
		if (summary) {
			vscode.window.showInformationMessage(`Briii Sync: applied ${summary} from ${meta.machine || 'GitHub'}.`, 'Open Backups Folder')
				.then(c => c && openBackups());
		}
		return { status: 'downloaded', userDir: userDir(), backup, applied: chosen.items.map(i => i.name), installed };
	});
}

async function startupCheck() {
	const mode = vscode.workspace.getConfiguration('briii.sync').get('onStartup', 'off');
	if (mode === 'off') {
		return;
	}
	try {
		const a = await api(false);
		const found = a && await gist.findGist(a);
		if (!found || found.version === context.globalState.get(LAST_VERSION)) {
			return;
		}
		const remote = await gist.getGist(a, found.id);
		const plan = planDown({ local: readSnapshot(userDir()).files, remote: remote.files, localExtensions: localExtensions(), ignored: ignored() });
		if (!plan.items.some(i => i.picked) && !plan.extensions.length) {
			return;
		}
		if (mode === 'pull') {
			await syncDown({ pick: 'default', silent: true });
			return;
		}
		const meta = parseMeta(remote.files);
		const choice = await vscode.window.showInformationMessage(`Your synced settings changed on ${meta.machine || 'another PC'}.`, 'Review', 'Not Now');
		if (choice === 'Review') {
			await syncDown();
		}
	} catch {
		// startup checks stay quiet; Sync Down reports problems when run by hand
	}
}

async function showGist() {
	await guarded(async () => {
		const a = await api(true);
		const found = a && await gist.findGist(a);
		if (found) {
			vscode.env.openExternal(vscode.Uri.parse(found.htmlUrl));
		} else if (a) {
			vscode.window.showInformationMessage('Briii Sync: nothing synced yet.');
		}
	});
}

function openBackups() {
	fs.mkdirSync(backupRoot(), { recursive: true });
	return vscode.env.openExternal(vscode.Uri.file(backupRoot()));
}

function activate(ctx) {
	context = ctx;
	ctx.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: uri => virtualDocs.get(uri.toString()) || '' }),
		vscode.commands.registerCommand('briii.sync.up', opts => syncUp(opts)),
		vscode.commands.registerCommand('briii.sync.down', opts => syncDown(opts)),
		vscode.commands.registerCommand('briii.sync.showGist', showGist),
		vscode.commands.registerCommand('briii.sync.openBackups', openBackups),
	);
	if (ctx.extensionMode === vscode.ExtensionMode.Production) {
		const timer = setTimeout(startupCheck, STARTUP_DELAY_MS);
		ctx.subscriptions.push({ dispose: () => clearTimeout(timer) });
	}
}

function deactivate() {}

module.exports = { activate, deactivate };
