// J-Novel Club setup for the reader. Collects the account email and password,
// plus the optional optimizer server's URL and password, in the browser and
// stores them in config.json in the plugin's folder. The
// on-device screen (device.json) then signs in silently, lists your library
// 10 volumes a page and downloads each as an EPUB. The firmware only offers
// {page} (1-based) and J-Novel Club pages with skip, so device.json uses a
// "Latest 10" list (skip=0) plus an "Older volumes" list with skip={page}0:
// page 1 skips 10, page 2 skips 20, and so on. No arithmetic needed.
//
// The card also has a library page for big libraries: volumes grouped by
// series, with search, sorting, hidden series, "already on the reader" marks
// and multi-select. Selected volumes are sent with api.fetchToSd, so the
// reader downloads them straight to the SD card. Hidden series only affect
// this page; the on-device list can't filter.
//
// Ordering books and buying coins are deliberately not supported: this plugin
// only fetches what you already own.
CrossPoint.registerPlugin(async (container, api) => {
  const CONFIG_PATH = api.dir + '/config.json';
  const LOGIN_URL = 'https://labs.j-novel.club/app/v2/auth/login?format=json';
  const ME_URL = 'https://labs.j-novel.club/app/v2/me?format=json';
  // device.json downloads from {cfg.api_base}/app/v2/me/library/volume/{id}:
  // J-Novel Club itself, or the optimizer server, which answers that same
  // request with a link to the optimized EPUB.
  const JNC_BASE = 'https://labs.j-novel.club';
  const LIBRARY_URL = JNC_BASE + '/app/v2/me/library?include=serie&format=json';
  // The library answer can be far over the relay's 32 KB cap, so the device
  // downloads it to this file and the page reads it back (then deletes it).
  const LIBRARY_TMP = api.dir + '/library.json';
  // Page-only preferences (hidden series, sort). Kept out of config.json,
  // which the firmware reads as a flat {cfg.KEY} map.
  const PREFS_PATH = api.dir + '/library-prefs.json';
  const DEST_DIR = '/J-Novel Club';

  container.innerHTML =
    '<h2>J-Novel Club</h2>' +
    '<p id="jn-status">Checking configuration…</p>' +
    '<div class="setting-row"><span class="setting-name">Email</span>' +
    '<span class="setting-control"><input type="text" id="jn-email" name="jnc-email" autocomplete="username"></span></div>' +
    '<div class="setting-row"><span class="setting-name">J-Novel Club password</span>' +
    '<span class="setting-control"><input type="password" id="jn-pass" name="jnc-password" autocomplete="current-password"></span></div>' +
    '<div class="setting-row"><span class="setting-name">Optimizer server URL (optional)</span>' +
    '<span class="setting-control"><input type="text" id="jn-server" placeholder="blank: download from J-Novel Club"></span></div>' +
    '<div class="setting-row"><span class="setting-name">Optimizer password</span>' +
    '<span class="setting-control"><input type="password" id="jn-key" name="optimizer-password" autocomplete="new-password" data-lpignore="true" data-1p-ignore></span></div>' +
    '<div class="setting-row"><label class="setting-name" for="jn-use">Use the optimizer server</label>' +
    '<span class="setting-control"><input type="checkbox" id="jn-use" checked></span></div>' +
    '<div class="setting-row">' +
    '<button type="button" class="btn-small btn-add" id="jn-save">Save</button> ' +
    '<button type="button" class="btn-small" id="jn-test">Test</button> ' +
    '<button type="button" class="btn-small" id="jn-clear" style="display:none">Clear</button>' +
    '</div>' +
    '<p style="color:#666">Use the email and password of your J-Novel Club account. ' +
    'Only volumes you already own can be downloaded. ' +
    'Leave the optimizer URL blank, or untick "Use the optimizer server", to download straight ' +
    'from J-Novel Club; the URL and password stay saved for when you tick it again. ' +
    'With an optimizer server, downloads go through it: it shrinks the EPUB and refuses ' +
    'files the reader cannot open. Its password is the one the server was started with ' +
    '(OPTIMIZER_PASSWORD). ' +
    'The optimizer server\'s code and setup guide are at '  +
    '<a href="https://github.com/meguminnet/Matcha-Epub-Optimizer" target="_blank" rel="noopener noreferrer">github.com/meguminnet/Matcha-Epub-Optimizer</a>. ' +
    'Credentials are stored in plain text on the SD card.</p>' +
    '<h3 style="margin:0.8em 0 0.2em">Library</h3>' +
    '<p id="jn-lib-status" style="color:#666">The reader pages through your library 10 volumes at a time, newest first. Here you can browse by series, search and send several volumes at once.</p>' +
    '<div class="setting-row">' +
    '<button type="button" class="btn-small btn-add" id="jn-lib-load">Load library</button>' +
    '</div>' +
    '<div id="jn-lib-tools" style="display:none">' +
    '<div class="setting-row"><span class="setting-control" style="width:100%">' +
    '<input type="text" id="jn-lib-search" placeholder="Search series or volume" style="width:100%"></span></div>' +
    '<div class="setting-row" style="flex-wrap:wrap;gap:0.4em 1em">' +
    '<label>Sort <select id="jn-lib-sort"><option value="title">Series A–Z</option>' +
    '<option value="recent">Recently purchased</option></select></label>' +
    '<label><input type="checkbox" id="jn-lib-missing"> Only volumes not on the reader</label>' +
    '<label><input type="checkbox" id="jn-lib-hidden"> Show hidden series</label>' +
    '</div>' +
    '<div class="setting-row">' +
    '<button type="button" class="btn-small btn-add" id="jn-lib-send" disabled>Send selected</button> ' +
    '<button type="button" class="btn-small" id="jn-lib-unselect" disabled>Clear selection</button>' +
    '</div>' +
    '<div id="jn-lib-list"></div>' +
    '</div>';


  const el = (id) => document.getElementById(id);
  const status = (t) => { el('jn-status').textContent = t; };
  const libStatus = (t) => { el('jn-lib-status').textContent = t; };
  const clearBtn = el('jn-clear');

  // config.json keys:
  //   server, optimizer_key  the optimizer's URL and password, kept even while
  //                          the optimizer is turned off
  //   use_server             "on" / "off" (strings: the firmware reads config.json
  //                          as a flat map of template values)
  //   api_base, server_key   what device.json actually uses: the optimizer and its
  //                          password when it is in use, else J-Novel Club and "".
  //                          server_key is emptied when off so the optimizer
  //                          password is never sent to J-Novel Club.
  function deviceKeys(server, optimizerKey, use) {
    return use === 'on' && server
      ? { server_key: optimizerKey, api_base: server }
      : { server_key: '', api_base: JNC_BASE };
  }

  // True when downloads go through the optimizer.
  function viaServer(cfg) {
    return cfg.api_base !== JNC_BASE;
  }

  function currentConfig() {
    const email = el('jn-email').value.trim();
    const password = el('jn-pass').value;
    if (!email) throw new Error('email is required');
    if (!password) throw new Error('password is required');
    const server = el('jn-server').value.trim().replace(/\/+$/, '');
    const optimizerKey = el('jn-key').value;
    const use = el('jn-use').checked ? 'on' : 'off';
    if (server && !/^https?:\/\/[^\s/]+$/.test(server)) {
      throw new Error('server URL must look like https://host[:port], with no spaces');
    }
    if (use === 'on' && server && !optimizerKey) {
      throw new Error('optimizer password is required while the optimizer is in use');
    }
    return Object.assign({ email, password, server, optimizer_key: optimizerKey, use_server: use },
      deviceKeys(server, optimizerKey, use));
  }

  // Settings from older versions: 1.3 kept the optimizer password only in
  // server_key and had no on/off switch (a server URL meant "in use").
  function upgradeConfig(cfg) {
    const server = cfg.server || '';
    const optimizerKey = cfg.optimizer_key !== undefined ? cfg.optimizer_key : (cfg.server_key || '');
    const use = cfg.use_server === 'on' || cfg.use_server === 'off' ? cfg.use_server : (server ? 'on' : 'off');
    return Object.assign({}, cfg, { server, optimizer_key: optimizerKey, use_server: use },
      deviceKeys(server, optimizerKey, use));
  }

  function modeText(cfg) {
    if (viaServer(cfg)) return 'through the optimizer server.';
    return cfg.server ? 'straight from J-Novel Club (optimizer turned off).' : 'straight from J-Novel Club.';
  }

  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function writeConfig(cfg) {
    return api.writeFile(CONFIG_PATH, b64(JSON.stringify(cfg)));
  }

  async function readJson(path) {
    try {
      const r = await fetch('/download?path=' + encodeURIComponent(path));
      if (!r.ok) return null;
      return JSON.parse(await r.text());
    } catch (e) {
      return null;
    }
  }

  function loadConfig() {
    return readJson(CONFIG_PATH);
  }

  async function post(path, params) {
    return fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
  }

  // --- sign-in ---------------------------------------------------------------

  let token = null;     // J-Novel Club token for this page visit
  let tokenFor = '';    // the email + password it was issued for

  // Same login the device performs, via the relay. Returns the token.
  async function signIn(cfg) {
    const r = await api.relay('POST', LOGIN_URL,
      { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      JSON.stringify({ login: cfg.email, password: cfg.password, slim: true }));
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch (e) {}
    if (!parsed || !parsed.id || parsed.error) throw new Error(signInFailure(r, parsed, cfg));
    token = parsed.id;
    tokenFor = cfg.email + '\n' + cfg.password;
    return token;
  }

  async function ensureToken(cfg, fresh) {
    if (!fresh && token && tokenFor === cfg.email + '\n' + cfg.password) return token;
    return signIn(cfg);
  }

  el('jn-save').onclick = async () => {
    try {
      await writeConfig(currentConfig());
      clearBtn.style.display = '';
      status('Saved. The reader lists your library (Plugins → J-Novel Club); load it here to browse by series.');
    } catch (e) {
      status('Error: ' + e.message);
    }
  };

  el('jn-test').onclick = async () => {
    let cfg;
    try {
      cfg = currentConfig();
    } catch (e) {
      status('Error: ' + e.message);
      return;
    }
    status('Testing sign-in…');
    try {
      let id;
      try {
        id = await signIn(cfg);
      } catch (e) {
        status(e.message);
        return;
      }
      let name = '';
      try {
        const me = await api.relay('GET', ME_URL,
          { 'Accept': 'application/json', 'Authorization': 'Bearer ' + id }, '');
        const profile = JSON.parse(me.body);
        if (profile && profile.username) name = ' as ' + profile.username;
      } catch (e) {}
      if (!viaServer(cfg)) {
        status('Sign-in OK' + name + '. Downloads come ' + modeText(cfg));
        return;
      }
      status('Sign-in OK' + name + '. Checking the optimizer…');
      status('Sign-in OK' + name + '. ' + await checkOptimizer(cfg));
    } catch (e) {
      status('Error: ' + e.message);
    }
  };

  // J-Novel Club answers a rejected login with 401 (and a body without an
  // "error" field), so say what happened instead of "unexpected response".
  function signInFailure(r, parsed, cfg) {
    const detail = parsed && (parsed.error || parsed.message || parsed.msg);
    const why = detail ? ' J-Novel Club says: ' + String(detail).slice(0, 120) + '.'
      : (r.body ? ' Response: ' + String(r.body).replace(/\s+/g, ' ').slice(0, 120) : '');
    if (r.status === 401 || r.status === 403 || (parsed && parsed.error)) {
      // The length (never the password) helps spot a browser autofilling the
      // wrong password into the field.
      return 'Sign-in failed: J-Novel Club rejected this email and password (HTTP ' + r.status +
        '; password field has ' + cfg.password.length + ' characters). Retype the password: ' +
        'your browser may have filled in a different one. Google/Facebook sign-in accounts cannot ' +
        'be used.' + why;
    }
    if (r.status === 429) return 'J-Novel Club is limiting sign-ins; wait a few minutes and try again.';
    return 'Unexpected response from J-Novel Club (HTTP ' + (r.status || 'none') + ').' + why;
  }

  // GET /auth checks the optimizer password without doing any work.
  async function checkOptimizer(cfg) {
    let r;
    try {
      r = await api.relay('GET', cfg.server + '/auth',
        { 'Accept': 'application/json', 'X-Optimizer-Key': cfg.server_key }, '');
    } catch (e) {
      return 'Optimizer unreachable: ' + e.message;
    }
    switch (r.status) {
      case 200: return 'Optimizer OK.';
      case 401: return 'Optimizer password rejected.';
      case 429: return 'Optimizer locked after too many wrong passwords; wait 10 minutes.';
      case 404: return 'That URL answers, but it is not an up-to-date optimizer server.';
      default: return 'Optimizer unreachable (' + (r.status ? 'HTTP ' + r.status : 'no response') + ').';
    }
  }

  clearBtn.onclick = async () => {
    try {
      await writeConfig({});
      el('jn-email').value = '';
      el('jn-pass').value = '';
      el('jn-server').value = '';
      el('jn-key').value = '';
      el('jn-use').checked = true;
      clearBtn.style.display = 'none';
      token = null;
      tokenFor = '';
      books = [];
      byId = new Map();
      selected.clear();
      el('jn-lib-tools').style.display = 'none';
      el('jn-lib-load').textContent = 'Load library';
      libStatus('The reader pages through your library 10 volumes at a time, newest first. Here you can browse by series, search and send several volumes at once.');
      status('Configuration cleared.');
    } catch (e) {
      status('Error: ' + e.message);
    }
  };

  // --- library: loading --------------------------------------------------------

  let books = [];            // [{id, title, number, seriesKey, seriesTitle, purchased, preorder}]
  let byId = new Map();
  let onReader = new Set();  // nameKey() of each EPUB in DEST_DIR
  const selected = new Set();
  const open = new Set();    // series keys whose group is expanded
  let prefs = { hidden_series: [], sort: 'title', missing_only: false };
  let hidden = new Set();
  let busy = false;

  // "Ascendance of a Bookworm: Part 1 Volume 2" -> "Ascendance of a Bookworm: Part 1",
  // for library entries that come without their series.
  function seriesFromTitle(title) {
    return title.replace(/[\s:,–-]*\b(?:Volume|Vol\.)\s*[\d.]+.*$/i, '').trim() || title;
  }

  function toBook(item) {
    const v = item && item.volume;
    if (!v || !v.id) return null;
    const s = item.serie || v.serie || null;
    const title = String(v.title || v.shortTitle || v.slug || v.id);
    const seriesTitle = String((s && (s.title || s.shortTitle)) || seriesFromTitle(title));
    return {
      id: String(v.id),
      title,
      number: Number(v.number) || 0,
      seriesKey: String((s && (s.id || s.legacyId || s.slug)) || 'title:' + seriesTitle.toLowerCase()),
      seriesTitle,
      purchased: Date.parse(item.purchased || '') || 0,
      preorder: String(item.status || '').toUpperCase() === 'PREORDER',
    };
  }

  // Compares file names loosely: the firmware and this page may replace
  // characters FAT can't store (":" and friends) differently.
  function nameKey(name) {
    return String(name).toLowerCase().replace(/\.epub$/, '').replace(/[^\p{L}\p{N}]+/gu, '');
  }

  function fileName(title) {
    let n = String(title).replace(/:/g, ' -').replace(/[\\/*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
    if (n.length > 180) n = n.slice(0, 180).trim();
    return (n || 'volume') + '.epub';
  }

  async function loadOnReader() {
    try {
      const r = await fetch('/api/files?path=' + encodeURIComponent(DEST_DIR));
      if (!r.ok) return new Set();
      return new Set((await r.json())
        .filter((e) => !e.isDirectory && /\.epub$/i.test(e.name))
        .map((e) => nameKey(e.name)));
    } catch (e) {
      return new Set();
    }
  }

  async function loadPrefs() {
    const p = await readJson(PREFS_PATH);
    if (p && typeof p === 'object') {
      prefs = {
        hidden_series: Array.isArray(p.hidden_series) ? p.hidden_series.map(String) : [],
        sort: p.sort === 'recent' ? 'recent' : 'title',
        missing_only: !!p.missing_only,
      };
    }
    hidden = new Set(prefs.hidden_series);
    el('jn-lib-sort').value = prefs.sort;
    el('jn-lib-missing').checked = prefs.missing_only;
  }

  async function savePrefs() {
    prefs.hidden_series = Array.from(hidden);
    try {
      await api.writeFile(PREFS_PATH, b64(JSON.stringify(prefs)));
    } catch (e) {
      libStatus('Could not save your page settings: ' + e.message);
    }
  }

  // One library request, downloaded to SD by the device and read back here.
  async function fetchLibraryPage(url, cfg) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await ensureToken(cfg, attempt > 0);
      const res = await api.fetchToSd(url, LIBRARY_TMP,
        { 'Accept': 'application/json', 'Authorization': 'Bearer ' + t });
      if (res && res.status === 401 && attempt === 0) continue;  // stale token: sign in again
      if (!res || res.error || (res.status && (res.status < 200 || res.status >= 300))) {
        throw new Error('J-Novel Club did not send the library (' +
          ((res && (res.error || (res.status && 'HTTP ' + res.status))) || 'no response') + ')');
      }
      const r = await fetch('/download?path=' + encodeURIComponent(LIBRARY_TMP));
      const text = r.ok ? await r.text() : '';
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error('the library answer could not be read (' + text.length + ' bytes' +
          (res.complete === false ? ', incomplete' : '') + ')');
      }
    }
    throw new Error('J-Novel Club refused the sign-in token');
  }

  async function fetchLibrary(cfg) {
    const items = [];
    const seen = new Set();
    let url = LIBRARY_URL;
    try {
      for (let page = 0; page < 100; page++) {
        const data = await fetchLibraryPage(url, cfg);
        const batch = (data && Array.isArray(data.books)) ? data.books : [];
        let added = 0;
        for (const it of batch) {
          const id = it && it.volume && it.volume.id;
          if (id && !seen.has(id)) { seen.add(id); items.push(it); added++; }
        }
        // The library normally comes whole. If J-Novel Club pages it, follow
        // the pagination until the last page (or until nothing new arrives).
        const pg = data && data.pagination;
        if (!pg || pg.lastPage !== false || !added) break;
        const limit = Number(pg.limit) || batch.length;
        url = LIBRARY_URL + '&skip=' + items.length + '&limit=' + limit;
        libStatus('Loading library… ' + items.length + ' volumes so far');
      }
    } finally {
      try { await post('/delete', { path: LIBRARY_TMP }); } catch (e) {}
    }
    return items.map(toBook).filter(Boolean);
  }

  el('jn-lib-load').onclick = async () => {
    if (busy) return;
    let cfg;
    try {
      cfg = currentConfig();
    } catch (e) {
      libStatus('Error: ' + e.message + ' (fill in the settings above first).');
      return;
    }
    busy = true;
    el('jn-lib-load').disabled = true;
    libStatus('Loading library…');
    try {
      const [list, files] = await Promise.all([fetchLibrary(cfg), loadOnReader()]);
      books = list;
      byId = new Map(books.map((b) => [b.id, b]));
      onReader = files;
      for (const id of Array.from(selected)) if (!byId.has(id)) selected.delete(id);
      el('jn-lib-tools').style.display = '';
      el('jn-lib-load').textContent = 'Refresh library';
      libStatus(summary());
    } catch (e) {
      libStatus('Error: ' + e.message);
    } finally {
      busy = false;
      el('jn-lib-load').disabled = false;
      render();
    }
  };

  // --- library: sending to the reader -------------------------------------------

  // The volume's downloads, from J-Novel Club or the optimizer (same request
  // and answer shape as the device's download hop).
  async function volumeDownloads(book, cfg) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await ensureToken(cfg, attempt > 0);
      const headers = { 'Accept': 'application/json', 'Authorization': 'Bearer ' + t };
      if (viaServer(cfg)) headers['X-Optimizer-Key'] = cfg.server_key;
      const r = await api.relay('GET', cfg.api_base + '/app/v2/me/library/volume/' +
        encodeURIComponent(book.id) + '?include=serie&format=json', headers, '');
      let body = null;
      try { body = JSON.parse(r.body); } catch (e) {}
      const err = body && body.error ? String(body.error) : '';
      if (r.status === 401) {
        if (viaServer(cfg) && /optimizer password/i.test(err)) throw new Error('the optimizer rejected its password');
        if (attempt === 0) continue;  // stale token: sign in again
        throw new Error('J-Novel Club refused the sign-in token');
      }
      if (r.status === 429) {
        throw new Error(viaServer(cfg) ? 'the optimizer is locking out this device for a few minutes'
          : 'J-Novel Club is limiting requests; wait a few minutes');
      }
      if (viaServer(cfg) && r.status === 415) throw new Error(err || 'no EPUB for this volume');
      if (r.status === 404) throw new Error(err || 'nothing to download yet (preorder?)');
      if (!r.status || r.status < 200 || r.status >= 300) {
        throw new Error(err || (r.status ? 'HTTP ' + r.status : 'no answer'));
      }
      if (!body) throw new Error('unreadable answer (' + String(r.body || '').length + ' bytes)');
      return Array.isArray(body.downloads) ? body.downloads : [];
    }
    throw new Error('J-Novel Club refused the sign-in token');
  }

  // Unlike the device, pick the EPUB by type: the list can start with a PDF.
  function pickEpub(downloads) {
    const list = downloads.filter((d) => d && typeof d === 'object');
    const epub = list.find((d) => String(d.type || '').toUpperCase() === 'EPUB' && d.link);
    if (epub) return epub.link;
    const kinds = Array.from(new Set(list.map((d) => String(d.type || 'unknown'))));
    if (kinds.length) throw new Error('only available as ' + kinds.join(', ') + ', not EPUB');
    throw new Error('nothing to download yet (preorder?)');
  }

  // fetchToSd does not follow redirects; resolve them through the relay first.
  async function resolveUrl(url) {
    for (let hop = 0; hop < 5; hop++) {
      let r;
      try { r = await api.relay('HEAD', url, {}, ''); } catch (e) { return url; }
      const s = r.status | 0;
      if (s < 300 || s >= 400) return url;
      let loc = '';
      for (const h of r.headers || []) if (String(h[0]).toLowerCase() === 'location') loc = h[1];
      if (!loc) return url;
      url = new URL(loc, url).toString();
    }
    return url;
  }

  function fileError(status, cfg) {
    if (viaServer(cfg)) {
      if (status === 404) return 'the download link expired; send it again';
      if (status === 422) return 'the optimizer refused the file (not a valid EPUB)';
      if (status === 413) return 'the file is over the optimizer\'s size limit';
      if (status === 429) return 'the optimizer is locking out this device for a few minutes';
    }
    return 'download failed (HTTP ' + status + ')';
  }

  function size(n) {
    n = Number(n) || 0;
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
  }

  async function sendBook(book, cfg) {
    const link = pickEpub(await volumeDownloads(book, cfg));
    let url = new URL(link, cfg.api_base + '/').toString();
    // Optimizer links never redirect, and a HEAD there would start the
    // optimization inside the relay call; only J-Novel Club links are resolved.
    if (!viaServer(cfg)) url = await resolveUrl(url);
    const dest = DEST_DIR + '/' + fileName(book.title);
    let res;
    try {
      res = await api.fetchToSd(url, dest, {});
    } catch (e) {
      res = { error: e.message };
    }
    let failure = '';
    if (!res || res.error) failure = 'download failed' + (res && res.error ? ': ' + res.error : '');
    else if (res.status && (res.status < 200 || res.status >= 300)) failure = fileError(res.status, cfg);
    else if (res.complete === false) failure = 'download incomplete (' + size(res.bytes) + ' of ' + size(res.total) + ')';
    if (failure) {
      // Don't leave a broken EPUB behind for the reader to choke on.
      try { await post('/delete', { path: dest }); } catch (e) {}
      throw new Error(failure);
    }
    onReader.add(nameKey(book.title));
  }

  async function sendBooks(ids) {
    if (busy || !ids.length) return;
    let cfg;
    try {
      cfg = currentConfig();
    } catch (e) {
      libStatus('Error: ' + e.message);
      return;
    }
    busy = true;
    render();
    const failures = [];
    let sent = 0;
    for (let i = 0; i < ids.length; i++) {
      const book = byId.get(ids[i]);
      if (!book) continue;
      libStatus('Sending ' + (i + 1) + ' of ' + ids.length + ': ' + book.title + '…' +
        (viaServer(cfg) ? ' (the optimizer may take a while on a first download)' : ''));
      try {
        await sendBook(book, cfg);
        selected.delete(book.id);
        sent++;
      } catch (e) {
        failures.push(book.title + ': ' + e.message);
      }
      render();
    }
    busy = false;
    let msg = 'Sent ' + sent + ' of ' + ids.length + ' to ' + DEST_DIR + '/.';
    if (failures.length) {
      msg += ' Failed: ' + failures.slice(0, 3).join('; ') +
        (failures.length > 3 ? '; and ' + (failures.length - 3) + ' more' : '') + '.';
    }
    libStatus(msg);
    render();
  }

  // --- library: rendering ----------------------------------------------------------

  let query = '';

  function groups() {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const showHidden = el('jn-lib-hidden').checked;
    const map = new Map();
    for (const b of books) {
      let g = map.get(b.seriesKey);
      if (!g) map.set(b.seriesKey, g = { key: b.seriesKey, title: b.seriesTitle, all: [], latest: 0 });
      g.all.push(b);
      g.latest = Math.max(g.latest, b.purchased);
    }
    const out = [];
    for (const g of map.values()) {
      g.hidden = hidden.has(g.key);
      if (g.hidden && !showHidden) continue;
      g.all.sort((a, b) => a.number - b.number || a.title.localeCompare(b.title));
      g.books = g.all.filter((b) =>
        (!prefs.missing_only || !onReader.has(nameKey(b.title))) &&
        (!words.length || words.every((w) => (g.title + ' ' + b.title).toLowerCase().includes(w))));
      if (g.books.length) out.push(g);
    }
    if (prefs.sort === 'recent') out.sort((a, b) => b.latest - a.latest || a.title.localeCompare(b.title));
    else out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  function summary() {
    const series = new Set(books.map((b) => b.seriesKey));
    const there = books.filter((b) => onReader.has(nameKey(b.title))).length;
    const hiddenCount = Array.from(series).filter((k) => hidden.has(k)).length;
    return books.length + ' volumes in ' + series.size + ' series; ' + there + ' already on the reader' +
      (hiddenCount ? '; ' + hiddenCount + ' series hidden' : '') + '.';
  }

  function render() {
    const list = el('jn-lib-list');
    const gs = groups();
    // Searching opens every matching series; otherwise keep what you opened.
    const autoOpen = !!query.trim();
    list.innerHTML = gs.map((g) => {
      const there = g.all.filter((b) => onReader.has(nameKey(b.title))).length;
      const missing = g.all.filter((b) => !b.preorder && !onReader.has(nameKey(b.title))).length;
      const key = escapeHtml(g.key);
      return '<details data-series="' + key + '"' + (autoOpen || open.has(g.key) ? ' open' : '') +
        ' style="margin:0.3em 0;' + (g.hidden ? 'opacity:0.6;' : '') + '">' +
        '<summary style="cursor:pointer"><strong>' + escapeHtml(g.title) + '</strong> ' +
        '<span style="color:#666">' + g.all.length + (g.all.length === 1 ? ' volume' : ' volumes') +
        ', ' + there + ' on the reader' + (g.hidden ? ', hidden' : '') + '</span></summary>' +
        '<div style="margin:0.3em 0 0.3em 1em">' +
        (missing ? '<button type="button" class="btn-small" data-act="select-missing" data-series="' + key + '">' +
          'Select the ' + missing + ' not on the reader</button> ' : '') +
        '<button type="button" class="btn-small" data-act="' + (g.hidden ? 'unhide' : 'hide') +
        '" data-series="' + key + '">' + (g.hidden ? 'Show this series' : 'Hide this series') + '</button>' +
        g.books.map((b) => {
          const isThere = onReader.has(nameKey(b.title));
          const id = escapeHtml(b.id);
          return '<div class="setting-row" style="align-items:center">' +
            '<label class="setting-name" style="flex:1">' +
            '<input type="checkbox" data-id="' + id + '"' + (selected.has(b.id) ? ' checked' : '') +
            (b.preorder || busy ? ' disabled' : '') + '> ' + escapeHtml(b.title) +
            (isThere ? ' <span style="color:#27ae60">On the reader</span>' : '') +
            (b.preorder ? ' <span style="color:#888">Preorder</span>' : '') + '</label>' +
            '<span class="setting-control">' + (b.preorder ? '' :
              '<button type="button" class="btn-small" data-act="send" data-id="' + id + '"' +
              (busy ? ' disabled' : '') + '>' + (isThere ? 'Send again' : 'Send') + '</button>') +
            '</span></div>';
        }).join('') +
        '</div></details>';
    }).join('') || (books.length ? '<p style="color:#888">No volumes match.</p>' : '');
    const n = selected.size;
    el('jn-lib-send').textContent = n ? 'Send ' + n + ' selected' : 'Send selected';
    el('jn-lib-send').disabled = busy || !n;
    el('jn-lib-unselect').disabled = busy || !n;
    el('jn-lib-load').disabled = busy;
  }

  const listEl = el('jn-lib-list');

  listEl.addEventListener('click', (e) => {
    const t = e.target;
    const act = t && t.getAttribute && t.getAttribute('data-act');
    if (!act || busy) return;
    const key = t.getAttribute('data-series');
    if (act === 'send') {
      sendBooks([t.getAttribute('data-id')]);
    } else if (act === 'select-missing') {
      for (const b of books) {
        if (b.seriesKey === key && !b.preorder && !onReader.has(nameKey(b.title))) selected.add(b.id);
      }
      render();
    } else if (act === 'hide' || act === 'unhide') {
      if (act === 'hide') {
        hidden.add(key);
        open.delete(key);
        for (const b of books) if (b.seriesKey === key) selected.delete(b.id);
      } else {
        hidden.delete(key);
      }
      savePrefs();
      libStatus(summary());
      render();
    }
  });

  listEl.addEventListener('change', (e) => {
    const t = e.target;
    const id = t && t.getAttribute && t.getAttribute('data-id');
    if (!id || t.type !== 'checkbox') return;
    if (t.checked) selected.add(id); else selected.delete(id);
    render();
  });

  // <details> toggle events don't bubble; listen in the capture phase.
  listEl.addEventListener('toggle', (e) => {
    const key = e.target && e.target.getAttribute && e.target.getAttribute('data-series');
    if (key === null || key === undefined || query.trim()) return;
    if (e.target.open) open.add(key); else open.delete(key);
  }, true);

  el('jn-lib-search').oninput = function () {
    query = this.value;
    render();
  };
  el('jn-lib-sort').onchange = function () {
    prefs.sort = this.value === 'recent' ? 'recent' : 'title';
    savePrefs();
    render();
  };
  el('jn-lib-missing').onchange = function () {
    prefs.missing_only = this.checked;
    savePrefs();
    render();
  };
  el('jn-lib-hidden').onchange = () => render();
  el('jn-lib-unselect').onclick = () => {
    selected.clear();
    render();
  };
  el('jn-lib-send').onclick = () => {
    // Send in the order shown on the page.
    const order = [];
    for (const g of groups()) for (const b of g.all) if (selected.has(b.id)) order.push(b.id);
    for (const id of selected) if (!order.includes(id)) order.push(id);
    sendBooks(order);
  };

  // --- boot ----------------------------------------------------------------------

  await loadPrefs();

  const existing = await loadConfig();
  if (existing && existing.email) {
    const cfg = upgradeConfig(existing);
    el('jn-email').value = cfg.email;
    el('jn-pass').value = cfg.password || '';
    el('jn-server').value = cfg.server;
    el('jn-key').value = cfg.optimizer_key;
    el('jn-use').checked = cfg.use_server === 'on';
    clearBtn.style.display = '';
    // Settings saved by an older version lack keys this version uses; write
    // them so on-device downloads keep working.
    const outdated = ['server', 'optimizer_key', 'use_server', 'server_key', 'api_base']
      .some((k) => cfg[k] !== existing[k]);
    let saved = !outdated;
    if (outdated) {
      try {
        await writeConfig(cfg);
        saved = true;
      } catch (e) {}
    }
    if (cfg.use_server === 'on' && cfg.server && !cfg.optimizer_key) {
      status('Add the optimizer password and Save (or untick "Use the optimizer server"): ' +
        'the server refuses downloads without it.');
    } else if (!saved) {
      status('Press Save once: settings from an older version need updating.');
    } else if (outdated) {
      status('Settings updated for this version. Downloads come ' + modeText(cfg));
    } else {
      status('Configured: downloads come ' + modeText(cfg) + ' The reader lists your library; load it here to browse by series.');
    }
  } else {
    status('Not configured yet.');
  }

  // The switch takes effect right away (on the reader too), without Save.
  el('jn-use').onchange = async () => {
    let cfg;
    try {
      cfg = currentConfig();
    } catch (e) {
      status('Not saved yet: ' + e.message + '. Fix it, then Save.');
      return;
    }
    try {
      await writeConfig(cfg);
      clearBtn.style.display = '';
      status('Saved: downloads now come ' + modeText(cfg));
    } catch (e) {
      status('Error: ' + e.message);
    }
  };
});
