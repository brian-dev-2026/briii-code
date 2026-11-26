'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { checkForUpdate, prepareRollback, isStalePending } = require('../lib/updater');
const { readState } = require('../lib/state');
const { startFeed, tempDir, TEST_KEYS } = require('./helpers');

const keys = [TEST_KEYS.publicKey];

const ID = '1.135.06055-20261002.1';

test('checkForUpdate: nothing to do when the feed has the current build', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const r = await checkForUpdate({ feedUrl: feed.url, dir: tempDir(), current: ID, mode: 'auto', keys });
	assert.equal(r.status, 'none');
	assert.equal(feed.hits['/blob'], undefined);
});

test('checkForUpdate: downloads, verifies and records a newer build', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: '1.135.06055-20261001.1', mode: 'auto', keys });
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
	await checkForUpdate({ feedUrl: feed.url, dir, current: '1.135.06055-20261001.1', mode: 'auto', keys });
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: '1.135.06055-20261001.1', mode: 'auto', keys });
	assert.equal(r.status, 'ready');
	assert.equal(feed.hits['/blob'], 1);
});

test('checkForUpdate: reports a failed download without recording it', async t => {
	const feed = await startFeed({ id: ID, badSha: true });
	t.after(feed.close);
	const dir = tempDir();
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: '1.135.06055-20261001.1', mode: 'auto', keys });
	assert.equal(r.status, 'failed');
	assert.match(r.error, /checksum mismatch/);
	assert.equal(readState(dir).pending, null);
});

test('checkForUpdate: off does no network request', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const r = await checkForUpdate({ feedUrl: feed.url, dir: tempDir(), current: '1.135.06055-20261001.1', mode: 'off', keys });
	assert.equal(r.status, 'off');
	assert.deepEqual(feed.hits, {});
});

test('checkForUpdate: an unreachable feed fails quietly', async () => {
	const r = await checkForUpdate({ feedUrl: 'http://127.0.0.1:9/latest', dir: tempDir(), current: '1.135.06055-20261001.1', mode: 'auto', keys });
	assert.equal(r.status, 'failed');
});

test('readState: defaults when the file is missing or broken', () => {
	const dir = tempDir();
	assert.deepEqual(readState(dir), { pending: null, failures: 0, lastCheck: 0, heldBack: null });
	fs.writeFileSync(path.join(dir, 'state.json'), '{not json');
	assert.deepEqual(readState(dir), { pending: null, failures: 0, lastCheck: 0, heldBack: null });
});

test('checkForUpdate: overlapping checks share one download', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const args = { feedUrl: feed.url, dir, current: '1.135.06055-20261001.1', mode: 'auto', keys };
	const [a, b] = await Promise.all([checkForUpdate(args), checkForUpdate(args)]);
	assert.equal(a.status, 'ready');
	assert.equal(b.status, 'ready');
	assert.equal(feed.hits['/blob'], 1);
});

test('checkForUpdate: a pending installer that changed on disk is downloaded again', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const args = { feedUrl: feed.url, dir, current: '1.135.06055-20261001.1', mode: 'auto', keys };
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
	fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ pending: { id: '1.135.06055-20261001.5', path: old, sha256: 'x', signed: true }, failures: 1, lastCheck: 0 }));
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: ID, mode: 'auto', keys });
	assert.equal(r.status, 'none');
	assert.equal(readState(dir).pending, null);
	assert.equal(fs.existsSync(old), false);
});

test('checkForUpdate: a repeat check asks with the ETag and uses the 304 (no rate limit cost)', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const args = { feedUrl: feed.url, dir, current: '1.135.06055-20261001.1', mode: 'auto', keys };
	await checkForUpdate(args);
	const r = await checkForUpdate(args);
	assert.equal(r.status, 'ready');
	assert.equal(r.id, ID);
	assert.equal(feed.hits.notModified, 1);
});

const OLD = '1.135.06055-20261001.1';
const PREV = '1.135.06055-20261001.5';

function writeStateFile(dir, state) {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
}

function fakeInstaller(dir, id) {
	const p = path.join(dir, `${id}.exe`);
	fs.writeFileSync(p, 'installer');
	return p;
}

test('checkForUpdate: a release not newer than heldBack is no update', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	writeStateFile(dir, { pending: null, failures: 0, lastCheck: 0, heldBack: ID });
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: OLD, mode: 'auto', keys });
	assert.equal(r.status, 'none');
	assert.equal(feed.hits['/blob'], undefined);
	assert.equal(readState(dir).heldBack, ID);
});

test('checkForUpdate: a release newer than heldBack replaces a pending rollback and clears the hold', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const rb = fakeInstaller(dir, PREV);
	writeStateFile(dir, { pending: { id: PREV, path: rb, sha256: 'x', rollback: true, signed: true }, failures: 0, lastCheck: 0, heldBack: '1.135.06055-20261001.9' });
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: '1.135.06055-20261001.9', mode: 'auto', keys });
	assert.equal(r.status, 'ready');
	const state = readState(dir);
	assert.equal(state.pending.id, ID);
	assert.ok(!state.pending.rollback);
	assert.equal(state.heldBack, null);
	assert.equal(fs.existsSync(rb), false);
});

test('checkForUpdate: heldBack older than the running build is cleared', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	writeStateFile(dir, { pending: null, failures: 0, lastCheck: 0, heldBack: OLD });
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: ID, mode: 'auto', keys });
	assert.equal(r.status, 'none');
	assert.equal(readState(dir).heldBack, null);
});

test('checkForUpdate: a rollback pending installer older than the running build is kept', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const rb = fakeInstaller(dir, PREV);
	writeStateFile(dir, { pending: { id: PREV, path: rb, sha256: 'x', rollback: true, signed: true }, failures: 0, lastCheck: 0, heldBack: ID });
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: ID, mode: 'auto', keys });
	assert.equal(r.status, 'none');
	assert.equal(readState(dir).pending.id, PREV);
	assert.equal(fs.existsSync(rb), true);
});

test('checkForUpdate: a rollback pending installer is dropped once it is the running build', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const rb = fakeInstaller(dir, PREV);
	writeStateFile(dir, { pending: { id: PREV, path: rb, sha256: 'x', rollback: true, signed: true }, failures: 0, lastCheck: 0, heldBack: ID });
	await checkForUpdate({ feedUrl: feed.url, dir, current: PREV, mode: 'auto', keys });
	assert.equal(readState(dir).pending, null);
	assert.equal(fs.existsSync(rb), false);
});

test('isStalePending: updates must be newer, rollbacks older', () => {
	assert.equal(isStalePending({ id: ID, signed: true }, OLD), false);
	assert.equal(isStalePending({ id: OLD, signed: true }, ID), true);
	assert.equal(isStalePending({ id: OLD, rollback: true, signed: true }, ID), false);
	assert.equal(isStalePending({ id: ID, rollback: true, signed: true }, ID), true);
	assert.equal(isStalePending({ id: '1.135.06055-20261001.5', rollback: true, signed: true }, '1.136.1-local'), false);
});

test('prepareRollback prepares the previous release and holds the current one', async t => {
	const feed = await startFeed({ id: PREV });
	t.after(feed.close);
	const dir = tempDir();
	const r = await prepareRollback({ listUrl: feed.listUrl, dir, current: ID, keys });
	assert.deepEqual(r, { status: 'ready', id: PREV, pending: readState(dir).pending });
	const state = readState(dir);
	assert.equal(state.pending.signed, true);
	assert.equal(state.pending.rollback, true);
	assert.equal(state.pending.id, PREV);
	assert.equal(state.heldBack, ID);
	assert.equal(fs.existsSync(state.pending.path), true);
});

test('prepareRollback replaces a pending update', async t => {
	const feed = await startFeed({ id: PREV });
	t.after(feed.close);
	const dir = tempDir();
	const newer = fakeInstaller(dir, '1.135.06055-20261003.1');
	writeStateFile(dir, { pending: { id: '1.135.06055-20261003.1', path: newer, sha256: 'x', signed: true }, failures: 2, lastCheck: 0, heldBack: null });
	const r = await prepareRollback({ listUrl: feed.listUrl, dir, current: ID, keys });
	assert.equal(r.status, 'ready');
	assert.equal(fs.existsSync(newer), false);
	assert.equal(readState(dir).failures, 0);
});

test('prepareRollback reports none when no older release is listed', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const r = await prepareRollback({ listUrl: feed.listUrl, dir, current: ID, keys });
	assert.deepEqual(r, { status: 'none' });
	assert.equal(readState(dir).pending, null);
	assert.equal(readState(dir).heldBack, null);
});

test('prepareRollback leaves state unchanged when the signature is bad', async t => {
	const feed = await startFeed({ id: PREV, badSig: true });
	t.after(feed.close);
	const dir = tempDir();
	const r = await prepareRollback({ listUrl: feed.listUrl, dir, current: ID, keys });
	assert.equal(r.status, 'failed');
	const state = readState(dir);
	assert.equal(state.pending, null);
	assert.equal(state.heldBack, null);
});

test('checkForUpdate called during a rollback does not return the rollback\'s result', async t => {
	const feed = await startFeed({ id: ID, releases: [PREV] });
	t.after(feed.close);
	const dir = tempDir();
	const rolling = prepareRollback({ listUrl: feed.listUrl, dir, current: ID, keys });
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: ID, mode: 'auto', keys });
	assert.deepEqual(r, { status: 'none' });
	assert.equal((await rolling).status, 'ready');
});

test('a check finishing does not unregister a queued rollback', async t => {
	const feed = await startFeed({ id: ID, releases: [PREV] });
	t.after(feed.close);
	const dir = tempDir();
	const check = checkForUpdate({ feedUrl: feed.url, dir, current: ID, mode: 'auto', keys });
	const rolling = prepareRollback({ listUrl: feed.listUrl, dir, current: ID, keys });
	await check;
	// The rollback is still running: a new check must wait for it, not run beside it.
	await checkForUpdate({ feedUrl: feed.url, dir, current: ID, mode: 'auto', keys });
	assert.equal(readState(dir).pending?.id, PREV, 'the new check ran before the rollback finished');
	assert.equal((await rolling).status, 'ready');
	const state = readState(dir);
	assert.equal(state.pending.rollback, true);
	assert.equal(state.heldBack, ID);
});

test('prepareRollback asks before downloading', async t => {
	const feed = await startFeed({ id: ID, releases: [PREV] });
	t.after(feed.close);
	let asked;
	let blobHitsWhenAsked = 'unset';
	const r = await prepareRollback({
		listUrl: feed.listUrl, dir: tempDir(), current: ID, keys,
		confirm: async release => { asked = release; blobHitsWhenAsked = feed.hits['/blob']; return true; },
	});
	assert.equal(asked.id, PREV);
	assert.equal(blobHitsWhenAsked, undefined);
	assert.equal(r.status, 'ready');
});

test('prepareRollback cancelled leaves state and the pending update untouched', async t => {
	const feed = await startFeed({ id: ID, releases: [PREV] });
	t.after(feed.close);
	const dir = tempDir();
	const newer = fakeInstaller(dir, '1.135.06055-20261003.1');
	writeStateFile(dir, { pending: { id: '1.135.06055-20261003.1', path: newer, sha256: 'x', signed: true }, failures: 1, lastCheck: 0, heldBack: null });
	const stateFile = path.join(dir, 'state.json');
	const before = fs.readFileSync(stateFile);
	const r = await prepareRollback({ listUrl: feed.listUrl, dir, current: ID, keys, confirm: async () => false });
	assert.deepEqual(r, { status: 'cancelled' });
	assert.deepEqual(fs.readFileSync(stateFile), before);
	assert.equal(fs.existsSync(newer), true);
	assert.equal(feed.hits['/blob'], undefined);
});

const BAD = '1.135.06055-20261003.0003';
const P1 = '1.135.06055-20261002.0002';
const P2 = '1.135.06055-20261001.0001';

function clearPending(dir) {
	writeStateFile(dir, { ...readState(dir), pending: null });
}

test('prepareRollback twice keeps holding the first version left', async t => {
	const feed = await startFeed({ id: BAD, releases: [P1, P2] });
	t.after(feed.close);
	const dir = tempDir();
	assert.equal((await prepareRollback({ listUrl: feed.listUrl, dir, current: BAD, keys })).id, P1);
	clearPending(dir); // P1 installed
	assert.equal((await prepareRollback({ listUrl: feed.listUrl, dir, current: P1, keys })).id, P2);
	clearPending(dir);
	assert.equal(readState(dir).heldBack, BAD);
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: P2, mode: 'auto', keys });
	assert.equal(r.status, 'none');
});

test('a check does not erase a rollback written by another window during the check', async t => {
	const feed = await startFeed({ id: ID, releases: [PREV], delayMs: 300 });
	t.after(feed.close);
	const dir = tempDir();
	const checking = checkForUpdate({ feedUrl: feed.url, dir, current: ID, mode: 'auto', keys });
	await new Promise(r => setTimeout(r, 100));
	const rb = fakeInstaller(dir, PREV);
	writeStateFile(dir, { pending: { id: PREV, path: rb, sha256: 'x', rollback: true, signed: true }, failures: 0, lastCheck: 0, heldBack: ID });
	assert.equal((await checking).status, 'none');
	const state = readState(dir);
	assert.equal(state.pending?.id, PREV);
	assert.equal(state.heldBack, ID);
	assert.ok(state.lastCheck > 0);
});

test('a pending entry without signed is dropped', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const p = fakeInstaller(dir, ID);
	writeStateFile(dir, { pending: { id: ID, path: p, sha256: 'x' }, failures: 0, lastCheck: 0, heldBack: null });
	assert.equal(isStalePending({ id: ID }, OLD), true);
	assert.equal(isStalePending({ id: PREV, rollback: true }, ID), true);
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: ID, mode: 'auto', keys });
	assert.equal(r.status, 'none');
	assert.equal(readState(dir).pending, null);
	assert.equal(fs.existsSync(p), false);
});

test('check reports the release it skipped because of the hold', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	writeStateFile(dir, { pending: null, failures: 0, lastCheck: 0, heldBack: ID });
	const r = await checkForUpdate({ feedUrl: feed.url, dir, current: OLD, mode: 'auto', keys });
	assert.deepEqual(r, { status: 'none', heldBack: ID });
});
