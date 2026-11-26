// One update check: is there a newer release, and if so, make sure a verified installer is ready.
'use strict';

const fs = require('fs');
const { fetchLatest, fetchPrevious, downloadVerified, hashFile } = require('./feed');
const { readState, writeState } = require('./state');
const { isNewer, isOlder } = require('./version');

/**
 * Overlapping calls for the same folder (a timer and a manual check) share one run.
 * @returns {Promise<{ status: 'off'|'none'|'ready'|'failed', id?: string, heldBack?: string, pageUrl?: string, error?: string }>}
 */
function checkForUpdate(args) {
	if (args.mode === 'off') {
		return Promise.resolve({ status: 'off' });
	}
	const running = inflight.get(args.dir);
	if (running && running.kind === 'check') {
		return running.promise;
	}
	// A running rollback is waited for, never shared: its result isn't a check's.
	const wait = running ? running.promise.catch(() => { }) : Promise.resolve();
	return enqueue(args.dir, 'check', wait.then(() => check(args)));
}

/** In-flight work per folder: { kind: 'check' | 'rollback', promise }. Each run removes only its own entry. */
const inflight = new Map();

function enqueue(dir, kind, work) {
	const promise = work.finally(() => {
		const entry = inflight.get(dir);
		if (entry && entry.promise === promise) {
			inflight.delete(dir);
		}
	});
	inflight.set(dir, { kind, promise });
	return promise;
}

/**
 * Drops, from `state`, a pending installer that no longer fits (the app was updated or rolled back
 * by hand, or it predates signing) and a hold the running build is already past. True if it changed.
 */
function normalize(state, current) {
	let changed = false;
	if (state.pending && isStalePending(state.pending, current)) {
		fs.rmSync(state.pending.path, { force: true });
		state.pending = null;
		state.failures = 0;
		changed = true;
	}
	if (state.heldBack && isOlder(state.heldBack, current)) {
		state.heldBack = null; // the running build is already past the hold
		changed = true;
	}
	return changed;
}

async function check({ feedUrl, dir, current, keys }) {
	try {
		// Another window may write state.json while this check waits on the network, so every write
		// re-reads it and applies only this check's own changes.
		const early = readState(dir);
		if (normalize(early, current)) {
			writeState(dir, early);
		}
		const feed = early.feed || {};
		const latest = await fetchLatest(feedUrl, feed);
		const state = readState(dir);
		normalize(state, current);
		const commit = change => {
			state.lastCheck = Date.now();
			state.feed = feed;
			if (change) {
				change(state);
			}
			writeState(dir, state);
		};
		if (!latest || !isNewer(latest.id, current)) {
			commit();
			return { status: 'none' };
		}
		if (state.heldBack && !isNewer(latest.id, state.heldBack)) {
			commit(); // the user rolled back from this release (or an older one)
			return { status: 'none', heldBack: latest.id };
		}
		const reuse = state.pending && state.pending.id === latest.id && fs.existsSync(state.pending.path) &&
			await hashFile(state.pending.path) === state.pending.sha256;
		let downloaded;
		if (!reuse) {
			const file = await downloadVerified(latest, dir, keys ? { keys } : {});
			downloaded = { id: latest.id, path: file, sha256: await hashFile(file), signed: true };
		}
		// Re-read again: the download took a while.
		Object.assign(state, readState(dir));
		normalize(state, current);
		commit(st => {
			if (downloaded) {
				st.pending = downloaded;
				st.failures = 0;
			}
			st.heldBack = null; // a release newer than the held one is ready
		});
		return { status: 'ready', id: latest.id, pageUrl: latest.pageUrl };
	} catch (err) {
		return { status: 'failed', error: String(err && err.message || err) };
	}
}

/** A pending installer that must never run: not newer than the running build, or (rollback) not older, or not marked signed. */
function isStalePending(pending, current) {
	if (!pending.signed) {
		return true; // written by the updater before releases were signed
	}
	return pending.rollback ? !isOlder(pending.id, current) : !isNewer(pending.id, current);
}

/**
 * Prepares the newest release older than `current` as a pending rollback installer, replacing any
 * pending update, and holds `current` back so the updater doesn't offer it again. Shares the
 * in-flight run with checkForUpdate for the same folder. `confirm(release)`, when given, is asked
 * after the release is found and before anything is downloaded or written; a falsy answer cancels.
 * @returns {Promise<{ status: 'none' } | { status: 'cancelled' } | { status: 'ready', id: string, pending: object } | { status: 'failed', error: string }>}
 */
function prepareRollback(args) {
	const running = inflight.get(args.dir);
	const wait = running ? running.promise.catch(() => { }) : Promise.resolve();
	return enqueue(args.dir, 'rollback', wait.then(() => rollback(args)));
}

async function rollback({ listUrl, dir, current, keys, confirm }) {
	try {
		const previous = await fetchPrevious(listUrl, current);
		if (!previous) {
			return { status: 'none' };
		}
		if (confirm && !await confirm(previous)) {
			return { status: 'cancelled' }; // nothing downloaded, nothing written
		}
		const file = await downloadVerified(previous, dir, keys ? { keys } : {}); // also removes other installers
		const pending = { id: previous.id, path: file, sha256: await hashFile(file), rollback: true, signed: true };
		const state = readState(dir); // after the download: another window may have written meanwhile
		state.pending = pending;
		state.failures = 0;
		// Keep holding the newer of an existing hold and the build left now (BAD -> P1 -> P2 must not offer BAD).
		state.heldBack = state.heldBack && isNewer(state.heldBack, current) ? state.heldBack : current;
		writeState(dir, state);
		return { status: 'ready', id: previous.id, pending };
	} catch (err) {
		return { status: 'failed', error: String(err && err.message || err) };
	}
}

module.exports = { checkForUpdate, prepareRollback, isStalePending };
