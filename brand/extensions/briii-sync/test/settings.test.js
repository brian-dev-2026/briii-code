'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSecretKey, stripSecrets, restoreSecrets } = require('../lib/settings');

test('stripSecrets removes top-level secret keys and keeps comments', () => {
	const r = stripSecrets('{\n  // my font\n  "editor.fontSize": 14,\n  "github.token": "abc",\n}', []);
	assert.match(r.text, /\/\/ my font/);
	assert.match(r.text, /"editor.fontSize": 14/);
	assert.doesNotMatch(r.text, /abc/);
	assert.deepEqual(r.removed, ['github.token']);
});

test('stripSecrets removes secrets nested in objects', () => {
	const text = '{\n\t"rest-client.environmentVariables": {\n\t\t"$shared": {\n\t\t\t"host": "localhost",\n\t\t\t"token": "xyz"\n\t\t}\n\t}\n}';
	const r = stripSecrets(text, []);
	assert.deepEqual(r.removed, ['rest-client.environmentVariables.$shared.token']);
	assert.doesNotMatch(r.text, /xyz/);
	assert.match(r.text, /"host": "localhost"/);
});

test('stripSecrets removes keys listed in ignoredSettings', () => {
	const r = stripSecrets('{ "window.zoomLevel": 2, "editor.tabSize": 4 }', ['window.zoomLevel']);
	assert.deepEqual(r.removed, ['window.zoomLevel']);
	assert.doesNotMatch(r.text, /zoomLevel/);
	assert.match(r.text, /tabSize/);
});

test('restoreSecrets puts local secret values back into the downloaded text', () => {
	const remote = '{\n\t// from the other PC\n\t"editor.fontSize": 16\n}';
	const local = '{\n\t"editor.fontSize": 14,\n\t"github.token": "abc"\n}';
	const out = restoreSecrets(remote, local, []);
	assert.match(out, /\/\/ from the other PC/);
	assert.match(out, /"editor.fontSize": 16/);
	assert.match(out, /"github.token": "abc"/);
	assert.deepEqual(JSON.parse(out.replace(/\/\/.*$/m, '')), { 'editor.fontSize': 16, 'github.token': 'abc' });
});

test('restoreSecrets restores nested secrets', () => {
	const remote = '{ "rest-client.environmentVariables": { "$shared": { "host": "prod" } } }';
	const local = '{ "rest-client.environmentVariables": { "$shared": { "host": "dev", "token": "xyz" } } }';
	const out = JSON.parse(restoreSecrets(remote, local, []));
	assert.deepEqual(out['rest-client.environmentVariables'].$shared, { host: 'prod', token: 'xyz' });
});

test('restoreSecrets drops nothing when local has no secrets', () => {
	const remote = '{\n\t// keep me\n\t"a": 1\n}';
	assert.equal(restoreSecrets(remote, '{ "a": 2 }', []), remote);
});

test('isSecretKey matches secret-looking names only', () => {
	for (const k of ['apiKey', 'api_key', 'openai.api-key', 'myPassword', 'credentials', 'github.token', 'clientSecret']) {
		assert.equal(isSecretKey(k, []), true, k);
	}
	for (const k of ['editor.tabSize', 'workbench.colorTheme', 'files.exclude']) {
		assert.equal(isSecretKey(k, []), false, k);
	}
	assert.equal(isSecretKey('window.zoomLevel', ['window.zoomLevel']), true);
});

test('stripSecrets catches credentials under other names (review: leaks)', () => {
	const text = JSON.stringify({
		'http.proxyAuthorization': 'Basic abc',
		'rest-client.defaultHeaders': { 'User-Agent': 'x', Authorization: 'Bearer t1' },
		'terminal.integrated.env.windows': { OPENAI_KEY: 'sk-1' },
		'claudeCode.environmentVariables': [{ name: 'ANTHROPIC_API_KEY', value: 'sk-ant-2' }, { name: 'DEBUG', value: '1' }],
		'editor.fontSize': 14,
	}, null, '\t');
	const r = stripSecrets(text, []);
	for (const s of ['Basic abc', 'Bearer t1', 'sk-1', 'sk-ant-2']) {
		assert.ok(!r.text.includes(s), `${s} leaked`);
	}
	assert.match(r.text, /"editor.fontSize": 14/);
	assert.match(r.text, /"DEBUG"/);
});

test('stripSecrets leaves out machine-scoped settings passed as ignored keys', () => {
	const r = stripSecrets('{ "git.path": "C:\\\\git\\\\bin\\\\git.exe", "editor.tabSize": 2 }', ['git.path']);
	assert.deepEqual(r.removed, ['git.path']);
});

test('restoreSecrets matches array entries by name, not position', () => {
	const local = JSON.stringify({ 'sqltools.connections': [{ name: 'a', password: 'P1' }, { name: 'b', password: 'P2' }] });
	const reordered = JSON.stringify({ 'sqltools.connections': [{ name: 'b' }, { name: 'a' }] });
	const out = JSON.parse(restoreSecrets(reordered, local, []))['sqltools.connections'];
	assert.deepEqual(out, [{ name: 'b', password: 'P2' }, { name: 'a', password: 'P1' }]);
	const shorter = JSON.stringify({ 'sqltools.connections': [{ name: 'a' }] });
	assert.deepEqual(JSON.parse(restoreSecrets(shorter, local, []))['sqltools.connections'], [{ name: 'a', password: 'P1' }]);
});
