// Ed25519 verification of a release's checksum file.
'use strict';

const crypto = require('crypto');

function fail(reason) {
	return new Error(`signature check failed: ${reason}`);
}

/**
 * Checks that `sigText` (base64 signature, one line) signs the exact bytes `shaBytes` with one of
 * `keys` (public PEMs), and that the signed file names release `id`. Returns the signed SHA-256
 * (lower-case hex). Throws an Error starting with "signature check failed:".
 */
function verifySignedSha(shaBytes, sigText, id, keys) {
	const sig = Buffer.from(String(sigText).trim(), 'base64');
	const ok = sig.length === 64 && keys.some((key) => {
		try {
			return crypto.verify(null, shaBytes, key, sig);
		} catch {
			return false;
		}
	});
	if (!ok) throw fail('no valid signature');

	const fields = shaBytes.toString('utf8').trim().split(/\s+/);
	if (fields.length !== 2 || !/^[0-9a-fA-F]{64}$/.test(fields[0])) throw fail('unreadable checksum file');
	const expected = `BriiiCode-Setup-x64-${id}.exe`;
	if (fields[1] !== expected) throw fail(`signed for ${fields[1]}, expected ${expected}`);
	return fields[0].toLowerCase();
}

module.exports = { verifySignedSha };
