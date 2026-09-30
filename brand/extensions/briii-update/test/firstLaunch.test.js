'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const firstLaunch = require('../lib/firstLaunch');

function harness({ installed = [], done = [], failing = [] } = {}) {
	const calls = [];
	const marked = [];
	return {
		calls,
		marked,
		opts: {
			ids: ['anthropic.claude-code', 'eamodio.gitlens'],
			isInstalled: id => installed.includes(id),
			install: async id => {
				calls.push(id);
				if (failing.includes(id)) {
					throw new Error('offline');
				}
			},
			done: new Set(done),
			markDone: id => marked.push(id),
		},
	};
}

test('installs only extensions that are missing and not done yet', async () => {
	const h = harness({ done: ['eamodio.gitlens'] });
	assert.deepEqual(await firstLaunch.run(h.opts), ['anthropic.claude-code']);
	assert.deepEqual(h.calls, ['anthropic.claude-code']);
	assert.deepEqual(h.marked, ['anthropic.claude-code']);
});

test('a failed install is not marked done, so it is retried next launch', async () => {
	const h = harness({ failing: ['anthropic.claude-code'] });
	assert.deepEqual(await firstLaunch.run(h.opts), ['eamodio.gitlens']);
	assert.deepEqual(h.marked, ['eamodio.gitlens']);
});

test('an extension that is already installed is marked done without installing', async () => {
	const h = harness({ installed: ['anthropic.claude-code'] });
	await firstLaunch.run(h.opts);
	assert.deepEqual(h.calls, ['eamodio.gitlens']);
	assert.deepEqual(h.marked.sort(), ['anthropic.claude-code', 'eamodio.gitlens']);
});

test('a user who uninstalled one later does not get it back', async () => {
	const h = harness({ done: ['anthropic.claude-code', 'eamodio.gitlens'] });
	assert.deepEqual(await firstLaunch.run(h.opts), []);
	assert.deepEqual(h.calls, []);
});
