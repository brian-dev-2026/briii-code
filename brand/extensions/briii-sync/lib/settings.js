// Keeps secrets out of the synced settings.json. A secret Gist can be read by anyone with its
// link, so settings that look like credentials (at any depth) and the ones the user lists in
// briii.sync.ignoredSettings stay on this PC. jsonc-parser edits the text in place, so comments
// and formatting survive in both directions.
'use strict';

const jsonc = require('./vendor/jsonc-parser/main');

const SECRET = /token|password|passwd|secret|api[-_.]?key|credential/i;

function isSecretKey(key, ignored) {
	return ignored.includes(key) || SECRET.test(key);
}

function formatting(text) {
	return { insertSpaces: !/^\t/m.test(text), tabSize: 4, eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

/** Paths ([key, key, ...]) of every secret property, with its value. */
function secretPaths(text, ignored) {
	const tree = jsonc.parseTree(text, [], { allowTrailingComma: true });
	const found = [];
	const walk = (node, at) => {
		if (!node || !node.children) {
			return;
		}
		if (node.type === 'object') {
			for (const prop of node.children) {
				const [keyNode, valueNode] = prop.children || [];
				if (!keyNode) {
					continue;
				}
				const p = [...at, keyNode.value];
				if (isSecretKey(keyNode.value, ignored) || ignored.includes(p.join('.'))) {
					found.push({ path: p, value: valueNode ? jsonc.getNodeValue(valueNode) : undefined });
				} else {
					walk(valueNode, p);
				}
			}
		} else if (node.type === 'array') {
			node.children.forEach((child, i) => walk(child, [...at, i]));
		}
	};
	walk(tree, []);
	return found;
}

function edit(text, path, value) {
	return jsonc.applyEdits(text, jsonc.modify(text, path, value, { formattingOptions: formatting(text) }));
}

/** The settings text without secrets, and the dotted paths that were left out. */
function stripSecrets(text, ignored) {
	const found = secretPaths(text, ignored);
	let out = text;
	for (const { path } of found) {
		out = edit(out, path, undefined);
	}
	return { text: out, removed: found.map(f => f.path.join('.')) };
}

/** The downloaded settings text with this PC's secret values put back. */
function restoreSecrets(remoteText, localText, ignored) {
	let out = remoteText;
	for (const { path, value } of secretPaths(localText, ignored)) {
		out = edit(out, path, value);
	}
	return out;
}

module.exports = { isSecretKey, stripSecrets, restoreSecrets };
