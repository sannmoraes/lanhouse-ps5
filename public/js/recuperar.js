(() => {
  const $ = (id) => document.getElementById(id);
  let email = '';

  async function sendCode(from) {
    LH.say($('msg1'), '');
    LH.say($('msg2'), '');
    email = $('email').value.trim();
    if (!email) return LH.say($('msg1'), LH.t('recuperar.email_required'));
    $('go1').disabled = true;
    try {
      const r = await LH.api('/api/auth/forgot', { method: 'POST', body: { email } });
      $('form-email').classList.add('hidden');
      $('form-code').classList.remove('hidden');
      $('sent-to').textContent = r.message;
      $('sub').textContent = LH.t('recuperar.code_sent_sub', { email });
      if (from === 'resend') LH.say($('msg2'), LH.t('recuperar.resend_ok'), true);
      $('code').focus();
    } catch (e) {
      LH.say(from === 'resend' ? $('msg2') : $('msg1'), e.message);
    } finally {
      $('go1').disabled = false;
    }
  }

  $('form-email').addEventListener('submit', (e) => {
    e.preventDefault();
    sendCode('first');
  });
  $('resend').addEventListener('click', () => sendCode('resend'));
  $('back').addEventListener('click', () => {
    $('form-code').classList.add('hidden');
    $('form-email').classList.remove('hidden');
    $('sub').textContent = LH.t('recuperar.back_sub');
  });

  $('form-code').addEventListener('submit', async (e) => {
    e.preventDefault();
    LH.say($('msg2'), '');
    const code = $('code').value.replace(/\D/g, '');
    if (code.length !== 6) return LH.say($('msg2'), LH.t('recuperar.code_len'));
    if ($('pw').value.length < 8) return LH.say($('msg2'), LH.t('auth.password_short'));
    if ($('pw').value !== $('pw2').value) return LH.say($('msg2'), LH.t('auth.passwords_differ'));
    $('go2').disabled = true;
    try {
      await LH.api('/api/auth/reset', { method: 'POST', body: { email, code, password: $('pw').value } });
      $('form-code').classList.add('hidden');
      $('sub').textContent = '';
      LH.say($('done'), LH.t('recuperar.done'), true);
      setTimeout(() => (location.href = LH.url('/entrar.html')), 2500);
    } catch (err) {
      LH.say($('msg2'), err.message);
    } finally {
      $('go2').disabled = false;
    }
  });
})();
