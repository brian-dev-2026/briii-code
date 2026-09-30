// Briii release ids: <vscodium>-<yyyymmdd>.<run> for published builds, <vscodium>-local for local ones.
'use strict';

const PUBLISHED = /^(\d+(?:\.\d+)*)-(\d{8})\.(\d+)$/;
const LOCAL = /^(\d+(?:\.\d+)*)-local$/;

/** @returns {{ vscodium: number[], date: number, run: number, local: boolean } | null} */
function parseRelease(id) {
	if (typeof id !== 'string') {
		return null;
	}
	const toParts = v => v.split('.').map(Number);
	let m = PUBLISHED.exec(id);
	if (m) {
		return { vscodium: toParts(m[1]), date: Number(m[2]), run: Number(m[3]), local: false };
	}
	m = LOCAL.exec(id);
	if (m) {
		// A local build sorts before every published build of the same VSCodium.
		return { vscodium: toParts(m[1]), date: 0, run: 0, local: true };
	}
	return null;
}

function compareParts(a, b) {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const d = (a[i] || 0) - (b[i] || 0);
		if (d) {
			return d;
		}
	}
	return 0;
}

/** True when `candidate` is a published build newer than `current`. */
function isNewer(candidate, current) {
	const a = parseRelease(candidate);
	const b = parseRelease(current);
	if (!a || a.local || !b) {
		return false;
	}
	return (compareParts(a.vscodium, b.vscodium) || a.date - b.date || a.run - b.run) > 0;
}

/**
 * What the updater may do for this install:
 * 'off' when switched off or the build has no release id (dev runs),
 * 'notify' for local builds and all-users installs (a silent install would need admin rights),
 * otherwise the user's setting.
 */
function effectiveMode({ mode, current, appRoot, programFiles }) {
	if (mode === 'off' || !parseRelease(current)) {
		return 'off';
	}
	const underProgramFiles = programFiles && appRoot &&
		appRoot.toLowerCase().startsWith(programFiles.toLowerCase().replace(/[\\/]*$/, '\\'));
	if (parseRelease(current).local || underProgramFiles) {
		return 'notify';
	}
	return mode === 'notify' ? 'notify' : 'auto';
}

module.exports = { parseRelease, isNewer, effectiveMode };
