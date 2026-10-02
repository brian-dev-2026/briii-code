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
			'editor.formatOnSave': true,
			'workbench.experimental.modernUI': true,
			'explorer.fileNesting.enabled': true,
			'redhat.telemetry.enabled': false,
			'workbench.browser.openLocalhostLinks': true,
			'workbench.welcomePage.extraAnnouncements': false,
		};
		const wrong = Object.entries(want).filter(([k, v]) => c.get(k) !== v).map(([k, v]) => `${k}=${JSON.stringify(c.get(k))} (want ${JSON.stringify(v)})`);
		const pyFormatter = vscode.workspace.getConfiguration('editor', { languageId: 'python' }).get('defaultFormatter');
		if (pyFormatter !== 'charliermarsh.ruff') wrong.push(`[python] editor.defaultFormatter=${JSON.stringify(pyFormatter)} (want "charliermarsh.ruff")`);
		assert(!wrong.length, wrong.join('; '));
	});

	await check('every bundled extension activates', async () => {
		const ids = ['briii.briii-defaults', 'briii.briii-theme', 'briii.briii-deploy', 'briii.briii-update', 'briii.briii-sync', 'vscode.git', 'vscode.typescript-language-features', 'ms-vscode.js-debug', ...expected];
		const bad = [];
		for (const id of ids) {
			const ext = vscode.extensions.getExtension(id);
			if (!ext) { bad.push(`${id}: not installed`); continue; }
			try { await withTimeout(Promise.resolve(ext.activate()), 60000, id); } catch (e) { bad.push(`${id}: ${e.message}`); }
		}
		assert(!bad.length, bad.join('; '));
		return `${ids.length} extensions`;
	}, 300000);

	// Claude Code, GitLens and Windsurf can't be bundled (licences); briii-update installs them on first launch.
	await check('first launch: Claude Code, GitLens and Windsurf installed from Open VSX', async () => {
		const ids = ['anthropic.claude-code', 'eamodio.gitlens', 'codeium.codeium'];
		await poll(() => ids.every(id => vscode.extensions.getExtension(id)), 180000, `installed: ${ids.filter(id => vscode.extensions.getExtension(id)).join(', ') || 'none'}`, 2000);
		for (const id of ids) await withTimeout(Promise.resolve(vscode.extensions.getExtension(id).activate()), 60000, id);
		// GitLens' own settings only exist once it is installed; the shipped default must apply to it.
		const skip = vscode.workspace.getConfiguration().get('gitlens.advanced.skipOnboarding');
		assert(skip === true, `gitlens.advanced.skipOnboarding=${JSON.stringify(skip)} (want true)`);
		return ids.join(', ');
	}, 240000);

	// A local server that looks like GitHub's "latest release" API, with a redirecting asset URL.
	const feed = (id, { badSha = false } = {}) => {
		const crypto = require('crypto');
		const bytes = crypto.randomBytes(1024);
		const name = `BriiiCode-Setup-x64-${id}.exe`;
		const sha = crypto.createHash('sha256').update(badSha ? Buffer.from('x') : bytes).digest('hex');
		const srv = http.createServer((req, res) => {
			const base = `http://127.0.0.1:${srv.address().port}`;
			if (req.url === '/latest') res.end(JSON.stringify({ tag_name: `v${id}`, html_url: `${base}/page`, assets: [
				{ name, browser_download_url: `${base}/a/${name}` }, { name: `${name}.sha256`, browser_download_url: `${base}/a/${name}.sha256` }] }));
			else if (req.url === `/a/${name}`) { res.writeHead(302, { location: `${base}/blob` }); res.end(); }
			else if (req.url === '/blob') res.end(bytes);
			else if (req.url === `/a/${name}.sha256`) res.end(`${sha}  ${name}\n`);
			else { res.writeHead(404); res.end(); }
		});
		return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}/latest`, close: () => srv.close() })));
	};
	const updateDir = process.env.BRIII_UPDATE_DIR;

	await check('updater: finds, downloads and verifies a release', async () => {
		assert(updateDir, 'BRIII_UPDATE_DIR not set by verify.ps1');
		const f = await feed('9.999.99999-20991231.1');
		const before = process.env.BRIII_UPDATE_FEED;
		process.env.BRIII_UPDATE_FEED = f.url;
		try {
			const r = await vscode.commands.executeCommand('briii.update.check');
			assert(r && r.status === 'ready', `status ${JSON.stringify(r)}`);
			const state = JSON.parse(fs.readFileSync(path.join(updateDir, 'state.json'), 'utf8'));
			assert(state.pending && fs.existsSync(state.pending.path), `no pending installer: ${JSON.stringify(state)}`);
			return r.id;
		} finally { process.env.BRIII_UPDATE_FEED = before; f.close(); }
	});

	await check('updater: rejects a wrong checksum', async () => {
		const f = await feed('9.999.99999-20991231.2', { badSha: true });
		const before = process.env.BRIII_UPDATE_FEED;
		process.env.BRIII_UPDATE_FEED = f.url;
		try {
			const r = await vscode.commands.executeCommand('briii.update.check');
			assert(r && r.status === 'failed' && /checksum mismatch/.test(r.error), `status ${JSON.stringify(r)}`);
			assert(!fs.existsSync(path.join(updateDir, '9.999.99999-20991231.2.exe')), 'unverified installer kept');
		} finally { process.env.BRIII_UPDATE_FEED = before; f.close(); }
	});

	// Briii Sync against the in-memory Gist API from its unit tests (the repo is next to this file).
	const { startFakeGist } = require(path.join(__dirname, '..', '..', 'brand', 'extensions', 'briii-sync', 'test', 'fakeGist.js'));
	const gist = await startFakeGist();
	process.env.BRIII_SYNC_API = gist.base;
	process.env.BRIII_SYNC_TOKEN = gist.token;
	const synced = () => [...gist.state.gists.values()].find(g => g.description === 'Briii Code settings');
	let userDir;

	await check('Briii Sync: Sync Up uploads settings, snippets and extensions, not secrets', async () => {
		const first = await vscode.commands.executeCommand('briii.sync.up', { onConflict: 'cancel' });
		assert(first && first.userDir, `no result: ${JSON.stringify(first)}`);
		userDir = first.userDir;
		const settingsFile = path.join(userDir, 'settings.json');
		// settings.json is JSONC: VS Code itself writes trailing commas.
		const jsonc = require(path.join(__dirname, '..', '..', 'brand', 'extensions', 'briii-sync', 'lib', 'vendor', 'jsonc-parser', 'main.js'));
		const existing = jsonc.parse(fs.readFileSync(settingsFile, 'utf8'), [], { allowTrailingComma: true }) || {};
		const body = Object.entries({ ...existing, 'briii.test.token': 's3cret' }).map(([k, v]) => `\t${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
		fs.writeFileSync(settingsFile, `{\n\t// kept by Briii Sync\n${body}\n}\n`);
		fs.mkdirSync(path.join(userDir, 'snippets'), { recursive: true });
		fs.writeFileSync(path.join(userDir, 'snippets', 'briii-smoke.code-snippets'), '{ "hi": { "prefix": "hi", "body": "hello" } }');
		const r = await vscode.commands.executeCommand('briii.sync.up', { onConflict: 'cancel' });
		assert(r.status === 'uploaded', `status ${JSON.stringify(r)}`);
		const g = synced();
		assert(g && g.public === false, 'no secret gist');
		assert(!g.files['settings.json'].includes('s3cret'), 'the secret was uploaded');
		assert(g.files['settings.json'].includes('// kept by Briii Sync'), 'comment lost on upload');
		assert(g.files['snippets__briii-smoke.code-snippets'], 'snippet not uploaded');
		assert(/anthropic\.claude-code/i.test(g.files['extensions.json']), `extensions: ${g.files['extensions.json']}`);
		return `${Object.keys(g.files).length} files`;
	});

	await check('Briii Sync: Sync Down applies changes with a backup and keeps comments', async () => {
		assert(userDir, 'Sync Up check did not run');
		const g = synced();
		g.files['settings.json'] = g.files['settings.json'].replace('// kept by Briii Sync', '// kept by Briii Sync\n\t"briii.test.value": "from-github",');
		g.versions.push(`${g.id}-other`);
		g.files['meta.json'] = JSON.stringify({ machine: 'OTHER-PC', time: new Date().toISOString(), format: 1 });
		const r = await vscode.commands.executeCommand('briii.sync.down', { pick: 'default' });
		assert(r.status === 'downloaded', `status ${JSON.stringify(r)}`);
		const text = fs.readFileSync(path.join(userDir, 'settings.json'), 'utf8');
		assert(text.includes('"briii.test.value": "from-github"'), 'new value not applied');
		assert(text.includes('// kept by Briii Sync'), 'comment lost');
		assert(text.includes('s3cret'), 'local secret lost');
		assert(r.backup && fs.existsSync(path.join(r.backup, 'settings.json')), `no backup: ${r.backup}`);
		const again = await vscode.commands.executeCommand('briii.sync.down', { pick: 'default' });
		assert(again.status === 'nothing', `second Sync Down: ${JSON.stringify(again)}`);
	});

	await check('extension commands registered', async () => {
		const all = new Set(await vscode.commands.getCommands(true));
		const exact = ['workbench.action.browser.open', 'briii.deploy', 'briii.deployPreview', 'briii.deployProduction', 'briii.showLastDeployment', 'claude-vscode.editor.open', 'briii.update.check', 'briii.update.installNow', 'briii.sync.up', 'briii.sync.down', 'briii.sync.showGist', 'briii.sync.openBackups', 'editor.action.formatDocument', 'git.commit', 'code-runner.run', 'rest-client.request'];
		const prefixes = ['gitlens.', 'eslint.', 'tailwindCSS.', 'errorLens.', 'pr.', 'prettier.', 'todo-tree.', 'ruff.'];
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

	await check('Python: basedpyright reports type errors', async () => {
		fs.writeFileSync(file('bad.py'), 'n: int = "not a number"\n');
		const doc = await vscode.workspace.openTextDocument(file('bad.py'));
		await vscode.window.showTextDocument(doc);
		const diag = await poll(() => vscode.languages.getDiagnostics(doc.uri).find(d => /basedpyright/i.test(d.source || '') && d.severity === vscode.DiagnosticSeverity.Error),
			120000, 'basedpyright error diagnostic', 1000);
		return diag.message.split('\n')[0].slice(0, 70);
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

	await check('Prettier: formats JavaScript on save', async () => {
		fs.writeFileSync(file('save.js'), 'let s=1\n');
		const doc = await vscode.workspace.openTextDocument(file('save.js'));
		const editor = await vscode.window.showTextDocument(doc);
		await editor.edit(e => e.insert(new vscode.Position(1, 0), 'const t={u:[1,2]}\n'));
		await vscode.commands.executeCommand('workbench.action.files.save');
		const want = 'let s = 1;\nconst t = { u: [1, 2] };';
		await poll(() => fs.readFileSync(file('save.js'), 'utf8').replace(/\r\n/g, '\n').trim() === want, 20000,
			`saved text, got ${JSON.stringify(fs.readFileSync(file('save.js'), 'utf8'))}`);
	}, 60000);

	await check('Ruff: formats Python on command', async () => {
		fs.writeFileSync(file('fmt.py'), "x={'a':1,'b':[1,2]}\n");
		const doc = await vscode.workspace.openTextDocument(file('fmt.py'));
		await vscode.window.showTextDocument(doc);
		const want = 'x = {"a": 1, "b": [1, 2]}';
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

	await check('Claude Code: CLI runs', async () => {
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

	// Studio layout: settings applied from the first launch (rebrand.mjs patches the default).
	await check('studio: the tool icons are a dock at the bottom of the sidebar', () => {
		const at = vscode.workspace.getConfiguration('workbench').get('activityBar.location');
		assert(at === 'bottom', `workbench.activityBar.location=${JSON.stringify(at)} (want "bottom")`);
	});

	await check('studio: Claude Code opens in the right-hand card', () => {
		const at = vscode.workspace.getConfiguration('claudeCode').get('preferredLocation');
		assert(at === 'sidebar', `claudeCode.preferredLocation=${JSON.stringify(at)} (want "sidebar")`);
	});

	await check('studio: the right-hand card shows and hides', async () => {
		await vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
		await vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
	});

	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	if (process.env.BRIII_SMOKE_OUT) fs.writeFileSync(process.env.BRIII_SMOKE_OUT, JSON.stringify(results, null, 2));
	const failed = results.filter(r => !r.ok).length;
	if (failed) throw new Error(`${failed} smoke check(s) failed`);
}

module.exports = { run };
