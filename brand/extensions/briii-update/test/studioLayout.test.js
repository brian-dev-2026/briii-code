'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyStudioOnce } = require('../lib/studioLayout');

function harness({ value, done = false, failWrite = false } = {}) {
	const h = { value, done, writes: [] };
	h.opts = {
		isDone: () => h.done,
		markDone: async () => { h.done = true; },
		userValue: () => h.value,
		setUserValue: async v => {
			if (failWrite) {
				throw new Error('settings.json is read-only');
			}
			h.writes.push(v);
			h.value = v;
		},
	};
	return h;
}

test('"panel" becomes "sidebar" and is marked done', async () => {
	const h = harness({ value: 'panel' });
	assert.equal(await applyStudioOnce(h.opts), true);
	assert.deepEqual(h.writes, ['sidebar']);
	assert.equal(h.done, true);
});

test('an unset value is left alone but marked done', async () => {
	const h = harness({ value: undefined });
	assert.equal(await applyStudioOnce(h.opts), false);
	assert.deepEqual(h.writes, []);
	assert.equal(h.done, true);
});

test('"sidebar" is left alone', async () => {
	const h = harness({ value: 'sidebar' });
	assert.equal(await applyStudioOnce(h.opts), false);
	assert.deepEqual(h.writes, []);
});

test('once done, a later "panel" is kept', async () => {
	const h = harness({ value: 'panel', done: true });
	assert.equal(await applyStudioOnce(h.opts), false);
	assert.deepEqual(h.writes, []);
});

test('a failing write is not marked done, so it is tried again next launch', async () => {
	const h = harness({ value: 'panel', failWrite: true });
	assert.equal(await applyStudioOnce(h.opts), false);
	assert.equal(h.done, false);
});
