'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CodeArea } = require('../lib/codeArea');

test('closing the last file hides the code area', () => {
	const a = new CodeArea(2);
	assert.equal(a.tabsChanged(1, true), null);
	assert.equal(a.tabsChanged(0, true), 'toggle');
});

test('nothing happens when the setting is off', () => {
	const a = new CodeArea(1);
	assert.equal(a.tabsChanged(0, false), null);
});

test('an area that is already hidden (Ctrl+Alt+W with files open) is not toggled back on', () => {
	const a = new CodeArea(2);
	assert.equal(a.toggle(), 'toggle');           // hidden by hand while files are open
	assert.equal(a.tabsChanged(0, true), null);  // closing them must not show it again
});

test('opening a file counts as shown (VS Code brings the area back by itself)', () => {
	const a = new CodeArea(1);
	assert.equal(a.tabsChanged(0, true), 'toggle');
	assert.equal(a.tabsChanged(1, true), null);
	assert.equal(a.tabsChanged(0, true), 'toggle');
});

test('starting with no files leaves the area alone (its restored state is unknown)', () => {
	const a = new CodeArea(0);
	assert.equal(a.tabsChanged(0, true), null);
});

test('Ctrl+Alt+W after an automatic hide shows the area, and the next close hides it again', () => {
	const a = new CodeArea(1);
	a.tabsChanged(0, true);
	assert.equal(a.toggle(), 'toggle');           // shown by hand, still no files
	assert.equal(a.tabsChanged(1, true), null);
	assert.equal(a.tabsChanged(0, true), 'toggle');
});
