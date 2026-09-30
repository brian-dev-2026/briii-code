// The release feed (GitHub's "latest release" API) and verified installer downloads.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const HEADERS = { 'user-agent': 'briii-update', accept: 'application/vnd.github+json' };

/** @returns {Promise<{ id: string, installerUrl: string, shaUrl: string, pageUrl: string } | null>} */
async function fetchLatest(feedUrl) {
	const res = await fetch(feedUrl, { headers: HEADERS });
	if (!res.ok) {
		throw new Error(`release feed returned ${res.status}`);
	}
	const release = await res.json();
	const id = String(release.tag_name || '').replace(/^v/, '');
	const asset = name => (release.assets || []).find(a => a.name === name);
	const exe = asset(`BriiiCode-Setup-x64-${id}.exe`);
	const sha = asset(`BriiiCode-Setup-x64-${id}.exe.sha256`);
	if (!id || !exe || !sha) {
		return null;
	}
	return { id, installerUrl: exe.browser_download_url, shaUrl: sha.browser_download_url, pageUrl: release.html_url };
}

/**
 * Downloads the installer to <dir>/<id>.exe, checking it against the published SHA-256.
 * Nothing but a verified file ever gets the .exe name. Older installers in <dir> are removed.
 * @returns {Promise<string>} the installer path
 */
async function downloadVerified(release, dir) {
	fs.mkdirSync(dir, { recursive: true });
	const target = path.join(dir, `${release.id}.exe`);
	const part = `${target}.part`;
	try {
		const shaRes = await fetch(release.shaUrl, { headers: HEADERS });
		if (!shaRes.ok) {
			throw new Error(`checksum download returned ${shaRes.status}`);
		}
		const expected = (await shaRes.text()).trim().split(/\s+/)[0].toLowerCase();

		const res = await fetch(release.installerUrl, { headers: { 'user-agent': HEADERS['user-agent'] } });
		if (!res.ok || !res.body) {
			throw new Error(`installer download returned ${res.status}`);
		}
		const hash = crypto.createHash('sha256');
		const body = Readable.fromWeb(res.body);
		body.on('data', chunk => hash.update(chunk));
		await pipeline(body, fs.createWriteStream(part));

		const actual = hash.digest('hex');
		if (actual !== expected) {
			throw new Error(`checksum mismatch (expected ${expected}, got ${actual})`);
		}
		fs.renameSync(part, target);
	} catch (err) {
		fs.rmSync(part, { force: true });
		throw err;
	}
	for (const f of fs.readdirSync(dir)) {
		if (/\.(exe|part)$/i.test(f) && path.join(dir, f) !== target) {
			fs.rmSync(path.join(dir, f), { force: true });
		}
	}
	return target;
}

module.exports = { fetchLatest, downloadVerified };
