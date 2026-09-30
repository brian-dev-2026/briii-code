'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readyMessage } = require('../lib/messages');

test('readyMessage: auto mode says the update installs on close', () => {
	assert.equal(readyMessage('auto', '1.135.06055-20261001.2'), 'Briii Code 1.135.06055-20261001.2 is ready. It installs when you close Briii Code.');
});

test('readyMessage: notify mode does not promise an install on close', () => {
	const text = readyMessage('notify', '1.135.06055-20261001.2');
	assert.equal(text, 'Briii Code 1.135.06055-20261001.2 is ready. Choose Install Now to restart and update.');
	assert.doesNotMatch(text, /when you close/);
});