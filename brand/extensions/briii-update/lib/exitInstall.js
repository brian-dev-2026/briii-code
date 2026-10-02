// Whether closing Briii Code should start the installer for a downloaded update.
'use strict';

const { isNewer } = require('./version');

/**
 * Auto mode installs on every close (until it has failed MAX_FAILURES times in a row). Install
 * Now asks for the install explicitly, so it also counts for notify mode (local builds, or the
 * setting) and after failures: if its quit was cancelled, the next close still installs.
 * Updates switched off never install.
 */
function shouldInstallOnExit({ pendingId, current, installerExists, mode, failures, maxFailures, mayRunInstaller, installRequested }) {
	if (!pendingId || !isNewer(pendingId, current) || !installerExists || !mayRunInstaller || mode === 'off') {
		return false;
	}
	if (installRequested) {
		return true;
	}
	return mode === 'auto' && failures < maxFailures;
}

module.exports = { shouldInstallOnExit };
