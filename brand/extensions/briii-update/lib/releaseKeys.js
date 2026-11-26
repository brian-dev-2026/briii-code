// Public keys (Ed25519, SPKI PEM) whose signatures the updater accepts. Several keys allow rotation.
'use strict';

const PUBLIC_KEYS = [
	`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAIEwoWMKVUXaS5X/b/c5zdq2KLelZKbr9MLLinHKoPAo=
-----END PUBLIC KEY-----
`,
];

/** PUBLIC_KEYS, plus BRIII_UPDATE_TEST_KEY while a test feed (BRIII_UPDATE_FEED) is set. */
function trustedKeys(env = process.env) {
	const keys = [...PUBLIC_KEYS];
	if (env.BRIII_UPDATE_TEST_KEY && env.BRIII_UPDATE_FEED) keys.push(env.BRIII_UPDATE_TEST_KEY);
	return keys;
}

module.exports = { PUBLIC_KEYS, trustedKeys };
