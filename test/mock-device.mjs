// A fake reader plus a fake J-Novel Club (and optimizer) for testing the plugin
// without hardware. Mirrors the documented device limits: the relay caps bodies
// at 32 KB and never follows redirects; fetchToSd never follows redirects.

export const JNC = 'https://labs.j-novel.club';
export const OPTIMIZER = 'http://optimizer.test:8000';
export const OPTIMIZER_KEY = 'secret-key';
const RELAY_CAP = 32 * 1024;

export class MockJnc {
  constructor({ pageLimit = 50, volumes = defaultVolumes() } = {}) {
    this.pageLimit = pageLimit;       // how many items the API sends per page
    this.volumes = volumes;           // [{id, title, number, serie, downloads, status}]
    this.tokens = new Set();
    this.counter = 0;
    this.password = 'hunter2';
    this.requests = [];               // every request seen, for assertions
  }

  expireTokens() { this.tokens.clear(); }

  handle(method, rawUrl, headers = {}, body = '') {
    const url = new URL(rawUrl);
    this.requests.push({ method, url: rawUrl, headers, body });
    const auth = headers.Authorization || headers.authorization || '';
    const token = auth.replace(/^Bearer /, '');
    const json = (status, obj) => ({ status, headers: [['content-type', 'application/json']], body: JSON.stringify(obj) });

    if (url.host === 'labs.j-novel.club') {
      if (url.pathname === '/app/v2/auth/login' && method === 'POST') {
        const b = JSON.parse(body || '{}');
        if (b.login === 'me@example.com' && b.password === this.password) {
          const id = 'tok-' + (++this.counter);
          this.tokens.add(id);
          return json(200, { id });
        }
        return json(401, { message: 'Invalid credentials' });
      }
      if (!this.tokens.has(token)) return json(401, { message: 'Unauthorized' });
      if (url.pathname === '/app/v2/me') return json(200, { username: 'tester' });
      if (url.pathname === '/app/v2/me/library') {
        const skip = Number(url.searchParams.get('skip') || 0);
        const limit = Math.min(Number(url.searchParams.get('limit') || this.pageLimit), this.pageLimit);
        const items = this.volumes.slice(skip, skip + limit).map(libraryItem);
        return json(200, {
          books: items,
          pagination: { limit, skip, lastPage: skip + limit >= this.volumes.length },
        });
      }
      const m = url.pathname.match(/^\/app\/v2\/me\/library\/volume\/([^/]+)$/);
      if (m) {
        const v = this.volumes.find((x) => x.id === decodeURIComponent(m[1]));
        if (!v) return json(404, { message: 'not found' });
        return json(200, libraryItem(v));
      }
      return json(404, { message: 'no route ' + url.pathname });
    }

    if (url.host === 'dl.j-novel.club') {
      // JNC download links redirect to a CDN, like the real service.
      return { status: 302, headers: [['Location', 'https://cdn.j-novel.club' + url.pathname]], body: '' };
    }
    if (url.host === 'cdn.j-novel.club') {
      if (method === 'HEAD') return { status: 200, headers: [], body: '' };
      return { status: 200, headers: [], body: 'FILE:' + url.pathname, binary: true };
    }

    if (url.origin === OPTIMIZER) {
      // File links are unauthenticated: the plugin never sends the key to them.
      if (url.pathname.startsWith('/files/')) return { status: 200, headers: [], body: 'OPT:' + url.pathname, binary: true };
      if (headers['X-Optimizer-Key'] !== OPTIMIZER_KEY) {
        return json(url.pathname === '/auth' ? 401 : 401, { error: 'bad optimizer password' });
      }
      if (url.pathname === '/auth') return json(200, { ok: true });
      const m = url.pathname.match(/^\/app\/v2\/me\/library\/volume\/([^/]+)$/);
      if (m) {
        const v = this.volumes.find((x) => x.id === decodeURIComponent(m[1]));
        if (!v) return json(404, { error: 'not found' });
        const epub = v.downloads.find((d) => d.type === 'EPUB');
        if (!epub) return json(415, { error: 'no EPUB for this volume' });
        return json(200, { ...libraryItem(v), downloads: [{ type: 'EPUB', link: OPTIMIZER + '/files/' + v.id + '.epub' }] });
      }
    }
    return json(404, { message: 'unknown host ' + url.host });
  }
}

function libraryItem(v) {
  return {
    volume: { id: v.id, legacyId: 'L' + v.id, title: v.title, shortTitle: v.shortTitle || v.title,
      slug: v.title.toLowerCase().replace(/\W+/g, '-'), number: v.number, owned: true, publishing: '2024-01-01T00:00:00Z' },
    serie: v.serie ? { id: v.serie.id, legacyId: 'S' + v.serie.id, slug: v.serie.slug, title: v.serie.title } : undefined,
    status: v.status || 'OWNED',
    purchased: v.purchased || '2024-05-01T00:00:00Z',
    downloads: v.downloads,
  };
}

export function defaultVolumes() {
  const serie = { id: 's1', slug: 'bookworm', title: 'Ascendance of a Bookworm: Part 1' };
  const dl = (id) => [
    { type: 'EPUB', link: 'https://dl.j-novel.club/dl/' + id + '.epub' },
  ];
  return [
    { id: 'v1', title: 'Ascendance of a Bookworm: Part 1 Volume 1', number: 1, serie, downloads: dl('v1') },
    { id: 'v2', title: 'Ascendance of a Bookworm: Part 1 Volume 2', number: 2, serie, downloads: dl('v2') },
    // A manga that comes as a PDF first, then an EPUB.
    { id: 'v3', title: 'Some Manga Volume 1', number: 1, serie: { id: 's2', slug: 'manga', title: 'Some Manga' },
      downloads: [{ type: 'PDF', link: 'https://dl.j-novel.club/dl/v3.pdf' }, { type: 'EPUB', link: 'https://dl.j-novel.club/dl/v3.epub' }] },
    // PDF only.
    { id: 'v4', title: 'PDF Only Volume 1', number: 1, serie: { id: 's3', slug: 'pdf', title: 'PDF Only' },
      downloads: [{ type: 'PDF', link: 'https://dl.j-novel.club/dl/v4.pdf' }] },
    // Preorder: nothing to download.
    { id: 'v5', title: 'Future Series Volume 1', number: 1, serie: { id: 's4', slug: 'future', title: 'Future Series' },
      status: 'PREORDER', downloads: [] },
  ];
}

// An in-memory SD card plus the browser-facing device API.
export class MockDevice {
  constructor(servers) {
    this.servers = servers;       // a MockJnc (also plays the optimizer)
    this.sd = new Map();          // absolute path -> string
    this.fetchToSdCalls = [];
    this.relayCalls = [];
    this.failFetchToSd = null;    // set to a result object to force a failure
  }

  http(method, url, headers, body) {
    return this.servers.handle(method, url, headers, body);
  }

  // The `api` object handed to the plugin.
  api(dir) {
    return {
      dir,
      name: 'jnc',
      relay: async (method, url, headers = {}, body = '') => {
        this.relayCalls.push({ method, url });
        const r = this.http(method, url, headers, body);
        let text = r.body;
        if (text.length > RELAY_CAP) text = text.slice(0, RELAY_CAP);
        return { status: r.status, headers: r.headers, body: text };
      },
      fetchToSd: async (url, dest, headers = {}) => {
        this.fetchToSdCalls.push({ url, dest, headers });
        if (this.failFetchToSd) return this.failFetchToSd;
        const r = this.http('GET', url, headers, '');
        if (r.status < 200 || r.status >= 300) return { status: r.status, bytes: 0, complete: false, total: 0 };
        this.sd.set(dest, r.body);
        return { status: r.status, bytes: r.body.length, complete: true, total: r.body.length };
      },
      writeFile: async (path, b64) => {
        const text = Buffer.from(b64, 'base64').toString('utf8');
        this.sd.set(path, text);
        return { ok: true, bytes: text.length };
      },
    };
  }

  // Same-origin endpoints of the device web server.
  async fetch(path, opts = {}) {
    const url = new URL(path, 'http://device.local');
    const res = (status, body) => ({
      ok: status >= 200 && status < 300, status,
      async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
      async json() { return typeof body === 'string' ? JSON.parse(body) : body; },
    });
    if (url.pathname === '/download') {
      const p = url.searchParams.get('path');
      return this.sd.has(p) ? res(200, this.sd.get(p)) : res(404, 'not found');
    }
    if (url.pathname === '/api/files') {
      const dir = url.searchParams.get('path').replace(/\/$/, '');
      const names = [...this.sd.keys()].filter((k) => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/'));
      return res(200, names.map((k) => ({ name: k.slice(dir.length + 1), isDirectory: false })));
    }
    if (url.pathname === '/delete' && opts.method === 'POST') {
      const p = new URLSearchParams(opts.body).get('path');
      this.sd.delete(p);
      return res(200, 'ok');
    }
    return res(404, 'no route');
  }
}
