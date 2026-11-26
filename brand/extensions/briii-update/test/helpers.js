// Test helper: a local server that looks like the GitHub Releases API plus asset downloads.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

// A throwaway Ed25519 key pair, generated once per process. Tests pass publicKey as `keys`.
const TEST_KEYS = (() => {
	const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
	return {
		privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
		publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
	};
})();

function sign(data) {
	return crypto.sign(null, data, TEST_KEYS.privateKey).toString('base64');
}

/**
 * Starts a fake release feed. Paths:
 *   /latest            release JSON for `id` (installer asset redirects like GitHub's)
 *   /releases          JSON array of releases for [id, ...releases], in the order given
 *   /asset/<name>.exe  302 -> /blob
 *   /blob              the installer bytes (a truncated body with truncate, headers only with stall)
 *   /asset/<name>.exe.sha256      "<hex>  <name>" (wrong digest when badSha is set)
 *   /asset/<name>.exe.sha256.sig  base64 Ed25519 signature of the .sha256 bytes with TEST_KEYS
 *                                 (of other bytes with badSig; no asset at all with unsigned)
 * Every listed release is served from the same bytes. Returns { url, listUrl, bytes, hits, close };
 * hits counts requests per path.
 */
async function startFeed({ id, bytes = crypto.randomBytes(1024), badSha = false, badSig = false, unsigned = false, releases = [], truncate = false, stall = false }) {
	const sha = crypto.createHash('sha256').update(badSha ? Buffer.from('other') : bytes).digest('hex');
	const nameOf = rid => `BriiiCode-Setup-x64-${rid}.exe`;
	const shaFile = rid => Buffer.from(`${sha}  ${nameOf(rid)}\n`);
	const hits = {};
	const ETAG = `"${id}"`;
	const server = http.createServer((req, res) => {
		hits[req.url] = (hits[req.url] || 0) + 1;
		const base = `http://127.0.0.1:${server.address().port}`;
		const releaseJson = rid => {
			const name = nameOf(rid);
			const assets = [
				{ name, browser_download_url: `${base}/asset/${name}` },
				{ name: `${name}.sha256`, browser_download_url: `${base}/asset/${name}.sha256` },
			];
			if (!unsigned) {
				assets.push({ name: `${name}.sha256.sig`, browser_download_url: `${base}/asset/${name}.sha256.sig` });
			}
			return { tag_name: `v${rid}`, html_url: `${base}/page`, assets };
		};
		const asset = /^\/asset\/BriiiCode-Setup-x64-(.+)\.exe(\.sha256|\.sha256\.sig)?$/.exec(req.url);
		if (req.url === '/latest') {
			if (req.headers['if-none-match'] === ETAG) {
				hits.notModified = (hits.notModified || 0) + 1;
				res.writeHead(304, { etag: ETAG });
				res.end();
				return;
			}
			res.setHeader('etag', ETAG);
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify(releaseJson(id)));
		} else if (req.url === '/releases') {
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify([id, ...releases].map(releaseJson)));
		} else if (asset && !asset[2]) {
			res.writeHead(302, { location: `${base}/blob` });
			res.end();
		} else if (req.url === '/blob') {
			if (stall) {
				res.writeHead(200, { 'content-length': bytes.length });
				res.write(bytes.subarray(0, 10));
			} else if (truncate) {
				res.writeHead(200, { 'content-length': bytes.length * 2 });
				res.write(bytes.subarray(0, 100));
				setTimeout(() => res.socket.destroy(), 20);
			} else {
				res.end(bytes);
			}
		} else if (asset && asset[2] === '.sha256') {
			res.end(shaFile(asset[1]));
		} else if (asset && asset[2] === '.sha256.sig' && !unsigned) {
			res.end(`${sign(badSig ? Buffer.from('other') : shaFile(asset[1]))}\n`);
		} else {
			res.writeHead(404);
			res.end();
		}
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	return {
		url: `http://127.0.0.1:${server.address().port}/latest`,
		listUrl: `http://127.0.0.1:${server.address().port}/releases`,
		bytes,
		hits,
		close: () => new Promise(r => { server.close(r); server.closeAllConnections(); }),
	};
}

// Removed when the test file's process exits, so test runs don't pile up folders in %TEMP%.
const tempDirs = [];
process.on('exit', () => {
	for (const dir of tempDirs) {
		try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still in use */ }
	}
});

function tempDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'briii-update-test-'));
	tempDirs.push(dir);
	return dir;
}

module.exports = { startFeed, tempDir, TEST_KEYS };
