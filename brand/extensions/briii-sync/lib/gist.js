// The GitHub Gist API: find, create, read and update the one secret Gist Briii Sync uses.
// `api` is { base, token, timeoutMs? }; base is https://api.github.com (tests pass a fake).
'use strict';

const DESCRIPTION = 'Briii Code settings';
const TIMEOUT_MS = 30 * 1000;

class GistError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

async function request(api, method, url, body) {
	const timeoutMs = api.timeoutMs || TIMEOUT_MS;
	let res;
	try {
		res = await fetch(url.startsWith('http') ? url : api.base + url, {
			method,
			headers: {
				authorization: `Bearer ${api.token}`,
				accept: 'application/vnd.github+json',
				'user-agent': 'briii-sync',
				...(body ? { 'content-type': 'application/json' } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (err) {
		if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
			throw new GistError(0, `GitHub didn't answer within ${Math.round(timeoutMs / 1000)} s (timed out).`);
		}
		throw new GistError(0, `Couldn't reach GitHub: ${err && err.message || err}`);
	}
	if (res.status === 401) {
		throw new GistError(401, 'GitHub refused the sign-in. Please sign in again.');
	}
	if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
		const reset = new Date(Number(res.headers.get('x-ratelimit-reset')) * 1000);
		throw new GistError(res.status, `GitHub's rate limit is reached. Try again after ${reset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`);
	}
	if (!res.ok) {
		let detail = '';
		try {
			detail = (await res.json()).message || '';
		} catch {
			// no JSON body
		}
		throw new GistError(res.status, `GitHub answered ${res.status}${detail ? `: ${detail}` : ''}.`);
	}
	return res;
}

const summary = g => ({ id: g.id, version: g.history && g.history[0] ? g.history[0].version : undefined, htmlUrl: g.html_url });

/** The Briii Gist of the signed-in user, or null. Walks every page of the user's gists. */
async function findGist(api) {
	let url = '/gists?per_page=100&page=1';
	while (url) {
		const res = await request(api, 'GET', url);
		const found = (await res.json()).find(g => g.description === DESCRIPTION);
		if (found) {
			return summary(await (await request(api, 'GET', `/gists/${found.id}`)).json());
		}
		const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') || '');
		url = next ? next[1] : null;
	}
	return null;
}

const toGistFiles = files => Object.fromEntries(Object.entries(files).map(([n, c]) => [n, c === null ? null : { content: c }]));

async function createGist(api, files) {
	const res = await request(api, 'POST', '/gists', { description: DESCRIPTION, public: false, files: toGistFiles(files) });
	return summary(await res.json());
}

/** @returns {Promise<{ id, version, htmlUrl, files: { [name: string]: string } }>} */
async function getGist(api, id) {
	const g = await (await request(api, 'GET', `/gists/${id}`)).json();
	const files = {};
	for (const [name, f] of Object.entries(g.files || {})) {
		files[name] = f.truncated ? await (await request(api, 'GET', f.raw_url)).text() : f.content;
	}
	return { ...summary(g), files };
}

/** `files`: name -> new content, or null to delete. */
async function updateGist(api, id, files) {
	const res = await request(api, 'PATCH', `/gists/${id}`, { files: toGistFiles(files) });
	return summary(await res.json());
}

module.exports = { findGist, createGist, getGist, updateGist, GistError, DESCRIPTION };
