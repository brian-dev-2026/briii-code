// Keeps the logs of a new version's first session, and of the session before it (the old
// version's last), in the update folder. VS Code deletes all but its newest 10 log sessions, so
// by the time someone notices "GitHub signed me out after the update", the evidence is gone.
// GitHub Authentication.log says whether the token was found; main.log has decryption errors.
'use strict';

const fs = require('fs');
const path = require('path');

const WANTED = /(^|[\\/])(main|sharedprocess|renderer|exthost)\.log$|(^|[\\/])vscode\.github-authentication[\\/]/;

/** <logs>\<session>\window<N>\exthost\<extension id> -> <logs>\<session> */
function sessionDirOf(extensionLogDir) {
	return path.dirname(path.dirname(path.dirname(extensionLogDir)));
}

function copyWanted(from, to, rel = '') {
	for (const entry of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) {
		const r = path.join(rel, entry.name);
		if (entry.isDirectory()) {
			copyWanted(from, to, r);
		} else if (WANTED.test(r)) {
			fs.mkdirSync(path.dirname(path.join(to, r)), { recursive: true });
			fs.copyFileSync(path.join(from, r), path.join(to, r));
		}
	}
}

/**
 * Copies the wanted logs of `sessionDir` and of the session before it into <dest>\<name>, then
 * deletes all but the newest `keep` folders in dest. Returns the folder written.
 */
function keepSessionLogs({ sessionDir, dest, name, keep = 3 }) {
	const logs = path.dirname(sessionDir);
	const sessions = fs.readdirSync(logs).filter(s => s <= path.basename(sessionDir)).sort();
	const out = path.join(dest, name);
	for (const s of sessions.slice(-2)) {
		copyWanted(path.join(logs, s), path.join(out, s));
	}
	const old = fs.readdirSync(dest)
		.map(n => ({ n, t: fs.statSync(path.join(dest, n)).mtimeMs }))
		.sort((a, b) => b.t - a.t)
		.slice(keep);
	for (const { n } of old) {
		fs.rmSync(path.join(dest, n), { recursive: true, force: true });
	}
	return out;
}

module.exports = { sessionDirOf, keepSessionLogs };
