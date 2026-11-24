// Confirmar e-mail do cadastro: digita o codigo recebido e ja entra na conta.
(() => {
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const next = (() => {
    const n = q.get('next') || LH.url('/');
    return /^\/[A-Za-z0-9\-_./]*$/.test(n) && !n.startsWith('//') ? n : LH.url('/');
  })();
  $('email').value = q.get('email') || '';
  if ($('email').value) $('code').focus();

  LH.onMe((me) => {
    if (me.user) location.replace(next);
  });

  $('form-confirm').addEventListener('submit', async (e) => {
    e.preventDefault();
    LH.say($('msg'), '');
    const email = $('email').value.trim();
    const code = $('code').value.replace(/\D/g, '');
    if (!email) return LH.say($('msg'), LH.t('confirmar.email_required'));
    if (code.length !== 6) return LH.say($('msg'), LH.t('confirmar.code_len'));
    $('go').disabled = true;
    try {
      await LH.api('/api/auth/verify', { method: 'POST', body: { email, code } });
      location.href = next;
    } catch (err) {
      LH.say($('msg'), err.message);
      $('go').disabled = false;
    }
  });

  $('resend').addEventListener('click', async () => {
    LH.say($('msg'), '');
    const email = $('email').value.trim();
    if (!email) return LH.say($('msg'), LH.t('confirmar.email_required'));
    $('resend').disabled = true;
    try {
      const r = await LH.api('/api/auth/resend-verify', { method: 'POST', body: { email } });
      LH.say($('msg'), r.message, true);
    } catch (err) {
      LH.say($('msg'), err.message);
    } finally {
      $('resend').disabled = false;
    }
  });
})();
