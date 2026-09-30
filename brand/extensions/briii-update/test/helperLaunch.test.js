'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { helperCommandLine } = require('../lib/helperLaunch');

const base = {
	script: 'C:\\Program Files\\x\\install-on-exit.ps1',
	installer: 'C:\\Users\\me\\AppData\\Local\\Briii Code\\updates\\1.135.06055-20261001.1.exe',
	appDir: 'C:\\Users\\me\\AppData\\Local\\Programs\\Briii Code',
	stateDir: 'C:\\Users\\me\\AppData\\Local\\Briii Code\\updates',
	id: '1.135.06055-20261001.1',
};

test('helperCommandLine quotes every path, so folders with spaces work', () => {
	const cmd = helperCommandLine(base);
	assert.ok(cmd.startsWith('powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\\Program Files\\x\\install-on-exit.ps1"'));
	assert.ok(cmd.includes(' -Installer "C:\\Users\\me\\AppData\\Local\\Briii Code\\updates\\1.135.06055-20261001.1.exe"'));
	assert.ok(cmd.includes(' -AppDir "C:\\Users\\me\\AppData\\Local\\Programs\\Briii Code"'));
	assert.ok(cmd.includes(' -StateDir "C:\\Users\\me\\AppData\\Local\\Briii Code\\updates"'));
	assert.ok(cmd.includes(' -Id "1.135.06055-20261001.1"'));
	assert.ok(!cmd.includes('-Relaunch'));
});

test('helperCommandLine adds -Relaunch for Install Now', () => {
	assert.ok(helperCommandLine({ ...base, relaunch: true }).endsWith(' -Relaunch'));
});

test('helperCommandLine refuses values that would break the quoting', () => {
	assert.throws(() => helperCommandLine({ ...base, appDir: 'C:\\bad"dir' }), /quote/);
});

test('helperCommandLine passes the app exe name, so the helper needs no hardcoded name', () => {
	assert.ok(helperCommandLine({ ...base, exeName: 'Briii Code' }).includes(' -ExeName "Briii Code"'));
});
