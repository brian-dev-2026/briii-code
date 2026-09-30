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

module.exports = { readState, writeState };
