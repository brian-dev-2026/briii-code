'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../package.json').contributes.configuration.properties;

// Startup sync acts on user settings, once per app: a workspace must not switch it to "pull".
test('onStartup is an application setting', () => {
	assert.equal(settings['briii.sync.onStartup'].scope, 'application');
});
