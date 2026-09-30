'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planDown, planUp, isConflict, sameText } = require('../lib/plan');

const byName = items => Object.fromEntries(items.map(i => [i.name, i]));

test('planDown lists changed, new and removed files (removed ones unpicked)', () => {
	const { items } = planDown({
		local: { 'keybindings.json': '[]', 'snippets__old.json': '{}', 'snippets__same.json': '{ "s": 1 }' },
		remote: { 'keybindings.json': '[{ "key": "f1" }]', 'snippets__new.json': '{}', 'snippets__same.json': '{ "s": 1 }', 'meta.json': '{}' },
		localExtensions: [],
		ignored: [],
	});
	const m = byName(items);
	assert.deepEqual(Object.keys(m).sort(), ['keybindings.json', 'snippets__new.json', 'snippets__old.json']);
	assert.equal(m['keybindings.json'].kind, 'changed');
	assert.equal(m['keybindings.json'].picked, true);
	assert.equal(m['snippets__new.json'].kind, 'new');
	assert.equal(m['snippets__old.json'].kind, 'removed');
	assert.equal(m['snippets__old.json'].content, null);
	assert.equal(m['snippets__old.json'].picked, false);
});

test('planDown keeps local secrets in settings', () => {
	const { items } = planDown({
		local: { 'settings.json': '{ "editor.fontSize": 14, "github.token": "abc" }' },
		remote: { 'settings.json': '{ "editor.fontSize": 16 }' },
		localExtensions: [],
		ignored: [],
	});
	assert.equal(items.length, 1);
	assert.deepEqual(JSON.parse(items[0].content), { 'editor.fontSize': 16, 'github.token': 'abc' });
});

test('planDown sees no difference when only the secrets differ', () => {
	const { items } = planDown({
		local: { 'settings.json': '{ "editor.fontSize": 14, "github.token": "abc" }' },
		remote: { 'settings.json': '{ "editor.fontSize": 14 }' },
		localExtensions: [],
		ignored: [],
	});
	assert.deepEqual(items, []);
});

test('planDown marks invalid JSON as invalid and unpicked', () => {
	const { items } = planDown({
		local: {},
		remote: { 'settings.json': '{ "a": ', 'extensions.json': 'nope' },
		localExtensions: [],
		ignored: [],
	});
	const m = byName(items);
	assert.equal(m['settings.json'].kind, 'invalid');
	assert.equal(m['settings.json'].picked, false);
	assert.equal(m['extensions.json'].kind, 'invalid');
});

test('planDown lists extensions to install and never uninstalls', () => {
	const r = planDown({
		local: {},
		remote: { 'extensions.json': JSON.stringify([{ id: 'eamodio.gitlens' }, { id: 'Vue.volar' }]) },
		localExtensions: ['vue.volar', 'only.local'],
		ignored: [],
	});
	assert.deepEqual(r.extensions, ['eamodio.gitlens']);
	assert.deepEqual(r.items, []);
});

test('planDown returns nothing when only line endings differ', () => {
	const { items } = planDown({
		local: { 'keybindings.json': '[\r\n  { "key": "f1" }\r\n]\r\n' },
		remote: { 'keybindings.json': '[\n  { "key": "f1" }\n]' },
		localExtensions: [],
		ignored: [],
	});
	assert.deepEqual(items, []);
});

const meta = { machine: 'PC-A', time: '2026-10-01T10:00:00.000Z', briiiRelease: '1.135.06055-20261001.1', format: 1 };

test('planUp sends only changed files and deletes removed snippets', () => {
	const { patch } = planUp({
		local: { 'keybindings.json': '[]', 'snippets__a.json': '{ "new": 1 }' },
		remote: { 'keybindings.json': '[]', 'snippets__a.json': '{}', 'snippets__gone.json': '{}', 'extensions.json': '[]' },
		localExtensions: [],
		ignored: [],
		meta,
	});
	assert.deepEqual(Object.keys(patch).sort(), ['meta.json', 'snippets__a.json', 'snippets__gone.json']);
	assert.equal(patch['snippets__gone.json'], null);
});

test('planUp sends nothing when nothing changed', () => {
	const { patch } = planUp({
		local: { 'keybindings.json': '[]' },
		remote: { 'keybindings.json': '[]\n', 'extensions.json': '[]', 'meta.json': '{}' },
		localExtensions: [],
		ignored: [],
		meta,
	});
	assert.deepEqual(patch, {});
});

test('planUp leaves secrets out and reports them', () => {
	const r = planUp({
		local: { 'settings.json': '{\n\t// mine\n\t"a": 1,\n\t"x.apiKey": "k"\n}' },
		remote: {},
		localExtensions: [],
		ignored: [],
		meta,
	});
	assert.doesNotMatch(r.patch['settings.json'], /"k"/);
	assert.match(r.patch['settings.json'], /\/\/ mine/);
	assert.deepEqual(r.removedSecrets, ['x.apiKey']);
});

test('planUp writes sorted extensions.json and meta.json', () => {
	const { patch } = planUp({ local: {}, remote: {}, localExtensions: ['vue.volar', 'anthropic.claude-code'], ignored: [], meta });
	assert.deepEqual(JSON.parse(patch['extensions.json']), [{ id: 'anthropic.claude-code' }, { id: 'vue.volar' }]);
	assert.deepEqual(JSON.parse(patch['meta.json']), meta);
});

test('isConflict: another machine wrote a version we never saw', () => {
	assert.equal(isConflict({ lastVersion: 'v1', remoteVersion: 'v2', remoteMachine: 'PC-B', machine: 'PC-A' }), true);
});

test('isConflict: our own last version is not a conflict', () => {
	assert.equal(isConflict({ lastVersion: 'v2', remoteVersion: 'v2', remoteMachine: 'PC-B', machine: 'PC-A' }), false);
	assert.equal(isConflict({ lastVersion: 'v1', remoteVersion: 'v2', remoteMachine: 'PC-A', machine: 'PC-A' }), false);
});

test("isConflict: a second PC's first Sync Up onto an existing gist is a conflict", () => {
	assert.equal(isConflict({ lastVersion: undefined, remoteVersion: 'v5', remoteMachine: 'PC-B', machine: 'PC-A' }), true);
});

test('isConflict: no gist yet is not a conflict', () => {
	assert.equal(isConflict({ lastVersion: undefined, remoteVersion: undefined, remoteMachine: undefined, machine: 'PC-A' }), false);
});

test('sameText ignores CRLF and a trailing newline only', () => {
	assert.equal(sameText('a\r\nb\r\n', 'a\nb'), true);
	assert.equal(sameText('a b', 'a  b'), false);
	assert.equal(sameText(undefined, 'a'), false);
});

test('sameContent ignores whitespace and trailing commas but not comments or values', () => {
	const { sameContent } = require('../lib/plan');
	assert.equal(sameContent('{ "a": 1, }', '{\n    "a": 1\n}'), true);
	assert.equal(sameContent('{ "a": 1 }', '{ "a": 2 }'), false);
	assert.equal(sameContent('{ // note\n "a": 1 }', '{ "a": 1 }'), false);
	assert.equal(sameContent(undefined, '{}'), false);
});
