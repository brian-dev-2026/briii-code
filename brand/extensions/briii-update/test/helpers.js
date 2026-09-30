// Test helper: a local server that looks like the GitHub Releases API plus asset downloads.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

/**
 * Starts a fake release feed. Paths:
 *   /latest            release JSON for `id` (installer asset redirects like GitHub's)
 *   /asset/<name>.exe  302 -> /blob
 *   /blob              the installer bytes (a truncated body with truncate, headers only with stall)
 *   /asset/<name>.exe.sha256  hex digest (wrong when badSha is set)
 * Returns { url, hits, close }; hits counts requests per path.
 */
async function startFeed({ id, bytes = crypto.randomBytes(1024), badSha = false, truncate = false, stall = false }) {
	const name = `BriiiCode-Setup-x64-${id}.exe`;
	const sha = crypto.createHash('sha256').update(badSha ? Buffer.from('other') : bytes).digest('hex');
	const hits = {};
	const ETAG = `"${id}"`;
	const server = http.createServer((req, res) => {
		hits[req.url] = (hits[req.url] || 0) + 1;
		const base = `http://127.0.0.1:${server.address().port}`;
		if (req.url === '/latest') {
			if (req.headers['if-none-match'] === ETAG) {
				hits.notModified = (hits.notModified || 0) + 1;
				res.writeHead(304, { etag: ETAG });
				res.end();
				return;
			}
			res.setHeader('etag', ETAG);
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify({
				tag_name: `v${id}`,
				html_url: `${base}/page`,
				assets: [
					{ name, browser_download_url: `${base}/asset/${name}` },
					{ name: `${name}.sha256`, browser_download_url: `${base}/asset/${name}.sha256` },
				],
			}));
		} else if (req.url === `/asset/${name}`) {
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
		} else if (req.url === `/asset/${name}.sha256`) {
			res.end(`${sha}  ${name}\n`);
		} else {
			res.writeHead(404);
			res.end();
		}
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	return {
		url: `http://127.0.0.1:${server.address().port}/latest`,
		bytes,
		hits,
		close: () => new Promise(r => { server.close(r); server.closeAllConnections(); }),
	};
}

function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'briii-update-test-'));
}

module.exports = { startFeed, tempDir };
