// Export a stage as a Collada (.dae) file for Blender and friends: the level's geometry as the game
// draws it (engine studio_romdump: every triangle with its texture, uvs and vertex colours, studio
// blocks and placed models baked in), one mesh per area, all around the stage's own origin; and its
// objects as empties named the way the model importer reads names (asset_mesh.js / assets.js
// markerEntry): "Koopa_Shell.001", "Star_3" / "Its_Name*Star_3", "Mario_Default_Start". A .zip with
// the .dae and its textures (PNG). Coordinates: Blender's Z-up (game x, -z, y), 1 unit = 1 game unit.
import { toPNGBlob } from './texcodec.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const START_ENTRY_NAME = 'Mario_Default_Start';

// areas of the original levels (by level number), for "the whole level"
const VANILLA_AREAS = { 6: 3, 8: 3, 5: 2, 10: 2, 11: 2, 12: 2, 13: 3, 22: 2, 23: 2, 36: 4, 16: 1, 26: 1 };

// ---- the engine's area dump (server/romexport/dump.js, the parts needed here) -----------------------
function parseDump(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 4;
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
  const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
  const u8 = () => bytes[o++];
  const f32 = () => { const v = dv.getFloat32(o, true); o += 4; return v; };
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'S64D') throw new Error('not an area dump');
  const version = u32();
  const textures = [];
  for (let n = u32(), i = 0; i < n; i++) {
    const w = u16(), h = u16(), tileW = u16(), tileH = u16();
    textures.push({ w, h, tileW, tileH, rgba: bytes.slice(o, o + w * h * 4) });
    o += w * h * 4;
  }
  const materials = [];
  for (let n = u32(), i = 0; i < n; i++) {
    const m = { tex: i32(), tex2: version >= 4 ? i32() : -1, combine: [u32(), u32()], geomode: u32(), othermode: [u32(), u32()] };
    m.layer = u8(); m.lit = u8(); m.cms = u8(); m.cmt = u8();
    m.prim = [u8(), u8(), u8(), u8()];
    m.env = [u8(), u8(), u8(), u8()];
    m.scaleS = u16(); m.scaleT = u16();
    materials.push(m);
  }
  const tris = [];
  for (let n = u32(), i = 0; i < n; i++) {
    const mat = u16(); u16();
    const v = [];
    for (let k = 0; k < 3; k++) v.push({ x: f32(), y: f32(), z: f32(), s: f32(), t: f32(), c: [u8(), u8(), u8(), u8()] });
    tris.push({ mat, v });
  }
  return { textures, materials, tris };
}

// ---- a store-only zip ------------------------------------------------------------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) { // [{ name, data: Uint8Array }]
  const enc = new TextEncoder();
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + n;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const fmt = (v) => (Math.abs(v) < 1e-6 ? '0' : String(Math.round(v * 10000) / 10000));
function hashBytes(b) { let h = 0x811c9dc5; for (let i = 0; i < b.length; i += 7) { h ^= b[i]; h = Math.imul(h, 0x01000193); } return `${b.length}:${(h >>> 0).toString(36)}`; }

export class StageExport {
  // state: the app state (engine, worldFlow, catalog, world)
  constructor(state) { this.state = state; }
  get engine() { return this.state.engine; }
  get flow() { return this.state.worldFlow; }

  // which areas "the whole level" means: [{ to, key, index, name }]
  areas(all) {
    const e = this.engine, flow = this.flow;
    const here = flow.here();
    const list = [];
    if (here.custom) {
      const areas = all ? flow.areasOf(here.custom) : [{ index: here.area || 1, name: '' }];
      for (const a of areas) list.push({ to: { custom: here.custom, area: a.index }, key: `c:${here.custom}${a.index > 1 ? `:${a.index}` : ''}`, index: a.index, name: a.name });
    } else {
      const n = all ? (VANILLA_AREAS[here.level] || 1) : 0;
      const idx = all ? Array.from({ length: n }, (_, i) => i + 1) : [here.area || 1];
      for (const i of idx) list.push({ to: { level: here.level, area: i }, key: `${here.level}:${i}`, index: i, name: '' });
    }
    return list;
  }

  // the area loaded again (the level reloads even when Mario is in it: wait for the load itself)
  async visit(a) {
    const e = this.engine;
    let loaded = false;
    const onArea = () => { loaded = true; };
    e.on('area', onArea);
    try {
      this.flow.goArea(a.to, { reload: true });
      const t0 = performance.now();
      while (performance.now() - t0 < 60000) {
        await sleep(150);
        let m = null;
        try { m = e.state().mario; } catch { /* loading */ }
        if (loaded && m && !e.inIntro && e.areaKey() === a.key) { await sleep(1500); return true; }
      }
      return false;
    } finally { e.off('area', onArea); }
  }

  // mode 0: the level's geometry (its own meshes, the studio's blocks and models); 1: the level's pieces
  // that are objects in the game (towers, platforms, bridges), where they are now
  dumpHere(bake, mode = 0) {
    const M = this.engine.M;
    const p = bake.length ? M._malloc(bake.length * 4) : 0;
    if (p) new Int32Array(M.HEAPU8.buffer, p, bake.length).set(bake);
    try {
      // with the area's own meshes (an original level's: engine builds with studio_stagedump)
      const ptr = M._studio_stagedump(p, bake.length, mode);
      return M.HEAPU8.slice(ptr, ptr + M._studio_romdump_size());
    } finally { if (p) M._free(p); }
  }

  // The level's objects here: [{ name, x, y, z, yaw }] (game coordinates)
  objectsHere(key, skipUids) {
    const e = this.engine;
    const cat = this.state.catalog?.entries || [];
    const recs = new Map((e.patch?.areas?.[key]?.objects || []).map((r) => [r.uid >>> 0, r]));
    const out = [];
    for (const o of e.objects()) {
      // the level's own objects (no studio uid) and the project's records; not what the studio spawns
      // for itself (the start marker, warp helpers, water) nor what objects spawn (parent)
      if (o.parent >= 0 || o.cat < 0 || skipUids.has(o.uid >>> 0) || (o.uid && !recs.has(o.uid >>> 0))) continue;
      // (the level's own pieces with a collision model or plain scenery are geometry: the _Objects mesh)
      if (!o.uid && o.visible && (o.surface || o.bhv === 'bhvStaticObject')) continue;
      const entry = cat[o.cat];
      if (!entry) continue;
      const rec = recs.get(o.uid >>> 0);
      const at = (o.hx || o.hy || o.hz) ? [o.hx, o.hy, o.hz] : [o.x, o.y, o.z];
      let base = entry.name.replace(/\s+/g, '_');
      if (entry.id === 'star') {
        const n = ((o.bparams >>> 24) & 0xff) + 1;
        const title = rec?.star?.name && !/^star \d+$/i.test(rec.star.name) ? rec.star.name.replace(/\s+/g, '_').replace(/\*/g, '') : '';
        base = title ? `${title}*Star_${n}` : `Star_${n}`;
      }
      out.push({ base, x: at[0], y: at[1], z: at[2], yaw: o.yaw & 0xffff });
    }
    // Mario's start: the area's own, else where he stands now (just loaded: the level's start)
    const sp = e.patch?.areas?.[key]?.settings?.spawn;
    let m = null;
    try { m = e.state().mario; } catch { /* none */ }
    const s = sp || (m ? { x: m.x, y: m.y, z: m.z, yaw: m.yaw } : null);
    if (s) out.push({ base: START_ENTRY_NAME, x: s.x, y: s.y, z: s.z, yaw: (s.yaw || 0) & 0xffff });
    return out;
  }

  // onStep({ text, progress }) -> { blob, name, stats }
  // colors: keep the game's vertex colours (else every corner white, 1 1 1 1)
  async run({ all = false, colors = false, onStep = () => {} } = {}) {
    const e = this.engine;
    if (!e.M?._studio_stagedump) throw new Error('this needs the engine rebuilt (Rebuild Engine.bat): the current build can only read the studio\'s own blocks and models, not the level\'s meshes');
    const back = this.flow.here();
    const areas = this.areas(all);
    const levelName = (this.flow.areaName?.({ ...back, area: 1 }) || 'stage').replace(/\s*[·,]\s*area.*$/i, '');
    const got = [];
    try {
      for (const [i, a] of areas.entries()) {
        onStep({ text: `Reading ${levelName}${areas.length > 1 ? `, area ${a.index}` : ''}`, progress: (i / areas.length) * 0.8 });
        if (!(await this.visit(a))) throw new Error(`area ${a.index} did not load`);
        // studio blocks and placed models are part of the level here (baked), not objects
        const recs = e.patch?.areas?.[a.key]?.objects || [];
        const bake = recs.filter((r) => r.block || r.asset).map((r) => r.uid | 0);
        const level = parseDump(this.dumpHere(bake, 0));
        const pieces = parseDump(this.dumpHere([], 1));
        if (!level.tris.length && !pieces.tris.length) throw new Error(`area ${a.index} came out with no triangles`);
        const meshes = [{ part: '', dump: level }, { part: 'obj', dump: pieces }].filter((m) => m.dump.tris.length);
        got.push({ a, meshes, objects: this.objectsHere(a.key, new Set(bake.map((u) => u >>> 0))) });
      }
    } finally {
      this.flow.goArea({ ...back }, { reload: true });
    }
    onStep({ text: 'Writing the Collada file', progress: 0.85 });
    const safe = levelName.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'stage';
    const { dae, images, stats } = await this.collada(got, safe, { colors });
    const files = [{ name: `${safe}.dae`, data: new TextEncoder().encode(dae) }];
    for (const im of images) files.push({ name: `textures/${im.name}`, data: im.data });
    onStep({ text: 'Done', progress: 1 });
    return { blob: zip(files), name: `${safe}.zip`, stats };
  }

  async collada(got, levelName, { colors = false } = {}) {
    // textures (shared across the areas), then materials (texture pair + see-through)
    const images = [], imageOf = new Map();
    const image = async (t) => {
      const k = hashBytes(t.rgba) + `:${t.w}x${t.h}`;
      if (imageOf.has(k)) return imageOf.get(k);
      const name = `tex${images.length}.png`;
      const blob = await toPNGBlob(t.rgba, t.w, t.h);
      images.push({ name, data: new Uint8Array(await blob.arrayBuffer()), id: `img${images.length}` });
      imageOf.set(k, images[images.length - 1].id);
      return imageOf.get(k);
    };
    const mats = [], matOf = new Map();
    const geoms = [], nodes = [];
    let tris = 0;
    const meshes = got.flatMap(({ a, meshes: ms }) => ms.map((m) => ({ a, ...m })));
    for (const { a, dump, part } of meshes) {
      const local = [];
      for (const m of dump.materials) {
        const blended = m.tex >= 0 && m.tex2 >= 0;
        // base colour: the texture (for a blended one TEXEL1, the base; TEXEL0 is the emission one)
        const base = blended ? m.tex2 : m.tex;
        const diffuse = base >= 0 ? await image(dump.textures[base]) : null;
        const emission = blended ? await image(dump.textures[m.tex]) : null;
        const see = m.layer >= 4;
        const k = `${diffuse}|${emission}|${see}`;
        if (!matOf.has(k)) { matOf.set(k, mats.length); mats.push({ id: `mat${mats.length}`, diffuse, emission, see }); }
        local.push(matOf.get(k));
      }
      // vertices welded by position; uvs and colours per corner
      const pos = [], posOf = new Map(), uv = [], col = [], byMat = new Map();
      for (const t of dump.tris) {
        const m = dump.materials[t.mat], tex = m && m.tex >= 0 ? dump.textures[m.tex2 >= 0 ? m.tex2 : m.tex] : null;
        const kS = m?.scaleS ? m.scaleS / 0x10000 : 1, kT = m?.scaleT ? m.scaleT / 0x10000 : 1;
        const idx = [];
        for (const v of t.v) {
          const k = `${Math.round(v.x * 100)},${Math.round(v.y * 100)},${Math.round(v.z * 100)}`;
          if (!posOf.has(k)) { posOf.set(k, pos.length / 3); pos.push(v.x, -v.z, v.y); } // Blender: x, -z, y
          const ui = uv.length / 2;
          uv.push(tex ? (v.s * kS) / (tex.tileW || tex.w) : 0, tex ? 1 - (v.t * kT) / (tex.tileH || tex.h) : 0);
          const ci = col.length / 4;
          // white unless asked for the game's colours (and never for lit materials: those bytes are a
          // normal; the lighting state a model inherits isn't always in its own display list either)
          col.push(...(colors && !m?.lit ? v.c.map((c) => c / 255) : [1, 1, 1, 1]));
          idx.push(posOf.get(k), ui, ci);
        }
        const mi = local[t.mat] ?? 0;
        if (!byMat.has(mi)) byMat.set(mi, []);
        byMat.get(mi).push(...idx);
        tris++;
      }
      const g = `area${a.index}${part}`;
      const nm = `${got.length > 1 || a.index > 1 ? `${levelName}_Area_${a.index}` : levelName}${part ? '_Objects' : ''}`;
      geoms.push(`<geometry id="${g}-mesh" name="${xml(nm)}"><mesh>
<source id="${g}-pos"><float_array id="${g}-pos-a" count="${pos.length}">${pos.map(fmt).join(' ')}</float_array><technique_common><accessor source="#${g}-pos-a" count="${pos.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="${g}-uv"><float_array id="${g}-uv-a" count="${uv.length}">${uv.map(fmt).join(' ')}</float_array><technique_common><accessor source="#${g}-uv-a" count="${uv.length / 2}" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>
<source id="${g}-col"><float_array id="${g}-col-a" count="${col.length}">${col.map(fmt).join(' ')}</float_array><technique_common><accessor source="#${g}-col-a" count="${col.length / 4}" stride="4"><param name="R" type="float"/><param name="G" type="float"/><param name="B" type="float"/><param name="A" type="float"/></accessor></technique_common></source>
<vertices id="${g}-vtx"><input semantic="POSITION" source="#${g}-pos"/></vertices>
${[...byMat].map(([mi, p]) => `<triangles material="m${mi}" count="${p.length / 9}"><input semantic="VERTEX" source="#${g}-vtx" offset="0"/><input semantic="TEXCOORD" source="#${g}-uv" offset="1" set="0"/><input semantic="COLOR" source="#${g}-col" offset="2" set="0"/><p>${p.join(' ')}</p></triangles>`).join('\n')}
</mesh></geometry>`);
      nodes.push(`<node id="${g}" name="${xml(nm)}" type="NODE"><instance_geometry url="#${g}-mesh" name="${xml(nm)}"><bind_material><technique_common>${[...byMat.keys()].map((mi) => `<instance_material symbol="m${mi}" target="#${mats[mi].id}-material"><bind_vertex_input semantic="UVMap" input_semantic="TEXCOORD" input_set="0"/></instance_material>`).join('')}</technique_common></bind_material></instance_geometry></node>`);
    }
    // the objects: empties, numbered the way Blender numbers copies
    const used = new Map();
    let nobj = 0;
    for (const { objects } of got) {
      for (const o of objects) {
        const n = used.get(o.base.toLowerCase()) || 0;
        used.set(o.base.toLowerCase(), n + 1);
        const name = n ? `${o.base}.${String(n).padStart(3, '0')}` : o.base;
        const deg = ((o.yaw & 0xffff) / 65536) * 360; // (an empty's front is its -Y: yaw 0 = the game's +Z)
        nodes.push(`<node id="obj${nobj++}" name="${xml(name)}" type="NODE"><translate sid="location">${fmt(o.x)} ${fmt(-o.z)} ${fmt(o.y)}</translate><rotate sid="rotationZ">0 0 1 ${fmt(deg)}</rotate></node>`);
      }
    }
    const sampler = (sid, img) => `<newparam sid="${sid}-surface"><surface type="2D"><init_from>${img}</init_from></surface></newparam><newparam sid="${sid}-sampler"><sampler2D><source>${sid}-surface</source></sampler2D></newparam>`;
    const effects = mats.map((m) => `<effect id="${m.id}-effect"><profile_COMMON>${m.diffuse ? sampler('d', m.diffuse) : ''}${m.emission ? sampler('e', m.emission) : ''}<technique sid="common"><lambert>${m.emission ? '<emission><texture texture="e-sampler" texcoord="UVMap"/></emission>' : ''}<diffuse>${m.diffuse ? '<texture texture="d-sampler" texcoord="UVMap"/>' : '<color sid="diffuse">0.8 0.8 0.8 1</color>'}</diffuse>${m.see && m.diffuse ? '<transparent opaque="A_ONE"><texture texture="d-sampler" texcoord="UVMap"/></transparent>' : ''}</lambert></technique></profile_COMMON></effect>`);
    const dae = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><contributor><authoring_tool>Studio 64 stage export</authoring_tool></contributor><unit name="game_unit" meter="1"/><up_axis>Z_UP</up_axis></asset>
<library_images>${images.map((im) => `<image id="${im.id}" name="${im.id}"><init_from>textures/${im.name}</init_from></image>`).join('')}</library_images>
<library_effects>${effects.join('\n')}</library_effects>
<library_materials>${mats.map((m) => `<material id="${m.id}-material" name="${m.id}"><instance_effect url="#${m.id}-effect"/></material>`).join('')}</library_materials>
<library_geometries>${geoms.join('\n')}</library_geometries>
<library_visual_scenes><visual_scene id="Scene" name="Scene">
${nodes.join('\n')}
</visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#Scene"/></scene>
</COLLADA>
`;
    return { dae, images, stats: { areas: got.length, tris, textures: images.length, materials: mats.length, objects: nobj } };
  }
}
