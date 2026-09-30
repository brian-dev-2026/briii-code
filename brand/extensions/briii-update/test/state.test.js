'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { trimLog, claimOnce } = require('../lib/state');
const { tempDir } = require('./helpers');

test('trimLog keeps only the newest lines of install.log', () => {
	const dir = tempDir();
	const lines = Array.from({ length: 600 }, (_, i) => `line ${i}`);
	fs.writeFileSync(path.join(dir, 'install.log'), lines.join('\n') + '\n');
	trimLog(dir, 500);
	const kept = fs.readFileSync(path.join(dir, 'install.log'), 'utf8').trim().split('\n');
	assert.equal(kept.length, 500);
	assert.equal(kept[0], 'line 100');
	assert.equal(kept[499], 'line 599');
});

test('trimLog leaves a short or missing log alone', () => {
	const dir = tempDir();
	trimLog(dir, 500);
	assert.equal(fs.existsSync(path.join(dir, 'install.log')), false);
	fs.writeFileSync(path.join(dir, 'install.log'), 'a\nb\n');
	trimLog(dir, 500);
	assert.equal(fs.readFileSync(path.join(dir, 'install.log'), 'utf8'), 'a\nb\n');
});

test('claimOnce: only the first window gets to show a notification', () => {
	const dir = tempDir();
	assert.equal(claimOnce(dir, 'ready:1.135.06055-20261001.2'), true);
	assert.equal(claimOnce(dir, 'ready:1.135.06055-20261001.2'), false);
	assert.equal(claimOnce(dir, 'failed:1.135.06055-20261001.2'), true);
});