// state.json in the update folder: the verified installer waiting to be installed, and history.
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT = () => ({ pending: null, failures: 0, lastCheck: 0 });

/** @returns {{ pending: { id: string, path: string, sha256: string } | null, failures: number, lastCheck: number }} */
function readState(dir) {
	try {
		const s = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
		return { ...DEFAULT(), ...s };
	} catch {
		return DEFAULT();
	}
}

/** Writes via a temp file and rename, so a crash never leaves half a file. */
function writeState(dir, state) {
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, 'state.json');
	fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, '\t'));
	fs.renameSync(`${file}.tmp`, file);
}

/** Keeps install.log (written by the helper, one line per event) to its newest `maxLines`. */
function trimLog(dir, maxLines = 500) {
	const file = path.join(dir, 'install.log');
	let lines;
	try {
		lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
	} catch {
		return;
	}
	if (lines.length > maxLines) {
		fs.writeFileSync(file, lines.slice(-maxLines).join('\n') + '\n');
	}
}

/**
 * True for the first caller only, across every window: an exclusive create is atomic. Markers
 * older than 90 days are removed.
 */
function claimOnce(dir, key) {
	const marks = path.join(dir, 'notified');
	fs.mkdirSync(marks, { recursive: true });
	for (const f of fs.readdirSync(marks)) {
		const p = path.join(marks, f);
		try {
			if (Date.now() - fs.statSync(p).mtimeMs > 90 * 24 * 60 * 60 * 1000) {
				fs.rmSync(p, { force: true });
			}
		} catch {
			// another window removed it
		}
	}
	try {
		fs.writeFileSync(path.join(marks, key.replace(/[^\w.-]/g, '_')), '', { flag: 'wx' });
		return true;
	} catch {
		return false;
	}
}

module.exports = { readState, writeState, trimLog, claimOnce };
