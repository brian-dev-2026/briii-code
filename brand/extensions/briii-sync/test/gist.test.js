'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findGist, createGist, getGist, updateGist, GistError, DESCRIPTION } = require('../lib/gist');
const { startFakeGist } = require('./fakeGist');

const others = n => Array.from({ length: n }, (_, i) => ({ description: `other ${i}`, files: { 'a.txt': 'x' } }));

test('findGist finds the Briii gist on page 2', async t => {
	const fake = await startFakeGist({ gists: [...others(150), { description: DESCRIPTION, files: { 'meta.json': '{}' } }] });
	t.after(fake.close);
	const g = await findGist({ base: fake.base, token: fake.token });
	assert.equal(g.id, 'g151');
	assert.ok(g.version);
	assert.match(g.htmlUrl, /\/gist\/g151$/);
	assert.ok(fake.hits.some(h => /page=2/.test(h)));
});

test('findGist returns null when there is none', async t => {
	const fake = await startFakeGist({ gists: others(3) });
	t.after(fake.close);
	assert.equal(await findGist({ base: fake.base, token: fake.token }), null);
});

test('createGist creates a secret gist with the description', async t => {
	const fake = await startFakeGist();
	t.after(fake.close);
	const g = await createGist({ base: fake.base, token: fake.token }, { 'settings.json': '{}' });
	assert.equal(fake.state.created[0].public, false);
	assert.equal(fake.state.created[0].description, 'Briii Code settings');
	assert.equal(fake.state.gists.get(g.id).files['settings.json'], '{}');
	assert.ok(g.version);
});

test('getGist follows raw_url for truncated files', async t => {
	const fake = await startFakeGist({ gists: [{ description: DESCRIPTION, files: { 'settings.json': '{ "long": "content here" }' } }], truncate: ['settings.json'] });
	t.after(fake.close);
	const g = await getGist({ base: fake.base, token: fake.token }, 'g1');
	assert.equal(g.files['settings.json'], '{ "long": "content here" }');
});

test('updateGist deletes files set to null and returns the new version', async t => {
	const fake = await startFakeGist({ gists: [{ description: DESCRIPTION, files: { 'snippets__old.json': '{}', 'settings.json': '{}' } }] });
	t.after(fake.close);
	const before = (await getGist({ base: fake.base, token: fake.token }, 'g1')).version;
	const g = await updateGist({ base: fake.base, token: fake.token }, 'g1', { 'snippets__old.json': null, 'settings.json': '{ "a": 1 }' });
	assert.deepEqual(fake.state.gists.get('g1').files, { 'settings.json': '{ "a": 1 }' });
	assert.notEqual(g.version, before);
});

test('a wrong token is a 401 GistError asking to sign in again', async t => {
	const fake = await startFakeGist();
	t.after(fake.close);
	await assert.rejects(findGist({ base: fake.base, token: 'wrong' }), e => e instanceof GistError && e.status === 401 && /sign in again/i.test(e.message));
});

test('a 403 rate limit names the reset time', async t => {
	const fake = await startFakeGist({ rateLimited: true });
	t.after(fake.close);
	await assert.rejects(findGist({ base: fake.base, token: fake.token }), e => e.status === 403 && /rate limit/i.test(e.message) && /\d{1,2}:\d{2}/.test(e.message));
});

test('a stalled server times out', async t => {
	const fake = await startFakeGist({ stall: true });
	t.after(fake.close);
	await assert.rejects(findGist({ base: fake.base, token: fake.token, timeoutMs: 300 }), /timed out|abort/i);
});
