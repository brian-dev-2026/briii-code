import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sign-release.mjs');
const dirs = [];
process.on('exit', () => {
	for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function tmp() {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), 'briii-sign-'));
	dirs.push(d);
	return d;
}

function run(args, env = {}) {
	const e = { ...process.env, ...env };
	if (!('BRIII_SIGNING_KEY' in env)) delete e.BRIII_SIGNING_KEY;
	return spawnSync(process.execPath, [SCRIPT, ...args], { env: e, encoding: 'utf8' });
}

function shaFile(dir) {
	const hash = crypto.createHash('sha256').update('x').digest('hex');
	const file = path.join(dir, 'BriiiCode-Setup-x64-1.0-20260101.1.exe.sha256');
	fs.writeFileSync(file, `${hash}  BriiiCode-Setup-x64-1.0-20260101.1.exe\n`);
	return file;
}

function generated() {
	const dir = tmp();
	const r = run(['--generate', dir]);
	assert.equal(r.status, 0, r.stderr);
	return dir;
}

test('--generate writes a key pair', () => {
	const dir = generated();
	for (const f of ['private.pem', 'public.pem']) {
		assert.ok(fs.readFileSync(path.join(dir, f), 'utf8').startsWith('-----BEGIN'));
	}
});

test('signs and verifies with the generated key', () => {
	const keys = generated();
	const sha = shaFile(tmp());
	const s = run([sha], { BRIII_SIGNING_KEY: fs.readFileSync(path.join(keys, 'private.pem'), 'utf8') });
	assert.equal(s.status, 0, s.stderr);
	const v = run(['--verify', sha, '--keys', path.join(keys, 'public.pem')]);
	assert.equal(v.status, 0, v.stderr);
});

test('--verify fails for a tampered file', () => {
	const keys = generated();
	const sha = shaFile(tmp());
	run([sha], { BRIII_SIGNING_KEY: fs.readFileSync(path.join(keys, 'private.pem'), 'utf8') });
	const text = fs.readFileSync(sha, 'utf8');
	fs.writeFileSync(sha, (text[0] === 'a' ? 'b' : 'a') + text.slice(1));
	const v = run(['--verify', sha, '--keys', path.join(keys, 'public.pem')]);
	assert.notEqual(v.status, 0);
});

test('--verify fails for a signature by a key not in releaseKeys.js', () => {
	const keys = generated();
	const sha = shaFile(tmp());
	run([sha], { BRIII_SIGNING_KEY: fs.readFileSync(path.join(keys, 'private.pem'), 'utf8') });
	const v = run(['--verify', sha]);
	assert.notEqual(v.status, 0);
	assert.match(v.stderr, /no valid signature/);
});

test('signing without BRIII_SIGNING_KEY exits 2', () => {
	const sha = shaFile(tmp());
	const r = run([sha]);
	assert.equal(r.status, 2);
	assert.equal(fs.existsSync(sha + '.sig'), false);
});
