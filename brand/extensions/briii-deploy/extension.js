// Briii Deploy - deploy the open folder to Vercel with the official Vercel CLI.
'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const LAST_KEY = 'briii.lastDeployment';
let output;
let statusItem;
let running = false;

function activate(context) {
	output = vscode.window.createOutputChannel('Vercel');
	statusItem = vscode.window.createStatusBarItem('briii.deploy', vscode.StatusBarAlignment.Left, -100);
	statusItem.name = 'Vercel Deploy';
	statusItem.command = 'briii.deploy';
	setIdle();

	context.subscriptions.push(
		output,
		statusItem,
		vscode.commands.registerCommand('briii.deploy', () => deploy(context)),
		vscode.commands.registerCommand('briii.deployPreview', () => deploy(context, false)),
		vscode.commands.registerCommand('briii.deployProduction', () => deploy(context, true)),
		vscode.commands.registerCommand('briii.showLastDeployment', () => showLast(context)),
		vscode.commands.registerCommand('briii.openDashboard', () =>
			vscode.env.openExternal(vscode.Uri.parse('https://vercel.com/dashboard'))),
		vscode.workspace.onDidChangeWorkspaceFolders(updateVisibility),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('briiiDeploy.showStatusBar')) {
				updateVisibility();
			}
		})
	);
	updateVisibility();
}

function updateVisibility() {
	const show = vscode.workspace.getConfiguration('briiiDeploy').get('showStatusBar', true);
	if (show && vscode.workspace.workspaceFolders?.length) {
		statusItem.show();
	} else {
		statusItem.hide();
	}
}

function setIdle() {
	statusItem.text = '$(triangle-up) Deploy';
	statusItem.tooltip = 'Deploy this folder to Vercel';
}

function cliCommand() {
	return vscode.workspace.getConfiguration('briiiDeploy').get('vercelCommand', 'vercel');
}

/** Runs a CLI command and resolves with { code, stdout, stderr }. Never rejects. */
function run(args, cwd, onData) {
	return new Promise(resolve => {
		const child = cp.spawn(`${cliCommand()} ${args}`, {
			cwd,
			shell: true,
			windowsHide: true,
			env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', d => { stdout += d; onData?.(String(d)); });
		child.stderr.on('data', d => { stderr += d; onData?.(String(d)); });
		child.on('error', err => resolve({ code: -1, stdout, stderr: stderr + err.message, child }));
		child.on('close', code => resolve({ code, stdout, stderr, child }));
		run.current = child;
	});
}

function kill(child) {
	if (!child || child.exitCode !== null) {
		return;
	}
	if (process.platform === 'win32') {
		cp.exec(`taskkill /pid ${child.pid} /T /F`);
	} else {
		child.kill();
	}
}

function openTerminal(cwd, command) {
	const terminal = vscode.window.createTerminal({ name: 'Vercel', cwd });
	terminal.show();
	terminal.sendText(command);
}

async function pickFolder() {
	const folders = vscode.workspace.workspaceFolders || [];
	if (folders.length === 0) {
		vscode.window.showWarningMessage('Open a folder to deploy it to Vercel.');
		return undefined;
	}
	if (folders.length === 1) {
		return folders[0].uri.fsPath;
	}
	const pick = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Which folder do you want to deploy?' });
	return pick?.uri.fsPath;
}

async function pickTarget() {
	const pick = await vscode.window.showQuickPick([
		{ label: '$(eye) Preview', description: 'Unique URL for testing', prod: false },
		{ label: '$(globe) Production', description: 'Your live domain', prod: true },
	], { placeHolder: 'Deploy to Vercel' });
	return pick?.prod;
}

/** Makes sure the CLI is installed, logged in and the folder is linked. Returns true when ready. */
async function preflight(cwd) {
	const version = await run('--version', cwd);
	if (version.code !== 0) {
		const choice = await vscode.window.showWarningMessage(
			'The Vercel CLI is not installed.', 'Install with npm', 'Learn more');
		if (choice === 'Install with npm') {
			openTerminal(cwd, 'npm install -g vercel');
		} else if (choice === 'Learn more') {
			vscode.env.openExternal(vscode.Uri.parse('https://vercel.com/docs/cli'));
		}
		return false;
	}

	const whoami = await run('whoami', cwd);
	if (whoami.code !== 0) {
		const choice = await vscode.window.showInformationMessage(
			'Log in to Vercel to deploy. Run the deploy again once you are logged in.', 'Log in');
		if (choice) {
			openTerminal(cwd, `${cliCommand()} login`);
		}
		return false;
	}

	if (!fs.existsSync(path.join(cwd, '.vercel', 'project.json'))) {
		const choice = await vscode.window.showInformationMessage(
			`Link "${path.basename(cwd)}" to a Vercel project first. Run the deploy again once it is linked.`, 'Link project');
		if (choice) {
			openTerminal(cwd, `${cliCommand()} link`);
		}
		return false;
	}
	return true;
}

async function deploy(context, prod) {
	if (running) {
		output.show(true);
		return;
	}
	const cwd = await pickFolder();
	if (!cwd) {
		return;
	}
	if (prod === undefined) {
		prod = await pickTarget();
		if (prod === undefined) {
			return;
		}
	}

	running = true;
	statusItem.text = '$(sync~spin) Checking…';
	try {
		if (!(await preflight(cwd))) {
			return;
		}
		const target = prod ? 'Production' : 'Preview';
		statusItem.text = `$(sync~spin) Deploying ${target}…`;
		output.appendLine(`\n▲ ${new Date().toLocaleString()} - deploying ${cwd} (${target})`);

		const result = await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Deploying to Vercel (${target})`,
			cancellable: true,
		}, (progress, token) => {
			const pending = run(`deploy --yes${prod ? ' --prod' : ''}`, cwd, text => {
				output.append(text);
				const line = text.trim().split(/\r?\n/).pop();
				if (line) {
					progress.report({ message: line.slice(0, 80) });
				}
			});
			token.onCancellationRequested(() => kill(run.current));
			return pending;
		});

		const urls = result.stdout.match(/https:\/\/[^\s]+/g);
		if (result.code !== 0 || !urls) {
			const choice = await vscode.window.showErrorMessage(
				`Vercel deploy failed${result.code > 0 ? ` (exit ${result.code})` : ''}.`, 'Show Output');
			if (choice) {
				output.show();
			}
			return;
		}

		const url = urls[urls.length - 1];
		const last = { url, prod, folder: cwd, time: Date.now() };
		await context.globalState.update(LAST_KEY, last);
		output.appendLine(`✓ ${url}`);
		await announce(last);
	} finally {
		running = false;
		setIdle();
	}
}

async function announce(last) {
	const choice = await vscode.window.showInformationMessage(
		`${last.prod ? 'Production' : 'Preview'} deployed: ${last.url}`,
		'Open', 'Open in External Browser', 'Copy URL');
	if (choice === 'Open') {
		// The Integrated Browser; fall back to the system browser if it is unavailable.
		vscode.commands.executeCommand('workbench.action.browser.open', last.url)
			.then(undefined, () => vscode.env.openExternal(vscode.Uri.parse(last.url)));
	} else if (choice === 'Open in External Browser') {
		vscode.env.openExternal(vscode.Uri.parse(last.url));
	} else if (choice === 'Copy URL') {
		await vscode.env.clipboard.writeText(last.url);
	}
}

async function showLast(context) {
	const last = context.globalState.get(LAST_KEY);
	if (!last) {
		vscode.window.showInformationMessage('No deployments yet. Click ▲ Deploy in the status bar.');
		return;
	}
	await announce(last);
}

function deactivate() {
	kill(run.current);
}

module.exports = { activate, deactivate };
