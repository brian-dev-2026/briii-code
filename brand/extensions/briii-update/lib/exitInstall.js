// Whether closing Briii Code should start the installer for a downloaded update.
'use strict';

const { isNewer, isOlder } = require('./version');

/**
 * Auto mode installs on every close (until it has failed MAX_FAILURES times in a row). Install
 * Now asks for the install explicitly, so it also counts for notify mode (local builds, or the
 * setting) and after failures: if its quit was cancelled, the next close still installs.
 * Updates switched off never install. A rollback installer is older than the running build by design,
 * and it exists only because the user confirmed Install Previous Version, so it installs on close in
 * every mode (until it has failed MAX_FAILURES times in a row).
 */
function shouldInstallOnExit({ pendingId, current, installerExists, mode, failures, maxFailures, mayRunInstaller, installRequested, rollback }) {
	const versionOk = rollback ? isOlder(pendingId, current) : isNewer(pendingId, current);
	if (rollback && pendingId && versionOk && installerExists && mayRunInstaller && failures < maxFailures) {
		return true;
	}
	if (!pendingId || !versionOk || !installerExists || !mayRunInstaller || mode === 'off') {
		return false;
	}
	if (installRequested) {
		return true;
	}
	return mode === 'auto' && failures < maxFailures;
}

module.exports = { shouldInstallOnExit };
