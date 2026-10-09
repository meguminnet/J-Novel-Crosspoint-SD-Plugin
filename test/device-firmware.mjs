// A small interpreter for device.json that follows the firmware's documented
// behavior (PluginCatalogActivity.cpp): {token}/{cfg.KEY}/{page}/{limit}/{id}/
// {title} templating, dotted field paths, page_size + 1 lookahead, the
// password-grant sign-in, the url_path hop and filename sanitizing.

export function substitute(tpl, vars) {
  return String(tpl).replace(/\{([^{}]+)\}/g, (all, key) => {
    if (key.startsWith('cfg.')) return vars.cfg && key.slice(4) in vars.cfg ? String(vars.cfg[key.slice(4)]) : all;
    return key in vars ? String(vars[key]) : all;
  });
}

export function resolvePath(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

// FAT-unsafe characters are replaced; the extension survives truncation.
export function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
}

export class DeviceScreen {
  constructor(manifest, device) {
    this.m = manifest;
    this.device = device;       // MockDevice
    this.token = '';
    this.cfg = {};
    this.page = 1;
  }

  readJsonFile(path) {
    const text = this.device.sd.get(path);
    return text ? JSON.parse(text) : null;
  }

  // The firmware resolves a bare file name against the plugin's own folder.
  resolveFile(file, pluginDir) {
    return file.startsWith('/') ? file : pluginDir + '/' + file;
  }

  load(pluginDir) {
    this.pluginDir = pluginDir;
    if (this.m.config) this.cfg = this.readJsonFile(this.resolveFile(this.m.config.file, pluginDir)) || {};
    if (this.m.token) {
      const t = this.readJsonFile(this.resolveFile(this.m.token.file, pluginDir));
      this.token = t ? resolvePath(t, this.m.token.path) || '' : '';
    }
  }

  vars(item) {
    const v = { token: this.token, cfg: this.cfg, page: this.page, limit: (this.m.browse.page_size || 8) + 1 };
    if (item) Object.assign(v, { id: item.id, title: item.title, author: item.author, url: item.url });
    return v;
  }

  request(spec, vars) {
    const headers = {};
    for (const [k, val] of Object.entries(spec.headers || {})) headers[k] = substitute(val, vars);
    return this.device.http(spec.method || 'GET', substitute(spec.url, vars), headers, substitute(spec.body || '', vars));
  }

  signIn() {
    const a = this.m.auth;
    const r = this.request(a.request, this.vars());
    if (r.status < 200 || r.status >= 300) return false;
    this.token = resolvePath(JSON.parse(r.body), a.token_path || 'access_token') || '';
    return !!this.token;
  }

  // One page of the browse list, as the firmware parses it.
  // `list` picks an entry of browse.lists (the picker shown before browsing).
  browse({ list = -1, page = 1 } = {}) {
    this.page = page;
    if (!this.token && this.m.auth) this.signIn();
    const entry = list >= 0 ? this.m.browse.lists[list] : null;
    const spec = { ...this.m.browse, url: (entry && entry.url) || this.m.browse.url };
    let r = this.request(spec, this.vars());
    if (r.status === 401 && this.m.auth && this.signIn()) r = this.request(spec, this.vars());
    if (r.status < 200 || r.status >= 300) return { error: r.status, items: [], hasMore: false };
    const rows = resolvePath(JSON.parse(r.body), this.m.browse.items) || [];
    const f = this.m.browse.fields;
    const size = Math.min(this.m.browse.page_size || 8, 16);
    const items = rows.slice(0, size + 1).map((row) => ({
      title: resolvePath(row, f.title), author: f.author ? resolvePath(row, f.author) : '',
      id: f.id ? resolvePath(row, f.id) : '', url: f.url ? resolvePath(row, f.url) : '',
    })).filter((it) => it.title);
    return { items: items.slice(0, size), hasMore: items.length > size };
  }

  // Download one item; returns {ok, dest} or {ok:false, error}.
  download(item) {
    const d = this.m.download;
    const vars = this.vars(item);
    let fileUrl;
    if (d.url_path) {
      const r = this.request(d, vars);
      if (r.status < 200 || r.status >= 300) return { ok: false, error: 'hop ' + r.status };
      fileUrl = resolvePath(JSON.parse(r.body), d.url_path);
    } else {
      fileUrl = substitute(d.url, vars);
    }
    if (!fileUrl) return { ok: false, error: 'no url' };
    const filename = sanitizeFilename(substitute(d.filename || '{title}.epub', vars));
    const dir = this.cfg.dest_dir || d.dest_dir || '';
    const dest = dir + '/' + filename;
    // The file GET follows redirects (HttpDownloader) and, after a url_path hop,
    // does not carry the catalog's headers.
    let url = fileUrl;
    for (let hop = 0; hop < 5; hop++) {
      const r = this.device.http('GET', url, {}, '');
      if (r.status >= 300 && r.status < 400) {
        url = new URL(r.headers.find((h) => h[0].toLowerCase() === 'location')[1], url).toString();
        continue;
      }
      if (r.status < 200 || r.status >= 300) return { ok: false, error: 'file ' + r.status };
      this.device.sd.set(dest, r.body);
      return { ok: true, dest, body: r.body };
    }
    return { ok: false, error: 'too many redirects' };
  }
}
