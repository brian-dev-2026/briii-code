// Extensions that can't be bundled (licences) are installed from Open VSX on first launch.
'use strict';

/**
 * Installs each id that is neither installed nor already done. An id counts as done once it has
 * been installed (by us or the user), so an extension the user later uninstalls stays uninstalled.
 * Failed installs are left for the next launch.
 * @returns {Promise<string[]>} the ids installed now
 */
async function run({ ids, isInstalled, install, done, markDone }) {
	const installed = [];
	for (const id of ids) {
		if (done.has(id)) {
			continue;
		}
		if (isInstalled(id)) {
			markDone(id);
			continue;
		}
		try {
			await install(id);
			markDone(id);
			installed.push(id);
		} catch {
			// offline or Open VSX unavailable: retried on the next launch
		}
	}
	return installed;
}

module.exports = { run };
