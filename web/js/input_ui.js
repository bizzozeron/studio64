// The Input workspace: which keyboard keys and controller buttons play the N64 buttons in the game
// (the studio's play window), and the studio's own hotkeys (play from entry, save states, the
// testing tools: keyboard keys or controller buttons, testing.js runs them). The engine keeps up to three bindings per button (engine/src/studio/
// input.c, sm64ex's configKey*): a keyboard key (its scancode) or a game controller button (0x1000 +
// the SDL button; 0x101A / 0x101B the triggers). This browser remembers the player's choice
// (localStorage) and gives it to the engine whenever it starts. Exported ROMs are not affected.

const STORE = 'studio64.input.v1';
const HOT_STORE = 'studio64.hotkeys.v1';

// the studio's hotkeys (testing.js `hotkeys`): id, name, default bindings ("key:<code>" or "pad:<the
// browser's standard button>"); none on the controller by default
export const HOTKEYS = [
  ['entry', 'Play from entry', 'Reload the level, start at its entry', ['key:Backspace', '']],
  ['save', 'Save state', 'Quick save (slot 1): the whole game as it is', ['key:F6', '']],
  ['load', 'Load state', 'Quick load (slot 1)', ['key:F7', '']],
  ['storeloc', 'Store location', 'Remember where Mario is', ['', '']],
  ['restoreloc', 'Restore location', 'Reload the level, Mario back there', ['', '']],
  ['debug', 'Debug view', 'Collision, hitboxes, Mario info', ['key:F2', '']],
  ['panel', 'Play-test panel', '', ['key:F3', '']],
  ['timer', 'Restart timer', 'Speedrun timer', ['key:F4', '']],
  ['pause', 'Pause / resume', '', ['key:F8', '']],
  ['step', 'Frame advance', '', ['key:F9', '']],
  ['slow', 'Slow motion', '1×, ½, ¼, ⅛', ['key:F10', '']],
];
const HOT_SLOTS = 2;
const PAD_NAMES = ['A / Cross', 'B / Circle', 'X / Square', 'Y / Triangle', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'Back / Select', 'Start', 'Left stick press', 'Right stick press', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Guide'];

function loadHot() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(HOT_STORE) || 'null'); } catch { /* none */ }
  return Object.fromEntries(HOTKEYS.map(([id, , , def]) => [id, Array.isArray(saved?.[id]) ? [0, 1].map((i) => String(saved[id][i] || '')) : [...def]]));
}
// testing.js before the Input workspace exists (and its fallback)
export function defaultHotkeyOfKey(code) {
  return HOTKEYS.find(([, , , def]) => def.includes(`key:${code}`))?.[0] || null;
}

// the engine's order (input.c binds_of)
export const ACTIONS = [
  ['a', 'A', 'Jump'], ['b', 'B', 'Punch, kick, dive'], ['z', 'Z', 'Crouch, ground pound'], ['start', 'Start', 'Pause'],
  ['l', 'L', 'Mario cam'], ['r', 'R', 'Camera mode'],
  ['cup', 'C ↑', 'Look around'], ['cdown', 'C ↓', 'Camera out'], ['cleft', 'C ←', 'Camera left'], ['cright', 'C →', 'Camera right'],
  ['up', 'Stick ↑', 'Forward'], ['down', 'Stick ↓', 'Back'], ['left', 'Stick ←', 'Left'], ['right', 'Stick →', 'Right'],
];
const SLOTS = 3;
const NONE = 0xFFFF;

// browser key codes <-> the engine's scancodes (controller_emscripten_keyboard.c)
const SCAN = {
  Escape: 0x01, Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06, Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0a, Digit0: 0x0b,
  Minus: 0x0c, Equal: 0x0d, Backspace: 0x0e, Tab: 0x0f, KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15, KeyU: 0x16, KeyI: 0x17,
  KeyO: 0x18, KeyP: 0x19, BracketLeft: 0x1a, BracketRight: 0x1b, Enter: 0x1c, ControlLeft: 0x1d, KeyA: 0x1e, KeyS: 0x1f, KeyD: 0x20, KeyF: 0x21,
  KeyG: 0x22, KeyH: 0x23, KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26, Semicolon: 0x27, Quote: 0x28, Backquote: 0x29, ShiftLeft: 0x2a, Backslash: 0x2b,
  KeyZ: 0x2c, KeyX: 0x2d, KeyC: 0x2e, KeyV: 0x2f, KeyB: 0x30, KeyN: 0x31, KeyM: 0x32, Comma: 0x33, Period: 0x34, Slash: 0x35, ShiftRight: 0x36,
  NumpadMultiply: 0x37, AltLeft: 0x38, Space: 0x39, CapsLock: 0x3a, NumLock: 0x45, ScrollLock: 0x46, Numpad7: 0x47, Numpad8: 0x48, Numpad9: 0x49,
  NumpadSubtract: 0x4a, Numpad4: 0x4b, Numpad5: 0x4c, Numpad6: 0x4d, NumpadAdd: 0x4e, Numpad1: 0x4f, Numpad2: 0x50, Numpad3: 0x51, Numpad0: 0x52,
  NumpadDecimal: 0x53, IntlBackslash: 0x56, IntlRo: 0x59, NumpadEnter: 0x11c, ControlRight: 0x11d, NumpadDivide: 0x135, AltRight: 0x138,
  Home: 0x147, ArrowUp: 0x148, PageUp: 0x149, ArrowLeft: 0x14b, ArrowRight: 0x14d, End: 0x14f, ArrowDown: 0x150, PageDown: 0x151, Insert: 0x152,
  Delete: 0x153, MetaLeft: 0x15b, MetaRight: 0x15c, ContextMenu: 0x15d,
  F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40, F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44, F11: 0x57, F12: 0x58,
};
const CODE_OF = Object.fromEntries(Object.entries(SCAN).map(([k, v]) => [v, k]));
// keys the studio keeps (closing things, Play/Build): not for the game or hotkeys
const RESERVED = new Set(['Escape', 'Tab']);

// SDL game controller buttons (what the engine binds) and the browser's standard gamepad layout
const SDL_NAMES = ['A', 'B', 'X', 'Y', 'Back / Select', 'Guide', 'Start', 'Left stick press', 'Right stick press', 'LB / L1', 'RB / R1', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →'];
const TRIGGER_L = 0x1A, TRIGGER_R = 0x1B;
const BROWSER_TO_SDL = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 9, 5: 10, 6: TRIGGER_L, 7: TRIGGER_R, 8: 4, 9: 6, 10: 7, 11: 8, 12: 11, 13: 12, 14: 13, 15: 14, 16: 5 };
const SDL_TO_BROWSER = Object.fromEntries(Object.entries(BROWSER_TO_SDL).map(([b, v]) => [v, Number(b)]));
// a hotkey binding <-> the engine's virtual key for the same key or button (they can't share one)
const hotToVk = (h) => (h.startsWith('key:') ? SCAN[h.slice(4)] ?? null : h.startsWith('pad:') ? 0x1000 + (BROWSER_TO_SDL[Number(h.slice(4))] ?? -0x1000) : null);
function hotName(h) {
  if (h.startsWith('key:')) return `⌨ ${keyName(h.slice(4))}`;
  if (h.startsWith('pad:')) return `🎮 ${PAD_NAMES[Number(h.slice(4))] || `button ${h.slice(4)}`}`;
  return '';
}

function keyName(code) {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow(.*)/, '$1 arrow').replace(/Left$/, ' (left)').replace(/Right$/, ' (right)')
    .replace(/^Numpad/, 'Num ').replace(/^Bracket/, 'Bracket ').trim();
}

export function bindName(vk) {
  if (vk === NONE || vk < 0) return '';
  if (vk >= 0x1000 && vk < 0x2000) {
    const b = vk - 0x1000;
    return `🎮 ${b === TRIGGER_L ? 'LT / L2' : b === TRIGGER_R ? 'RT / R2' : SDL_NAMES[b] || `button ${b}`}`;
  }
  if (vk >= 0x2000) return `mouse ${vk - 0x2000}`;
  const code = CODE_OF[vk];
  return code ? `⌨ ${keyName(code)}` : `key ${vk.toString(16)}`;
}

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAD_ICON = '<svg class="i" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6 12h4M8 10v4M15 12h.01M18 11h.01"/></svg>';

const CSS = `
#input-panel{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)}
#input-panel[hidden]{display:none}
#input-panel .ip-box{background:var(--panel,#1d2027);color:var(--text,#e8eaf0);border:1px solid var(--line,#333a46);border-radius:12px;width:min(760px,calc(100vw - 32px));max-height:calc(100vh - 48px);display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.5)}
#input-panel .ip-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line,#333a46)}
#input-panel .ip-head b{font-size:15px;flex:1}
#input-panel .ip-body{overflow:auto;padding:8px 16px 14px}
#input-panel .ip-note{font-size:12px;opacity:.75;margin:6px 0 10px;line-height:1.45}
#input-panel table{width:100%;border-collapse:collapse;font-size:13px}
#input-panel th{font-weight:600;text-align:left;font-size:11px;opacity:.6;padding:4px 6px}
#input-panel td{padding:3px 6px;border-top:1px solid var(--line,#2b313c)}
#input-panel td.ip-act b{display:inline-block;min-width:58px}
#input-panel td.ip-act span{opacity:.6;font-size:12px}
#input-panel .ip-slot{display:flex;align-items:center;gap:2px}
#input-panel .ip-slot button.ip-b{flex:1;min-width:120px;text-align:left;padding:5px 8px;border-radius:6px;border:1px solid var(--line,#3a4150);background:var(--bg2,#262a33);color:inherit;cursor:pointer;font:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#input-panel .ip-slot button.ip-b.empty{opacity:.45}
#input-panel .ip-slot button.ip-b.wait{border-color:var(--accent,#6aa8ff);background:rgba(106,168,255,.15)}
#input-panel .ip-slot button.ip-x{border:0;background:none;color:inherit;opacity:.5;cursor:pointer;padding:2px 4px}
#input-panel .ip-slot button.ip-x:hover{opacity:1}
#input-panel .ip-foot{display:flex;gap:8px;align-items:center;padding:10px 16px;border-top:1px solid var(--line,#333a46)}
#input-panel .ip-foot .ip-pad{flex:1;font-size:12px;opacity:.7}
`;

export class InputUI {
  // hotkeys: () => testing.js's hotkeys by id
  constructor({ engine, toast, hotkeys }) {
    this.engine = engine;
    this.toast = toast || (() => {});
    this.getHotkeys = hotkeys || (() => ({}));
    this.defaults = null;   // the engine's own bindings (read once, before ours go in)
    this.waiting = null;    // { action, slot } (or { hot: id, slot }) while waiting for a key or button
    this.hot = loadHot();
    this.padDown = new Set();
    this.buildDom();
    if (engine.ready) this.onReady(); else engine.on('ready', () => this.onReady());
    this.pollPads();
  }

  // ---- hotkeys --------------------------------------------------------------------------------

  hotkeyOfKey(code) {
    const k = `key:${code}`;
    return HOTKEYS.find(([id]) => this.hot[id]?.includes(k))?.[0] || null;
  }

  storeHot() { try { localStorage.setItem(HOT_STORE, JSON.stringify(this.hot)); } catch { /* this session only */ } }

  setHot(id, slot, h) {
    if (h) {
      // one key or button, one job: off the other hotkeys and off the game's buttons
      for (const [other] of HOTKEYS) this.hot[other] = this.hot[other].map((x, j) => (x === h && !(other === id && j === slot) ? '' : x));
      const vk = hotToVk(h);
      if (vk !== null && this.supported()) {
        const binds = this.read();
        let changed = false;
        binds.forEach((list, a) => list.forEach((v, j) => { if (v === vk) { binds[a][j] = NONE; changed = true; } }));
        if (changed) { this.write(binds); this.store(binds); this.toast(`${hotName(h)} is now only for ${HOTKEYS.find(([x]) => x === id)[1]}`, 'check'); }
      }
    }
    this.hot[id][slot] = h || '';
    this.storeHot();
    this.render();
  }

  get M() { return this.engine.M; }
  supported() { return !!this.M?._studio_input_get; }

  // ---- bindings -----------------------------------------------------------------------------

  read() {
    return ACTIONS.map((_, a) => Array.from({ length: SLOTS }, (__, s) => this.M._studio_input_get(a, s) & 0xffff));
  }

  stored() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; }
  }

  store(binds) {
    try {
      const out = {};
      ACTIONS.forEach(([id], a) => { out[id] = binds[a]; });
      localStorage.setItem(STORE, JSON.stringify(out));
    } catch { /* private window: this session only */ }
  }

  write(binds) {
    binds.forEach((list, a) => list.forEach((vk, s) => this.M._studio_input_set(a, s, vk, 0)));
    this.M._studio_input_apply();
  }

  onReady() {
    if (!this.supported()) return;
    this.defaults = this.read();
    const saved = this.stored();
    if (saved) {
      const binds = ACTIONS.map(([id], a) => (Array.isArray(saved[id]) ? [0, 1, 2].map((s) => Number(saved[id][s] ?? this.defaults[a][s]) & 0xffff) : this.defaults[a]));
      this.write(binds);
    }
    if (this.isOpen()) this.render();
  }

  setBind(a, s, vk) {
    if (vk !== NONE) {
      const h = vk >= 0x1000 && vk < 0x2000 ? (SDL_TO_BROWSER[vk - 0x1000] !== undefined ? `pad:${SDL_TO_BROWSER[vk - 0x1000]}` : null) : CODE_OF[vk] ? `key:${CODE_OF[vk]}` : null;
      if (h) for (const [id] of HOTKEYS) if (this.hot[id].includes(h)) { this.hot[id] = this.hot[id].map((x) => (x === h ? '' : x)); this.storeHot(); }
    }
    const binds = this.read();
    // one key does one thing: taken off the other buttons first
    if (vk !== NONE) binds.forEach((list, i) => list.forEach((v, j) => { if (v === vk && !(i === a && j === s)) binds[i][j] = NONE; }));
    binds[a][s] = vk;
    this.write(binds);
    this.store(binds);
    this.render();
  }

  // ---- the panel ------------------------------------------------------------------------------

  buildDom() {
    if (!document.getElementById('input-ui-css')) {
      const st = document.createElement('style');
      st.id = 'input-ui-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    // the rail button (shell.js adopts buttons next to #sound-btn)
    const btn = el('button', 'btn ghost', `${PAD_ICON}<span class="hide-sm">Input</span>`);
    btn.id = 'input-btn';
    btn.title = 'Input: keyboard keys and controller buttons for the game';
    btn.onclick = () => (this.isOpen() ? this.close() : this.open());
    const sound = document.getElementById('sound-btn');
    if (sound) sound.parentNode.insertBefore(btn, sound.nextSibling); else document.querySelector('.topbar')?.appendChild(btn);
    this.btn = btn;
    const p = el('div', '', `<div class="ip-box"><div class="ip-head">${PAD_ICON}<b>Input</b><button class="btn icon ghost" data-a="close" title="Close (Esc)">✕</button></div>
      <div class="ip-body"></div>
      <div class="ip-foot"><span class="ip-pad"></span><button class="btn sm ghost" data-a="reset">Back to the defaults</button><button class="btn sm primary" data-a="done">Done</button></div></div>`);
    p.id = 'input-panel';
    p.hidden = true;
    p.addEventListener('mousedown', (ev) => { if (ev.target === p) this.close(); });
    p.querySelector('[data-a=close]').onclick = () => this.close();
    p.querySelector('[data-a=done]').onclick = () => this.close();
    p.querySelector('[data-a=reset]').onclick = () => {
      this.hot = Object.fromEntries(HOTKEYS.map(([id, , , def]) => [id, [...def]]));
      try { localStorage.removeItem(HOT_STORE); } catch { /* fine */ }
      if (this.defaults) this.write(this.defaults);
      try { localStorage.removeItem(STORE); } catch { /* fine */ }
      this.render();
      this.toast('Controls back to the defaults', 'check');
    };
    document.body.appendChild(p);
    this.panel = p;
    // keys while waiting for one (before the game and the studio's shortcuts see them)
    window.addEventListener('keydown', (ev) => {
      if (!this.isOpen()) return;
      if (!this.waiting) { if (ev.key === 'Escape') { ev.preventDefault(); this.close(); } return; }
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.code === 'Escape') { this.stopWaiting(); return; }
      if (RESERVED.has(ev.code)) { this.toast(`${ev.code} stays the studio's`, 'x'); return; }
      if (this.waiting.hot) {
        const { hot, slot } = this.waiting;
        this.stopWaiting();
        this.setHot(hot, slot, `key:${ev.code}`);
        return;
      }
      const sc = SCAN[ev.code];
      if (sc === undefined) { this.toast(`The game can't use ${ev.code}`, 'x'); return; }
      const { action, slot } = this.waiting;
      this.stopWaiting();
      this.setBind(action, slot, sc);
    }, true);
  }

  isOpen() { return !this.panel.hidden; }

  open() {
    this.panel.hidden = false;
    this.render();
    this.btn?.classList.add('active');
  }

  close() {
    this.stopWaiting();
    this.panel.hidden = true;
    this.btn?.classList.remove('active');
    document.getElementById('canvas')?.focus();
  }

  render() {
    const body = this.panel.querySelector('.ip-body');
    const game = this.supported();
    const binds = game ? this.read() : null;
    body.innerHTML = `${game ? '' : '<div class="ip-note"><b>The game\'s buttons can be changed once the engine is rebuilt:</b> run <b>Rebuild Engine.bat</b> in the Studio 64 folder, then reload this page. The studio hotkeys below work now.</div>'}<div class="ip-note">Click a slot, then press a key or a controller button (Esc cancels, ✕ clears it). Each button can have three. A key used elsewhere moves here.
      The controller's left stick always moves Mario and its right stick works the C buttons; these are for the buttons, triggers and D-pad.
      Kept in this browser; exported ROMs use a real N64 controller. Esc and Tab stay the studio's; a key or button does one thing (setting it moves it here).</div>
      <table><thead><tr><th>N64</th><th>1</th><th>2</th><th>3</th></tr></thead><tbody class="ip-game"></tbody></table>
      <div class="ip-note" style="margin-top:14px"><b>Studio hotkeys</b> work while playing (and building, except Backspace / Delete, which delete there).</div>
      <table><thead><tr><th>Hotkey</th><th>1</th><th>2</th><th></th></tr></thead><tbody class="ip-hot"></tbody></table>`;
    const hb = body.querySelector('.ip-hot');
    HOTKEYS.forEach(([id, label, what]) => {
      const tr = el('tr');
      tr.appendChild(el('td', 'ip-act', `<b>${esc(label)}</b> <span>${esc(what)}</span>`));
      for (let s = 0; s < HOT_SLOTS; s++) {
        const h = this.hot[id][s] || '';
        const td = el('td');
        const wrap = el('div', 'ip-slot');
        const wait = this.waiting?.hot === id && this.waiting?.slot === s;
        const b = el('button', `ip-b${h ? '' : ' empty'}${wait ? ' wait' : ''}`, esc(wait ? 'Press a key or button…' : hotName(h) || '—'));
        b.onclick = () => this.startWaiting(null, s, id);
        wrap.appendChild(b);
        if (h && !wait) {
          const x = el('button', 'ip-x', '✕');
          x.title = 'Clear';
          x.onclick = () => this.setHot(id, s, '');
          wrap.appendChild(x);
        }
        td.appendChild(wrap);
        tr.appendChild(td);
      }
      tr.appendChild(el('td'));
      hb.appendChild(tr);
    });
    const tb = body.querySelector('.ip-game');
    if (!game) { tb.closest('table').remove(); return; }
    ACTIONS.forEach(([, label, what], a) => {
      const tr = el('tr');
      tr.appendChild(el('td', 'ip-act', `<b>${esc(label)}</b> <span>${esc(what)}</span>`));
      for (let s = 0; s < SLOTS; s++) {
        const vk = binds[a][s];
        const td = el('td');
        const wrap = el('div', 'ip-slot');
        const wait = this.waiting?.action === a && this.waiting?.slot === s;
        const b = el('button', `ip-b${vk === NONE ? ' empty' : ''}${wait ? ' wait' : ''}`, esc(wait ? 'Press a key or button…' : bindName(vk) || '—'));
        b.onclick = () => this.startWaiting(a, s);
        wrap.appendChild(b);
        if (vk !== NONE && !wait) {
          const x = el('button', 'ip-x', '✕');
          x.title = 'Clear';
          x.onclick = () => this.setBind(a, s, NONE);
          wrap.appendChild(x);
        }
        td.appendChild(wrap);
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    });
  }

  startWaiting(action, slot, hot = null) {
    this.waiting = { action, slot, hot, pads: this.padButtons() };
    this.render();
  }

  stopWaiting() {
    if (!this.waiting) return;
    this.waiting = null;
    if (this.isOpen()) this.render();
  }

  // ---- game controllers (the browser's standard layout, as the engine's SDL sees it) -------------

  padButtons() {
    const down = new Set();
    for (const g of navigator.getGamepads?.() || []) {
      if (!g || g.mapping !== 'standard') continue;
      g.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) down.add(i); });
    }
    return down;
  }

  // every frame: hotkeys on the controller (pressed now, not before), and in the panel the button
  // a slot waits for
  pollPads() {
    requestAnimationFrame(() => this.pollPads());
    const now = this.padButtons();
    if (!this.waiting) {
      const fresh = [...now].filter((i) => !this.padDown.has(i));
      if (fresh.length && !this.isOpen()) {
        const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
        const run = this.getHotkeys() || {};
        if (!typing) for (const i of fresh) {
          const id = HOTKEYS.find(([x]) => this.hot[x]?.includes(`pad:${i}`))?.[0];
          if (id && run[id]) { try { run[id](); } catch (err) { console.error('hotkey', err); } }
        }
      }
    }
    this.padDown = now;
    if (!this.isOpen()) return;
    const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
    const label = this.panel.querySelector('.ip-pad');
    if (label) label.textContent = pads.length ? `Controller: ${pads[0].id.replace(/\s*\(.*\)\s*$/, '').slice(0, 60)}${pads[0].mapping === 'standard' ? '' : ' (non-standard layout: buttons may not match)'}` : 'No controller seen (press a button on it)';
    if (this.waiting) {
      const now = this.padButtons();
      const fresh = [...now].find((i) => !this.waiting.pads.has(i));
      this.waiting.pads = now;
      if (fresh !== undefined && BROWSER_TO_SDL[fresh] !== undefined) {
        const { action, slot, hot } = this.waiting;
        this.waiting = null;
        if (hot) this.setHot(hot, slot, `pad:${fresh}`);
        else this.setBind(action, slot, 0x1000 + BROWSER_TO_SDL[fresh]);
      }
    }
  }
}
