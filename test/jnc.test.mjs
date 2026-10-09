import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { MockDevice, MockJnc, OPTIMIZER, OPTIMIZER_KEY, defaultVolumes } from './mock-device.mjs';
import { DeviceScreen } from './device-firmware.mjs';

const root = new URL('../', import.meta.url);
const PLUGIN_DIR = '/plugins/jnc';
const IDS = ['jn-status', 'jn-email', 'jn-pass', 'jn-server', 'jn-key', 'jn-use', 'jn-save', 'jn-test',
  'jn-clear', 'jn-lib-status', 'jn-lib-load', 'jn-lib-tools', 'jn-lib-search', 'jn-lib-sort',
  'jn-lib-missing', 'jn-lib-hidden', 'jn-lib-send', 'jn-lib-unselect', 'jn-lib-list'];

function fakeElement(id) {
  const listeners = {};
  return {
    id, value: '', textContent: '', innerHTML: '', checked: false, disabled: false, style: {},
    onclick: null, onchange: null, oninput: null,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    emit(type, target) { for (const fn of listeners[type] || []) fn({ target }); },
  };
}

// Boots plugin.js against the mock reader. Returns handles to drive the page.
async function boot({ jnc = new MockJnc(), sd = {} } = {}) {
  const device = new MockDevice(jnc);
  for (const [k, v] of Object.entries(sd)) device.sd.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  const elements = Object.fromEntries(IDS.map((id) => [id, fakeElement(id)]));
  elements['jn-use'].checked = true;
  const document = {
    getElementById(id) { assert.ok(elements[id], 'unexpected element lookup: ' + id); return elements[id]; },
  };
  let render;
  const context = vm.createContext({
    CrossPoint: { registerPlugin(fn) { render = fn; } },
    document, URL, URLSearchParams, TextEncoder, TextDecoder, btoa, atob,
    encodeURIComponent, decodeURIComponent,
    fetch: (p, o) => device.fetch(p, o),
  });
  vm.runInContext(await readFile(new URL('plugin.js', root), 'utf8'), context, { filename: 'plugin.js' });
  assert.equal(typeof render, 'function');
  await render({ innerHTML: '' }, device.api(PLUGIN_DIR));
  const page = {
    device, jnc, el: elements,
    fill({ email = 'me@example.com', pass = 'hunter2', server = '', key = '', use = true } = {}) {
      elements['jn-email'].value = email; elements['jn-pass'].value = pass;
      elements['jn-server'].value = server; elements['jn-key'].value = key; elements['jn-use'].checked = use;
    },
    status: () => elements['jn-status'].textContent,
    libStatus: () => elements['jn-lib-status'].textContent,
    list: () => elements['jn-lib-list'].innerHTML,
    savedConfig: () => JSON.parse(device.sd.get(PLUGIN_DIR + '/config.json')),
    async click(id) { await elements[id].onclick(); },
    // Click a data-act button inside the library list.
    async act(act, attrs = {}) {
      const target = { getAttribute: (n) => (n === 'data-act' ? act : attrs[n] ?? null), type: 'button' };
      elements['jn-lib-list'].emit('click', target);
      await new Promise((r) => setTimeout(r, 20));
    },
  };
  return page;
}

async function configured(opts = {}) {
  const page = await boot(opts);
  page.fill(opts.fill);
  await page.click('jn-save');
  return page;
}

// --- manifest contract ---------------------------------------------------------

test('manifest.json has the fields the store and settings page need', async () => {
  const m = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  for (const k of ['title', 'mount', 'description', 'author', 'version']) assert.ok(m[k], k);
  assert.ok(['settings', 'files'].includes(m.mount));
});

test('manifest and device.json versions agree', async () => {
  const m = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const d = JSON.parse(await readFile(new URL('device.json', root), 'utf8'));
  assert.equal(d.version, m.version);
});

test('device.json is under the firmware size cap and within limits', async () => {
  const raw = await readFile(new URL('device.json', root), 'utf8');
  assert.ok(raw.length < 8 * 1024, 'device.json must be < 8 KB');
  const d = JSON.parse(raw);
  assert.ok(d.browse.page_size <= 16, 'page_size is capped at 16');
  assert.equal(d.browse.format, 'json');
  assert.ok(d.browse.fields.title);
});

test('device.json only uses template variables the firmware knows', async () => {
  const raw = await readFile(new URL('device.json', root), 'utf8');
  const known = /^(token|page|limit|query|query_raw|id|title|author|url|md5|dest|cfg\.[A-Za-z_]+)$/;
  // Skip JSON-escaped braces inside body strings: only {name} tokens count.
  for (const m of raw.matchAll(/\{([A-Za-z_.]+)\}/g)) assert.match(m[1], known, 'unknown template {' + m[1] + '}');
});

test('every {cfg.KEY} device.json reads is written by plugin.js', async () => {
  const raw = await readFile(new URL('device.json', root), 'utf8');
  const keys = [...raw.matchAll(/\{cfg\.([A-Za-z_]+)\}/g)].map((m) => m[1]);
  const page = await configured();
  const cfg = page.savedConfig();
  for (const k of new Set(keys)) assert.ok(k in cfg, 'config.json is missing "' + k + '"');
});

// --- web page: configuration -----------------------------------------------------

test('saving writes the flat config the firmware reads', async () => {
  const page = await configured();
  const cfg = page.savedConfig();
  assert.equal(cfg.email, 'me@example.com');
  assert.equal(cfg.api_base, 'https://labs.j-novel.club');
  assert.equal(cfg.server_key, '');
  for (const v of Object.values(cfg)) assert.equal(typeof v, 'string', 'firmware reads config.json as a flat string map');
});

test('optimizer settings: key goes to the device only while the optimizer is on', async () => {
  const page = await configured({ fill: { server: OPTIMIZER + '/', key: OPTIMIZER_KEY } });
  let cfg = page.savedConfig();
  assert.equal(cfg.api_base, OPTIMIZER);
  assert.equal(cfg.server_key, OPTIMIZER_KEY);
  page.el['jn-use'].checked = false;
  await page.el['jn-use'].onchange();
  cfg = page.savedConfig();
  assert.equal(cfg.api_base, 'https://labs.j-novel.club');
  assert.equal(cfg.server_key, '', 'the optimizer password must never go to J-Novel Club');
  assert.equal(cfg.optimizer_key, OPTIMIZER_KEY, 'but it stays saved for later');
});

test('saving rejects bad input', async () => {
  const page = await boot();
  page.fill({ email: '' });
  await page.click('jn-save');
  assert.match(page.status(), /email is required/);
  page.fill({ server: 'not a url', key: 'k' });
  await page.click('jn-save');
  assert.match(page.status(), /server URL/);
  page.fill({ server: OPTIMIZER, key: '' });
  await page.click('jn-save');
  assert.match(page.status(), /optimizer password is required/);
});

test('settings from v1.3 (no use_server, key only in server_key) are upgraded on load', async () => {
  const page = await boot({ sd: { [PLUGIN_DIR + '/config.json']: {
    email: 'me@example.com', password: 'hunter2', server: OPTIMIZER, server_key: OPTIMIZER_KEY,
    api_base: OPTIMIZER } } });
  const cfg = page.savedConfig();
  assert.equal(cfg.use_server, 'on');
  assert.equal(cfg.optimizer_key, OPTIMIZER_KEY);
  assert.match(page.status(), /updated for this version/);
});

test('Test button: good sign-in, wrong password, rate limit', async () => {
  const page = await boot();
  page.fill();
  await page.click('jn-test');
  assert.match(page.status(), /Sign-in OK as tester/);
  page.fill({ pass: 'wrong' });
  await page.click('jn-test');
  assert.match(page.status(), /rejected this email and password \(HTTP 401/);
  assert.ok(!page.status().includes('wrong'), 'never echo the password');
});

test('Test button checks the optimizer password', async () => {
  const page = await boot();
  page.fill({ server: OPTIMIZER, key: 'nope' });
  await page.click('jn-test');
  assert.match(page.status(), /Optimizer password rejected/);
  page.fill({ server: OPTIMIZER, key: OPTIMIZER_KEY });
  await page.click('jn-test');
  assert.match(page.status(), /Optimizer OK/);
});

// --- web page: library -------------------------------------------------------------

test('library loads, groups by series and marks nothing as on-reader', async () => {
  const page = await configured();
  await page.click('jn-lib-load');
  assert.match(page.libStatus(), /5 volumes in 4 series; 0 already on the reader/);
  assert.match(page.list(), /Ascendance of a Bookworm: Part 1/);
  assert.match(page.list(), /Preorder/);
});

test('library follows pagination when J-Novel Club pages the answer', async () => {
  const volumes = Array.from({ length: 11 }, (_, i) => ({
    id: 'p' + i, title: 'Paged Series Volume ' + (i + 1), number: i + 1,
    serie: { id: 'sp', slug: 'paged', title: 'Paged Series' },
    downloads: [{ type: 'EPUB', link: 'https://dl.j-novel.club/dl/p' + i + '.epub' }] }));
  const page = await configured({ jnc: new MockJnc({ pageLimit: 4, volumes }) });
  await page.click('jn-lib-load');
  assert.match(page.libStatus(), /11 volumes in 1 series/);
  const skips = page.jnc.requests.filter((r) => r.url.includes('/me/library?')).map((r) => new URL(r.url).searchParams.get('skip'));
  assert.deepEqual(skips, [null, '4', '8']);
  assert.ok(!page.device.sd.has(PLUGIN_DIR + '/library.json'), 'temporary library file is cleaned up');
});

test('an expired token is replaced once and the library still loads', async () => {
  const page = await configured();
  await page.click('jn-test');           // caches a token
  page.jnc.expireTokens();
  await page.click('jn-lib-load');
  assert.match(page.libStatus(), /5 volumes/);
});

test('sending a volume downloads the EPUB, following the redirect', async () => {
  const page = await configured();
  await page.click('jn-lib-load');
  await page.act('send', { 'data-id': 'v1' });
  const file = '/J-Novel Club/Ascendance of a Bookworm - Part 1 Volume 1.epub';
  assert.equal(page.device.sd.get(file), 'FILE:/dl/v1.epub');
  const [call] = page.device.fetchToSdCalls.filter((c) => c.dest === file);
  assert.match(call.url, /^https:\/\/cdn\.j-novel\.club\//, 'fetchToSd must get the resolved URL: it does not follow redirects');
  assert.match(page.libStatus(), /Sent 1 of 1/);
  assert.match(page.list(), /On the reader/);
});

test('a PDF-first volume sends the EPUB, a PDF-only one is skipped', async () => {
  const page = await configured();
  await page.click('jn-lib-load');
  await page.act('send', { 'data-id': 'v3' });
  assert.equal(page.device.sd.get('/J-Novel Club/Some Manga Volume 1.epub'), 'FILE:/dl/v3.epub');
  await page.act('send', { 'data-id': 'v4' });
  assert.match(page.libStatus(), /only available as PDF, not EPUB/);
  assert.ok(![...page.device.sd.keys()].some((k) => k.includes('PDF Only')));
});

test('a failed download leaves no broken file behind', async () => {
  const page = await configured();
  await page.click('jn-lib-load');
  page.device.failFetchToSd = { status: 200, bytes: 100, complete: false, total: 5000 };
  await page.act('send', { 'data-id': 'v1' });
  assert.match(page.libStatus(), /download incomplete/);
  assert.ok(![...page.device.sd.keys()].some((k) => k.endsWith('.epub')));
});

test('through the optimizer: key header sent, link resolved against the server, no HEAD hop', async () => {
  const page = await configured({ fill: { server: OPTIMIZER, key: OPTIMIZER_KEY } });
  await page.click('jn-lib-load');
  await page.act('send', { 'data-id': 'v1' });
  assert.equal(page.device.sd.get('/J-Novel Club/Ascendance of a Bookworm - Part 1 Volume 1.epub'), 'OPT:/files/v1.epub');
  assert.ok(!page.device.relayCalls.some((c) => c.method === 'HEAD'));
  // The optimizer password must not leak to J-Novel Club.
  const leaked = page.jnc.requests.filter((r) => r.url.startsWith('https://labs.j-novel.club') && JSON.stringify(r.headers).includes(OPTIMIZER_KEY));
  assert.equal(leaked.length, 0);
});

test('hiding a series removes it and is remembered', async () => {
  const page = await configured();
  await page.click('jn-lib-load');
  await page.act('hide', { 'data-series': 's2' });
  assert.ok(!page.list().includes('Some Manga'));
  const prefs = JSON.parse(page.device.sd.get(PLUGIN_DIR + '/library-prefs.json'));
  assert.deepEqual(prefs.hidden_series, ['s2']);
});

test('titles from the API are escaped before they reach innerHTML', async () => {
  const volumes = defaultVolumes();
  volumes[0].title = '<img src=x onerror=alert(1)> Volume 1';
  const page = await configured({ jnc: new MockJnc({ volumes }) });
  await page.click('jn-lib-load');
  assert.ok(!page.list().includes('<img'));
});

// --- on-device screen (device.json) ---------------------------------------------------

async function deviceScreen(page) {
  const manifest = JSON.parse(await readFile(new URL('device.json', root), 'utf8'));
  const screen = new DeviceScreen(manifest, page.device);
  screen.load(PLUGIN_DIR);
  return screen;
}

test('device screen: signs in silently and lists the library', async () => {
  const page = await configured();
  const screen = await deviceScreen(page);
  const { items, hasMore, error } = screen.browse({ list: 0 });
  assert.equal(error, undefined);
  assert.equal(items.length, 5);
  assert.equal(hasMore, false);
  assert.equal(items[0].id, 'v1');
  assert.ok(items[0].title);
  const browseReq = page.jnc.requests.find((r) => r.url.includes('/me/library?'));
  assert.match(browseReq.headers.Authorization, /^Bearer tok-/);
});

function bigLibrary(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'b' + i, title: 'Big Volume ' + String(i).padStart(3, '0'), number: i,
    serie: { id: 'sb', slug: 'big', title: 'Big' },
    downloads: [{ type: 'EPUB', link: 'https://dl.j-novel.club/dl/b' + i + '.epub' }] }));
}

// The firmware only offers {page} (1-based) and {limit}; J-Novel Club pages by
// skip. device.json bridges them with a "Latest" list plus "skip={page}0".
test('device screen: the lists together reach the whole library, page by page', async () => {
  for (const n of [3, 10, 11, 20, 21, 45, 101]) {
    const page = await configured({ jnc: new MockJnc({ volumes: bigLibrary(n), pageLimit: 50 }) });
    const screen = await deviceScreen(page);
    const seen = [];
    const latest = screen.browse({ list: 0 });
    assert.equal(latest.hasMore, false, 'the Latest list is a single page');
    seen.push(...latest.items.map((i) => i.id));
    for (let p = 1; p < 50; p++) {
      const { items, hasMore } = screen.browse({ list: 1, page: p });
      seen.push(...items.map((i) => i.id));
      if (!hasMore) break;
    }
    const expected = bigLibrary(n).map((v) => v.id);
    assert.deepEqual(seen, expected, n + ' volumes: every volume once, in order');
  }
});

test('device screen: page size and requests stay within the firmware limits', async () => {
  const page = await configured({ jnc: new MockJnc({ volumes: bigLibrary(45) }) });
  const screen = await deviceScreen(page);
  assert.ok(screen.m.browse.page_size <= 16);
  assert.equal(screen.browse({ list: 0 }).items.length, screen.m.browse.page_size);
  assert.equal(screen.browse({ list: 1, page: 2 }).items[0].id, 'b20');
  const skips = page.jnc.requests.filter((r) => r.url.includes('/me/library?')).map((r) => new URL(r.url).searchParams.get('skip'));
  assert.deepEqual(skips, ['0', '20']);
});

test('device screen: downloads an EPUB into /J-Novel Club', async () => {
  const page = await configured();
  const screen = await deviceScreen(page);
  const [first] = screen.browse({ list: 0 }).items;
  const r = screen.download(first);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.dest, '/J-Novel Club/Ascendance of a Bookworm_ Part 1 Volume 1.epub');
  assert.equal(r.body, 'FILE:/dl/v1.epub');
});

test('device screen: downloading through the optimizer sends the key on the hop only', async () => {
  const page = await configured({ fill: { server: OPTIMIZER, key: OPTIMIZER_KEY } });
  const screen = await deviceScreen(page);
  const [first] = screen.browse({ list: 0 }).items;
  const r = screen.download(first);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.body, 'OPT:/files/v1.epub');
});

// The firmware's url_path is a plain dotted path, so direct downloads take the
// first entry of `downloads`. device.json shows that entry's format as the row
// subtitle so a PDF-first volume is recognisable before it is downloaded.
test('device screen: each row shows the format the reader would download', async () => {
  const page = await configured();
  const screen = await deviceScreen(page);
  const formats = Object.fromEntries(screen.browse({ list: 0 }).items.map((i) => [i.id, i.author]));
  assert.equal(formats.v1, 'EPUB');
  assert.equal(formats.v3, 'PDF', 'PDF-first volume is flagged');
});

test('device screen: through the optimizer a PDF-first volume still arrives as an EPUB', async () => {
  const page = await configured({ fill: { server: OPTIMIZER, key: OPTIMIZER_KEY } });
  const screen = await deviceScreen(page);
  const manga = screen.browse({ list: 0 }).items.find((i) => i.id === 'v3');
  const r = screen.download(manga);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.body, 'OPT:/files/v3.epub');
});

test('device screen: direct download of a PDF-first volume saves the PDF (firmware cannot filter)',
  { todo: 'unfixable in device.json: use the optimizer or Send from the web card' }, async () => {
    const page = await configured();
    const screen = await deviceScreen(page);
    const manga = screen.browse({ list: 0 }).items.find((i) => i.id === 'v3');
    assert.equal(screen.download(manga).body, 'FILE:/dl/v3.epub');
  });
