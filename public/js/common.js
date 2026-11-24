// Compartilhado por todas as paginas: estado ao vivo, conta logada, formatadores e cabecalho.
(() => {
  // Idioma da pagina (vem de <html lang>); os textos ficam em /js/i18n/<idioma>.js, carregado antes deste arquivo.
  const DICT = window.LH_I18N ?? { lang: 'pt', locale: 'pt-BR', strings: {} };
  const LANG = /^en/i.test(document.documentElement.lang) ? 'en' : 'pt';
  const BASE = LANG === 'en' ? '/en' : '';

  const LH = (window.LH = {
    lang: LANG,
    locale: DICT.locale,
    base: BASE,
    // Texto da chave no idioma da pagina; {nome} e trocado por params.nome.
    t(key, params) {
      const s = DICT.strings[key];
      if (s === undefined) {
        console.warn('[i18n] chave sem texto:', key);
        return key;
      }
      return params ? s.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k]))) : s;
    },
    // Endereco de uma pagina do site no idioma atual: LH.url('/entrar.html') -> /en/entrar.html em ingles.
    url: (p) => (BASE && p.startsWith('/') && !p.startsWith('/api/') && !p.startsWith('/js/') && !p.startsWith('/en/') ? BASE + p : p),

    state: null,
    me: { user: null, ticket: null, tickets: [], raisable: null, pending: null, free: null, loaded: false },
    config: { pixExpiresMin: 15, devPay: false, streamUrl: '', rules: null, actions: [], defaultControls: null },
    stateListeners: new Set(),
    meListeners: new Set(),
    skew: 0, // diferenca entre o relogio do servidor e o do navegador

    money: (cents) => (cents / 100).toLocaleString(DICT.locale, { style: 'currency', currency: 'BRL' }),
    clock(ms) {
      const s = Math.max(0, Math.ceil(ms / 1000));
      const h = Math.floor(s / 3600);
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    },
    minutesText(ms) {
      const m = Math.round(ms / 60000);
      return m < 1 ? LH.t('common.less_than_1_min') : LH.t('common.n_min', { n: m });
    },
    nowServer: () => Date.now() + LH.skew,
    esc: (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),

    // O cabecalho x-lh protege as acoes de quem esta logado contra pedidos vindos de outros sites.
    async api(path, { method = 'GET', body, headers } = {}) {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-lh': '1', 'x-lang': LANG, ...(headers || {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.message || LH.t('common.unexpected_error')), { code: data.error, status: res.status });
      return data;
    },

    onState(fn) {
      LH.stateListeners.add(fn);
      if (LH.state) fn(LH.state);
    },
    onMe(fn) {
      LH.meListeners.add(fn);
      if (LH.me.loaded) fn(LH.me);
    },

    async refreshMe() {
      try {
        const d = await LH.api('/api/me');
        LH.me = { user: d.user, ticket: d.ticket ?? null, tickets: d.tickets ?? [], raisable: d.raisable ?? null, pending: d.pending ?? null, free: d.free ?? null, loaded: true };
      } catch {
        LH.me = { ...LH.me, loaded: true };
      }
      for (const fn of LH.meListeners) fn(LH.me);
    },

    async logout() {
      try {
        await LH.api('/api/auth/logout', { method: 'POST', body: {} });
      } catch {}
      location.href = LH.url('/');
    },

    // Mensagem de erro/sucesso de formularios.
    say(el, msg, ok = false) {
      if (!el) return;
      el.textContent = msg || '';
      el.classList.toggle('hidden', !msg);
      el.classList.toggle('text-bad', !ok);
      el.classList.toggle('text-money', ok);
    },

    // Quem nao esta logado e levado para entrar e volta depois.
    requireLogin() {
      LH.onMe((me) => {
        if (!me.user) location.href = `${LH.url('/entrar.html')}?next=${encodeURIComponent(location.pathname)}`;
      });
    },
  });

  function setState(s) {
    LH.state = s;
    LH.skew = s.now - Date.now();
    for (const fn of LH.stateListeners) {
      try {
        fn(s);
      } catch (e) {
        console.error(e);
      }
    }
  }

  // ---- cabecalho ----
  const CONSOLE = {
    free: ['console.free', 'bg-money'],
    busy: ['console.busy', 'bg-orange'],
    paused: ['console.paused', 'bg-teal'],
    offline: ['console.offline', 'bg-bad'],
  };

  LH.onState((s) => {
    const [text, dot] = CONSOLE[s.console] ?? CONSOLE.offline;
    const d = document.getElementById('hdr-dot');
    const t = document.getElementById('hdr-status');
    if (d) d.className = `w-2 h-2 rounded-full ${dot}`;
    if (t) t.textContent = LH.t(text);
  });

  LH.onMe((me) => {
    const el = document.getElementById('auth-area');
    if (!el) return;
    if (me.user) {
      el.innerHTML = `<a href="${LH.url('/conta.html')}" class="flex items-center gap-2 px-3 py-1.5 rounded-md bg-panel2 hover:bg-line text-sm"><span class="w-6 h-6 rounded-full btn-main flex items-center justify-center text-xs">${LH.esc(me.user.nickname[0].toUpperCase())}</span><span class="font-medium max-w-[9rem] truncate">${LH.esc(me.user.nickname)}</span></a><button id="btn-logout" class="px-3 py-1.5 rounded-md text-sm text-mute hover:text-ink">${LH.t('auth.logout')}</button>`;
      document.getElementById('btn-logout').addEventListener('click', LH.logout);
    } else {
      el.innerHTML = `<a href="${LH.url('/entrar.html')}" class="px-3 py-1.5 rounded-md text-sm font-medium text-ink hover:bg-panel2">${LH.t('auth.login')}</a><a href="${LH.url('/criar-conta.html')}" class="px-3 py-1.5 rounded-md text-sm btn-main">${LH.t('auth.signup')}</a>`;
    }
  });

  // ---- idioma ----
  // O seletor PT | EN guarda a escolha. Sem escolha guardada, quem usa o navegador em ingles vai para /en/ na primeira visita.
  // Com a escolha guardada em ingles, a pagina inicial em portugues leva para /en/.
  const PREF = 'lh-lang';
  const store = {
    get: () => {
      try {
        return localStorage.getItem(PREF);
      } catch {
        return null;
      }
    },
    set: (v) => {
      try {
        localStorage.setItem(PREF, v);
      } catch {}
    },
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a.lang-link');
    if (a?.dataset.lang) store.set(a.dataset.lang);
  });
  const enLink = document.querySelector('a.lang-link[data-lang="en"]');
  if (LANG === 'pt' && enLink) {
    const saved = store.get();
    const home = location.pathname === '/' || location.pathname === '/index.html';
    const wantsEn = saved ? saved === 'en' && home : /^en\b/i.test(navigator.language || '');
    if (wantsEn) {
      if (!saved) store.set('en');
      location.replace(enLink.getAttribute('href') + location.search + location.hash);
    }
  }

  // ---- carga inicial ----
  LH.api('/api/config')
    .then((c) => {
      LH.config = { ...LH.config, ...c };
      const a = document.getElementById('src-link');
      if (a && c.sourceUrl) {
        a.href = c.sourceUrl;
        a.classList.remove('hidden');
      }
    })
    .catch(() => {});
  LH.api('/api/state').then(setState).catch(() => {});
  try {
    const es = new EventSource('/api/events');
    es.addEventListener('state', (e) => {
      setState(JSON.parse(e.data));
      // Quando a fila muda, atualiza tambem a ficha da pessoa logada.
      if (LH.me.user) LH.refreshMe();
    });
  } catch {}
  LH.refreshMe();
  setInterval(() => LH.me.user && LH.refreshMe(), 8000);
})();
