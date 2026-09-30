'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fetchLatest, downloadVerified } = require('../lib/feed');
const { startFeed, tempDir } = require('./helpers');

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
	const file = await downloadVerified(await fetchLatest(feed.url), dir);
	assert.equal(file, path.join(dir, EXE));
	assert.deepEqual(fs.readFileSync(file), feed.bytes);
	assert.equal(feed.hits['/blob'], 1);
});

test('downloadVerified rejects a wrong checksum and leaves nothing behind', async t => {
	const feed = await startFeed({ id: ID, badSha: true });
	t.after(feed.close);
	const dir = tempDir();
	await assert.rejects(downloadVerified(await fetchLatest(feed.url), dir), /checksum mismatch/);
	assert.equal(fs.existsSync(path.join(dir, EXE)), false);
	assert.equal(fs.existsSync(path.join(dir, `${EXE}.part`)), false);
});

test('downloadVerified rejects a truncated download', async t => {
	const feed = await startFeed({ id: ID, truncate: true });
	t.after(feed.close);
	const dir = tempDir();
	await assert.rejects(downloadVerified(await fetchLatest(feed.url), dir));
	assert.equal(fs.existsSync(path.join(dir, EXE)), false);
});

test('downloadVerified removes older installers from the folder', async t => {
	const feed = await startFeed({ id: ID });
	t.after(feed.close);
	const dir = tempDir();
	fs.writeFileSync(path.join(dir, '1.135.06055-20260901.1.exe'), 'old');
	fs.writeFileSync(path.join(dir, 'stale.exe.part'), 'old');
	await downloadVerified(await fetchLatest(feed.url), dir);
	assert.deepEqual(fs.readdirSync(dir).filter(f => /\.(exe|part)$/.test(f)), [EXE]);
});

test('fetchLatest returns null when the release has no installer asset', async t => {
	const http = require('http');
	const server = http.createServer((req, res) => res.end(JSON.stringify({ tag_name: `v${ID}`, assets: [] })));
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	t.after(() => server.close());
	assert.equal(await fetchLatest(`http://127.0.0.1:${server.address().port}/latest`), null);
});
