'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../package.json').contributes.configuration.properties;

// The command runs through a shell. If a cloned repo's .vscode/settings.json could set it,
// pressing Deploy in that folder would run whatever the repo chose. VS Code ignores
// workspace values of machine-scoped settings.
test('vercelCommand cannot be set by a workspace', () => {
	assert.equal(settings['briiiDeploy.vercelCommand'].scope, 'machine');
});
