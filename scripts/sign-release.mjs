// Signs and verifies a release checksum file with Ed25519.
//   node scripts/sign-release.mjs --generate <dir>
//   node scripts/sign-release.mjs <sha-file>                      (key in BRIII_SIGNING_KEY)
//   node scripts/sign-release.mjs --verify <sha-file> [--keys <public.pem>]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

function die(message, code = 1) {
	console.error(message);
	process.exit(code);
}

const args = process.argv.slice(2);

if (args[0] === '--generate') {
	const dir = args[1];
	if (!dir) die('usage: sign-release.mjs --generate <dir>');
	const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
	const pub = publicKey.export({ type: 'spki', format: 'pem' });
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
	fs.writeFileSync(path.join(dir, 'public.pem'), pub);
	process.stdout.write(pub);
} else if (args[0] === '--verify') {
	const file = args[1];
	if (!file) die('usage: sign-release.mjs --verify <sha-file> [--keys <public.pem>]');
	const keysAt = args.indexOf('--keys');
	let keys;
	if (keysAt >= 0) {
		if (!args[keysAt + 1]) die('--keys needs a file');
		keys = [fs.readFileSync(args[keysAt + 1], 'utf8')];
	} else {
		keys = require(path.join(here, '..', 'brand', 'extensions', 'briii-update', 'lib', 'releaseKeys.js')).PUBLIC_KEYS;
	}
	const { verifySignedSha } = require(path.join(here, '..', 'brand', 'extensions', 'briii-update', 'lib', 'signature.js'));
	try {
		const bytes = fs.readFileSync(file);
		const m = /^BriiiCode-Setup-x64-(.+)\.exe\.sha256$/.exec(path.basename(file));
		const named = /\s(BriiiCode-Setup-x64-(.+)\.exe)\s*$/.exec(bytes.toString('utf8'));
		const id = named ? named[2] : m ? m[1] : '';
		verifySignedSha(bytes, fs.readFileSync(file + '.sig', 'utf8'), id, keys);
		console.log(`${path.basename(file)}: signature OK`);
	} catch (e) {
		die(e.message);
	}
} else {
	const file = args[0];
	if (!file) die('usage: sign-release.mjs <sha-file>');
	const key = process.env.BRIII_SIGNING_KEY;
	if (!key || !key.trim()) die('BRIII_SIGNING_KEY is missing or empty', 2);
	const sig = crypto.sign(null, fs.readFileSync(file), key);
	fs.writeFileSync(file + '.sig', sig.toString('base64') + '\n');
}
