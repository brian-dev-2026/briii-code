'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifySignedSha } = require('../lib/signature');
const { PUBLIC_KEYS, trustedKeys } = require('../lib/releaseKeys');

function makeKeys() {
	const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
	return {
		pub: publicKey.export({ type: 'spki', format: 'pem' }),
		priv: privateKey.export({ type: 'pkcs8', format: 'pem' }),
	};
}

const right = makeKeys();
const other = makeKeys();
const HASH = crypto.createHash('sha256').update('installer').digest('hex');

function signed(id, hash, key = right.priv) {
	const bytes = Buffer.from(`${hash}  BriiiCode-Setup-x64-${id}.exe\n`);
	const sig = crypto.sign(null, bytes, key).toString('base64') + '\n';
	return { bytes, sig };
}

test('verifySignedSha returns the signed hash', () => {
	const { bytes, sig } = signed('1.0-1.1', HASH);
	assert.equal(verifySignedSha(bytes, sig, '1.0-1.1', [right.pub]), HASH);
});

test('verifySignedSha accepts a signature with trailing whitespace', () => {
	const { bytes, sig } = signed('1.0-1.1', HASH);
	assert.equal(verifySignedSha(bytes, sig.trim() + '\r\n', '1.0-1.1', [right.pub]), HASH);
});

test('verifySignedSha rejects a tampered checksum file', () => {
	const { bytes, sig } = signed('1.0-1.1', HASH);
	const text = bytes.toString();
	const tampered = Buffer.from((text[0] === 'a' ? 'b' : 'a') + text.slice(1));
	assert.throws(() => verifySignedSha(tampered, sig, '1.0-1.1', [right.pub]), /no valid signature/);
});

test('verifySignedSha rejects a signature by an unknown key', () => {
	const { bytes, sig } = signed('1.0-1.1', HASH, other.priv);
	assert.throws(() => verifySignedSha(bytes, sig, '1.0-1.1', [right.pub]), /no valid signature/);
});

test('verifySignedSha rejects a file signed for another release', () => {
	const { bytes, sig } = signed('A', HASH);
	assert.throws(() => verifySignedSha(bytes, sig, 'B', [right.pub]), /signed for BriiiCode-Setup-x64-A\.exe/);
});

test('verifySignedSha accepts any key in the list', () => {
	const { bytes, sig } = signed('1.0-1.1', HASH);
	assert.equal(verifySignedSha(bytes, sig, '1.0-1.1', [other.pub, right.pub]), HASH);
});

test('trustedKeys adds the test key only with a test feed', () => {
	assert.deepEqual(trustedKeys({ BRIII_UPDATE_TEST_KEY: 'k' }), PUBLIC_KEYS);
	assert.deepEqual(trustedKeys({ BRIII_UPDATE_TEST_KEY: 'k', BRIII_UPDATE_FEED: 'http://x' }), [...PUBLIC_KEYS, 'k']);
});
