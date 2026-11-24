// Entrar e Criar conta (mesmo arquivo; cada pagina tem o seu formulario).
(() => {
  const $ = (id) => document.getElementById(id);
  const msg = $('form-msg');

  // Volta para onde a pessoa estava, so para caminhos do proprio site.
  const next = (() => {
    const n = new URLSearchParams(location.search).get('next') || LH.url('/');
    return /^\/[A-Za-z0-9\-_./]*$/.test(n) && !n.startsWith('//') ? n : LH.url('/');
  })();

  // Quem ja esta logado nao precisa ver estas telas.
  LH.onMe((me) => {
    if (me.user) location.replace(next);
  });

  const confirmUrl = (email) => `${LH.url('/confirmar-email.html')}?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`;

  async function submit(path, body) {
    LH.say(msg, '');
    $('submit').disabled = true;
    try {
      const r = await LH.api(path, { method: 'POST', body });
      // Cadastro novo: falta confirmar o e-mail com o codigo que acabou de chegar.
      location.href = r.needsVerification ? confirmUrl(r.email) : next;
    } catch (e) {
      // Login com senha certa, mas e-mail ainda sem confirmar: o servidor ja mandou um codigo novo.
      if (e.code === 'email_unverified') return (location.href = confirmUrl(body.email));
      LH.say(msg, e.message);
      $('submit').disabled = false;
    }
  }

  $('login-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!$('email').value || !$('password').value) return LH.say(msg, LH.t('auth.fill_email_password'));
    submit('/api/auth/login', { email: $('email').value, password: $('password').value });
  });

  $('register-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!$('email').value || !$('nickname').value) return LH.say(msg, LH.t('auth.fill_email_nickname'));
    if ($('email').value.trim().toLowerCase() !== $('email2').value.trim().toLowerCase()) return LH.say(msg, LH.t('auth.emails_differ'));
    if ($('password').value.length < 8) return LH.say(msg, LH.t('auth.password_short'));
    if ($('password').value !== $('password2').value) return LH.say(msg, LH.t('auth.passwords_differ'));
    if (!$('adult').checked) return LH.say(msg, LH.t('auth.adult_terms'));
    submit('/api/auth/register', {
      email: $('email').value,
      emailConfirm: $('email2').value,
      nickname: $('nickname').value,
      password: $('password').value,
      adult: true,
    });
  });
})();
