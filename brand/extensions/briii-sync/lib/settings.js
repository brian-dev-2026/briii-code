// Keeps secrets out of the synced settings.json. A secret Gist can be read by anyone with its
// link, and its history keeps every version, so these stay on this PC:
// - properties (at any depth) whose name looks like a credential;
// - whole values of environment-variable and header maps (terminal.integrated.env.*, *.env,
//   *.headers), whatever their keys are called;
// - `value` of { name, value } pairs whose name looks like a credential (Claude Code's
//   environmentVariables, for example);
// - the keys in `ignored`: briii.sync.ignoredSettings plus every machine-scoped setting.
// jsonc-parser edits the text in place, so comments and formatting survive in both directions.
'use strict';

const jsonc = require('./vendor/jsonc-parser/main');

const SECRET = /token|password|passwd|secret|api[-_.]?key|credential|authorization|bearer|private[-_.]?key|access[-_.]?key|cookie/i;
const WHOLE = /^terminal\.integrated\.env\.|(^|\.)(env|headers|defaultheaders)$/i;
const IDENTITY = ['name', 'id', 'key', 'label', 'title'];

function isSecretKey(key, ignored) {
	return ignored.includes(key) || SECRET.test(key) || WHOLE.test(key);
}

function formatting(text) {
	return { insertSpaces: !/^\t/m.test(text), tabSize: 4, eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

const stringProp = (objNode, prop) => {
	const p = (objNode.children || []).find(c => c.children && c.children[0].value === prop);
	return p && p.children[1] && p.children[1].type === 'string' ? p.children[1].value : undefined;
};

/** How to find an array element again: by a name-like property, else by position. */
function identityOf(arrayNode, index) {
	const el = arrayNode.children[index];
	for (const prop of IDENTITY) {
		const v = el && el.type === 'object' ? stringProp(el, prop) : undefined;
		if (v !== undefined) {
			return { prop, value: v };
		}
	}
	return { index, length: arrayNode.children.length };
}

/**
 * Every secret in the text: its path, value, and for each array step how to find the element
 * again ({ prop, value } or { index, length }).
 */
function secretPaths(text, ignored) {
	const tree = jsonc.parseTree(text, [], { allowTrailingComma: true });
	const found = [];
	const walk = (node, at, ids) => {
		if (!node || !node.children) {
			return;
		}
		if (node.type === 'object') {
			const pairName = stringProp(node, 'name') || stringProp(node, 'key');
			for (const prop of node.children) {
				const [keyNode, valueNode] = prop.children || [];
				if (!keyNode) {
					continue;
				}
				const p = [...at, keyNode.value];
				const secret = isSecretKey(keyNode.value, ignored) || ignored.includes(p.join('.')) ||
					(keyNode.value === 'value' && pairName !== undefined && SECRET.test(pairName));
				if (secret) {
					found.push({ path: p, ids: [...ids, null], value: valueNode ? jsonc.getNodeValue(valueNode) : undefined });
				} else {
					walk(valueNode, p, [...ids, null]);
				}
			}
		} else if (node.type === 'array') {
			node.children.forEach((child, i) => walk(child, [...at, i], [...ids, identityOf(node, i)]));
		}
	};
	walk(tree, [], []);
	return found;
}

/** Maps a path from the local file onto the remote tree, or null when an element isn't there. */
function resolvePath(remoteTree, path, ids) {
	const out = [];
	let node = remoteTree;
	for (let i = 0; i < path.length; i++) {
		const step = path[i];
		const id = ids[i];
		if (typeof step === 'number') {
			if (!node || node.type !== 'array') {
				return null;
			}
			let index = -1;
			if (id.prop) {
				index = node.children.findIndex(el => el.type === 'object' && stringProp(el, id.prop) === id.value);
			} else if (node.children.length === id.length) {
				index = id.index;
			}
			if (index < 0) {
				return null;
			}
			out.push(index);
			node = node.children[index];
		} else {
			out.push(step);
			if (i < path.length - 1) {
				node = node ? jsonc.findNodeAtLocation(node, [step]) : undefined;
				if (!node) {
					return null;
				}
			}
		}
	}
	return out;
}

function edit(text, path, value) {
	return jsonc.applyEdits(text, jsonc.modify(text, path, value, { formattingOptions: formatting(text) }));
}

/** The settings text without secrets, and the dotted paths that were left out. */
function stripSecrets(text, ignored) {
	const found = secretPaths(text, ignored);
	let out = text;
	for (const { path } of [...found].reverse()) { // last first, so array indices stay valid
		out = edit(out, path, undefined);
	}
	return { text: out, removed: found.map(f => f.path.join('.')) };
}

/**
 * The downloaded settings text with this PC's secret values put back. Array elements are found
 * by name (or position when the array didn't change length); a secret whose element is gone is
 * dropped rather than put into another element.
 */
function restoreSecrets(remoteText, localText, ignored) {
	let out = remoteText;
	for (const { path, ids, value } of secretPaths(localText, ignored)) {
		const target = resolvePath(jsonc.parseTree(out, [], { allowTrailingComma: true }), path, ids);
		if (target) {
			out = edit(out, target, value);
		}
	}
	return out;
}

module.exports = { isSecretKey, stripSecrets, restoreSecrets };
