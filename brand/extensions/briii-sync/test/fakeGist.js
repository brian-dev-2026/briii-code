// Test helper: an in-memory GitHub Gist API.
//   GET /gists?per_page&page   list (Link: rel="next" while more pages exist)
//   POST /gists                create
//   GET /gists/:id             get (names in `truncate` come back truncated with a raw_url)
//   PATCH /gists/:id           update (a file set to null is deleted)
//   GET /raw/:id/:name         raw file content
// Every request needs `authorization: Bearer <token>`, else 401. `rateLimited` answers 403 with
// x-ratelimit-reset; `stall` never answers.
'use strict';

const http = require('http');

async function startFakeGist({ gists = [], pageSize = 100, truncate = [], rateLimited = false, stall = false } = {}) {
	const token = 'test-token';
	const state = { gists: new Map(), created: [] };
	let next = 1;
	const addGist = ({ description, public: isPublic = false, files = {} }) => {
		const id = `g${next++}`;
		state.gists.set(id, { id, description, public: isPublic, files: { ...files }, versions: [`v${id}-1`] });
		return state.gists.get(id);
	};
	gists.forEach(addGist);
	const hits = [];

	const server = http.createServer((req, res) => {
		hits.push(`${req.method} ${req.url}`);
		if (stall) {
			return;
		}
		const base = `http://127.0.0.1:${server.address().port}`;
		const send = (status, body, headers = {}) => {
			res.writeHead(status, { 'content-type': 'application/json', ...headers });
			res.end(body === undefined ? '' : JSON.stringify(body));
		};
		if (req.headers.authorization !== `Bearer ${token}`) {
			return send(401, { message: 'Bad credentials' });
		}
		if (rateLimited) {
			return send(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' });
		}
		const view = g => ({
			id: g.id,
			description: g.description,
			public: g.public,
			html_url: `${base}/gist/${g.id}`,
			history: [...g.versions].reverse().map(version => ({ version })),
			files: Object.fromEntries(Object.entries(g.files).map(([name, content]) => {
				const cut = truncate.includes(name);
				return [name, { filename: name, content: cut ? content.slice(0, 5) : content, truncated: cut, raw_url: `${base}/raw/${g.id}/${encodeURIComponent(name)}` }];
			})),
		});
		let body = '';
		req.on('data', c => { body += c; });
		req.on('end', () => {
			const url = new URL(req.url, base);
			const m = url.pathname.match(/^\/gists\/([^/]+)$/);
			const raw = url.pathname.match(/^\/raw\/([^/]+)\/(.+)$/);
			if (req.method === 'GET' && url.pathname === '/gists') {
				const all = [...state.gists.values()];
				const size = Math.min(Number(url.searchParams.get('per_page') || 30), pageSize);
				const page = Number(url.searchParams.get('page') || 1);
				const items = all.slice((page - 1) * size, page * size).map(g => ({ id: g.id, description: g.description, html_url: `${base}/gist/${g.id}` }));
				const more = page * size < all.length;
				return send(200, items, more ? { link: `<${base}/gists?per_page=${size}&page=${page + 1}>; rel="next"` } : {});
			}
			if (req.method === 'POST' && url.pathname === '/gists') {
				const b = JSON.parse(body);
				const g = addGist({ description: b.description, public: b.public, files: Object.fromEntries(Object.entries(b.files).map(([n, f]) => [n, f.content])) });
				state.created.push(b);
				return send(201, view(g));
			}
			if (m && state.gists.has(m[1])) {
				const g = state.gists.get(m[1]);
				if (req.method === 'GET') {
					return send(200, view(g));
				}
				if (req.method === 'PATCH') {
					for (const [n, f] of Object.entries(JSON.parse(body).files)) {
						if (f === null) {
							delete g.files[n];
						} else {
							g.files[n] = f.content;
						}
					}
					g.versions.push(`v${g.id}-${g.versions.length + 1}`);
					return send(200, view(g));
				}
			}
			if (raw && req.method === 'GET' && state.gists.has(raw[1])) {
				res.writeHead(200, { 'content-type': 'text/plain' });
				return res.end(state.gists.get(raw[1]).files[decodeURIComponent(raw[2])]);
			}
			send(404, { message: 'Not Found' });
		});
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	return {
		base: `http://127.0.0.1:${server.address().port}`,
		token,
		state,
		hits,
		addGist,
		close: () => new Promise(r => { server.close(r); server.closeAllConnections(); }),
	};
}

module.exports = { startFakeGist };
