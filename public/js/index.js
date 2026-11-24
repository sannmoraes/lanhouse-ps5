(() => {
  const $ = (id) => document.getElementById(id);
  let tickTimer = null;
  let shownOrder = null;
  let previewSeq = 0;
  let prevPosition = null;
  let lastRaiseId = null;

  const reais = (cents) => LH.money(cents);
  const perMin = (cents, min) => LH.t('index.per_min', { price: reais(Math.round(cents / min)) });

  // ---------- video ao vivo ----------
  const LIVE = {
    free: ['index.live_free', 'bg-money'],
    busy: ['index.live_busy', 'bg-bad animate-pulse'],
    paused: ['index.live_paused', 'bg-teal'],
    offline: ['index.live_offline', 'bg-mute'],
  };

  let whep = null;
  let videoState = 'connecting';

  const msg = (icon, title, sub) =>
    `<div class="text-center text-mute p-6"><span class="material-symbols-outlined text-[56px] text-pink">${icon}</span><p class="mt-2 font-medium text-ink">${title}</p><p class="text-sm">${sub}</p></div>`;

  function paintVideoState() {
    const live = videoState === 'live';
    $('video').classList.toggle('hidden', !live);
    $('video-box').classList.toggle('hidden', live);
    $('v-mute').classList.toggle('hidden', !live || !$('video').muted);
    if (!live) {
      $('video-box').innerHTML = videoState === 'connecting' ? msg('sync', LH.t('index.video_connecting_title'), LH.t('index.video_connecting_sub')) : msg('videocam_off', LH.t('index.video_nosignal_title'), LH.t('index.video_nosignal_sub'));
    }
  }

  function paintVideo() {
    const box = $('video-box');
    const { whepUrl, streamUrl, stunUrl } = LH.config;
    if (whepUrl) {
      // Video de baixa latencia (WebRTC) publicado pelo PC do console.
      if (!whep) {
        whep = startWhep(whepUrl, $('video'), { stun: stunUrl, onState: (st) => { videoState = st; paintVideoState(); } });
        paintVideoState();
      }
      return;
    }
    if (streamUrl && box.dataset.url !== streamUrl) {
      box.dataset.url = streamUrl;
      box.innerHTML = `<iframe src="${LH.esc(streamUrl)}" class="w-full h-full" allow="autoplay; fullscreen" allowfullscreen referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>`;
    } else if (!streamUrl && !box.dataset.url) {
      box.dataset.url = '-';
      box.innerHTML = msg('videocam_off', LH.t('index.video_notconnected_title'), LH.t('index.video_notconnected_sub'));
    }
  }

  // Painel de diagnostico: abra o site com ?debug=1
  if (new URLSearchParams(location.search).has('debug')) {
    const box = document.createElement('pre');
    box.id = 'dbg';
    box.className = 'absolute bottom-12 left-3 z-10 px-2 py-1 rounded bg-black/80 text-[11px] font-mono text-money whitespace-pre';
    $('stage').appendChild(box);
    setInterval(async () => {
      const st = whep ? await whep.stats() : {};
      const v = st.video ?? {};
      const a = st.audio ?? {};
      box.textContent = `video ${v.fps ?? '-'} fps | buffer ${v.bufferMs ?? '-'} ms | perdidos ${v.packetsLost ?? '-'} | rtt ${st.rttMs ?? '-'} ms
audio ${a.bytes ? 'chegando' : 'sem audio'} | nivel ${a.audioLevel != null ? a.audioLevel.toFixed(3) : '-'} | buffer ${a.bufferMs ?? '-'} ms`;
    }, 1000);
  }

  $('v-mute').addEventListener('click', () => {
    $('video').muted = false;
    $('v-mute').classList.add('hidden');
  });
  $('v-full').addEventListener('click', () => {
    const el = $('stage');
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  });

  // Estado do controle do jogador da vez (so aparece quando e a vez dele).
  function paintChip(st) {
    const chip = $('ctl-chip');
    const myTurn = LH.me.ticket?.phase === 'active';
    chip.classList.toggle('hidden', !myTurn);
    if (!myTurn) return;
    const [txt, cls] = !st.connected ? [LH.t('index.chip_connecting'), 'text-orange'] : !st.hostReady ? [LH.t('index.chip_nosignal'), 'text-bad'] : [LH.t('index.chip_on'), 'text-money'];
    chip.textContent = txt;
    chip.className = `absolute top-3 right-3 px-2.5 py-1 rounded-md bg-black/70 text-xs font-mono font-bold ${cls}`;
  }
  LH.play.onStatus(paintChip);

  // ---------- jogador atual + fila ----------
  function paintState(s) {
    paintVideo();
    const [text, dot] = LIVE[s.console] ?? LIVE.offline;
    $('live-text').textContent = LH.t(text);
    $('live-dot').className = `w-2 h-2 rounded-full ${dot}`;

    const cur = s.current;
    $('np-name').textContent = cur ? cur.nickname : s.console === 'free' ? LH.t('index.np_free') : '—';
    $('np-avatar').textContent = cur ? cur.nickname[0].toUpperCase() : '?';
    $('np-avatar').className = `w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold shrink-0 ${cur ? 'btn-main' : 'bg-panel2'}`;
    $('np-sub').textContent = cur && cur.clockPaused
      ? LH.t('index.np_paused')
      : cur
      ? cur.lane === 'free'
        ? LH.t('index.np_free_turn', { min: cur.minutes })
        : LH.t('index.np_bid_turn', { price: reais(cur.cents), min: cur.minutes })
      : s.console === 'free'
        ? LH.t('index.np_bid_now')
        : s.console === 'offline'
          ? LH.t('index.np_offline')
          : '';

    $('q-count').textContent = s.queueLength;
    const mine = LH.me.user?.nickname;
    $('q-list').innerHTML = s.queue.length
      ? s.queue
          .map((q) => {
            const price =
              q.lane === 'free'
                ? `<span class="text-teal font-bold">${LH.t('index.free_tag')}</span>`
                : `<span class="text-money font-bold">${reais(q.cents)}</span> <span class="text-mute">· ${perMin(q.cents, q.minutes)}</span>`;
            return `<div class="flex items-center justify-between gap-2 px-4 py-2.5 ${q.nickname === mine ? 'bg-pink/10' : ''}"><div class="flex items-center gap-3 min-w-0"><span class="font-mono text-sm text-orange w-6">#${q.position}</span><span class="font-medium truncate">${LH.esc(q.nickname)}</span></div><div class="text-xs font-mono text-right shrink-0">${price}<div class="text-mute">${LH.t('common.n_min', { n: q.minutes })}</div></div></div>`;
          })
          .join('')
      : `<div class="px-4 py-6 text-sm text-mute text-center">${LH.t('index.queue_empty')}</div>`;
    const total = (cur ? cur.remainingMs : 0) + s.queue.reduce((a, q) => a + q.minutes * 60000, 0);
    $('q-wait').textContent = cur || s.queueLength ? LH.minutesText(total) : LH.t('index.wait_now');
    paintFree();
  }

  function tick() {
    const cur = LH.state?.current;
    if (!cur) {
      $('np-clock').textContent = '--:--';
      $('np-bar').style.width = '0%';
      return;
    }
    const left = Math.max(0, cur.endsAt - LH.nowServer());
    $('np-clock').textContent = LH.clock(left);
    $('np-clock').className = `text-4xl font-mono font-bold leading-none ${left < 180000 ? 'text-bad' : 'text-pink'}`;
    $('np-bar').style.width = `${Math.min(100, (left / (cur.minutes * 60000)) * 100)}%`;
  }

  // ---------- minha ficha ----------
  function paintTickets(me) {
    $('my-box').classList.toggle('hidden', !me.tickets?.length);
    if (!me.tickets?.length) return;
    $('my-box').querySelectorAll('.t-row').forEach((n) => n.remove());
    for (const t of me.tickets) {
      const row = document.createElement('div');
      row.className = 't-row';
      const kind = t.lane === 'free' ? LH.t('index.kind_free') : reais(t.cents);
      row.innerHTML =
        t.phase === 'active'
          ? `<div class="font-bold text-money">${LH.t('index.ticket_active', { kind, min: t.minutes })}</div><div class="text-sm text-mute">${LH.t('index.ticket_active_sub', { href: LH.url('/controles.html') })}</div>`
          : `<div class="font-bold text-orange">${LH.t('index.ticket_waiting', { pos: t.position, kind, min: t.minutes })}</div><div class="text-sm text-mute">${LH.t('index.ticket_wait', { wait: LH.minutesText(t.estimatedWaitMs) })}</div>`;
      $('my-box').appendChild(row);
    }
    $('my-title').textContent = '';
    $('my-sub').textContent = '';

    // Aviso quando alguem passa na frente.
    const pos = me.raisable?.position ?? null;
    if (pos !== null && prevPosition !== null && pos > prevPosition) {
      const a = $('alert');
      a.textContent = LH.t('index.alert_overtaken', { pos });
      a.classList.remove('hidden');
      setTimeout(() => a.classList.add('hidden'), 12000);
    }
    prevPosition = pos;
  }

  // ---------- lance ----------
  function fillMinutes() {
    const r = LH.config.rules;
    if (!r || $('bid-min').dataset.ready) return;
    $('bid-min').dataset.ready = '1';
    const opts = [];
    for (let m = r.minMinutes; m <= r.maxMinutes; m += r.stepMinutes) opts.push(`<option value="${m}">${LH.t('common.n_min', { n: m })}</option>`);
    $('bid-min').innerHTML = opts.join('');
    $('bid-min').value = '10';
    $('bid-reais').value = String(Math.ceil((r.minCentsPerMinute * 10) / 100));
    $('bid-hint').textContent = LH.t('index.bid_hint', { floor: reais(r.minCentsPerMinute), example: (r.minCentsPerMinute * 10) / 100 });
    if (raiseOf) startFromCurrentBid();
    schedulePreview();
  }

  // No modo "aumentar", os campos comecam no lance atual (+ R$ 5) para a pessoa so subir.
  function startFromCurrentBid() {
    $('bid-min').value = String(raiseOf.minutes);
    $('bid-reais').value = String(raiseOf.cents / 100 + 5);
  }

  let raiseOf = null; // { entryId, minutes, cents } quando estamos aumentando um lance
  function setMode(raisable) {
    const was = raiseOf?.entryId;
    raiseOf = raisable ? { entryId: raisable.entryId, minutes: raisable.minutes, cents: raisable.cents } : null;
    $('bid-title').lastElementChild.textContent = raiseOf ? LH.t('index.title_raise') : LH.t('index.title_bid');
    $('bid-go').textContent = raiseOf ? LH.t('index.go_raise') : LH.t('index.go_bid');
    if (raiseOf && lastRaiseId !== raiseOf.entryId) {
      // começa do lance atual para a pessoa so aumentar
      lastRaiseId = raiseOf.entryId;
      if ($('bid-min').dataset.ready) startFromCurrentBid();
      schedulePreview();
    }
    if (!raiseOf && was) {
      lastRaiseId = null;
      schedulePreview();
    }
  }

  const bidValues = () => ({ minutes: Number($('bid-min').value), cents: Math.round(Number($('bid-reais').value) * 100) });

  function schedulePreview() {
    clearTimeout(schedulePreview.t);
    schedulePreview.t = setTimeout(runPreview, 250);
  }

  async function runPreview() {
    const seq = ++previewSeq;
    const { minutes, cents } = bidValues();
    const box = $('bid-preview');
    $('bid-first').classList.add('hidden');
    if (!minutes || !cents) {
      box.innerHTML = `<span class="text-mute">${LH.t('index.preview_empty')}</span>`;
      return;
    }
    try {
      const q = new URLSearchParams({ minutes, cents });
      if (raiseOf) q.set('entryId', raiseOf.entryId);
      const p = await LH.api(`/api/bids/preview?${q}`);
      if (seq !== previewSeq) return;
      let extra = '';
      if (raiseOf) {
        const diff = cents - raiseOf.cents;
        extra = diff > 0 || minutes > raiseOf.minutes ? LH.t('index.preview_diff', { diff: reais(Math.max(diff, 0)) }) : LH.t('index.preview_must_raise');
      }
      box.innerHTML = LH.t('index.preview_main', { rate: perMin(cents, minutes), pos: p.position, extra });
      if (p.position > 1 && p.toBeFirstCents && p.toBeFirstCents <= (LH.config.rules?.maxCents ?? Infinity)) {
        $('bid-first').textContent = LH.t('index.bid_first', { price: reais(p.toBeFirstCents) });
        $('bid-first').dataset.cents = p.toBeFirstCents;
        $('bid-first').classList.remove('hidden');
      }
    } catch (e) {
      if (seq === previewSeq) box.innerHTML = `<span class="text-bad">${LH.esc(e.message)}</span>`;
    }
  }

  async function go() {
    LH.say($('buy-error'), '');
    if (!LH.me.user) {
      location.href = `${LH.url('/entrar.html')}?next=${encodeURIComponent(LH.url('/'))}`;
      return;
    }
    $('bid-go').disabled = true;
    try {
      const { minutes, cents } = bidValues();
      const me = raiseOf
        ? await LH.api('/api/bids/raise', { method: 'POST', body: { entryId: raiseOf.entryId, minutes, cents } })
        : await LH.api('/api/bids', { method: 'POST', body: { minutes, cents } });
      if (me.pending) showPix(me.pending);
    } catch (e) {
      LH.say($('buy-error'), e.message);
    } finally {
      $('bid-go').disabled = false;
    }
  }

  // ---------- Pix ----------
  // O QR e desenhado aqui a partir do proprio "copia e cola" (assim os dois sao sempre o mesmo Pix).
  // Se so houver a imagem do provedor, usa a imagem.
  function drawQr(p) {
    const wrap = $('pix-qr');
    const canvas = $('pix-qr-canvas');
    const img = $('pix-qr-img');
    wrap.classList.toggle('hidden', !p.pixCode && !p.pixQr);
    canvas.classList.add('hidden');
    img.classList.add('hidden');
    if (p.pixCode && typeof qrcode === 'function') {
      try {
        const qr = qrcode(0, 'M');
        qr.addData(p.pixCode);
        qr.make();
        const n = qr.getModuleCount();
        const quiet = 4;
        const scale = Math.max(3, Math.floor(480 / (n + quiet * 2)));
        const size = (n + quiet * 2) * scale;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#000000';
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        canvas.classList.remove('hidden');
        return;
      } catch {
        /* cai para a imagem do provedor */
      }
    }
    if (p.pixQr) {
      img.src = `data:image/png;base64,${p.pixQr}`;
      img.classList.remove('hidden');
    }
  }

  function showPix(p) {
    shownOrder = p.orderId;
    $('pix').classList.remove('hidden');
    $('pix-pack').textContent = p.kind === 'raise' ? LH.t('index.pix_raise') : LH.t('index.pix_bid');
    $('pix-amount').textContent = reais(p.amountCents);
    $('pix-code').value = p.pixCode ?? '';
    drawQr(p);
    $('pix-dev').classList.toggle('hidden', !LH.config.devPay);
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      const left = p.expiresAt - LH.nowServer();
      $('pix-expire').textContent = left > 0 ? LH.t('index.pix_expires', { t: LH.clock(left) }) : LH.t('index.pix_expired');
    }, 500);
  }

  function hidePix() {
    shownOrder = null;
    clearInterval(tickTimer);
    $('pix').classList.add('hidden');
  }

  $('pix-copy').addEventListener('click', async () => {
    const code = $('pix-code').value;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      $('pix-code').select();
      document.execCommand('copy');
    }
    $('pix-copy').textContent = LH.t('index.copied');
    setTimeout(() => ($('pix-copy').textContent = LH.t('index.copy')), 1500);
  });

  $('pix-dev').addEventListener('click', async () => {
    if (!shownOrder) return;
    try {
      await LH.api(`/api/dev/pay/${shownOrder}`, { method: 'POST', body: {} });
      LH.refreshMe();
    } catch (e) {
      LH.say($('buy-error'), e.message);
    }
  });

  $('pix-cancel').addEventListener('click', async () => {
    try {
      await LH.api('/api/orders/pending', { method: 'DELETE' });
    } catch {}
    hidePix();
    LH.refreshMe();
  });

  // ---------- fila gratis ----------
  function paintFree() {
    const r = LH.config.rules;
    if (!r) return;
    const s = LH.state;
    const f = LH.me.free;
    const rotation = r.freeEvery > 0 ? LH.t('index.free_rotation_every', { n: r.freeEvery }) : LH.t('index.free_rotation_idle');
    let txt = LH.t('index.free_text', { min: r.freeMinutes, rotation, n: s?.freeLength ?? 0 });
    let btn = LH.t('index.free_join');
    let disabled = false;
    if (!LH.me.user) {
      btn = LH.t('index.free_login');
    } else if (f?.inQueue) {
      btn = LH.t('index.free_leave');
    } else if (f?.cooldownMs > 0) {
      txt += LH.t('index.free_cooldown', { wait: LH.minutesText(f.cooldownMs) });
      disabled = true;
    }
    $('free-text').textContent = txt;
    $('free-go').textContent = btn;
    $('free-go').disabled = disabled;
    $('free-go').classList.toggle('opacity-50', disabled);
  }

  $('free-go').addEventListener('click', async () => {
    LH.say($('free-error'), '');
    if (!LH.me.user) {
      location.href = `${LH.url('/entrar.html')}?next=${encodeURIComponent(LH.url('/'))}`;
      return;
    }
    try {
      await LH.api('/api/free', { method: LH.me.free?.inQueue ? 'DELETE' : 'POST', body: {} });
      LH.refreshMe();
    } catch (e) {
      LH.say($('free-error'), e.message);
    }
  });

  // ---------- ligacoes ----------
  function paintMe(me) {
    $('buy-guest').classList.toggle('hidden', Boolean(me.user));
    paintTickets(me);
    paintChip(LH.play.state);
    setMode(me.raisable);
    if (me.pending && me.pending.orderId !== shownOrder) showPix(me.pending);
    if (!me.pending && shownOrder) hidePix();
    if (LH.state) paintState(LH.state);
  }

  $('bid-min').addEventListener('change', schedulePreview);
  $('bid-reais').addEventListener('input', schedulePreview);
  $('bid-go').addEventListener('click', go);
  $('bid-first').addEventListener('click', () => {
    $('bid-reais').value = String(Number($('bid-first').dataset.cents) / 100);
    schedulePreview();
  });

  LH.onState((s) => {
    fillMinutes();
    paintState(s);
    tick();
    schedulePreview();
  });
  LH.onMe(paintMe);
  setInterval(tick, 250);
  setTimeout(() => {
    paintVideo();
    fillMinutes();
    paintFree();
  }, 800);
})();
