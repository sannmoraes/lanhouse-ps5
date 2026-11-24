(() => {
  const $ = (id) => document.getElementById(id);
  let pw = null;
  let timer = null;
  let last = null;

  const headers = () => ({ 'x-admin-password': pw });
  const say = (msg) => LH.say($('admin-msg'), msg);

  async function load() {
    try {
      last = await LH.api('/api/admin/overview', { headers: headers() });
      last._at = Date.now();
      say('');
      $('panel').classList.remove('hidden');
      $('panel').classList.add('flex');
      paint(last);
    } catch (e) {
      if (e.status === 401) {
        logout();
        say('Senha incorreta.');
      } else say(e.message);
    }
  }

  const CONSOLE = { free: ['LIVRE', 'text-money'], busy: ['EM USO', 'text-orange'], paused: ['PAUSADO', 'text-teal'], offline: ['OFFLINE', 'text-bad'] };

  function paint(o) {
    $('k-money').textContent = LH.money(o.paid.cents);
    $('k-orders').textContent = o.paid.orders;
    $('k-queue').textContent = o.queueLength;
    const [txt, cls] = CONSOLE[o.console] ?? CONSOLE.offline;
    $('k-console').textContent = txt;
    $('k-console').className = `text-2xl font-bold mt-1 ${cls}`;
    const h = o.host ?? {};
    $('k-host').textContent = h.ready ? 'PC do console: pronto (vídeo no ar)' : h.connected ? 'PC do console: conectado, sem vídeo' : 'PC do console: desconectado';
    $('a-player').textContent = o.current ? `${o.current.nickname} (${o.current.minutes} min)` : '—';
    $('b-pause-t').textContent = o.console === 'paused' ? 'Retomar fila' : 'Pausar fila';

    $('a-queue').innerHTML = o.adminQueue.length
      ? o.adminQueue
          .map(
            (q) => `<tr><td class="py-2 font-mono text-orange">#${q.position}</td><td class="font-medium">${LH.esc(q.nickname)}</td><td class="font-mono text-mute">${q.lane === 'free' ? 'grátis' : LH.money(q.cents)} · ${q.minutes} min</td><td class="text-right"><button data-cancel="${q.id}" class="px-2 py-1 rounded border border-bad text-bad text-xs hover:bg-bad hover:text-white">Remover</button></td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4" class="py-3 text-mute">Fila vazia.</td></tr>';
    for (const b of document.querySelectorAll('[data-cancel]')) b.addEventListener('click', () => cancel(b.dataset.cancel));

    const due = o.refundsDue ?? [];
    $('refund-box').classList.toggle('hidden', due.length === 0);
    $('a-refund').innerHTML = due
      .map(
        (r) => `<tr><td class="py-2 font-mono text-mute">${new Date(r.paid_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td><td class="font-medium">${LH.esc(r.nickname)}</td><td class="font-mono font-bold text-orange">${LH.money(r.refund_cents)}</td><td class="text-right"><button data-refunded="${LH.esc(r.id)}" class="px-2 py-1 rounded border border-orange text-orange text-xs hover:bg-orange hover:text-black">Já devolvi</button></td></tr>`,
      )
      .join('');
    for (const b of document.querySelectorAll('[data-refunded]')) b.addEventListener('click', () => confirm('Confirma que você já devolveu esse valor?') && act(`/api/admin/orders/${b.dataset.refunded}/refunded`));

    $('a-pay').innerHTML = o.recent.length
      ? o.recent
          .map(
            (r) => `<tr><td class="py-2 font-mono text-mute">${new Date(r.paid_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td><td class="font-medium">${LH.esc(r.nickname)}</td><td class="font-mono text-mute">${r.kind === 'raise' ? 'aumento' : r.minutes + ' min'}</td><td class="text-right font-bold text-money">${LH.money(r.amount_cents)}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4" class="py-3 text-mute">Nenhum pagamento ainda.</td></tr>';
  }

  function tick() {
    if (!last || !last.current) return ($('a-clock').textContent = '--:--');
    const serverNow = last.now + (Date.now() - last._at);
    $('a-clock').textContent = LH.clock(Math.max(0, last.current.endsAt - serverNow));
  }

  async function act(path, body) {
    try {
      await LH.api(path, { method: 'POST', headers: headers(), body: body ?? {} });
      load();
    } catch (e) {
      say(e.message);
    }
  }
  const cancel = (id) => {
    if (confirm('Remover esta pessoa da fila? O valor pago NÃO é devolvido automaticamente.')) act(`/api/admin/entries/${id}/cancel`);
  };

  $('b-end').addEventListener('click', () => {
    if (confirm('Encerrar o turno do jogador atual agora?')) act('/api/admin/end');
  });
  $('b-pause').addEventListener('click', () => act('/api/admin/pause', { paused: last?.console !== 'paused' }));

  function logout() {
    pw = null;
    clearInterval(timer);
    $('panel').classList.add('hidden');
    $('panel').classList.remove('flex');
    try {
      sessionStorage.removeItem('lh_admin');
    } catch {}
  }

  function start(password) {
    pw = password;
    try {
      sessionStorage.setItem('lh_admin', password);
    } catch {}
    load();
    clearInterval(timer);
    timer = setInterval(load, 3000);
  }

  $('login').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('pw').value) start($('pw').value);
    $('pw').value = '';
  });
  setInterval(tick, 250);

  try {
    const saved = sessionStorage.getItem('lh_admin');
    if (saved) start(saved);
  } catch {}
})();
