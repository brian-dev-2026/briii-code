// One update check: is there a newer release, and if so, make sure a verified installer is ready.
'use strict';

const fs = require('fs');
const { fetchLatest, fetchPrevious, downloadVerified, hashFile } = require('./feed');
const { readState, writeState } = require('./state');
const { isNewer, isOlder } = require('./version');

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

async function check({ feedUrl, dir, current, keys }) {
	const state = readState(dir);
	try {
		// A pending installer that no longer fits (the app was updated or rolled back by hand) must never run.
		if (state.pending && isStalePending(state.pending, current)) {
			fs.rmSync(state.pending.path, { force: true });
			state.pending = null;
			state.failures = 0;
			writeState(dir, state);
		}
		if (state.heldBack && isOlder(state.heldBack, current)) {
			state.heldBack = null; // the running build is already past the hold
		}
		state.feed = state.feed || {};
		const latest = await fetchLatest(feedUrl, state.feed);
		state.lastCheck = Date.now();
		if (!latest || !isNewer(latest.id, current)) {
			writeState(dir, state);
			return { status: 'none' };
		}
		if (state.heldBack && !isNewer(latest.id, state.heldBack)) {
			writeState(dir, state); // the user rolled back from this release (or an older one)
			return { status: 'none' };
		}
		const reuse = state.pending && state.pending.id === latest.id && fs.existsSync(state.pending.path) &&
			await hashFile(state.pending.path) === state.pending.sha256;
		if (!reuse) {
			const file = await downloadVerified(latest, dir, keys ? { keys } : {});
			state.pending = { id: latest.id, path: file, sha256: await hashFile(file) };
			state.failures = 0;
		}
		state.heldBack = null; // a release newer than the held one is ready
		writeState(dir, state);
		return { status: 'ready', id: latest.id, pageUrl: latest.pageUrl };
	} catch (err) {
		return { status: 'failed', error: String(err && err.message || err) };
	}
}

/** A pending installer that must never run: not newer than the running build, or (rollback) not older. */
function isStalePending(pending, current) {
	return pending.rollback ? !isOlder(pending.id, current) : !isNewer(pending.id, current);
}

/**
 * Prepares the newest release older than `current` as a pending rollback installer, replacing any
 * pending update, and holds `current` back so the updater doesn't offer it again. Shares the
 * in-flight run with checkForUpdate for the same folder.
 * @returns {Promise<{ status: 'none' } | { status: 'ready', id: string } | { status: 'failed', error: string }>}
 */
function prepareRollback(args) {
	const wait = inflight.get(args.dir) || Promise.resolve();
	const run = wait.catch(() => { }).then(() => rollback(args)).finally(() => {
		if (inflight.get(args.dir) === run) {
			inflight.delete(args.dir);
		}
	});
	inflight.set(args.dir, run);
	return run;
}

async function rollback({ listUrl, dir, current, keys }) {
	try {
		const previous = await fetchPrevious(listUrl, current);
		if (!previous) {
			return { status: 'none' };
		}
		const state = readState(dir);
		const file = await downloadVerified(previous, dir, keys ? { keys } : {}); // also removes other installers
		state.pending = { id: previous.id, path: file, sha256: await hashFile(file), rollback: true };
		state.failures = 0;
		state.heldBack = current;
		writeState(dir, state);
		return { status: 'ready', id: previous.id };
	} catch (err) {
		return { status: 'failed', error: String(err && err.message || err) };
	}
}

module.exports = { checkForUpdate, prepareRollback, isStalePending };
