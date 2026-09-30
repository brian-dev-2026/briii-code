'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { checkForUpdate } = require('../lib/updater');
const { readState } = require('../lib/state');
const { startFeed, tempDir } = require('./helpers');

const ID = '1.135.06055-20261002.1';

test('checkForUpdate: nothing to do when the feed has the current build', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const r = await checkForUpdate({ feedUrl: feed.url, dir: tempDir(), current: ID, mode: 'auto' });
	assert.equal(r.status, 'none');
	assert.equal(feed.hits['/blob'], undefined);
});

test('checkForUpdate: downloads, verifies and records a newer build', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: '1.135.06055-20261001.1', mode: 'auto' });
	assert.equal(r.status, 'ready');
	assert.equal(r.id, ID);
	const state = readState(dir);
	assert.equal(state.pending.id, ID);
	assert.equal(fs.existsSync(state.pending.path), true);
	assert.ok(state.lastCheck > 0);
});

test('checkForUpdate: a second check reuses the verified download', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	await checkForUpdate({ feedUrl: feed.url, dir, current: '1.135.06055-20261001.1', mode: 'auto' });
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: '1.135.06055-20261001.1', mode: 'auto' });
	assert.equal(r.status, 'ready');
	assert.equal(feed.hits['/blob'], 1);
});

test('checkForUpdate: reports a failed download without recording it', async t => {
	const feed = await startFeed({ id: ID, badSha: true });
	t.after(feed.close);
	const dir = tempDir();
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: '1.135.06055-20261001.1', mode: 'auto' });
	assert.equal(r.status, 'failed');
	assert.match(r.error, /checksum mismatch/);
	assert.equal(readState(dir).pending, null);
});

test('checkForUpdate: off does no network request', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const r = await checkForUpdate({ feedUrl: feed.url, dir: tempDir(), current: '1.135.06055-20261001.1', mode: 'off' });
	assert.equal(r.status, 'off');
	assert.deepEqual(feed.hits, {});
});

test('checkForUpdate: an unreachable feed fails quietly', async () => {
	const r = await checkForUpdate({ feedUrl: 'http://127.0.0.1:9/latest', dir: tempDir(), current: '1.135.06055-20261001.1', mode: 'auto' });
	assert.equal(r.status, 'failed');
});

test('readState: defaults when the file is missing or broken', () => {
	const dir = tempDir();
	assert.deepEqual(readState(dir), { pending: null, failures: 0, lastCheck: 0 });
	fs.writeFileSync(path.join(dir, 'state.json'), '{not json');
	assert.deepEqual(readState(dir), { pending: null, failures: 0, lastCheck: 0 });
});

test('checkForUpdate: overlapping checks share one download', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const args = { feedUrl: feed.url, dir, current: '1.135.06055-20261001.1', mode: 'auto' };
	const [a, b] = await Promise.all([checkForUpdate(args), checkForUpdate(args)]);
	assert.equal(a.status, 'ready');
	assert.equal(b.status, 'ready');
	assert.equal(feed.hits['/blob'], 1);
});

test('checkForUpdate: a pending installer that changed on disk is downloaded again', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const args = { feedUrl: feed.url, dir, current: '1.135.06055-20261001.1', mode: 'auto' };
	await checkForUpdate(args);
	fs.writeFileSync(readState(dir).pending.path, 'damaged');
	const r = await checkForUpdate(args);
	assert.equal(r.status, 'ready');
	assert.equal(feed.hits['/blob'], 2);
	assert.deepEqual(fs.readFileSync(readState(dir).pending.path), feed.bytes);
});

test('checkForUpdate: drops a pending installer that is not newer than the running build', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const old = path.join(dir, '1.135.06055-20261001.5.exe');
	fs.writeFileSync(old, 'older');
	fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ pending: { id: '1.135.06055-20261001.5', path: old, sha256: 'x' }, failures: 1, lastCheck: 0 }));
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: ID, mode: 'auto' });
	assert.equal(r.status, 'none');
	assert.equal(readState(dir).pending, null);
	assert.equal(fs.existsSync(old), false);
});
