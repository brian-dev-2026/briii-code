'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSnapshot, applyChanges, localPath } = require('../lib/files');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'briii-sync-test-'));

test('readSnapshot maps snippets to snippets__ names and skips other files', () => {
	const user = tempDir();
	fs.writeFileSync(path.join(user, 'settings.json'), '{ "a": 1 }');
	fs.writeFileSync(path.join(user, 'keybindings.json'), '[]');
	fs.writeFileSync(path.join(user, 'tasks.json'), '{}');
	fs.mkdirSync(path.join(user, 'snippets'));
	fs.writeFileSync(path.join(user, 'snippets', 'js.json'), '{}');
	fs.writeFileSync(path.join(user, 'snippets', 'my.code-snippets'), '{ "x": {} }');
	fs.writeFileSync(path.join(user, 'snippets', 'notes.txt'), 'no');
	assert.deepEqual(readSnapshot(user).files, {
		'settings.json': '{ "a": 1 }',
		'keybindings.json': '[]',
		'snippets__js.json': '{}',
		'snippets__my.code-snippets': '{ "x": {} }',
	});
});

test('readSnapshot on a fresh profile returns only what exists', () => {
	assert.deepEqual(readSnapshot(tempDir()), { files: {} });
});

test('localPath maps gist names back to the user folder', () => {
	assert.equal(localPath('C:\\u', 'snippets__js.json'), path.join('C:\\u', 'snippets', 'js.json'));
	assert.equal(localPath('C:\\u', 'settings.json'), path.join('C:\\u', 'settings.json'));
});

test('applyChanges creates missing files and the snippets folder', () => {
	const user = tempDir();
	applyChanges(user, tempDir(), [
		{ name: 'keybindings.json', content: '[{ "key": "f1" }]' },
		{ name: 'snippets__js.json', content: '{ "log": {} }' },
	]);
	assert.equal(fs.readFileSync(path.join(user, 'keybindings.json'), 'utf8'), '[{ "key": "f1" }]');
	assert.equal(fs.readFileSync(path.join(user, 'snippets', 'js.json'), 'utf8'), '{ "log": {} }');
});

test('applyChanges backs up touched files first', () => {
	const user = tempDir();
	const backups = tempDir();
	fs.writeFileSync(path.join(user, 'settings.json'), 'old');
	const { backup } = applyChanges(user, backups, [{ name: 'settings.json', content: 'new' }]);
	assert.equal(fs.readFileSync(path.join(backup, 'settings.json'), 'utf8'), 'old');
	assert.equal(path.dirname(backup), backups);
	assert.equal(fs.readFileSync(path.join(user, 'settings.json'), 'utf8'), 'new');
});

test('applyChanges deletes a snippet for content null', () => {
	const user = tempDir();
	fs.mkdirSync(path.join(user, 'snippets'));
	fs.writeFileSync(path.join(user, 'snippets', 'old.json'), '{}');
	applyChanges(user, tempDir(), [{ name: 'snippets__old.json', content: null }]);
	assert.equal(fs.existsSync(path.join(user, 'snippets', 'old.json')), false);
});

test('applyChanges restores the file when a write fails', () => {
	const user = tempDir();
	fs.writeFileSync(path.join(user, 'settings.json'), 'old settings');
	fs.mkdirSync(path.join(user, 'keybindings.json')); // a folder where the file should go: the write fails
	assert.throws(() => applyChanges(user, tempDir(), [
		{ name: 'settings.json', content: 'new settings' },
		{ name: 'keybindings.json', content: '[]' },
	]), /keybindings\.json/);
	assert.equal(fs.readFileSync(path.join(user, 'settings.json'), 'utf8'), 'old settings');
});

test('applyChanges keeps the newest 10 backups', () => {
	const user = tempDir();
	const backups = tempDir();
	for (let i = 0; i < 12; i++) {
		applyChanges(user, backups, [{ name: 'settings.json', content: `v${i}` }]);
	}
	assert.equal(fs.readdirSync(backups).length, 10);
});

test('applyChanges puts back a file whose write fails halfway (review)', () => {
	const user = tempDir();
	fs.writeFileSync(path.join(user, 'settings.json'), 'old settings');
	fs.writeFileSync(path.join(user, 'keybindings.json'), 'old keys');
	const halfway = (file, content) => {
		if (file.endsWith('keybindings.json')) {
			fs.writeFileSync(file, '');
			throw new Error('disk full');
		}
		fs.writeFileSync(file, content);
	};
	assert.throws(() => applyChanges(user, tempDir(), [
		{ name: 'settings.json', content: 'new settings' },
		{ name: 'keybindings.json', content: 'new keys' },
	], { write: halfway }), /keybindings\.json/);
	assert.equal(fs.readFileSync(path.join(user, 'keybindings.json'), 'utf8'), 'old keys');
	assert.equal(fs.readFileSync(path.join(user, 'settings.json'), 'utf8'), 'old settings');
});
