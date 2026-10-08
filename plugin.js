// J-Novel Club setup for the reader. Collects the account email and password,
// plus the optional optimizer server's URL and password, in the browser and
// stores them in config.json in the plugin's folder. The
// on-device screen (device.json) then signs in silently, lists your library, and
// downloads each owned volume as an EPUB. Ordering books and buying coins are
// deliberately not supported: this plugin only fetches what you already own.
CrossPoint.registerPlugin(async (container, api) => {
  const CONFIG_PATH = api.dir + '/config.json';
  const LOGIN_URL = 'https://labs.j-novel.club/app/v2/auth/login?format=json';
  const ME_URL = 'https://labs.j-novel.club/app/v2/me?format=json';
  // device.json downloads from {cfg.api_base}/app/v2/me/library/volume/{id}:
  // J-Novel Club itself, or the optimizer server, which answers that same
  // request with a link to the optimized EPUB.
  const JNC_BASE = 'https://labs.j-novel.club';

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
    '<div class="setting-row">' +
    '<button type="button" class="btn-small btn-add" id="jn-save">Save</button> ' +
    '<button type="button" class="btn-small" id="jn-test">Test</button> ' +
    '<button type="button" class="btn-small" id="jn-clear" style="display:none">Clear</button>' +
    '</div>' +
    '<p style="color:#666">Use the email and password of your J-Novel Club account. ' +
    'Only volumes you already own can be downloaded. ' +
    'Leave the optimizer URL blank to download straight from J-Novel Club. ' +
    'With an optimizer server, downloads go through it: it shrinks the EPUB and refuses ' +
    'files the reader cannot open. Its password is the one the server was started with ' +
    '(OPTIMIZER_PASSWORD). ' +
    'Credentials are stored in plain text on the SD card.</p>';

  const el = (id) => document.getElementById(id);
  const status = (t) => { el('jn-status').textContent = t; };
  const clearBtn = el('jn-clear');

  function currentConfig() {
    const email = el('jn-email').value.trim();
    const password = el('jn-pass').value;
    if (!email) throw new Error('email is required');
    if (!password) throw new Error('password is required');
    const server = el('jn-server').value.trim().replace(/\/+$/, '');
    if (!server) {
      // Direct mode. server_key stays present (empty) so device.json's
      // {cfg.server_key} header template always has a value to fill in.
      return { email, password, server: '', server_key: '', api_base: JNC_BASE };
    }
    if (!/^https?:\/\/[^\s/]+$/.test(server)) throw new Error('server URL must look like https://host[:port], with no spaces');
    const serverKey = el('jn-key').value;
    if (!serverKey) throw new Error('optimizer password is required when a server URL is set');
    // device.json sends server_key as the X-Optimizer-Key header on every download.
    return { email, password, server, server_key: serverKey, api_base: server };
  }

  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  function writeConfig(cfg) {
    return api.writeFile(CONFIG_PATH, b64(JSON.stringify(cfg)));
  }

  async function loadConfig() {
    try {
      const r = await fetch('/download?path=' + encodeURIComponent(CONFIG_PATH));
      if (!r.ok) return null;
      return JSON.parse(await r.text());
    } catch (e) {
      return null;
    }
  }

  el('jn-save').onclick = async () => {
    try {
      await writeConfig(currentConfig());
      clearBtn.style.display = '';
      status('Saved. Browse from the device: Plugins → J-Novel Club.');
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
      // Same login the device performs, via the relay.
      const r = await api.relay('POST', LOGIN_URL,
        { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        JSON.stringify({ login: cfg.email, password: cfg.password, slim: true }));
      let parsed = null;
      try { parsed = JSON.parse(r.body); } catch (e) {}
      if (!parsed || !parsed.id || parsed.error) {
        status(signInFailure(r, parsed, cfg));
        return;
      }
      let name = '';
      try {
        const me = await api.relay('GET', ME_URL,
          { 'Accept': 'application/json', 'Authorization': 'Bearer ' + parsed.id }, '');
        const profile = JSON.parse(me.body);
        if (profile && profile.username) name = ' as ' + profile.username;
      } catch (e) {}
      if (!cfg.server) {
        status('Sign-in OK' + name + '. Downloads come straight from J-Novel Club (no optimizer).');
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
      clearBtn.style.display = 'none';
      status('Configuration cleared.');
    } catch (e) {
      status('Error: ' + e.message);
    }
  };

  const existing = await loadConfig();
  if (existing && existing.email) {
    el('jn-email').value = existing.email;
    el('jn-pass').value = existing.password || '';
    el('jn-server').value = existing.server || '';
    el('jn-key').value = existing.server_key || '';
    clearBtn.style.display = '';
    const mode = existing.server ? 'through the optimizer server.' : 'straight from J-Novel Club.';
    if (existing.server && !existing.server_key) {
      status('Add the optimizer password and Save: the server refuses downloads without it.');
    } else if (!existing.api_base || existing.server_key === undefined) {
      // Settings saved by an older version lack the keys device.json now
      // fills in; write them so on-device downloads keep working.
      try {
        await writeConfig(Object.assign({}, existing, {
          server: existing.server || '',
          server_key: existing.server_key || '',
          api_base: existing.server || JNC_BASE
        }));
        status('Settings updated for this version. Downloads come ' + mode);
      } catch (e) {
        status('Press Save once: settings from an older version need updating.');
      }
    } else {
      status('Configured: downloads come ' + mode + ' Browse from the device, or update below.');
    }
  } else {
    status('Not configured yet.');
  }
});
