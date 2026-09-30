// The synced files in the user folder (…\User): reading them, and writing downloaded versions
// with a backup first, so a Sync Down can always be undone.
'use strict';

const fs = require('fs');
const path = require('path');

const TOP = ['settings.json', 'keybindings.json'];
const SNIPPET = /\.(json|code-snippets)$/i;
const PREFIX = 'snippets__';
const KEEP_BACKUPS = 10;

/** Where a Gist file lives in the user folder. */
function localPath(userDir, gistName) {
	return gistName.startsWith(PREFIX)
		? path.join(userDir, 'snippets', gistName.slice(PREFIX.length))
		: path.join(userDir, gistName);
}

/** @returns {{ files: { [gistName: string]: string } }} the synced files that exist */
function readSnapshot(userDir) {
	const files = {};
	for (const name of TOP) {
		try {
			files[name] = fs.readFileSync(path.join(userDir, name), 'utf8');
		} catch {
			// not created yet
		}
	}
	let snippets = [];
	try {
		snippets = fs.readdirSync(path.join(userDir, 'snippets'), { withFileTypes: true });
	} catch {
		// no snippets folder
	}
	for (const e of snippets) {
		if (e.isFile() && SNIPPET.test(e.name)) {
			files[PREFIX + e.name] = fs.readFileSync(path.join(userDir, 'snippets', e.name), 'utf8');
		}
	}
	return { files };
}

function newBackupDir(backupRoot) {
	const stamp = new Date().toISOString().replace(/:/g, '-');
	for (let n = 0; ; n++) {
		const dir = path.join(backupRoot, `${stamp}-${String(n).padStart(3, '0')}`);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
			return dir;
		}
	}
}

function pruneBackups(backupRoot) {
	const dirs = fs.readdirSync(backupRoot).sort();
	for (const d of dirs.slice(0, Math.max(0, dirs.length - KEEP_BACKUPS))) {
		fs.rmSync(path.join(backupRoot, d), { recursive: true, force: true });
	}
}

/** Writes via a temp file and a rename, so a failed write never leaves half a file. */
function atomicWrite(file, content) {
	const tmp = `${file}.briii-sync.tmp`;
	try {
		fs.writeFileSync(tmp, content);
		fs.renameSync(tmp, file);
	} finally {
		fs.rmSync(tmp, { force: true });
	}
}

/**
 * Writes the changes (content null deletes). Every touched file that exists is copied to a new
 * backup folder first. If a write fails, every touched file (the failing one too) is put back
 * and the error names the file. `write` is replaceable for tests.
 * @returns {{ backup: string }}
 */
function applyChanges(userDir, backupRoot, changes, { write = atomicWrite } = {}) {
	const backup = newBackupDir(backupRoot);
	const previous = new Map(); // gist name -> old content, or null when the file didn't exist
	for (const { name } of changes) {
		const file = localPath(userDir, name);
		let old = null;
		try {
			old = fs.readFileSync(file, 'utf8');
		} catch {
			// new file
		}
		previous.set(name, old);
		if (old !== null) {
			fs.writeFileSync(path.join(backup, name), old);
		}
	}
	const done = [];
	for (const { name, content } of changes) {
		const file = localPath(userDir, name);
		try {
			if (content === null) {
				fs.rmSync(file, { force: true });
			} else {
				fs.mkdirSync(path.dirname(file), { recursive: true });
				write(file, content);
			}
			done.push(name);
		} catch (err) {
			for (const n of [...done, name]) {
				const old = previous.get(n);
				try {
					if (old === null) {
						fs.rmSync(localPath(userDir, n), { force: true });
					} else {
						fs.writeFileSync(localPath(userDir, n), old);
					}
				} catch {
					// still in the backup folder
				}
			}
			throw new Error(`Couldn't write ${name}: ${err.message}. Nothing was changed.`);
		}
	}
	pruneBackups(backupRoot);
	return { backup };
}

module.exports = { readSnapshot, applyChanges, localPath };
