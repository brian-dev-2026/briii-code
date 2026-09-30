// One update check: is there a newer release, and if so, make sure a verified installer is ready.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { fetchLatest, downloadVerified } = require('./feed');
const { readState, writeState } = require('./state');
const { isNewer } = require('./version');

/**
 * @returns {Promise<{ status: 'off'|'none'|'ready'|'failed', id?: string, pageUrl?: string, error?: string }>}
 */
async function checkForUpdate({ feedUrl, dir, current, mode }) {
	if (mode === 'off') {
		return { status: 'off' };
	}
	const state = readState(dir);
	try {
		const latest = await fetchLatest(feedUrl);
		state.lastCheck = Date.now();
		if (!latest || !isNewer(latest.id, current)) {
			writeState(dir, state);
			return { status: 'none' };
		}
		const reuse = state.pending && state.pending.id === latest.id && fs.existsSync(state.pending.path);
		if (!reuse) {
			const file = await downloadVerified(latest, dir);
			const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
			state.pending = { id: latest.id, path: file, sha256 };
			state.failures = 0;
		}
		writeState(dir, state);
		return { status: 'ready', id: latest.id, pageUrl: latest.pageUrl };
	} catch (err) {
		return { status: 'failed', error: String(err && err.message || err) };
	}
}

module.exports = { checkForUpdate };
