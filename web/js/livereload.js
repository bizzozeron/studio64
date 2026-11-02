// Live reload (browser side): files in the live assets folder (server/routes/livereload.js) that are
// checked in the Assets drawer's "Live" tab are re-imported as soon as they change, with the settings
// they were imported with, and replace the project's copy in place:
//
//   models (.fbx .glb .gltf .obj .zip, + textures next to them)  -> same model id: every placement is
//                                                                 rebuilt where it stands (Mario keeps running)
//   pictures linked to a game texture                            -> the texture replacement
//   pictures linked to a block material                          -> the material (same slot / number)
//   pictures linked to a sky                                     -> the sky (same level / all levels)
//
// A project asset is linked to a file by `live: { path, hash }` on its entry (set when it is brought in
// from the live folder), or, for assets imported earlier by drag & drop, by the file name: a model by
// the names in its `source.files`, a texture by its note (the picture's name), a material or sky by name.
// Every reload is one undo step ("Live reload: castle.fbx").

import { importModel } from './asset_import.js';
import { buildPackage, encodePackage, defaultMaterialMeta, keepMaterialMeta } from './asset_mesh.js';
import { thumbnail } from './asset_preview.js';
import { rasterize, quantize, pow2 } from './texcodec.js';

export const MODEL_EXTS = ['fbx', 'glb', 'gltf', 'obj', 'zip'];
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];
// files a model may read next to it (textures, materials, buffers)
const COMPANION_EXTS = ['mtl', 'bin', 'tga', ...IMAGE_EXTS];

const extOf = (p) => String(p).toLowerCase().split('.').pop();
const baseOf = (p) => String(p).split('/').pop();
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const stem = (p) => baseOf(p).replace(/\.[^.]+$/, '');
const plain = (s) => String(s || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
export const isModelPath = (p) => MODEL_EXTS.includes(extOf(p));
export const isImagePath = (p) => IMAGE_EXTS.includes(extOf(p));

// nearest rule wins: the path itself, then its folders, then '' (everything)
export function isWatched(rules, p) {
  for (let q = p; ; q = dirOf(q)) {
    if (Object.prototype.hasOwnProperty.call(rules || {}, q)) return rules[q] === true;
    if (q === '') return false;
  }
}

export class LiveReload {
  constructor({ assets, send, toast }) {
    Object.assign(this, { assets, send, toast: toast || (() => {}) });
    this.state = { on: false, respawn: false, rules: {} };
    this.list = { root: '', files: [], dirs: [] };
    this.listeners = [];
    this.queue = new Map();   // target key -> { target, hash }
    this.busy = new Set();    // target keys being reloaded
    this.log = [];            // [{ at, path, ok, text }]
    this.status = new Map();  // path -> { at, ok, text }
    window.studio64LiveReload = this;
    window.addEventListener('studio-message', (e) => {
      const msg = e.detail;
      if (msg?.type === 'livereload_state') {
        const was = this.state.on;
        this.state = { on: !!msg.state?.on, respawn: !!msg.state?.respawn, rules: msg.state?.rules || {} };
        this.emit('state');
        if (msg.driver && this.state.on && (!was || msg.hello)) this.whenReady().then(() => this.catchUp());
      } else if (msg?.type === 'livereload_tree') {
        clearTimeout(this.treeTimer);
        this.treeTimer = setTimeout(() => this.refresh(), 250);
      } else if (msg?.type === 'livereload_changed') {
        this.changed(msg.files || []);
      }
    });
    // respawn switch: lives never run out while it is on
    assets.engine.afterAreaHooks.push(() => { if (this.state.respawn) assets.engine.M?._studio_set_lives_min?.(4); });
  }

  async setRespawn(on) {
    await this.put({ respawn: !!on });
    if (on) this.assets.engine.M?._studio_set_lives_min?.(4);
  }

  // Mario where he is now (null when he is not in a level).
  marioNow() {
    try { const m = this.assets.engine.state().mario; return m ? { x: m.x, y: m.y, z: m.z, yaw: m.yaw | 0, key: this.assets.key() } : null; } catch { return null; }
  }

  // Back where he was, a little above it (or above the new ground if it rose there), falling.
  dropMario(m) {
    const E = this.assets.engine;
    if (!m || m.key !== this.assets.key()) return;
    let y = m.y;
    try {
      const f = E.floor(m.x, m.y + 250, m.z); // the reloaded geometry may be higher now
      if (f > -10000 && f > y) y = f;
    } catch { /* no floor query */ }
    try { E.teleport(m.x, y + 60, m.z, m.yaw); } catch (err) { console.warn('live reload: could not put Mario back', err); }
  }

  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  emit(what) { for (const fn of this.listeners) { try { fn(what); } catch (err) { console.error(err); } } }

  // the websocket is (re)connected to the project
  connected() {
    this.send({ type: 'livereload_hello' });
    this.refresh();
  }

  async whenReady() {
    for (let i = 0; i < 600 && !(this.assets.loaded && this.assets.engine.ready); i++) await new Promise((r) => setTimeout(r, 100));
    await this.refresh();
  }

  base() { return `/api/projects/${this.assets.getProjectId()}/livereload`; }

  async refresh() {
    if (!this.assets.getProjectId()) return this.list;
    try {
      const r = await fetch(this.base(), { headers: this.assets.headers() });
      if (r.ok) {
        const j = await r.json();
        this.list = { root: j.root, files: j.files || [], dirs: j.dirs || [] };
        this.state = { on: !!j.state?.on, respawn: !!j.state?.respawn, rules: j.state?.rules || {} };
        this.emit('list');
      }
    } catch (err) { console.warn('livereload: no list', err); }
    return this.list;
  }

  async put(body) {
    Object.assign(this.state, body);
    this.emit('state');
    const r = await fetch(this.base(), { method: 'PUT', headers: this.assets.headers({ 'content-type': 'application/json' }), body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'could not save the live reload settings');
    const j = await r.json();
    this.state = { on: !!j.state.on, respawn: !!j.state.respawn, rules: j.state.rules || {} };
    this.emit('state');
  }

  async setOn(on) {
    await this.put({ on: !!on });
    if (on) { await this.refresh(); this.catchUp(); }
  }

  watched(p) { return isWatched(this.state.rules, p); }

  // A folder's check box: 'all' | 'none' | 'some' of the files below it.
  folderState(dir) {
    const pre = dir ? `${dir}/` : '';
    let y = 0, n = 0;
    for (const f of this.list.files) if (!pre || f.path.startsWith(pre)) { if (this.watched(f.path)) y++; else n++; }
    if (!y && !n) return this.watched(dir) ? 'all' : 'none';
    return !n ? 'all' : !y ? 'none' : 'some';
  }

  // Check / uncheck a file or a whole folder ('' = everything).
  async toggle(p, isDir) {
    const rules = { ...this.state.rules };
    const want = isDir ? this.folderState(p) !== 'all' : !this.watched(p);
    if (isDir) for (const k of Object.keys(rules)) if (p === '' || k.startsWith(`${p}/`)) delete rules[k];
    rules[p] = want;
    // a rule that says what its folder already says is not needed
    if (p !== '' && isWatched(rules, dirOf(p)) === want) delete rules[p];
    if (p === '' && !want) delete rules[''];
    await this.put({ rules });
    if (want) await this.refresh(); // hashes of the newly watched files
  }

  async watch(paths) {
    const rules = { ...this.state.rules };
    let any = false;
    for (const p of paths) if (!isWatched(rules, p)) { rules[p] = true; any = true; }
    if (any) await this.put({ rules });
  }

  // ---- files -----------------------------------------------------------------------

  async fetchFile(p) {
    const r = await fetch(`/api/livereload/file?path=${encodeURIComponent(p)}`, { headers: this.assets.headers() });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `could not read ${p}`);
    const f = new File([await r.arrayBuffer()], baseOf(p), { lastModified: Number(r.headers.get('x-livereload-mtime')) || Date.now() });
    f.livePath = p;
    f.liveHash = r.headers.get('x-livereload-hash');
    return f;
  }

  filesIn(dir) { return this.list.files.filter((f) => dirOf(f.path) === dir); }

  // The files a model reads: the model file plus the textures / .mtl / .bin next to it.
  companionsOf(mainPath, names = null) {
    const want = names ? new Set(names.map((n) => n.toLowerCase())) : null;
    return this.filesIn(dirOf(mainPath)).filter((f) => f.path !== mainPath && COMPANION_EXTS.includes(extOf(f.path)) && (!want || want.has(baseOf(f.path).toLowerCase())))
      .slice(0, 40).map((f) => f.path);
  }

  // A model file from the folder with what it reads (for the import dialog): main first.
  async modelFiles(mainPath) {
    const paths = [mainPath, ...this.companionsOf(mainPath)];
    return Promise.all(paths.map((p) => this.fetchFile(p)));
  }

  // ---- links -----------------------------------------------------------------------

  byName(name, exts) {
    if (!name) return null;
    const n = String(name).toLowerCase();
    const hit = this.list.files.find((f) => exts.includes(extOf(f.path)) && baseOf(f.path).toLowerCase() === n);
    return hit?.path || null;
  }

  byStem(name, exts) {
    const n = plain(name);
    if (!n) return null;
    return this.list.files.find((f) => exts.includes(extOf(f.path)) && plain(stem(f.path)) === n)?.path || null;
  }

  // Every project asset that comes from a file in the folder:
  // [{ key, kind: 'model'|'texture'|'material'|'sky', id, label, main, deps: [paths], hash, auto }]
  targets() {
    const m = this.assets.meta;
    const out = [];
    const have = new Set(this.list.files.map((f) => f.path));
    for (const x of m.models || []) {
      const names = x.source?.files || [];
      const main = (x.live?.path && have.has(x.live.path) && x.live.path) || names.map((n) => this.byName(n, MODEL_EXTS)).find(Boolean);
      if (!main) continue;
      const deps = [main, ...this.companionsOf(main, names.filter((n) => !isModelPath(n)))];
      out.push({ key: `model:${x.id}`, kind: 'model', id: x.id, label: x.name, main, deps, hash: x.live?.path === main ? x.live.hash : null, auto: x.live?.path !== main });
    }
    for (const [tp, r] of Object.entries(m.textures || {})) {
      const main = (r.live?.path && have.has(r.live.path) && r.live.path) || this.byName(r.note, IMAGE_EXTS);
      if (main) out.push({ key: `texture:${tp}`, kind: 'texture', id: tp, label: tp.split('/').slice(-2).join(' ').replace(/\.\w+$/, ''), main, deps: [main], hash: r.live?.path === main ? r.live.hash : null, auto: r.live?.path !== main });
    }
    for (const x of m.materials || []) {
      const main = (x.live?.path && have.has(x.live.path) && x.live.path) || this.byStem(x.name, IMAGE_EXTS);
      if (main) out.push({ key: `material:${x.slot}`, kind: 'material', id: x.slot, label: `${x.name} (#${48 + x.slot})`, main, deps: [main], hash: x.live?.path === main ? x.live.hash : null, auto: x.live?.path !== main });
    }
    for (const [k, s] of Object.entries(m.skies || {})) {
      const main = (s.live?.path && have.has(s.live.path) && s.live.path) || this.byStem(s.name, IMAGE_EXTS);
      if (main) out.push({ key: `sky:${k}`, kind: 'sky', id: k, label: k === '*' ? 'all levels' : k, main, deps: [main], hash: s.live?.path === main ? s.live.hash : null, auto: s.live?.path !== main });
    }
    return out;
  }

  // What uses file p: [{ target, role: 'main' | 'part' }]
  usesOf(p, targets = this.targets()) {
    const out = [];
    for (const t of targets) {
      if (t.main === p) out.push({ target: t, role: 'main' });
      else if (t.deps.includes(p)) out.push({ target: t, role: 'part' });
    }
    return out;
  }

  // ---- reloading ---------------------------------------------------------------------

  changed(files) {
    if (!this.state.on) return;
    const targets = this.targets();
    let any = false;
    for (const f of files) {
      for (const { target } of this.usesOf(f.path, targets)) {
        this.queue.set(target.key, { target, hash: target.main === f.path ? f.hash : null, why: f.path });
        any = true;
      }
      if (!this.usesOf(f.path, targets).length) this.note(f.path, true, 'changed (not used in this project)');
    }
    if (any) this.pump();
  }

  // Files that changed while nothing was watching (Studio 64 was closed): reload what is stale.
  async catchUp() {
    if (!this.state.on) return;
    const hashes = new Map(this.list.files.filter((f) => f.hash).map((f) => [f.path, f]));
    let n = 0;
    for (const t of this.targets()) {
      if (!this.watched(t.main)) continue;
      const f = hashes.get(t.main);
      if (!f) continue;
      // linked from the folder: compare hashes; matched by name: newer than when it was imported
      const meta = this.entryOf(t);
      const stale = t.hash ? t.hash !== f.hash : f.mtime > (meta?.at || meta?.created || Infinity) + 2000;
      if (stale) { this.queue.set(t.key, { target: t, hash: f.hash, why: t.main }); n++; }
    }
    if (n) { this.toast(`Live reload: ${n} changed file${n === 1 ? '' : 's'} to bring in`, 'sparkles'); this.pump(); }
  }

  entryOf(t) {
    const m = this.assets.meta;
    if (t.kind === 'model') return (m.models || []).find((x) => x.id === t.id);
    if (t.kind === 'texture') return m.textures?.[t.id];
    if (t.kind === 'material') return (m.materials || []).find((x) => x.slot === t.id);
    if (t.kind === 'sky') return m.skies?.[t.id];
    return null;
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.size) {
        const [key, job] = this.queue.entries().next().value;
        this.queue.delete(key);
        this.busy.add(key);
        this.emit('busy');
        const t0 = performance.now();
        try {
          await this.reload(job.target);
          const ms = Math.round(performance.now() - t0);
          this.note(job.target.main, true, `reloaded ${job.target.kind} ${job.target.label} (${ms} ms)`);
          this.toast(`Live reload: ${baseOf(job.why || job.target.main)} → ${job.target.label}`, 'check');
        } catch (err) {
          console.error('live reload', job.target, err);
          this.note(job.target.main, false, err.message || String(err));
          this.toast(`Live reload of ${baseOf(job.target.main)} failed: ${err.message || err}`, 'x');
        } finally { this.busy.delete(key); this.emit('busy'); }
      }
    } finally { this.pumping = false; }
  }

  note(p, ok, text) {
    const e = { at: Date.now(), path: p, ok, text };
    this.status.set(p, e);
    this.log.unshift(e);
    this.log.length = Math.min(this.log.length, 30);
    this.emit('log');
  }

  async reload(t) {
    const summary = `Live reload: ${baseOf(t.main)}`;
    if (t.kind === 'model') return this.reloadModel(t, summary);
    const file = await this.fetchFile(t.main);
    const live = { path: t.main, hash: file.liveHash };
    const bmp = await createImageBitmap(file).catch(() => { throw new Error(`${baseOf(t.main)} is not a picture the browser can read`); });
    const A = this.assets;
    if (t.kind === 'texture') {
      await A.locate();
      const x = (await A.catalog()).find((c) => c.path === t.id);
      if (!x) throw new Error(`the game texture ${t.id} is not in this game build`);
      const r = A.meta.textures[t.id] || {};
      // same choice as when it was replaced: game size, or kept sharp (up to 4x)
      const keepHd = (r.w || x.w) > x.w || (r.h || x.h) > x.h;
      const w = keepHd ? Math.min(x.w * 4, pow2(bmp.width, 512)) : x.w, h = keepHd ? Math.min(x.h * 4, pow2(bmp.height, 512)) : x.h;
      const rgba = rasterize(bmp, w, h);
      if (!keepHd) quantize(rgba, x.fmt === 'rgba' && x.bits === 16 ? 'rgba16' : x.fmt === 'ia' ? 'rgba32' : 'rgba16');
      await A.replaceTexture(x, rgba, w, h, r.note || baseOf(t.main), live, summary);
      return;
    }
    if (t.kind === 'material') {
      const m = (A.meta.materials || []).find((x) => x.slot === t.id);
      if (!m) throw new Error('the material is gone');
      const s = bmp.width >= 64 && bmp.height >= 64 ? 64 : 32;
      const rgba = quantize(rasterize(bmp, s, s), 'rgba16');
      await A.saveMaterial({ slot: m.slot, name: m.name, rgba, w: s, h: s, sharp: s > 32 && m.sharp !== false, live, summary });
      return;
    }
    if (t.kind === 'sky') {
      const s = A.meta.skies?.[t.id];
      if (!s) throw new Error('the sky is gone');
      const mode = s.mode || (Math.abs(bmp.width / bmp.height - 2) < 0.15 ? 'panorama' : 'picture');
      await A.setSky(t.id, bmp, { mode, quality: s.quality || 'n64', horizon: s.horizon || 0, name: s.name, live, summary });
    }
  }

  async reloadModel(t, summary) {
    const A = this.assets;
    const meta = A.model(t.id);
    if (!meta) throw new Error('the model is gone');
    const src = meta.source || {};
    const files = await Promise.all(t.deps.map((p) => this.fetchFile(p)));
    const main = files[0];
    const scene = await importModel(files);
    // the settings it was imported with, but always the file's own origin: the model stays where the
    // file puts it however its size changes (no re-centering)
    const pkg = await buildPackage(scene, {
      scale: src.scale ?? 1, rotate: src.rotate || [0, 0, 0], zUp: src.zUp, origin: 'file',
      texMax: meta.texMax || 64, texFormat: meta.texFormat || 'rgba16', markerEntry: (n) => A.markerEntry(n),
    });
    // per-material game settings (surface, transparency, ...) stay, matched by material name
    const fresh = defaultMaterialMeta(pkg);
    const old = meta.materials || [];
    const materials = pkg.materials.map((m, i) => {
      const keep = old.find((o) => o.name === m.name) || (old.length === pkg.materials.length ? old[i] : null);
      return keep ? keepMaterialMeta(keep, m.name) : fresh[i];
    });
    const bytes = await encodePackage(pkg);
    const file = await A.upload(new Blob([bytes]), 'model', meta.name);
    A.files.set(file, Promise.resolve(bytes)); // no need to download it again
    let thumb = meta.thumb;
    try { thumb = thumbnail(pkg, { materials, lighting: meta.lighting }); } catch { /* keep the old picture */ }
    const oldFile = meta.file;
    const mario = this.marioNow();
    const placedHere = (A.getPatch()?.areas?.[A.key()]?.objects || []).some((r) => r.asset?.model === meta.id);
    await A.updateModel(meta.id, {
      file, tris: pkg.tris, bounds: pkg.bounds, materials, thumb, at: Date.now(), markers: pkg.markers || [],
      live: { path: t.main, hash: main.liveHash },
      source: { ...src, origin: 'file', files: files.map((f) => f.name).slice(0, 40), format: scene.format },
    }, summary);
    if (placedHere) this.dropMario(mario);
    if (oldFile && oldFile !== file) A.deleteFile(oldFile);
  }
}
