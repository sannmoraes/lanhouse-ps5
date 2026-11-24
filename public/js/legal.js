// Termos e privacidade: preenche quem e o operador do site (OPERATOR_NAME e CONTACT_EMAIL no .env do servidor).
(() => {
  const fill = (op) => {
    const name = op?.name || '';
    const email = op?.email || '';
    for (const el of document.querySelectorAll('[data-op="name"]')) if (name) el.textContent = name;
    for (const el of document.querySelectorAll('[data-op="email"]')) {
      if (!email) continue;
      el.textContent = '';
      const a = document.createElement('a');
      a.href = `mailto:${email}`;
      a.textContent = email;
      a.className = 'text-pink hover:underline';
      el.appendChild(a);
    }
    if (!name || !email) {
      const w = document.getElementById('legal-warn');
      w.textContent = LH.t('legal.operator_missing');
      w.classList.remove('hidden');
    }
  };
  fetch('/api/config')
    .then((r) => r.json())
    .then((c) => fill(c.operator))
    .catch(() => fill(null));
})();
