// The release feed (GitHub's "latest release" API) and verified installer downloads.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { verifySignedSha } = require('./signature');
const { trustedKeys } = require('./releaseKeys');
const { isNewer, isOlder } = require('./version');

const HEADERS = { 'user-agent': 'briii-update', accept: 'application/vnd.github+json' };
const FEED_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/** SHA-256 (hex) of a file, streamed. */
async function hashFile(file) {
	const hash = crypto.createHash('sha256');
	await pipeline(fs.createReadStream(file), hash);
	return hash.digest('hex');
}

/**
 * The latest release. `cache` ({ etag, latest }, kept in state.json) is sent as If-None-Match and
 * updated in place: GitHub answers 304 when nothing changed, which costs no rate limit.
 * @returns {Promise<{ id: string, installerUrl: string, shaUrl: string, sigUrl: string, pageUrl: string } | null>}
 */
async function fetchLatest(feedUrl, cache = {}) {
	const headers = cache.etag ? { ...HEADERS, 'if-none-match': cache.etag } : HEADERS;
	const res = await fetch(feedUrl, { headers, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
	if (res.status === 304 && cache.etag) {
		if (cache.latest && cache.latest.sigUrl) {
			return cache.latest;
		}
		// Cached by the updater from before signing: fetch the release again, unconditionally.
		delete cache.etag;
		delete cache.latest;
		return fetchLatest(feedUrl, cache);
	}
	if (!res.ok) {
		throw new Error(`release feed returned ${res.status}`);
	}
	const latest = toLatest(await res.json());
	cache.etag = res.headers.get('etag') || undefined;
	cache.latest = latest;
	return latest;
}

/**
 * The newest signed release older than `current`, from a releases list (GitHub's "list releases"
 * API). Tags that aren't Briii ids, and local builds, are skipped. No ETag: this runs only on request.
 * @returns {Promise<{ id: string, installerUrl: string, shaUrl: string, sigUrl: string, pageUrl: string } | null>}
 */
async function fetchPrevious(listUrl, current) {
	const res = await fetch(listUrl, { headers: HEADERS, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
	if (!res.ok) {
		throw new Error(`release feed returned ${res.status}`);
	}
	const list = await res.json();
	let best = null;
	for (const entry of Array.isArray(list) ? list : []) {
		const release = toLatest(entry);
		if (release && isOlder(release.id, current) && (!best || isNewer(release.id, best.id))) {
			best = release;
		}
	}
	return best;
}

function toLatest(release) {
	const id = String(release.tag_name || '').replace(/^v/, '');
	const asset = name => (release.assets || []).find(a => a.name === name);
	const exe = asset(`BriiiCode-Setup-x64-${id}.exe`);
	const sha = asset(`BriiiCode-Setup-x64-${id}.exe.sha256`);
	const sig = asset(`BriiiCode-Setup-x64-${id}.exe.sha256.sig`);
	if (!id || !exe || !sha || !sig) {
		return null;
	}
	return { id, installerUrl: exe.browser_download_url, shaUrl: sha.browser_download_url, sigUrl: sig.browser_download_url, pageUrl: release.html_url };
}

/**
 * Downloads the installer to <dir>/<id>.exe, checking it against the SHA-256 in the signed
 * checksum file: the .sha256 and its .sig are fetched and verified (against `keys`) before the
 * installer is requested at all.
 * Nothing but a verified file ever gets the .exe name: the file on disk is hashed, so another
 * writer can't slip in. Each process downloads to its own .part (several windows may check at
 * once). Files of other releases in <dir> are removed.
 * @returns {Promise<string>} the installer path
 */
async function downloadVerified(release, dir, { timeoutMs = DOWNLOAD_TIMEOUT_MS, keys = trustedKeys() } = {}) {
	fs.mkdirSync(dir, { recursive: true });
	const target = path.join(dir, `${release.id}.exe`);
	const part = path.join(dir, `${release.id}.${process.pid}.part`);
	const signal = AbortSignal.timeout(timeoutMs);
	try {
		const shaRes = await fetch(release.shaUrl, { headers: HEADERS, signal });
		if (!shaRes.ok) {
			throw new Error(`checksum download returned ${shaRes.status}`);
		}
		const shaBytes = Buffer.from(await shaRes.arrayBuffer());
		const sigRes = await fetch(release.sigUrl, { headers: HEADERS, signal });
		if (!sigRes.ok) {
			throw new Error(`signature download returned ${sigRes.status}`);
		}
		const expected = verifySignedSha(shaBytes, await sigRes.text(), release.id, keys);

		const res = await fetch(release.installerUrl, { headers: { 'user-agent': HEADERS['user-agent'] }, signal });
		if (!res.ok || !res.body) {
			throw new Error(`installer download returned ${res.status}`);
		}
		await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part), { signal });

		const actual = await hashFile(part);
		if (actual !== expected) {
			throw new Error(`checksum mismatch (expected ${expected}, got ${actual})`);
		}
		fs.renameSync(part, target);
	} catch (err) {
		fs.rmSync(part, { force: true });
		throw err;
	}
	for (const f of fs.readdirSync(dir)) {
		if (/\.(exe|part)$/i.test(f) && !f.startsWith(`${release.id}.`)) {
			fs.rmSync(path.join(dir, f), { force: true });
		}
	}
	return target;
}

module.exports = { fetchLatest, fetchPrevious, downloadVerified, hashFile };
