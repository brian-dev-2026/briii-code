// User-facing update messages that depend on the update mode.
'use strict';

/** The "update ready" text: only auto mode installs on close. */
function readyMessage(mode, id) {
	return mode === 'auto'
		? `Briii Code ${id} is ready. It installs when you close Briii Code.`
		: `Briii Code ${id} is ready. Choose Install Now to restart and update.`;
}

module.exports = { readyMessage };