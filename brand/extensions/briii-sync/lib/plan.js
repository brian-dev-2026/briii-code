// Pure: compares this PC's files with the Gist's and decides what a Sync Down would change, what
// a Sync Up would send, and whether uploading would overwrite another PC's work.
'use strict';

const crypto = require('crypto');
const jsonc = require('./vendor/jsonc-parser/main');
const { stripSecrets, restoreSecrets } = require('./settings');

const MUST_PARSE = ['settings.json', 'keybindings.json', 'extensions.json'];
const META = 'meta.json';
const EXTENSIONS = 'extensions.json';
const SNIPPET = /^snippets__/;
// The only Gist files ever written to disk. A snippet name is one plain file name.
const WRITABLE = /^(settings\.json|keybindings\.json|snippets__(?!.*\.\.)[^\\/:*?"<>|]+\.(json|code-snippets))$/i;

const normalize = s => s.replace(/\r\n/g, '\n').replace(/\n+$/, '');

/** Same text apart from CRLF vs LF and trailing newlines. */
function sameText(a, b) {
	return typeof a === 'string' && typeof b === 'string' && normalize(a) === normalize(b);
}

/** JSONC tokens without whitespace, and without a comma right before a closing bracket. */
function tokens(text) {
	const s = jsonc.createScanner(text, false);
	const out = [];
	for (let k = s.scan(); k !== 17 /* EOF */; k = s.scan()) {
		if (k === 14 /* LineBreakTrivia */ || k === 15 /* Trivia */) {
			continue;
		}
		if ((k === 2 /* CloseBrace */ || k === 4 /* CloseBracket */) && out.length && out[out.length - 1].startsWith('5:') /* CommaToken */) {
			out.pop();
		}
		out.push(`${k}:${s.getTokenValue().replace(/\r\n/g, '\n')}`);
	}
	return out;
}

/** Same JSONC content: whitespace, line endings and trailing commas don't count; comments do. */
function sameContent(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string') {
		return false;
	}
	const x = tokens(a);
	const y = tokens(b);
	return x.length === y.length && x.every((t, i) => t === y[i]);
}

function parses(text) {
	const errors = [];
	jsonc.parse(text, errors, { allowTrailingComma: true });
	return errors.length === 0;
}

function extensionIds(text) {
	return jsonc.parse(text, [], { allowTrailingComma: true }).map(e => e.id).filter(Boolean);
}

/**
 * @returns {{ items: { name, kind: 'changed'|'new'|'removed'|'invalid', content: string|null, picked: boolean }[], extensions: string[] }}
 */
function planDown({ local, remote, localExtensions, ignored }) {
	const items = [];
	let extensions = [];
	for (const [name, text] of Object.entries(remote)) {
		if (name === META) {
			continue;
		}
		if (MUST_PARSE.includes(name) && !parses(text)) {
			items.push({ name, kind: 'invalid', content: null, picked: false });
			continue;
		}
		if (name === EXTENSIONS) {
			const have = new Set(localExtensions.map(id => id.toLowerCase()));
			extensions = extensionIds(text).filter(id => !have.has(id.toLowerCase()));
			continue;
		}
		if (!WRITABLE.test(name)) {
			continue; // README.md added on github.com, or a name that would escape the user folder
		}
		const mine = local[name];
		if (name === 'settings.json') {
			// Remote equals what this PC would upload: nothing to do (secrets stay as they are).
			if (mine !== undefined && sameContent(stripSecrets(mine, ignored).text, text)) {
				continue;
			}
			items.push({ name, kind: mine === undefined ? 'new' : 'changed', content: mine === undefined ? text : restoreSecrets(text, mine, ignored), picked: true });
			continue;
		}
		if (!sameContent(mine, text)) {
			items.push({ name, kind: mine === undefined ? 'new' : 'changed', content: text, picked: true });
		}
	}
	for (const name of Object.keys(local)) {
		if (SNIPPET.test(name) && !(name in remote)) {
			items.push({ name, kind: 'removed', content: null, picked: false });
		}
	}
	return { items, extensions };
}

/**
 * @returns {{ patch: { [name: string]: string|null }, removedSecrets: string[] }} only what changed;
 * meta.json is added whenever anything else is sent.
 */
function planUp({ local, remote, localExtensions, ignored, meta }) {
	const upload = {};
	let removedSecrets = [];
	for (const [name, text] of Object.entries(local)) {
		if (name === 'settings.json') {
			const s = stripSecrets(text, ignored);
			upload[name] = s.text;
			removedSecrets = s.removed;
		} else {
			upload[name] = text;
		}
	}
	upload[EXTENSIONS] = JSON.stringify([...localExtensions].sort((a, b) => a.localeCompare(b)).map(id => ({ id })), null, '\t');
	const patch = {};
	for (const [name, text] of Object.entries(upload)) {
		if (!sameContent(remote[name], text)) {
			patch[name] = text;
		}
	}
	for (const name of Object.keys(remote)) {
		if (SNIPPET.test(name) && !(name in local)) {
			patch[name] = null;
		}
	}
	if (Object.keys(patch).length) {
		patch[META] = JSON.stringify(meta, null, '\t');
	}
	return { patch, removedSecrets };
}

/** Per-file hashes of what was synced (settings without secrets; whitespace doesn't count). */
function snapshotHashes(files, ignored) {
	const out = {};
	for (const [name, text] of Object.entries(files)) {
		const content = name === 'settings.json' ? stripSecrets(text, ignored).text : text;
		out[name] = crypto.createHash('sha256').update(tokens(content).join('\u0000')).digest('hex');
	}
	return out;
}

/** True when this PC's files changed since the hashes were taken (or nothing was recorded). */
function localChangedSince(files, hashes, ignored) {
	if (!hashes) {
		return true;
	}
	const now = snapshotHashes(files, ignored);
	const names = new Set([...Object.keys(now), ...Object.keys(hashes)]);
	return [...names].some(n => now[n] !== hashes[n]);
}

/** True when uploading would overwrite a version another PC wrote and this one never saw. */
function isConflict({ lastVersion, remoteVersion, remoteMachine, machine }) {
	if (!remoteVersion || remoteVersion === lastVersion) {
		return false;
	}
	return remoteMachine !== machine;
}

module.exports = { planDown, planUp, isConflict, sameText, sameContent, snapshotHashes, localChangedSince };
