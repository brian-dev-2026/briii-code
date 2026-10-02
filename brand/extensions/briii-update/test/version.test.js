'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRelease, isNewer, effectiveMode } = require('../lib/version');

test('parseRelease reads a published release id', () => {
	assert.deepEqual(parseRelease('1.135.06055-20261001.14'), { vscodium: [1, 135, 6055], date: 20261001, run: 14, local: false });
});

test('parseRelease reads a local build id', () => {
	assert.equal(parseRelease('1.135.06055-local').local, true);
	assert.deepEqual(parseRelease('1.135.06055-local').vscodium, [1, 135, 6055]);
});

test('parseRelease rejects anything else', () => {
	assert.equal(parseRelease('garbage'), null);
	assert.equal(parseRelease(''), null);
	assert.equal(parseRelease(undefined), null);
});

test('isNewer: a later build date on the same VSCodium is newer', () => {
	assert.equal(isNewer('1.135.06055-20261002.1', '1.135.06055-20261001.9'), true);
});

test('isNewer: the same id is not newer', () => {
	assert.equal(isNewer('1.135.06055-20261001.9', '1.135.06055-20261001.9'), false);
});

test('isNewer: a later release wins even when VSCodium went back (a pulled VSCodium release)', () => {
	assert.equal(isNewer('1.135.06055-20261009.21', '1.136.00100-20261005.18'), true);
	assert.equal(isNewer('1.136.00100-20261005.18', '1.135.06055-20261009.21'), false);
});

test('isNewer: VSCodium decides between two releases of the same day and run', () => {
	assert.equal(isNewer('1.136.00100-20261001.1', '1.135.06055-20261001.1'), true);
});

test('isNewer: a local build of a newer VSCodium is not replaced by an older published one', () => {
	assert.equal(isNewer('1.135.06055-20261001.1', '1.136.00100-local'), false);
});

test('isNewer: a published build is newer than a local build of the same VSCodium', () => {
	assert.equal(isNewer('1.135.06055-20261001.1', '1.135.06055-local'), true);
});

test('isNewer: unparsable ids are never newer', () => {
	assert.equal(isNewer('garbage', '1.135.06055-20261001.1'), false);
});

const base = { mode: 'auto', current: '1.135.06055-20261001.1', appRoot: 'C:\\Users\\me\\AppData\\Local\\Programs\\Briii Code', programFiles: 'C:\\Program Files' };

test('effectiveMode: a per-user published install uses the setting', () => {
	assert.equal(effectiveMode(base), 'auto');
	assert.equal(effectiveMode({ ...base, mode: 'notify' }), 'notify');
});

test('effectiveMode: off when the setting is off or the build has no release id', () => {
	assert.equal(effectiveMode({ ...base, mode: 'off' }), 'off');
	assert.equal(effectiveMode({ ...base, current: undefined }), 'off');
});

test('effectiveMode: local builds only notify', () => {
	assert.equal(effectiveMode({ ...base, current: '1.135.06055-local' }), 'notify');
});

test('effectiveMode: all-users installs under Program Files only notify', () => {
	assert.equal(effectiveMode({ ...base, appRoot: 'C:\\Program Files\\Briii Code' }), 'notify');
	assert.equal(effectiveMode({ ...base, appRoot: 'c:\\program files\\Briii Code' }), 'notify');
});

test('effectiveMode: an install folder the user cannot write to only notifies', () => {
	assert.equal(effectiveMode({ ...base, appRoot: 'D:\\Apps\\Briii Code', writable: false }), 'notify');
	assert.equal(effectiveMode({ ...base, appRoot: 'D:\\Apps\\Briii Code', writable: true }), 'auto');
});

// CI pads the run number (.0013) so GitHub lists releases in order; installed copies from before
// the padding must still see those as newer.
test('isNewer: a zero-padded run number compares by value', () => {
	assert.equal(isNewer('1.135.06055-20261002.0013', '1.135.06055-20261002.12'), true);
	assert.equal(isNewer('1.135.06055-20261002.0012', '1.135.06055-20261002.12'), false);
	assert.equal(isNewer('1.135.06055-20261002.13', '1.135.06055-20261002.0012'), true);
});
