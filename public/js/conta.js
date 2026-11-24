(() => {
  const $ = (id) => document.getElementById(id);
  LH.requireLogin();

  let filled = false;
  LH.onMe((me) => {
    if (!me.user || filled) return;
    filled = true;
    $('p-email').textContent = me.user.email;
    $('p-nick').value = me.user.nickname;
    loadOrders();
  });

  const STATUS = { paid: ['conta.status_paid', 'text-money'], pending: ['conta.status_pending', 'text-orange'], expired: ['conta.status_expired', 'text-mute'] };
  async function loadOrders() {
    try {
      const { orders } = await LH.api('/api/me/orders');
      $('orders').innerHTML = orders.length
        ? orders
            .map((o) => {
              const [txt, cls] = STATUS[o.status] ?? [null, 'text-mute'];
              const refund = o.refund_cents > 0 ? `<span class="${o.refunded_at ? 'text-mute' : 'text-orange'} font-medium">${o.refunded_at ? LH.t('conta.refund_done') : LH.t('conta.refund_coming', { amount: LH.money(o.refund_cents) })}</span>` : '';
              return `<div class="flex items-center justify-between py-2"><span>${o.kind === 'raise' ? LH.t('conta.order_raise') : LH.t('conta.order_bid', { n: o.minutes })} · ${LH.money(o.amount_cents)}</span><span class="flex gap-3 text-xs"><span class="text-mute">${new Date(o.created_at).toLocaleString(LH.locale, { dateStyle: 'short', timeStyle: 'short' })}</span><span class="${cls} font-medium">${txt ? LH.t(txt) : '—'}</span>${refund}</span></div>`;
            })
            .join('')
        : `<p class="py-2 text-mute">${LH.t('conta.orders_empty')}</p>`;
    } catch (e) {
      $('orders').textContent = e.message;
    }
  }

  $('nick-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await LH.api('/api/me', { method: 'PATCH', body: { nickname: $('p-nick').value } });
      LH.say($('nick-msg'), LH.t('conta.nick_saved'), true);
      LH.refreshMe();
    } catch (err) {
      LH.say($('nick-msg'), err.message);
    }
  });

  $('pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('pw-new').value !== $('pw-new2').value) return LH.say($('pw-msg'), LH.t('conta.pw_differ'));
    try {
      await LH.api('/api/me/password', { method: 'POST', body: { current: $('pw-cur').value, next: $('pw-new').value } });
      LH.say($('pw-msg'), LH.t('conta.pw_changed'), true);
      $('pw-form').reset();
    } catch (err) {
      LH.say($('pw-msg'), err.message);
    }
  });

  $('del-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm(LH.t('conta.delete_confirm'))) return;
    try {
      await LH.api('/api/me', { method: 'DELETE', body: { password: $('del-pw').value } });
      location.href = LH.url('/');
    } catch (err) {
      LH.say($('del-msg'), err.message);
    }
  });

  $('logout').addEventListener('click', LH.logout);
})();
