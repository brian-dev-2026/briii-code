'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldInstallOnExit } = require('../lib/exitInstall');

const base = {
	pendingId: '1.135.06055-20261002.0016',
	current: '1.135.06055-20261002.0015',
	installerExists: true,
	mode: 'auto',
	failures: 0,
	maxFailures: 3,
	mayRunInstaller: true,
	installRequested: false,
};

test('auto mode installs a newer downloaded build on close', () => {
	assert.equal(shouldInstallOnExit(base), true);
});

test('notify mode does not install on close by itself', () => {
	assert.equal(shouldInstallOnExit({ ...base, mode: 'notify' }), false);
});

test('after Install Now, notify mode installs on the next close even if that quit was cancelled', () => {
	assert.equal(shouldInstallOnExit({ ...base, mode: 'notify', installRequested: true }), true);
});

test('a local build installs a published build on close once Install Now was chosen', () => {
	assert.equal(shouldInstallOnExit({ ...base, current: '1.135.06055-local', mode: 'notify', installRequested: true }), true);
});

test('updates switched off never install, even after Install Now', () => {
	assert.equal(shouldInstallOnExit({ ...base, mode: 'off', installRequested: true }), false);
});

test('nothing is installed without a newer build, its installer, or permission to run it', () => {
	assert.equal(shouldInstallOnExit({ ...base, pendingId: undefined }), false);
	assert.equal(shouldInstallOnExit({ ...base, pendingId: base.current }), false);
	assert.equal(shouldInstallOnExit({ ...base, installerExists: false }), false);
	assert.equal(shouldInstallOnExit({ ...base, mayRunInstaller: false, installRequested: true }), false);
});

test('repeated failures stop automatic installs but not a requested one', () => {
	assert.equal(shouldInstallOnExit({ ...base, failures: 3 }), false);
	assert.equal(shouldInstallOnExit({ ...base, failures: 3, installRequested: true }), true);
});

const OLDER = '1.135.06055-20261001.0010';

test('a rollback older than the running build installs on close', () => {
	assert.equal(shouldInstallOnExit({ ...base, pendingId: OLDER, rollback: true }), true);
});

test('an older installer that is not a rollback never installs', () => {
	assert.equal(shouldInstallOnExit({ ...base, pendingId: OLDER }), false);
});

test('a rollback installs on close from a local build', () => {
	assert.equal(shouldInstallOnExit({ ...base, current: '1.143.17232-local', pendingId: '1.140.06880-20261015.0050', rollback: true }), true);
});

test('a rollback that is not older than the running build never installs', () => {
	assert.equal(shouldInstallOnExit({ ...base, rollback: true }), false);
});
