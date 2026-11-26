'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchLatest, fetchPrevious, downloadVerified } = require('../lib/feed');
const { startFeed, tempDir, TEST_KEYS } = require('./helpers');

const keys = [TEST_KEYS.publicKey];

const ID = '1.135.06055-20261001.14';
const EXE = `${ID}.exe`;

test('fetchLatest maps a GitHub release to id and asset URLs', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const r = await fetchLatest(feed.url);
	assert.equal(r.id, ID);
	assert.match(r.installerUrl, /BriiiCode-Setup-x64-1\.135\.06055-20261001\.14\.exe$/);
	assert.match(r.shaUrl, /\.exe\.sha256$/);
	assert.match(r.pageUrl, /\/page$/);
});

test('downloadVerified follows redirects and verifies the checksum', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	const file = await downloadVerified(await fetchLatest(feed.url), dir, { keys });
	assert.equal(file, path.join(dir, EXE));
	assert.deepEqual(fs.readFileSync(file), feed.bytes);
	assert.equal(feed.hits['/blob'], 1);
});

test('downloadVerified rejects a wrong checksum and leaves nothing behind', async t => {
	const feed = await startFeed({ id: ID, badSha: true });
	t.after(feed.close);
	const dir = tempDir();
	await assert.rejects(downloadVerified(await fetchLatest(feed.url), dir, { keys }), /checksum mismatch/);
	assert.equal(fs.existsSync(path.join(dir, EXE)), false);
	assert.equal(fs.existsSync(path.join(dir, `${EXE}.part`)), false);
});

test('downloadVerified rejects a truncated download', async t => {
	const feed = await startFeed({ id: ID, truncate: true });
	t.after(feed.close);
	const dir = tempDir();
	await assert.rejects(downloadVerified(await fetchLatest(feed.url), dir, { keys }));
	assert.equal(fs.existsSync(path.join(dir, EXE)), false);
});

test('downloadVerified removes older installers from the folder', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	fs.writeFileSync(path.join(dir, '1.135.06055-20260901.1.exe'), 'old');
	fs.writeFileSync(path.join(dir, 'stale.exe.part'), 'old');
	await downloadVerified(await fetchLatest(feed.url), dir, { keys });
	assert.deepEqual(fs.readdirSync(dir).filter(f => /\.(exe|part)$/.test(f)), [EXE]);
});

test('fetchLatest returns null when the release has no installer asset', async t => {
	const http = require('http');
	const server = http.createServer((req, res) => res.end(JSON.stringify({ tag_name: `v${ID}`, assets: [] })));
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	t.after(() => server.close());
	assert.equal(await fetchLatest(`http://127.0.0.1:${server.address().port}/latest`), null);
});

test('downloadVerified leaves another in-flight download of the same release alone', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	fs.writeFileSync(path.join(dir, `${ID}.99999.part`), 'another window');
	fs.writeFileSync(path.join(dir, '1.135.06055-20260901.1.exe'), 'older');
	await downloadVerified(await fetchLatest(feed.url), dir, { keys });
	assert.equal(fs.existsSync(path.join(dir, `${ID}.99999.part`)), true);
	assert.equal(fs.existsSync(path.join(dir, '1.135.06055-20260901.1.exe')), false);
});

test('downloadVerified gives up on a stalled download', async t => {
	const feed = await startFeed({ id: ID, stall: true });
	t.after(feed.close);
	const dir = tempDir();
	await assert.rejects(downloadVerified(await fetchLatest(feed.url), dir, { timeoutMs: 300, keys }));
	assert.equal(fs.readdirSync(dir).length, 0);
});

test('fetchLatest returns null when the release has no signature asset', async t => {
	const feed = await startFeed({ id: ID, unsigned: true });
	t.after(feed.close);
	assert.equal(await fetchLatest(feed.url), null);
});

test('downloadVerified rejects a bad signature and leaves nothing behind', async t => {
	const feed = await startFeed({ id: ID, badSig: true });
	t.after(feed.close);
	const dir = tempDir();
	await assert.rejects(downloadVerified(await fetchLatest(feed.url), dir, { keys }), /signature check failed/);
	assert.deepEqual(fs.readdirSync(dir).filter(f => /.(exe|part)$/.test(f)), []);
	assert.equal(feed.hits['/blob'], undefined);
});

test('downloadVerified rejects a feed signed by an unknown key', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
	const dir = tempDir();
	await assert.rejects(downloadVerified(await fetchLatest(feed.url), dir, { keys: [other] }), /no valid signature/);
	assert.equal(feed.hits['/blob'], undefined);
});

test('fetchPrevious picks the newest older signed release', async t => {
	const feed = await startFeed({ id: '1.135.06055-20261126.0088', releases: ['1.135.06055-20261126.0087', '1.135.06055-20261126.0081', '1.135.06055-20261126.0090'] });
	t.after(feed.close);
	const r = await fetchPrevious(feed.listUrl, '1.135.06055-20261126.0088');
	assert.equal(r.id, '1.135.06055-20261126.0087');
	assert.match(r.sigUrl, /.exe.sha256.sig$/);
});

test('fetchPrevious skips releases whose tag is not a Briii id', async t => {
	const feed = await startFeed({ id: 'vjunk', releases: ['1.143.17232-local', '1.135.06055-20261126.0081'] });
	t.after(feed.close);
	const r = await fetchPrevious(feed.listUrl, '1.135.06055-20261126.0088');
	assert.equal(r.id, '1.135.06055-20261126.0081');
});

test('fetchPrevious returns null when nothing older is listed', async t => {
	const feed = await startFeed({ id: '1.135.06055-20261126.0090', releases: ['1.135.06055-20261126.0088'] });
	t.after(feed.close);
	assert.equal(await fetchPrevious(feed.listUrl, '1.135.06055-20261126.0088'), null);
});
