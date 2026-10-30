// Live reload: the "assets" folder next to Studio 64 (STUDIO_LIVE_ASSETS moves it) is watched,
// and files that are checked in the Assets drawer's "Live" tab are re-imported into the running
// game as soon as their contents change (models in place, game textures, block materials, skies).
//
// Only checked files are looked at closely: the folder tree is read once a second, but only checked
// files are stat'ed, and a file is hashed (SHA-1) only after its size or time changed and then stayed
// the same for one more tick (exporters write big files in pieces). When a hash really changed, ONE
// open tab of each project that watches that file gets { type: 'livereload_changed', files } and does
// the re-import (the others follow through the normal 'assets' broadcast), so nothing is imported twice.
//
//   GET  /api/projects/:id/livereload               { root, files: [{ path, size, mtime, hash? }], dirs, state }
//   PUT  /api/projects/:id/livereload               { on?, rules? } -> state (broadcast as 'livereload_state')
//   GET  /api/livereload/file?path=a/b.fbx          the file (header x-livereload-hash)
//   ws   { type: 'livereload_hello' }               this tab can do re-imports (replies with the state)
//
// state = project.livereload = { on: bool, rules: { '<path or folder>': true | false } }
// A path is watched when the nearest rule (itself, then its folders, then '' = everything) is true.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const TICK_MS = 1000;
const MAX_ENTRIES = 8000;
const SKIP = /(^|\/)(\.|~\$|__MACOSX)|\.(tmp|swp|crdownload|part|blend1|bak)$/i; // hidden, temp and backup files

const README = `Studio 64 live assets folder
============================

Put models (.fbx .glb .gltf .obj .zip + their textures) and pictures (.png .jpg .webp .bmp .gif)
in here, in any sub-folders you like.

In Studio 64: Assets -> Live tab.
  1. Turn on "Live reload".
  2. Check the files or whole folders you want watched (uncheck what you don't need: fewer checked
     files = faster checks).
  3. Bring a file into the project from this folder (Models -> Choose files -> "From the live assets
     folder", or Textures / Materials / Sky -> choose a picture -> "From the live assets folder").
     Models and pictures you imported earlier by drag & drop are linked automatically when a file
     with the same name is in here.

Now save over the file in Blender / Photoshop / anything: the game picks the change up within a
second or two and replaces it in place (Mario keeps running). Every reload is one undo step.

Tip: keep each model with its textures in its own sub-folder. A model re-reads the textures next to it.
`;

const rel = (p) => p.split(path.sep).join('/');
const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

export function isWatched(rules, p) {
  if (!rules) return false;
  for (let q = p; ; q = dirname(q)) {
    if (Object.prototype.hasOwnProperty.call(rules, q)) return rules[q] === true;
    if (q === '') return false;
  }
}

function cleanRules(rules) {
  const out = {};
  if (!rules || typeof rules !== 'object') return out;
  for (const [k, v] of Object.entries(rules).slice(0, 4000)) {
    const p = String(k).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (p.split('/').some((s) => s === '..' || s === '.')) continue;
    out[p] = v === true;
  }
  return out;
}

export default (ctx) => {
  const { projects, hub, clients, json, readBody } = ctx;
  const ROOT = path.resolve(process.env.STUDIO_LIVE_ASSETS || path.join(ctx.ROOT, 'assets'));
  try {
    fs.mkdirSync(ROOT, { recursive: true });
    const readme = path.join(ROOT, 'README.txt');
    if (!fs.existsSync(readme)) fs.writeFileSync(readme, README);
  } catch (err) { console.error('[livereload] could not make the assets folder', ROOT, err.message); }
  console.log(`[livereload] live assets folder: ${ROOT}`);

  const stateOf = (p) => {
    const s = (p.livereload ||= {});
    s.on = !!s.on;
    s.respawn = !!s.respawn;
    s.rules = cleanRules(s.rules);
    return s;
  };

  // Resolve a relative path inside the folder (never outside it, also not through a link).
  function inside(p) {
    const r = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!r || r.split('/').some((s) => s === '..' || s === '.')) return null;
    const abs = path.resolve(ROOT, r);
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
    try {
      const real = fs.realpathSync(abs);
      const realRoot = fs.realpathSync(ROOT);
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
    } catch { return null; }
    return abs;
  }

  // ---- the tree --------------------------------------------------------------------------

  let tree = { files: [], dirs: [], sig: '' };
  async function walk() {
    const files = [], dirs = [];
    const stack = [''];
    while (stack.length && files.length + dirs.length < MAX_ENTRIES) {
      const d = stack.pop();
      let list;
      try { list = await fsp.readdir(path.join(ROOT, d), { withFileTypes: true }); } catch { continue; }
      for (const e of list) {
        const p = d ? `${d}/${e.name}` : e.name;
        if (SKIP.test(p) || p === 'README.txt') continue;
        if (e.isDirectory()) { dirs.push(p); stack.push(p); } else if (e.isFile()) files.push(p);
      }
    }
    files.sort(); dirs.sort();
    return { files, dirs, sig: `${files.join('|')}#${dirs.join('|')}` };
  }

  // ---- hashes ----------------------------------------------------------------------------

  const known = new Map(); // path -> { size, mtime, hash, pending: { size, mtime } | null }
  async function hashFile(p) {
    const h = crypto.createHash('sha1');
    await new Promise((resolve, reject) => {
      const s = fs.createReadStream(path.join(ROOT, p));
      s.on('data', (c) => h.update(c)); s.on('end', resolve); s.on('error', reject);
    });
    return h.digest('hex').slice(0, 20);
  }

  // Projects with live reload on and a tab open: their rules.
  function activeProjects() {
    const out = [];
    for (const [pid, set] of clients) {
      if (!set?.size) continue;
      const p = projects.getProject(pid);
      if (p?.livereload?.on) out.push(p);
    }
    return out;
  }

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const t = await walk();
      if (t.sig !== tree.sig) {
        tree = t;
        for (const k of known.keys()) if (!t.files.includes(k)) known.delete(k);
        for (const [pid, set] of clients) if (set?.size) hub.broadcast(pid, { type: 'livereload_tree' });
      }
      const active = activeProjects();
      if (!active.length) return;
      const watched = new Map(); // path -> [project]
      for (const f of tree.files) {
        for (const p of active) if (isWatched(p.livereload.rules, f)) { if (!watched.has(f)) watched.set(f, []); watched.get(f).push(p); }
      }
      const changed = new Map(); // project id -> [{ path, hash }]
      for (const [f, ps] of watched) {
        let st;
        try { st = await fsp.stat(path.join(ROOT, f)); } catch { continue; }
        const size = st.size, mtime = Math.floor(st.mtimeMs);
        let k = known.get(f);
        if (!k) { // first look: the baseline, no reload
          try { known.set(f, { size, mtime, hash: await hashFile(f), pending: null }); } catch { /* busy */ }
          continue;
        }
        if (k.size === size && k.mtime === mtime) { k.pending = null; continue; }
        // changed: wait until it stays the same for one tick (still being written otherwise)
        if (!k.pending || k.pending.size !== size || k.pending.mtime !== mtime) { k.pending = { size, mtime }; continue; }
        let hash;
        try { hash = await hashFile(f); } catch { continue; }
        const was = k.hash;
        Object.assign(k, { size, mtime, hash, pending: null });
        if (hash === was || !size) continue; // touched, not changed (or truncated mid-save)
        for (const p of ps) { if (!changed.has(p.id)) changed.set(p.id, []); changed.get(p.id).push({ path: f, hash }); }
      }
      for (const [pid, files] of changed) {
        const driver = [...(clients.get(pid) || [])].find((c) => c.liveReload && c.ws.readyState === 1);
        if (driver) hub.send(driver, { type: 'livereload_changed', files });
        console.log(`[livereload] ${pid}: ${files.map((x) => x.path).join(', ')}${driver ? '' : ' (no tab can reload)'}`);
      }
    } catch (err) { console.error('[livereload]', err); } finally { running = false; }
  }
  setInterval(tick, TICK_MS).unref?.();
  tick();

  // Current hash of a watched file (computed now if needed).
  async function hashOf(p) {
    const k = known.get(p);
    try {
      const st = await fsp.stat(path.join(ROOT, p));
      if (k && k.size === st.size && k.mtime === Math.floor(st.mtimeMs) && k.hash) return k.hash;
      const hash = await hashFile(p);
      known.set(p, { size: st.size, mtime: Math.floor(st.mtimeMs), hash, pending: null });
      return hash;
    } catch { return null; }
  }

  function sendState(p) { hub.broadcast(p.id, { type: 'livereload_state', state: stateOf(p) }); }

  return {
    async http(req, res, url) {
      if (url.pathname === '/api/livereload/file' && req.method === 'GET') {
        const p = String(url.searchParams.get('path') || '');
        const abs = inside(p);
        if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) { json(res, 404, { error: 'no such file in the live assets folder' }); return true; }
        const data = await fsp.readFile(abs);
        const hash = crypto.createHash('sha1').update(data).digest('hex').slice(0, 20);
        const st = fs.statSync(abs);
        known.set(p.replace(/\\/g, '/'), { size: st.size, mtime: Math.floor(st.mtimeMs), hash, pending: null });
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': data.length, 'cache-control': 'no-store', 'x-livereload-hash': hash, 'x-livereload-mtime': String(Math.floor(st.mtimeMs)) });
        res.end(data);
        return true;
      }
      const m = url.pathname.match(/^\/api\/projects\/([\w-]+)\/livereload$/);
      if (!m) return false;
      const proj = projects.getProject(m[1]);
      if (!proj) { json(res, 404, { error: 'no such project' }); return true; }
      const s = stateOf(proj);
      if (req.method === 'GET') {
        if (tree.sig === '') tree = await walk();
        const files = [];
        for (const f of tree.files) {
          let st = null;
          try { st = await fsp.stat(path.join(ROOT, f)); } catch { continue; }
          const e = { path: f, size: st.size, mtime: Math.floor(st.mtimeMs) };
          if (isWatched(s.rules, f)) e.hash = await hashOf(f);
          files.push(e);
        }
        json(res, 200, { root: ROOT, files, dirs: tree.dirs, state: s });
        return true;
      }
      if (req.method === 'PUT') {
        let body;
        try { body = (await readBody(req, 2e6)) || {}; } catch (err) { json(res, err.status || 400, { error: err.message }); return true; }
        if ('on' in body) s.on = !!body.on;
        if ('respawn' in body) s.respawn = !!body.respawn;
        if ('rules' in body) s.rules = cleanRules(body.rules);
        projects.save(proj);
        sendState(proj);
        json(res, 200, { state: s });
        return true;
      }
      json(res, 405, { error: 'method not allowed' });
      return true;
    },
    async ws(msg, client, project) {
      if (msg.type !== 'livereload_hello' || !project) return false;
      client.liveReload = true;
      // the first tab of the project that can reload also brings in what changed while Studio 64 was closed
      const driver = [...(clients.get(project.id) || [])].find((c) => c.liveReload && c.ws.readyState === 1) === client;
      hub.send(client, { type: 'livereload_state', state: stateOf(project), driver, hello: true });
      return true;
    },
  };
};
