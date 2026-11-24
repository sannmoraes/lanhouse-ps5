(() => {
  const $ = (id) => document.getElementById(id);
  const LS = 'lh_controls';

  const LABELS = {
    up: LH.t('controles.label_up'), down: LH.t('controles.label_down'), left: LH.t('controles.label_left'), right: LH.t('controles.label_right'),
    cross: '✕ Cross', circle: '○ Circle', square: '□ Square', triangle: '△ Triangle',
    l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', l3: LH.t('controles.label_l3'), r3: LH.t('controles.label_r3'),
    start: 'Options', select: 'Create',
  };
  const KEY_NAMES = { Space: LH.t('controles.key_space'), Enter: 'Enter', Backspace: 'Backspace', Escape: 'Esc', Tab: 'Tab', ShiftLeft: LH.t('controles.key_shift_left'), ShiftRight: LH.t('controles.key_shift_right'), ControlLeft: LH.t('controles.key_ctrl_left'), ControlRight: LH.t('controles.key_ctrl_right'), AltLeft: LH.t('controles.key_alt_left'), AltRight: LH.t('controles.key_alt_right'), ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  const keyName = (code) => KEY_NAMES[code] ?? code.startsWith('Numpad') ? LH.t('controles.key_num', { key: code.slice(6) }) : code.replace(/^Key/, '').replace(/^Digit/, '');

  let saved = null; // o que esta salvo
  let cur = null; // o que esta na tela
  let capturing = null; // { kind: 'kb'|'pad', action }
  let loggedIn = false;
  const downKeys = new Set();

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const dirty = () => JSON.stringify(cur) !== JSON.stringify(saved);

  // ---------- desenho ----------
  function row(action, kind) {
    const label = LABELS[action];
    const value = kind === 'kb' ? keyName(cur.keyboard[action]) : LH.t('controles.pad_button', { n: cur.pad[action] });
    const wait = capturing && capturing.kind === kind && capturing.action === action;
    return `<div data-row="${kind}-${action}" class="flex items-center justify-between px-4 py-2 transition-colors">
      <span class="text-sm">${label}</span>
      <span class="flex items-center gap-2"><span class="font-mono text-xs px-2 py-1 rounded bg-panel2 min-w-[4.5rem] text-center ${wait ? 'text-orange' : ''}">${wait ? LH.t('controles.press') : LH.esc(value)}</span>
      <button data-rebind="${kind}-${action}" class="text-xs px-2 py-1 rounded bg-panel2 hover:bg-line">${LH.t('controles.change')}</button></span></div>`;
  }

  function paint() {
    const actions = LH.config.actions;
    $('kb-rows').innerHTML = actions.map((a) => row(a, 'kb')).join('');
    $('pad-rows').innerHTML = actions.map((a) => row(a, 'pad')).join('');
    for (const b of document.querySelectorAll('[data-rebind]')) {
      b.addEventListener('click', () => {
        const [kind, action] = b.dataset.rebind.split('-');
        capturing = capturing && capturing.kind === kind && capturing.action === action ? null : { kind, action };
        padBaseline = null;
        paint();
      });
    }
    $('kb-mode').value = cur.mode ?? 'dpad';
    $('btn-save').disabled = !dirty();
    $('guest-note').classList.toggle('hidden', loggedIn);
  }

  function light(kind, action, on) {
    const el = document.querySelector(`[data-row="${kind}-${action}"]`);
    if (el) el.classList.toggle('bg-pink/20', on);
  }

  // ---------- teclado ----------
  addEventListener('keydown', (e) => {
    if (!cur || e.target.tagName === 'INPUT') return;
    if (capturing?.kind === 'kb') {
      e.preventDefault();
      if (e.code === 'Escape') {
        capturing = null;
        return paint();
      }
      const a = capturing.action;
      const other = Object.keys(cur.keyboard).find((k) => cur.keyboard[k] === e.code && k !== a);
      if (other) cur.keyboard[other] = cur.keyboard[a]; // troca, para nunca repetir a mesma tecla
      cur.keyboard[a] = e.code;
      capturing = null;
      return paint();
    }
    const action = Object.keys(cur.keyboard).find((k) => cur.keyboard[k] === e.code);
    if (action) {
      e.preventDefault();
      downKeys.add(e.code);
      light('kb', action, true);
    }
  });
  addEventListener('keyup', (e) => {
    if (!cur) return;
    downKeys.delete(e.code);
    for (const [a, code] of Object.entries(cur.keyboard)) if (code === e.code) light('kb', a, false);
  });
  addEventListener('blur', () => {
    downKeys.clear();
    if (cur) for (const a of Object.keys(cur.keyboard)) light('kb', a, false);
  });

  // ---------- controle fisico (Gamepad API) ----------
  let padBaseline = null;
  function activePad() {
    return [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected) ?? null;
  }

  function loop() {
    const gp = activePad();
    if (!gp) {
      $('pad-badge').textContent = LH.t('controles.pad_none');
      $('pad-badge').className = 'text-xs font-mono px-2 py-0.5 rounded bg-panel2 text-mute';
      $('pad-info').textContent = LH.t('controles.pad_none_info');
    } else {
      $('pad-badge').textContent = LH.t('controles.pad_connected');
      $('pad-badge').className = 'text-xs font-mono px-2 py-0.5 rounded bg-money/20 text-money';
      const std = gp.mapping === 'standard';
      $('pad-info').innerHTML = `<span class="text-ink font-medium">${LH.esc(gp.id.slice(0, 60))}</span>${std ? '' : `<br><span class="text-orange">${LH.t('controles.pad_nonstandard')}</span>`}`;
      const pressed = gp.buttons.map((b) => b.pressed || b.value > 0.5);
      if (cur) {
        for (const [a, idx] of Object.entries(cur.pad)) light('pad', a, Boolean(pressed[idx]));
        if (capturing?.kind === 'pad') {
          if (!padBaseline) padBaseline = pressed.slice();
          const idx = pressed.findIndex((p, i) => p && !padBaseline[i]);
          if (idx >= 0) {
            const a = capturing.action;
            const other = Object.keys(cur.pad).find((k) => cur.pad[k] === idx && k !== a);
            if (other) cur.pad[other] = cur.pad[a];
            cur.pad[a] = idx;
            capturing = null;
            padBaseline = null;
            paint();
          }
        }
      }
    }
    requestAnimationFrame(loop);
  }

  // ---------- carregar / salvar ----------
  async function load() {
    await LH.api('/api/config').then((c) => (LH.config = { ...LH.config, ...c })).catch(() => {});
    const def = LH.config.defaultControls;
    try {
      if (loggedIn) saved = (await LH.api('/api/me/controls')).controls;
    } catch {}
    if (!saved) {
      try {
        saved = JSON.parse(localStorage.getItem(LS) || 'null');
      } catch {}
    }
    saved = saved && saved.keyboard && saved.pad ? { mode: 'dpad', ...saved } : clone(def);
    cur = clone(saved);
    paint();
  }

  $('kb-mode').addEventListener('change', () => {
    cur.mode = $('kb-mode').value;
    paint();
  });

  $('btn-reset').addEventListener('click', () => {
    cur = clone(LH.config.defaultControls);
    capturing = null;
    paint();
  });

  $('btn-save').addEventListener('click', async () => {
    LH.say($('save-msg'), '');
    try {
      if (loggedIn) {
        saved = (await LH.api('/api/me/controls', { method: 'PUT', body: { controls: cur } })).controls;
        LH.say($('save-msg'), LH.t('controles.saved_account'), true);
      } else {
        localStorage.setItem(LS, JSON.stringify(cur));
        saved = clone(cur);
        LH.say($('save-msg'), LH.t('controles.saved_local'), true);
      }
      cur = clone(saved);
      paint();
    } catch (e) {
      LH.say($('save-msg'), e.message);
    }
  });

  addEventListener('beforeunload', (e) => {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  let started = false;
  LH.onMe((me) => {
    loggedIn = Boolean(me.user);
    if (!started) {
      started = true;
      load();
      requestAnimationFrame(loop);
    }
  });
})();
