'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../package.json').contributes.configuration.properties;

// Updating is app-wide: a workspace must not be able to turn it off (or each window would
// see its own mode).
test('update mode is an application setting', () => {
	assert.equal(settings['briii.update.mode'].scope, 'application');
});
