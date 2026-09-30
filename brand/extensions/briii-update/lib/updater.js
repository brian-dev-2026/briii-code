// One update check: is there a newer release, and if so, make sure a verified installer is ready.
'use strict';

const fs = require('fs');
const { fetchLatest, downloadVerified, hashFile } = require('./feed');
const { readState, writeState } = require('./state');
const { isNewer } = require('./version');

/**
 * Overlapping calls for the same folder (a timer and a manual check) share one run.
 * @returns {Promise<{ status: 'off'|'none'|'ready'|'failed', id?: string, pageUrl?: string, error?: string }>}
 */
function checkForUpdate(args) {
	if (args.mode === 'off') {
		return Promise.resolve({ status: 'off' });
	}
	if (!inflight.has(args.dir)) {
		inflight.set(args.dir, check(args).finally(() => inflight.delete(args.dir)));
	}
	return inflight.get(args.dir);
}

const inflight = new Map();

async function check({ feedUrl, dir, current }) {
	const state = readState(dir);
	try {
		// A pending installer that isn't newer (the app was updated by hand) must never run.
		if (state.pending && !isNewer(state.pending.id, current)) {
			fs.rmSync(state.pending.path, { force: true });
			state.pending = null;
			state.failures = 0;
			writeState(dir, state);
		}
		state.feed = state.feed || {};
		const latest = await fetchLatest(feedUrl, state.feed);
		state.lastCheck = Date.now();
		if (!latest || !isNewer(latest.id, current)) {
			writeState(dir, state);
			return { status: 'none' };
		}
		const reuse = state.pending && state.pending.id === latest.id && fs.existsSync(state.pending.path) &&
			await hashFile(state.pending.path) === state.pending.sha256;
		if (!reuse) {
			const file = await downloadVerified(latest, dir);
			state.pending = { id: latest.id, path: file, sha256: await hashFile(file) };
			state.failures = 0;
		}
		writeState(dir, state);
		return { status: 'ready', id: latest.id, pageUrl: latest.pageUrl };
	} catch (err) {
		return { status: 'failed', error: String(err && err.message || err) };
	}
}

module.exports = { checkForUpdate };
