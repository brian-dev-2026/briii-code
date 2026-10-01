// The Studio layout puts Claude Code in the right-hand card. Claude Code saves where it was last
// opened in the user's settings ("panel" = an editor tab), so a default alone wouldn't move an
// existing install: this moves it once, and never again, so a later choice is kept.
'use strict';

/**
 * Changes a user value of "panel" to "sidebar", once. Unset or other values are left alone.
 * A failed write isn't marked done, so it is tried again on the next launch.
 * @returns {Promise<boolean>} true when the setting was changed
 */
async function applyStudioOnce({ isDone, markDone, userValue, setUserValue }) {
	if (isDone()) {
		return false;
	}
	let changed = false;
	if (userValue() === 'panel') {
		try {
			await setUserValue('sidebar');
			changed = true;
		} catch {
			return false;
		}
	}
	await markDone();
	return changed;
}

module.exports = { applyStudioOnce };
