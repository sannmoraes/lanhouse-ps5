// Catalogo de mensagens do servidor por idioma (pt = portugues do Brasil, en = ingles).
// O cliente manda o idioma no cabecalho x-lang (en | pt); sem ele, sai em portugues.
// Toda chave precisa existir nos dois idiomas (o teste de paridade confere).

export const LANGS = ['pt', 'en'];

const money = (cents, lang) =>
  (cents / 100).toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR', { style: 'currency', currency: 'BRL' });
const plural = (n, one, many) => (n === 1 ? one : many);

export const MESSAGES = {
  pt: {
    // controles
    controls_invalid: () => 'Controles inválidos.',
    controls_bad_key: (p) => `Tecla inválida para "${p.action}".`,
    controls_bad_button: (p) => `Botão do controle inválido para "${p.action}".`,
    controls_dup_key: () => 'Duas ações estão usando a mesma tecla.',
    // conta
    password_length: () => 'A senha precisa ter de 8 a 128 caracteres.',
    email_invalid: () => 'E-mail inválido.',
    email_mismatch: () => 'Os dois e-mails não são iguais.',
    nickname_rules: () => 'Apelido: 2 a 16 caracteres (letras, números, espaço, _ - .).',
    nickname_invalid: () => 'Apelido inválido.',
    adult_required: () => 'Confirme que você tem 18 anos ou mais.',
    nick_taken: () => 'Esse apelido já está em uso.',
    account_create_failed: () => 'Não foi possível criar a conta com esses dados.',
    login_wrong: () => 'E-mail ou senha incorretos.',
    login_wrong_remaining: (p) => `E-mail ou senha incorretos. Você tem mais ${p.remaining} ${plural(p.remaining, 'tentativa', 'tentativas')}.`,
    login_wrong_locked: () => 'Senha incorreta. Conta bloqueada por 15 minutos. Se você esqueceu a senha, use "Esqueci minha senha".',
    email_unverified: () => 'Confirme o seu e-mail para entrar: enviamos um código para ele.',
    password_current_wrong: () => 'Senha atual incorreta.',
    password_wrong: () => 'Senha incorreta.',
    code_invalid: () => 'Código inválido ou expirado. Peça um novo código se precisar.',
    has_tickets: () => 'Você tem fichas na fila. Use ou espere terminar antes de apagar a conta.',
    login_required: () => 'Entre na sua conta para continuar.',
    // respostas de sucesso
    resend_sent: () => 'Se esse e-mail estiver esperando confirmação, enviamos um novo código de 6 dígitos.',
    forgot_sent: () => 'Se esse e-mail tiver conta, enviamos um código de 6 dígitos. Ele vale por 15 minutos.',
    password_changed: () => 'Senha trocada. Entre com a nova senha.',
    // limites e bloqueios
    locked: (p, t) => `${t(p.reason ?? 'too_many_tries')} Tente de novo em ${p.min} min.`,
    too_many_tries: () => 'Muitas tentativas.',
    device_too_many_tries: () => 'Muitas tentativas deste aparelho.',
    device_too_many_requests: () => 'Muitos pedidos deste aparelho. Tente mais tarde.',
    register_too_many: () => 'Muitas contas criadas deste aparelho. Tente mais tarde.',
    account_locked: () => 'Conta bloqueada por excesso de tentativas. Se você esqueceu a senha, use "Esqueci minha senha".',
    forgot_too_many: () => 'Você já pediu códigos demais.',
    wait_few_minutes: () => 'Muitas tentativas. Espere alguns minutos.',
    orders_too_many: () => 'Muitos pedidos. Aguarde alguns minutos.',
    requests_too_many: () => 'Muitas requisições.',
    admin_too_many: () => 'Muitas tentativas de senha do painel.',
    admin_password_wrong: () => 'Senha do painel inválida.',
    admin_password_locked: () => 'Senha do painel inválida. Acesso bloqueado por 15 minutos.',
    host_too_many: () => 'Muitas tentativas com o segredo do console.',
    host_secret_wrong: () => 'Segredo do host inválido.',
    // requisicao
    body_too_large: () => 'Corpo da requisição grande demais.',
    bad_json: () => 'JSON inválido.',
    bad_request: () => 'Requisição inválida.',
    not_found: () => 'Não encontrado.',
    order_not_found: () => 'Pedido não encontrado.',
    internal: () => 'Erro interno.',
    // fila, lances e Pix
    pix_failed: () => 'Não foi possível gerar o Pix agora. Tente de novo.',
    bid_minutes_range: (p) => `Os minutos precisam ser de ${p.min} a ${p.max}, de ${p.step} em ${p.step}.`,
    bid_whole_reais: () => 'O valor precisa ser em reais inteiros.',
    bid_max: (p) => `O valor máximo de um lance é ${money(p.cents, 'pt')}.`,
    bid_below_min: (p) => `Valor abaixo do mínimo para ${p.minutes} min: ${money(p.cents, 'pt')}.`,
    too_many_bids: (p) => `Você já tem ${p.max} lances na fila. Espere um terminar.`,
    bid_not_waiting: () => 'Esse lance não está mais esperando na fila.',
    bid_raise_higher: () => 'O novo lance precisa ser maior que o atual (mais reais e/ou mais minutos).',
    amount_mismatch: () => 'Valor pago diferente do pedido.',
    already_free: () => 'Você já está na fila grátis.',
    free_cooldown: (p) => `A fila grátis libera de novo em ${p.wait} min.`,
    free_full: () => 'A fila grátis está cheia. Tente mais tarde.',
    // e-mails
    email_reset_subject: () => 'Seu código para redefinir a senha - Lan House PS5',
    email_reset_text: (p) =>
      `Seu código para redefinir a senha é: ${p.code}\n\nEle vale por ${p.minutes} minutos e só pode ser usado uma vez.\nSe você não pediu isso, ignore este e-mail: a sua senha continua a mesma.`,
    email_verify_subject: () => 'Confirme o seu e-mail - Lan House PS5',
    email_verify_text: (p) =>
      `Seu código para confirmar o e-mail é: ${p.code}\n\nEle vale por ${p.minutes} minutos e só pode ser usado uma vez.\nSe você não criou uma conta na Lan House PS5, ignore este e-mail: nada será ativado.`,
  },
  en: {
    controls_invalid: () => 'Invalid controls.',
    controls_bad_key: (p) => `Invalid key for "${p.action}".`,
    controls_bad_button: (p) => `Invalid controller button for "${p.action}".`,
    controls_dup_key: () => 'Two actions are using the same key.',
    password_length: () => 'The password must be 8 to 128 characters long.',
    email_invalid: () => 'Invalid email.',
    email_mismatch: () => 'The two emails do not match.',
    nickname_rules: () => 'Nickname: 2 to 16 characters (letters, numbers, space, _ - .).',
    nickname_invalid: () => 'Invalid nickname.',
    adult_required: () => 'Confirm that you are 18 or older.',
    nick_taken: () => 'That nickname is already taken.',
    account_create_failed: () => 'Could not create an account with these details.',
    login_wrong: () => 'Wrong email or password.',
    login_wrong_remaining: (p) => `Wrong email or password. You have ${p.remaining} more ${plural(p.remaining, 'attempt', 'attempts')}.`,
    login_wrong_locked: () => 'Wrong password. Account locked for 15 minutes. If you forgot your password, use "Forgot my password".',
    email_unverified: () => 'Confirm your email to sign in: we sent a code to it.',
    password_current_wrong: () => 'Current password is wrong.',
    password_wrong: () => 'Wrong password.',
    code_invalid: () => 'Invalid or expired code. Ask for a new code if you need one.',
    has_tickets: () => 'You have tickets in the queue. Use them or wait for them to finish before deleting your account.',
    login_required: () => 'Sign in to your account to continue.',
    resend_sent: () => 'If that email is waiting for confirmation, we sent a new 6-digit code.',
    forgot_sent: () => 'If that email has an account, we sent a 6-digit code. It is valid for 15 minutes.',
    password_changed: () => 'Password changed. Sign in with the new password.',
    locked: (p, t) => `${t(p.reason ?? 'too_many_tries')} Try again in ${p.min} min.`,
    too_many_tries: () => 'Too many attempts.',
    device_too_many_tries: () => 'Too many attempts from this device.',
    device_too_many_requests: () => 'Too many requests from this device. Try again later.',
    register_too_many: () => 'Too many accounts created from this device. Try again later.',
    account_locked: () => 'Account locked after too many attempts. If you forgot your password, use "Forgot my password".',
    forgot_too_many: () => 'You have already asked for too many codes.',
    wait_few_minutes: () => 'Too many attempts. Wait a few minutes.',
    orders_too_many: () => 'Too many orders. Wait a few minutes.',
    requests_too_many: () => 'Too many requests.',
    admin_too_many: () => 'Too many owner panel password attempts.',
    admin_password_wrong: () => 'Wrong owner panel password.',
    admin_password_locked: () => 'Wrong owner panel password. Access blocked for 15 minutes.',
    host_too_many: () => 'Too many attempts with the console secret.',
    host_secret_wrong: () => 'Invalid host secret.',
    body_too_large: () => 'Request body too large.',
    bad_json: () => 'Invalid JSON.',
    bad_request: () => 'Invalid request.',
    not_found: () => 'Not found.',
    order_not_found: () => 'Order not found.',
    internal: () => 'Internal error.',
    pix_failed: () => 'Could not create the Pix payment right now. Try again.',
    bid_minutes_range: (p) => `Minutes must be from ${p.min} to ${p.max}, in steps of ${p.step}.`,
    bid_whole_reais: () => 'The amount must be in whole reais.',
    bid_max: (p) => `The maximum bid is ${money(p.cents, 'en')}.`,
    bid_below_min: (p) => `Amount below the minimum for ${p.minutes} min: ${money(p.cents, 'en')}.`,
    too_many_bids: (p) => `You already have ${p.max} bids in the queue. Wait for one to finish.`,
    bid_not_waiting: () => 'That bid is no longer waiting in the queue.',
    bid_raise_higher: () => 'The new bid must be higher than the current one (more reais and/or more minutes).',
    amount_mismatch: () => 'Amount paid differs from the order.',
    already_free: () => 'You are already in the free queue.',
    free_cooldown: (p) => `The free queue opens for you again in ${p.wait} min.`,
    free_full: () => 'The free queue is full. Try again later.',
    email_reset_subject: () => 'Your password reset code - Lan House PS5',
    email_reset_text: (p) =>
      `Your password reset code is: ${p.code}\n\nIt is valid for ${p.minutes} minutes and can only be used once.\nIf you did not ask for this, ignore this email: your password stays the same.`,
    email_verify_subject: () => 'Confirm your email - Lan House PS5',
    email_verify_text: (p) =>
      `Your email confirmation code is: ${p.code}\n\nIt is valid for ${p.minutes} minutes and can only be used once.\nIf you did not create an account at Lan House PS5, ignore this email: nothing will be activated.`,
  },
};

/** Normaliza o idioma: qualquer coisa que comece com "en" vira en; o resto, pt. */
export function normLang(value) {
  return String(value ?? '').trim().toLowerCase().startsWith('en') ? 'en' : 'pt';
}

/** Idioma da requisicao (cabecalho x-lang). */
export const langOf = (req) => normLang(req?.headers?.['x-lang']);

export const hasMessage = (key) => typeof key === 'string' && Object.hasOwn(MESSAGES.pt, key);

/** Texto da chave no idioma pedido (cai para pt se faltar). */
export function msg(lang, key, params = {}) {
  const l = normLang(lang);
  const fn = MESSAGES[l][key] ?? MESSAGES.pt[key];
  if (!fn) return String(key);
  return fn(params ?? {}, (k, p) => msg(l, k, p));
}
