'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sessionDirOf, keepSessionLogs } = require('../lib/diagnostics');
const { tempDir } = require('./helpers');

function write(file, text = 'x') {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
}

// A logs folder like VS Code's: one folder per session, named by start time.
function fakeLogs() {
	const logs = path.join(tempDir(), 'logs');
	for (const s of ['20261020T080000', '20261021T070927', '20261021T075419']) {
		write(path.join(logs, s, 'main.log'), `main ${s}`);
		write(path.join(logs, s, 'sharedprocess.log'));
		write(path.join(logs, s, 'ptyhost.log'));
		write(path.join(logs, s, 'window1', 'renderer.log'));
		write(path.join(logs, s, 'window1', 'exthost', 'exthost.log'));
		write(path.join(logs, s, 'window1', 'exthost', 'vscode.github-authentication', 'GitHub Authentication.log'), `auth ${s}`);
		write(path.join(logs, s, 'window1', 'exthost', 'eamodio.gitlens', 'GitLens.log'));
	}
	return logs;
}

test('sessionDirOf: the session folder above an extension log folder', () => {
	const p = path.join('C:', 'logs', '20261021T075419', 'window2', 'exthost', 'briii.briii-update');
	assert.equal(sessionDirOf(p), path.join('C:', 'logs', '20261021T075419'));
});

test('keepSessionLogs copies this and the previous session, sign-in related logs only', () => {
	const logs = fakeLogs();
	const dest = path.join(tempDir(), 'diagnostics');
	const kept = keepSessionLogs({ sessionDir: path.join(logs, '20261021T075419'), dest, name: '1.140.06880-20261020.0045' });
	const out = path.join(dest, '1.140.06880-20261020.0045');
	assert.equal(kept, out);
	assert.deepEqual(fs.readdirSync(out).sort(), ['20261021T070927', '20261021T075419']);
	const auth = path.join(out, '20261021T070927', 'window1', 'exthost', 'vscode.github-authentication', 'GitHub Authentication.log');
	assert.equal(fs.readFileSync(auth, 'utf8'), 'auth 20261021T070927');
	assert.ok(fs.existsSync(path.join(out, '20261021T075419', 'main.log')));
	assert.ok(fs.existsSync(path.join(out, '20261021T075419', 'sharedprocess.log')));
	assert.ok(fs.existsSync(path.join(out, '20261021T075419', 'window1', 'renderer.log')));
	assert.ok(fs.existsSync(path.join(out, '20261021T075419', 'window1', 'exthost', 'exthost.log')));
	assert.ok(!fs.existsSync(path.join(out, '20261021T075419', 'ptyhost.log')));
	assert.ok(!fs.existsSync(path.join(out, '20261021T075419', 'window1', 'exthost', 'eamodio.gitlens')));
});

test('keepSessionLogs works for the very first session (no previous one)', () => {
	const logs = path.join(tempDir(), 'logs');
	write(path.join(logs, '20261021T075419', 'main.log'));
	const dest = path.join(tempDir(), 'diagnostics');
	keepSessionLogs({ sessionDir: path.join(logs, '20261021T075419'), dest, name: 'r1' });
	assert.deepEqual(fs.readdirSync(path.join(dest, 'r1')), ['20261021T075419']);
});

test('keepSessionLogs keeps only the newest folders', () => {
	const logs = fakeLogs();
	const dest = path.join(tempDir(), 'diagnostics');
	for (const name of ['r1', 'r2', 'r3', 'r4']) {
		keepSessionLogs({ sessionDir: path.join(logs, '20261021T075419'), dest, name, keep: 3 });
		const t = new Date(Date.now() + ['r1', 'r2', 'r3', 'r4'].indexOf(name) * 1000);
		fs.utimesSync(path.join(dest, name), t, t);
	}
	assert.deepEqual(fs.readdirSync(dest).sort(), ['r2', 'r3', 'r4']);
});
