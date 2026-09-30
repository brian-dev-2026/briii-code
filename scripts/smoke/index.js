// In-app smoke tests for Briii Code. verify.ps1 starts the installed app with
// --extensionTestsPath pointing here, opens a prepared git workspace (dbg.js, bad.ts, fmt.js,
// needle.txt) and reads the JSON report written to BRIII_SMOKE_OUT.
// Every check drives the real app: real terminals, tasks, debugger, extensions and browser.
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stripAnsi = s => s.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');

function withTimeout(promise, ms, what) {
	let timer;
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s${what ? ` (${what})` : ''}`)), ms); }),
	]);
}

// Resolves with the first event that matches, or rejects after ms.
function nextEvent(event, match, ms, what) {
	let sub;
	return withTimeout(new Promise(resolve => {
		sub = event(e => { if (match(e)) resolve(e); });
	}), ms, what).finally(() => sub && sub.dispose());
}

async function poll(fn, ms, what, every = 500) {
	const end = Date.now() + ms;
	for (;;) {
		const v = await fn();
		if (v) return v;
		if (Date.now() > end) throw new Error(`timed out after ${ms / 1000}s (${what})`);
		await sleep(every);
	}
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const only = process.env.BRIII_SMOKE_ONLY ? new RegExp(process.env.BRIII_SMOKE_ONLY, 'i') : null;

async function check(name, fn, ms = 60000) {
	if (only && !only.test(name)) return;
	const started = Date.now();
	try {
		const detail = await withTimeout(Promise.resolve().then(fn), ms);
		results.push({ name, ok: true, detail: detail || '', secs: (Date.now() - started) / 1000 });
	} catch (e) {
		results.push({ name, ok: false, detail: String(e && e.message || e), secs: (Date.now() - started) / 1000 });
	}
}

async function run() {
	const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
	if (!ws) throw new Error('no workspace folder opened');
	const root = ws.uri.fsPath;
	const file = name => path.join(root, name);
	const expected = (process.env.BRIII_SMOKE_EXTS || '').split(',').filter(Boolean);

	await check('default settings', () => {
		const c = vscode.workspace.getConfiguration();
		const want = {
			'workbench.colorTheme': 'Briii Dark',
			'workbench.iconTheme': 'material-icon-theme',
			'editor.defaultFormatter': 'esbenp.prettier-vscode',
			'workbench.browser.openLocalhostLinks': true,
			'workbench.welcomePage.extraAnnouncements': false,
			'gitlens.advanced.skipOnboarding': true,
		};
		const wrong = Object.entries(want).filter(([k, v]) => c.get(k) !== v).map(([k, v]) => `${k}=${JSON.stringify(c.get(k))} (want ${JSON.stringify(v)})`);
		assert(!wrong.length, wrong.join('; '));
	});

	await check('every bundled extension activates', async () => {
		const ids = ['briii.briii-defaults', 'briii.briii-theme', 'briii.briii-deploy', 'vscode.git', 'vscode.typescript-language-features', 'ms-vscode.js-debug', ...expected];
		const bad = [];
		for (const id of ids) {
			const ext = vscode.extensions.getExtension(id);
			if (!ext) { bad.push(`${id}: not installed`); continue; }
			try { await withTimeout(Promise.resolve(ext.activate()), 60000, id); } catch (e) { bad.push(`${id}: ${e.message}`); }
		}
		assert(!bad.length, bad.join('; '));
		return `${ids.length} extensions`;
	}, 300000);

	await check('extension commands registered', async () => {
		const all = new Set(await vscode.commands.getCommands(true));
		const exact = ['workbench.action.browser.open', 'briii.deploy', 'briii.deployPreview', 'briii.deployProduction', 'briii.showLastDeployment', 'claude-vscode.editor.open', 'editor.action.formatDocument', 'git.commit'];
		const prefixes = ['gitlens.', 'eslint.', 'tailwindCSS.', 'errorLens.', 'pr.', 'prettier.'];
		const missing = exact.filter(c => !all.has(c));
		for (const p of prefixes) if (![...all].some(c => c.startsWith(p))) missing.push(`${p}*`);
		assert(!missing.length, `missing: ${missing.join(', ')}`);
	});

	await check('terminal: PowerShell runs commands (shell integration)', async () => {
		const t = vscode.window.createTerminal({ name: 'smoke-pwsh' });
		try {
			const si = t.shellIntegration || (await nextEvent(vscode.window.onDidChangeTerminalShellIntegration, e => e.terminal === t, 45000, 'shell integration')).shellIntegration;
			const exec = si.executeCommand('Write-Output "briii-$(40+2)"; Write-Output "ERAN=[$env:ELECTRON_RUN_AS_NODE]"; git --version; node --version');
			const ended = nextEvent(vscode.window.onDidEndTerminalShellExecution, e => e.execution === exec, 45000, 'command end');
			let out = '';
			for await (const d of exec.read()) out += d;
			const { exitCode } = await ended;
			out = stripAnsi(out);
			assert(out.includes('briii-42'), `no command output: ${JSON.stringify(out.slice(0, 300))}`);
			assert(out.includes('ERAN=[]'), 'ELECTRON_RUN_AS_NODE leaks into the terminal');
			assert(/git version/.test(out), 'git not on PATH in the terminal');
			assert(/v\d+\.\d+/.test(out), 'node not on PATH in the terminal');
			assert(exitCode === 0 || exitCode === undefined, `exit code ${exitCode}`);
			return out.match(/git version [^\r\n]+/)[0] + ', node ' + out.match(/v\d+[.\d]*/)[0];
		} finally { t.dispose(); }
	}, 120000);

	await check('terminal: exit codes are reported', async () => {
		const t = vscode.window.createTerminal({ name: 'smoke-exit' });
		try {
			const si = t.shellIntegration || (await nextEvent(vscode.window.onDidChangeTerminalShellIntegration, e => e.terminal === t, 45000, 'shell integration')).shellIntegration;
			const run = async cmd => {
				const exec = si.executeCommand(cmd);
				return (await nextEvent(vscode.window.onDidEndTerminalShellExecution, e => e.execution === exec, 30000, 'command end')).exitCode;
			};
			// PowerShell's shell integration reports success as 0 and any failure as 1.
			const ok = await run('cmd /c exit 0');
			const fail = await run('cmd /c exit 7');
			assert(ok === 0 && fail === 1, `exit codes ${ok} and ${fail}, want 0 and 1`);
		} finally { t.dispose(); }
	}, 90000);

	const shellRuns = [
		['Command Prompt', 'cmd.exe', m => `/d /c echo briii-shell> "${m}"`],
		['Git Bash', 'C:\\Program Files\\Git\\bin\\bash.exe', m => ['-c', `echo briii-shell > '${m.replace(/\\/g, '/')}'`]],
	];
	for (const [label, shellPath, args] of shellRuns) {
		await check(`terminal: ${label}`, async () => {
			if (label === 'Git Bash' && !fs.existsSync(shellPath)) return 'skipped, Git Bash not installed';
			const marker = file(`shell-${label.replace(/\W/g, '')}.txt`);
			const t = vscode.window.createTerminal({ name: `smoke-${label}`, shellPath, shellArgs: args(marker) });
			const closed = await nextEvent(vscode.window.onDidCloseTerminal, x => x === t, 30000, 'terminal close');
			assert(closed.exitStatus && closed.exitStatus.code === 0, `exit status ${JSON.stringify(closed.exitStatus)}`);
			assert(fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').includes('briii-shell'), 'command did not run');
		});
	}

	await check('tasks: run and report exit codes', async () => {
		fs.writeFileSync(file('fail3.js'), 'process.exit(3);\n');
		const runTask = async (name, execution) => {
			const task = new vscode.Task({ type: 'shell', id: name }, vscode.TaskScope.Workspace, name, 'briii-smoke', execution);
			task.presentationOptions = { reveal: vscode.TaskRevealKind.Never };
			const ended = nextEvent(vscode.tasks.onDidEndTaskProcess, e => e.execution.task.name === name, 60000, name);
			await vscode.tasks.executeTask(task);
			return (await ended).exitCode;
		};
		const codes = {
			'shell ok': await runTask('smoke-ok', new vscode.ShellExecution('node -e "process.exit(0)"')),
			'shell node fail3.js': await runTask('smoke-node3', new vscode.ShellExecution('node fail3.js')),
			'process node exit 3': await runTask('smoke-proc3', new vscode.ProcessExecution('node', ['-e', 'process.exit(3)'])),
		};
		const detail = Object.entries(codes).map(([k, v]) => `${k}=${v}`).join(', ');
		// A failing shell task must not look successful (Windows PowerShell reports failures as 1).
		assert(codes['shell ok'] === 0 && codes['shell node fail3.js'] !== 0 && codes['process node exit 3'] === 3, detail);
		return detail;
	}, 240000);

	await check('debugger: Node breakpoint, evaluate, continue', async () => {
		const program = file('dbg.js');
		const out = file('dbg-out.txt');
		const bp = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(program), new vscode.Position(2, 0)));
		vscode.debug.addBreakpoints([bp]);
		try {
			const stopped = nextEvent(vscode.debug.onDidChangeActiveStackItem, i => i instanceof vscode.DebugStackFrame, 90000, 'breakpoint hit');
			const started = await vscode.debug.startDebugging(ws, { type: 'node', request: 'launch', name: 'smoke', program, args: [out], console: 'internalConsole' });
			assert(started, 'startDebugging returned false');
			const frame = await stopped;
			const ev = await frame.session.customRequest('evaluate', { expression: 'x', frameId: frame.frameId, context: 'repl' });
			assert(String(ev.result) === '41', `x evaluated to ${ev.result}, want 41`);
			const done = nextEvent(vscode.debug.onDidTerminateDebugSession, () => true, 60000, 'session end');
			await frame.session.customRequest('continue', { threadId: frame.threadId });
			await done;
			await poll(() => fs.existsSync(out), 10000, 'program output');
			assert(fs.readFileSync(out, 'utf8') === '42', 'program did not finish correctly');
			return 'stopped at line 3, x = 41';
		} finally { vscode.debug.removeBreakpoints([bp]); }
	}, 180000);

	await check('git: repository detected, changes tracked', async () => {
		const api = vscode.extensions.getExtension('vscode.git').exports.getAPI(1);
		const repo = await poll(() => api.repositories.find(r => r.rootUri.fsPath.toLowerCase() === root.toLowerCase()), 45000, 'repository');
		fs.appendFileSync(file('needle.txt'), 'changed\n');
		await repo.status();
		const changes = await poll(() => repo.state.workingTreeChanges.length, 20000, 'working tree change');
		return `branch ${repo.state.HEAD && repo.state.HEAD.name}, ${changes} change(s)`;
	}, 90000);

	await check('TypeScript: type errors reported', async () => {
		const doc = await vscode.workspace.openTextDocument(file('bad.ts'));
		await vscode.window.showTextDocument(doc);
		const diag = await poll(() => vscode.languages.getDiagnostics(doc.uri).find(d => String(d.code) === '2322'), 120000, 'TS2322 diagnostic', 1000);
		return diag.message.slice(0, 60);
	}, 150000);

	await check('Prettier: formats JavaScript on command', async () => {
		const doc = await vscode.workspace.openTextDocument(file('fmt.js'));
		await vscode.window.showTextDocument(doc);
		const want = 'const a = { b: 1, c: [1, 2, 3] };';
		await poll(async () => {
			await vscode.commands.executeCommand('editor.action.formatDocument');
			return doc.getText().trim() === want;
		}, 60000, `formatted text, got ${JSON.stringify(doc.getText())}`, 2000);
		await vscode.commands.executeCommand('workbench.action.files.revert');
	}, 90000);

	await check('search: files and ripgrep text search', async () => {
		const found = await vscode.workspace.findFiles('**/*.ts', '**/node_modules/**');
		assert(found.some(u => u.fsPath.endsWith('bad.ts')), 'findFiles missed bad.ts');
		const rg = path.join(vscode.env.appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep-universal', 'bin', 'win32-x64', 'rg.exe');
		assert(fs.existsSync(rg), `bundled ripgrep missing at ${rg}`);
		const out = cp.execFileSync(rg, ['-n', 'briii-needle', root], { encoding: 'utf8' });
		assert(out.includes('needle.txt'), 'ripgrep found nothing');
	});

	await check('file watcher: new files are noticed', async () => {
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(ws, 'watch-*.txt'));
		try {
			await sleep(1000);
			const created = nextEvent(watcher.onDidCreate, u => u.fsPath.endsWith('watch-1.txt'), 20000, 'create event');
			fs.writeFileSync(file('watch-1.txt'), 'x');
			await created;
		} finally { watcher.dispose(); }
	});

	await check('webviews: scripts run and post messages', async () => {
		const panel = vscode.window.createWebviewPanel('briiiSmoke', 'Smoke', vscode.ViewColumn.Active, { enableScripts: true });
		try {
			const got = nextEvent(panel.webview.onDidReceiveMessage, m => m === 'briii-webview', 30000, 'webview message');
			panel.webview.html = '<!doctype html><html><body><script>acquireVsCodeApi().postMessage("briii-webview")</script></body></html>';
			await got;
		} finally { panel.dispose(); }
	});

	// A local server tells us who loaded the page: the Integrated Browser identifies as Electron.
	const hits = [];
	const server = http.createServer((req, res) => {
		hits.push({ url: req.url, ua: String(req.headers['user-agent'] || '') });
		res.setHeader('content-type', 'text/html');
		res.end('<!doctype html><title>briii-smoke</title><h1>ok</h1>');
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	const base = `http://localhost:${server.address().port}`;
	try {
		await check('Integrated Browser: opens and loads a page', async () => {
			await vscode.commands.executeCommand('workbench.action.browser.open', `${base}/command`);
			const hit = await poll(() => hits.find(h => h.url === '/command'), 30000, 'page request');
			assert(/Electron/.test(hit.ua), `page was loaded by a non-integrated browser: ${hit.ua}`);
			// The page title becomes the tab label (the tab may replace a preview tab, so don't count tabs).
			const labels = () => vscode.window.tabGroups.all.flatMap(g => g.tabs.map(t => t.label));
			await poll(() => labels().includes('briii-smoke'), 15000, `browser tab; tabs now: ${labels().join(' | ')}`);
		});

		// Like clicking the URL that `npm run dev` prints: the terminal's "Open Last URL Link"
		// goes through the same opener as a click. (Extensions' vscode.env.openExternal always
		// uses the system browser, by design.)
		await check('Integrated Browser: localhost links from the terminal open inside the app', async () => {
			const t = vscode.window.createTerminal({ name: 'smoke-link' });
			try {
				t.show();
				const si = t.shellIntegration || (await nextEvent(vscode.window.onDidChangeTerminalShellIntegration, e => e.terminal === t, 45000, 'shell integration')).shellIntegration;
				const exec = si.executeCommand(`Write-Output "  Local:   ${base}/terminal"`);
				await nextEvent(vscode.window.onDidEndTerminalShellExecution, e => e.execution === exec, 30000, 'command end');
				// Link detection runs after the output is rendered, so retry until the link is picked up.
				const hit = await poll(async () => {
					t.show(false);
					await vscode.commands.executeCommand('workbench.action.terminal.openUrlLink');
					await sleep(1500);
					return hits.find(h => h.url === '/terminal');
				}, 45000, 'page request', 1500);
				assert(/Electron/.test(hit.ua), `localhost link opened in the system browser: ${hit.ua}`);
			} finally { t.dispose(); }
		}, 120000);
	} finally { server.close(); }

	await check('GitHub sign-in provider available', async () => {
		await withTimeout(Promise.resolve(vscode.authentication.getSession('github', ['read:user'], { silent: true })), 20000, 'github provider');
	});

	await check('Claude Code: bundled CLI runs', async () => {
		const ext = vscode.extensions.getExtension('anthropic.claude-code');
		assert(ext, 'Claude Code not installed');
		const bin = path.join(ext.extensionPath, 'resources', 'native-binary', 'claude.exe');
		assert(fs.existsSync(bin), `missing ${bin}`);
		const out = cp.execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 60000 }).trim();
		assert(/\d+\.\d+/.test(out), `unexpected output ${out}`);
		return out;
	}, 90000);

	await check('clipboard round trip', async () => {
		await vscode.env.clipboard.writeText('briii-clip');
		assert(await vscode.env.clipboard.readText() === 'briii-clip', 'clipboard text differs');
	});

	await check('first launch: no GitLens welcome tab', () => {
		const gitlens = vscode.window.tabGroups.all.flatMap(g => g.tabs)
			.filter(t => t.input instanceof vscode.TabInputWebview && /gitlens/i.test(t.input.viewType));
		assert(!gitlens.length, `open: ${gitlens.map(t => t.label).join(', ')}`);
	});

	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	if (process.env.BRIII_SMOKE_OUT) fs.writeFileSync(process.env.BRIII_SMOKE_OUT, JSON.stringify(results, null, 2));
	const failed = results.filter(r => !r.ok).length;
	if (failed) throw new Error(`${failed} smoke check(s) failed`);
}

module.exports = { run };
