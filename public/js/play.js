// Envia os botoes do jogador da vez ao servidor (WebSocket /ws/play) a ~60 quadros por segundo.
// Convencao dos eixos: lx/rx positivo = direita; ly/ry positivo = CIMA (o Gamepad API usa o contrario, convertido aqui).
// Nao existe botao PS: o jogador nao sai do jogo nem desliga o console.
(() => {
  const state = { connected: false, active: false, hostReady: false };
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn({ ...state }));

  let ws = null;
  let retryTimer = null;
  let sendTimer = null;
  let controls = null;
  let wanted = false; // so conecta quando e a vez da pessoa
  const keys = new Set();
  let lastKey = '';
  let lastSentAt = 0;

  const DEADZONE = 0.12;
  const DIRS = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };

  async function loadControls() {
    if (controls) return controls;
    try {
      controls = (await LH.api('/api/me/controls')).controls;
    } catch {
      controls = LH.config.defaultControls;
    }
    return controls;
  }

  const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : v);

  function currentFrame() {
    const c = controls;
    if (!c) return null;
    const actions = LH.config.actions;
    let bits = 0;
    let lx = 0;
    let ly = 0;
    let rx = 0;
    let ry = 0;
    let l2 = 0;
    let r2 = 0;

    // teclado
    actions.forEach((a, i) => {
      if (!keys.has(c.keyboard[a])) return;
      if (c.mode === 'stick' && DIRS[a]) {
        lx += DIRS[a][0];
        ly += DIRS[a][1];
      } else bits |= 1 << i;
    });
    if (lx && ly) {
      lx *= Math.SQRT1_2;
      ly *= Math.SQRT1_2;
    }

    // controle fisico (se houver, os analogicos dele valem mais que o teclado)
    const gp = [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected);
    if (gp) {
      actions.forEach((a, i) => {
        if (gp.buttons[c.pad[a]]?.pressed) bits |= 1 << i;
      });
      const pLx = dz(gp.axes[0] ?? 0);
      const pLy = dz(-(gp.axes[1] ?? 0));
      if (pLx || pLy) {
        lx = pLx;
        ly = pLy;
      }
      rx = dz(gp.axes[2] ?? 0);
      ry = dz(-(gp.axes[3] ?? 0));
      l2 = gp.buttons[c.pad.l2]?.value ?? 0;
      r2 = gp.buttons[c.pad.r2]?.value ?? 0;
    }
    const r = (v) => Math.round(v * 100) / 100;
    return { t: 'in', b: bits, lx: r(lx), ly: r(ly), rx: r(rx), ry: r(ry), l2: r(l2), r2: r(r2) };
  }

  function pump() {
    if (!ws || ws.readyState !== 1 || !state.active) return;
    const f = currentFrame();
    if (!f) return;
    const k = JSON.stringify(f);
    const now = performance.now();
    // so manda quando muda, mais um sinal de vida a cada 100 ms (o PC solta tudo se ficar sem receber)
    if (k !== lastKey || now - lastSentAt > 100) {
      ws.send(k);
      lastKey = k;
      lastSentAt = now;
    }
  }

  function neutral() {
    keys.clear();
    lastKey = '';
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'in', b: 0, lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0 }));
  }

  async function open() {
    if (ws || !wanted) return;
    await loadControls();
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/play`;
    const sock = new WebSocket(url);
    ws = sock;
    sock.onopen = () => {
      state.connected = true;
      notify();
      clearInterval(sendTimer);
      sendTimer = setInterval(pump, 16);
    };
    sock.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'status') {
        state.active = m.active;
        state.hostReady = m.hostReady;
        if (!m.active) neutral();
        notify();
      }
    };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      state.connected = false;
      state.active = false;
      clearInterval(sendTimer);
      notify();
      if (wanted) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(open, 1500);
      }
    };
    sock.onerror = () => {};
  }

  function close() {
    wanted = false;
    clearTimeout(retryTimer);
    clearInterval(sendTimer);
    if (ws) {
      neutral();
      ws.close();
    }
  }

  // ---------- teclado ----------
  const typing = (t) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName);
  const mapped = (code) => controls && Object.values(controls.keyboard).includes(code);

  addEventListener('keydown', (e) => {
    if (!state.active || typing(e.target) || !mapped(e.code)) return;
    e.preventDefault();
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', neutral);
  addEventListener('beforeunload', close);

  // ---------- liga/desliga conforme a vez da pessoa ----------
  LH.onMe((me) => {
    const myTurn = me.ticket?.phase === 'active';
    if (myTurn && !wanted) {
      wanted = true;
      controls = null; // recarrega: a pessoa pode ter mudado os controles
      open();
    } else if (!myTurn && wanted) {
      close();
    }
  });

  LH.play = {
    state,
    onStatus(fn) {
      listeners.add(fn);
      fn({ ...state });
    },
  };
})();
