import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { config, RULES, assertProductionConfig } from './config.js';
import { LanHouse, LanHouseError, openDb } from './lanhouse.js';
import { Accounts, ACTIONS, DEFAULT_CONTROLS } from './accounts.js';
import { makePixProvider } from './pix.js';
import { attachPlay } from './play.js';
import { Throttle } from './security.js';
import { createMailer, resetEmail, verifyEmailMessage } from './mailer.js';
import { langOf, msg } from './messages.js';

const db = openDb(config.dbFile);
const house = new LanHouse(db, { rules: RULES, pixExpiresMin: config.pixExpiresMin });
const accounts = new Accounts(db, { requireVerification: config.requireEmailVerification });
const throttle = new Throttle(db);
const mailer = createMailer(config);
const pix = makePixProvider(config);

const problems = assertProductionConfig();
if (problems.length) console.warn(`[aviso] configuracao incompleta: ${problems.join('; ')}`);
console.log(`[pix] provedor: ${pix.name}${pix.name === 'mock' ? ' (NAO cobra de verdade)' : ''}`);
console.log(`[e-mail] ${mailer.name}${mailer.name === 'console' ? ' (NAO envia: os codigos de confirmar e-mail e recuperar senha aparecem neste log)' : ''}`);

// O console so e considerado online se o PC ligado ao PS5 avisou ha pouco.
let lastHostBeat = 0;
const HOST_TTL_MS = 15_000;
let play = null; // canal de controle (WebSocket), criado depois do servidor HTTP
function refreshConsole() {
  house.setConsoleOnline(Date.now() - lastHostBeat < HOST_TTL_MS);
}

// ---------- utilidades ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readJson(req, limit = 10_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new LanHouseError('too_large', 'body_too_large', 413);
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new LanHouseError('bad_json', 'bad_json');
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Senha do painel: 5 erros bloqueiam o IP por 15 minutos (antes era ilimitado).
const ADMIN_RULES = { max: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };
function requireAdmin(req) {
  const key = `admin:${req.socket.remoteAddress ?? 'x'}`;
  throttle.check(key, 'admin_too_many');
  if (!config.adminPassword || !safeEqual(req.headers['x-admin-password'], config.adminPassword)) {
    const r = throttle.fail(key, ADMIN_RULES);
    throw new LanHouseError('unauthorized', r.locked ? 'admin_password_locked' : 'admin_password_wrong', 401);
  }
  throttle.clear(key);
}

// ---------- sessao (cookie HttpOnly) ----------
const COOKIE = 'lh_session';

function sessionToken(req) {
  const m = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`));
  return m ? m[1] : null;
}

function sessionCookie(token, maxAgeSec) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${config.cookieSecure ? '; Secure' : ''}`;
}

/** Rotas que mudam algo exigem o cabecalho x-lh (um site de fora nao consegue envia-lo junto do cookie). */
function requireCsrfHeader(req) {
  if (req.method !== 'GET' && req.headers['x-lh'] !== '1') {
    throw new LanHouseError('bad_request', 'bad_request', 400);
  }
}

function currentUser(req) {
  return accounts.userFromToken(sessionToken(req));
}

function requireUser(req) {
  requireCsrfHeader(req);
  const user = currentUser(req);
  if (!user) throw new LanHouseError('unauthorized', 'login_required', 401);
  return user;
}

// ---------- limites de uso (em memoria) ----------
const buckets = new Map();
function hit(key, max, windowMs, message) {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new LanHouseError('rate_limited', message, 429);
  arr.push(now);
  buckets.set(key, arr);
}
function peek(key, max, windowMs, message) {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new LanHouseError('rate_limited', message, 429);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (!v.some((t) => now - t < 3_600_000)) buckets.delete(k);
}, 600_000).unref();

const ip = (req) => req.socket.remoteAddress ?? 'x';

// Segredo do PC do console: 10 erros bloqueiam o IP por 15 minutos.
const hostGuard = {
  check: (addr) => throttle.check(`host:${addr}`, 'host_too_many'),
  fail: (addr) => throttle.fail(`host:${addr}`, { max: 10, windowMs: 15 * 60_000, lockMs: 15 * 60_000 }),
  clear: (addr) => throttle.clear(`host:${addr}`),
};

// ---------- SSE (estado ao vivo) ----------
const clients = new Set();
let lastSnapshot = '';
function broadcast() {
  play?.sync(); // se a vez mudou, solta os botoes do jogador anterior na hora
  const snap = JSON.stringify(house.publicState());
  // "now" muda todo segundo; o cliente conta o relogio sozinho, entao so reenviamos se algo relevante mudou.
  const key = snap.replace(/"now":\d+,/, '').replace(/"remainingMs":\d+/, '');
  if (key === lastSnapshot) return;
  lastSnapshot = key;
  for (const c of clients) c.write(`event: state\ndata: ${snap}\n\n`);
}

setInterval(() => throttle.sweep(), 3_600_000).unref();
setInterval(() => accounts.purgeUnverified(), 600_000).unref(); // contas que nunca confirmaram o e-mail somem em ate ~2 h

setInterval(() => {
  refreshConsole();
  house.tick();
  broadcast();
}, 1000).unref();

/** Visao da pessoa logada: fichas (jogando/esperando), Pix pendente e fila gratis. */
function meView(userId) {
  const t = house.ticketForUser(userId);
  return { ticket: t.ticket, tickets: t.tickets, raisable: t.raisable, pending: t.pending, free: t.free };
}

/** Manda o codigo de confirmar e-mail (no maximo 3 por hora por e-mail). Em segundo plano, para o tempo de resposta nao revelar nada. */
function sendVerificationCode(mail, lang = 'pt') {
  const r = throttle.fail(`verify-send:${mail}`, { max: 4, windowMs: 3_600_000, lockMs: 3_600_000 });
  if (r.locked) return;
  const issued = accounts.issueVerification(mail);
  if (!issued) return;
  const m = verifyEmailMessage(issued.code, issued.minutes, lang);
  mailer.send({ to: issued.email, subject: m.subject, text: m.text }).catch((e) => console.error('[e-mail] falha ao enviar:', e.message));
}

const int = (v) => (v === undefined || v === null || v === '' ? NaN : Number(v));

// ---------- rotas ----------
async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/state') return send(res, 200, house.publicState());

  if (method === 'GET' && pathname === '/api/config') {
    return send(res, 200, {
      pixExpiresMin: config.pixExpiresMin,
      devPay: pix.name === 'mock',
      streamUrl: config.streamUrl,
      whepUrl: config.whepUrl,
      stunUrl: config.stunUrl,
      rules: house.rules,
      actions: ACTIONS,
      defaultControls: DEFAULT_CONTROLS,
      operator: { name: config.operatorName, email: config.contactEmail },
      sourceUrl: config.sourceUrl,
    });
  }

  if (method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(house.publicState())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // ----- contas -----
  if (method === 'POST' && pathname === '/api/auth/register') {
    requireCsrfHeader(req);
    hit(`reg:${ip(req)}`, config.registerPerHour, 3_600_000, 'register_too_many');
    const b = await readJson(req);
    const user = await accounts.register({ email: b.email, emailConfirm: b.emailConfirm, nickname: b.nickname, password: b.password, adult: b.adult });
    if (!user.email_verified_at) {
      // Conta criada, mas so entra depois de digitar o codigo enviado ao e-mail.
      sendVerificationCode(user.email, langOf(req));
      return send(res, 201, { needsVerification: true, email: user.email });
    }
    const token = accounts.createSession(user.id);
    return send(res, 201, { user: accounts.publicUser(user) }, { 'Set-Cookie': sessionCookie(token, 30 * 86400) });
  }

  // Confirmar e-mail: codigo certo confirma e ja entra na conta.
  if (method === 'POST' && pathname === '/api/auth/verify') {
    requireCsrfHeader(req);
    const b = await readJson(req);
    const mail = String(b.email ?? '').trim().toLowerCase().slice(0, 254);
    throttle.check(`verify-ip:${ip(req)}`, 'device_too_many_tries');
    try {
      const { user, token } = accounts.verifyEmail({ email: mail, code: b.code });
      throttle.clear(`verify-send:${mail}`);
      return send(res, 200, { user: accounts.publicUser(user) }, { 'Set-Cookie': sessionCookie(token, 30 * 86400) });
    } catch (e) {
      if (e.code === 'bad_code') throttle.fail(`verify-ip:${ip(req)}`, { max: 20, windowMs: 3_600_000, lockMs: 3_600_000 });
      throw e;
    }
  }

  // Pedir outro codigo de confirmacao. A resposta e SEMPRE a mesma (nao revela quais e-mails tem conta).
  if (method === 'POST' && pathname === '/api/auth/resend-verify') {
    requireCsrfHeader(req);
    hit(`verify-ip-send:${ip(req)}`, 10, 3_600_000, 'device_too_many_requests');
    const b = await readJson(req);
    sendVerificationCode(String(b.email ?? '').trim().toLowerCase().slice(0, 254), langOf(req));
    return send(res, 200, { ok: true, message: msg(langOf(req), 'resend_sent') });
  }

  // Login: 5 senhas erradas para o mesmo e-mail bloqueiam por 15 min (conta existindo ou nao, para nao revelar quem tem conta).
  if (method === 'POST' && pathname === '/api/auth/login') {
    requireCsrfHeader(req);
    const b = await readJson(req);
    const mail = String(b.email ?? '').trim().toLowerCase().slice(0, 254);
    const emailKey = `login:${mail}`;
    const ipKey = `loginip:${ip(req)}`;
    throttle.check(emailKey, 'account_locked');
    throttle.check(ipKey, 'device_too_many_tries');
    try {
      const { user, token } = await accounts.login({ email: b.email, password: b.password });
      throttle.clear(emailKey);
      return send(res, 200, { user: accounts.publicUser(user) }, { 'Set-Cookie': sessionCookie(token, 30 * 86400) });
    } catch (e) {
      if (e.code === 'email_unverified') {
        // Senha certa, e-mail ainda nao confirmado: manda um codigo novo e leva a pessoa para a tela de confirmar.
        throttle.clear(emailKey);
        sendVerificationCode(mail, langOf(req));
        throw e;
      }
      if (e.code !== 'bad_login') throw e;
      const r = throttle.fail(emailKey, { max: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 });
      throttle.fail(ipKey, { max: 30, windowMs: 15 * 60_000, lockMs: 15 * 60_000 });
      throw new LanHouseError('bad_login', r.locked ? 'login_wrong_locked' : 'login_wrong_remaining', 401, { remaining: r.remaining });
    }
  }

  // Recuperar senha, passo 1: manda um codigo de 6 digitos para o e-mail. A resposta e SEMPRE a mesma.
  if (method === 'POST' && pathname === '/api/auth/forgot') {
    requireCsrfHeader(req);
    hit(`forgot-ip:${ip(req)}`, 10, 3_600_000, 'device_too_many_requests');
    const b = await readJson(req);
    const mail = String(b.email ?? '').trim().toLowerCase().slice(0, 254);
    throttle.check(`forgot:${mail}`, 'forgot_too_many');
    const r = throttle.fail(`forgot:${mail}`, { max: 4, windowMs: 3_600_000, lockMs: 3_600_000 }); // no maximo 3 codigos por hora por e-mail
    if (!r.locked) {
      const issued = accounts.requestReset(mail);
      if (issued) {
        const m = resetEmail(issued.code, issued.minutes, langOf(req));
        // em segundo plano: assim o tempo de resposta nao revela se o e-mail existe
        mailer.send({ to: issued.email, subject: m.subject, text: m.text }).catch((e) => console.error('[e-mail] falha ao enviar:', e.message));
      }
    }
    return send(res, 200, { ok: true, message: msg(langOf(req), 'forgot_sent') });
  }

  // Recuperar senha, passo 2: codigo + nova senha.
  if (method === 'POST' && pathname === '/api/auth/reset') {
    requireCsrfHeader(req);
    const b = await readJson(req);
    const mail = String(b.email ?? '').trim().toLowerCase().slice(0, 254);
    throttle.check(`reset-ip:${ip(req)}`, 'device_too_many_tries');
    try {
      const u = await accounts.resetPassword({ email: mail, code: b.code, password: b.password });
      throttle.clear(`login:${mail}`); // a pessoa provou ser dona do e-mail: libera o bloqueio de login
      throttle.clear(`forgot:${mail}`);
      return send(res, 200, { ok: true, message: msg(langOf(req), 'password_changed') });
    } catch (e) {
      if (e.code === 'bad_code') throttle.fail(`reset-ip:${ip(req)}`, { max: 20, windowMs: 3_600_000, lockMs: 3_600_000 });
      throw e;
    }
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    requireCsrfHeader(req);
    accounts.logout(sessionToken(req));
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (method === 'GET' && pathname === '/api/me') {
    const user = currentUser(req);
    if (!user) return send(res, 200, { user: null });
    return send(res, 200, { user: accounts.publicUser(user), ...meView(user.id) });
  }

  if (method === 'PATCH' && pathname === '/api/me') {
    const user = requireUser(req);
    const b = await readJson(req);
    return send(res, 200, { user: accounts.publicUser(accounts.updateNickname(user.id, b.nickname)) });
  }

  if (method === 'POST' && pathname === '/api/me/password') {
    const user = requireUser(req);
    hit(`pw:${user.id}`, 6, 10 * 60_000, 'wait_few_minutes');
    const b = await readJson(req);
    await accounts.changePassword(user.id, b.current, b.next, sessionToken(req));
    return send(res, 200, { ok: true });
  }

  if (method === 'DELETE' && pathname === '/api/me') {
    const user = requireUser(req);
    hit(`del:${user.id}`, 5, 10 * 60_000, 'wait_few_minutes');
    const b = await readJson(req);
    await accounts.deleteAccount(user.id, b.password);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (method === 'GET' && pathname === '/api/me/controls') {
    const user = currentUser(req);
    if (!user) throw new LanHouseError('unauthorized', 'login_required', 401);
    return send(res, 200, { controls: accounts.getControls(user.id) });
  }

  if (method === 'PUT' && pathname === '/api/me/controls') {
    const user = requireUser(req);
    const b = await readJson(req, 4_000);
    return send(res, 200, { controls: accounts.setControls(user.id, b.controls) });
  }

  if (method === 'GET' && pathname === '/api/me/orders') {
    const user = currentUser(req);
    if (!user) throw new LanHouseError('unauthorized', 'login_required', 401);
    return send(res, 200, { orders: house.ordersForUser(user.id) });
  }

  // ----- leilao -----
  // Simula onde um lance ficaria (nao cria nada, nao exige login).
  if (method === 'GET' && pathname === '/api/bids/preview') {
    const p = url.searchParams;
    const replace = p.get('entryId') ? Number(p.get('entryId')) : undefined;
    return send(res, 200, house.previewBid({ minutes: int(p.get('minutes')), cents: int(p.get('cents')), replaceEntryId: replace }));
  }

  async function chargeAndRespond(user, order) {
    try {
      const charge = await pix.createCharge(order);
      house.attachPix(order.id, charge);
    } catch (e) {
      // Se o provedor falhar, o pedido nao fica pendurado.
      house.db.prepare("UPDATE orders SET status = 'expired' WHERE id = ?").run(order.id);
      console.error('[pix] falha ao criar cobranca:', e.message);
      throw new LanHouseError('pix_failed', 'pix_failed', 502);
    }
    return send(res, 201, meView(user.id));
  }

  // Novo lance: gera o Pix do valor total.
  if (method === 'POST' && pathname === '/api/bids') {
    const user = requireUser(req);
    hit(`order:${user.id}`, 10, 10 * 60_000, 'orders_too_many');
    const b = await readJson(req);
    const order = house.createBidOrder({ userId: user.id, nickname: user.nickname, minutes: int(b.minutes), cents: int(b.cents) });
    return chargeAndRespond(user, order);
  }

  // Aumentar um lance que esta na fila: informe os novos totais; o Pix e so a diferenca.
  if (method === 'POST' && pathname === '/api/bids/raise') {
    const user = requireUser(req);
    hit(`order:${user.id}`, 10, 10 * 60_000, 'orders_too_many');
    const b = await readJson(req);
    const order = house.createRaiseOrder({ userId: user.id, entryId: int(b.entryId), minutes: int(b.minutes), cents: int(b.cents) });
    return chargeAndRespond(user, order);
  }

  // Cancelar um Pix que ainda nao foi pago.
  if (method === 'DELETE' && pathname === '/api/orders/pending') {
    const user = requireUser(req);
    house.db.prepare("UPDATE orders SET status = 'expired' WHERE user_id = ? AND status = 'pending'").run(user.id);
    return send(res, 200, meView(user.id));
  }

  // ----- fila gratis -----
  if (method === 'POST' && pathname === '/api/free') {
    const user = requireUser(req);
    hit(`free:${user.id}`, 10, 10 * 60_000, 'wait_few_minutes');
    house.joinFree({ userId: user.id, nickname: user.nickname });
    broadcast();
    return send(res, 201, meView(user.id));
  }

  if (method === 'DELETE' && pathname === '/api/free') {
    const user = requireUser(req);
    house.leaveFree(user.id);
    broadcast();
    return send(res, 200, meView(user.id));
  }

  // Aviso do Mercado Pago: confirmamos consultando a API deles, nunca confiando no corpo.
  if (method === 'POST' && pathname === '/api/webhooks/mercadopago') {
    const body = await readJson(req);
    const ref = body?.data?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id');
    if (!ref || pix.name !== 'mercadopago') return send(res, 200, { ok: true });
    const pay = await pix.fetchPayment(ref);
    const order = pay.orderId ? house.getOrder(pay.orderId) : house.findOrderByProviderRef(ref);
    if (pay.paid && order && order.provider_ref === String(ref)) {
      house.markPaid(order.id, { amountCents: pay.amountCents });
      broadcast();
    }
    return send(res, 200, { ok: true });
  }

  // So existe com o Pix de mentira, e so para o dono do pedido.
  const devPay = pathname.match(/^\/api\/dev\/pay\/([0-9a-f-]{36})$/);
  if (method === 'POST' && devPay) {
    if (pix.name !== 'mock') throw new LanHouseError('not_found', 'not_found', 404);
    const user = requireUser(req);
    const order = house.getOrder(devPay[1]);
    if (!order || order.user_id !== user.id) throw new LanHouseError('not_found', 'order_not_found', 404);
    house.markPaid(order.id);
    broadcast();
    return send(res, 200, { ok: true });
  }

  // PC ligado ao PS5 avisa que esta vivo.
  if (method === 'POST' && pathname === '/api/console/heartbeat') {
    hostGuard.check(ip(req));
    if (!config.hostSecret || !safeEqual(req.headers['x-host-secret'], config.hostSecret)) {
      hostGuard.fail(ip(req));
      throw new LanHouseError('unauthorized', 'host_secret_wrong', 401);
    }
    hostGuard.clear(ip(req));
    const body = await readJson(req);
    lastHostBeat = body.online === false ? 0 : Date.now();
    refreshConsole();
    house.tick();
    broadcast();
    return send(res, 200, { ok: true });
  }

  // Painel do dono
  if (pathname.startsWith('/api/admin/')) {
    requireAdmin(req);
    hit(`admin:${ip(req)}`, 600, 60_000, 'requests_too_many');
    if (method === 'GET' && pathname === '/api/admin/overview') return send(res, 200, { ...house.adminOverview(), host: play?.hostStatus() ?? { connected: false, ready: false } });
    if (method === 'POST' && pathname === '/api/admin/end') {
      const ok = house.endActive('admin');
      broadcast();
      return send(res, 200, { ok });
    }
    if (method === 'POST' && pathname === '/api/admin/pause') {
      const body = await readJson(req);
      house.setPaused(body.paused === true);
      broadcast();
      return send(res, 200, { ok: true, paused: house.paused });
    }
    const refunded = pathname.match(/^\/api\/admin\/orders\/([0-9a-f-]{36})\/refunded$/);
    if (method === 'POST' && refunded) return send(res, 200, { ok: house.markRefunded(refunded[1]) });
    const cancel = pathname.match(/^\/api\/admin\/entries\/(\d+)\/cancel$/);
    if (method === 'POST' && cancel) {
      const ok = house.cancelEntry(Number(cancel[1]));
      broadcast();
      return send(res, 200, { ok });
    }
  }

  throw new LanHouseError('not_found', 'not_found', 404);
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(config.publicDir, rel);
  if (!file.startsWith(config.publicDir + path.sep)) return send(res, 403, 'Proibido');
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch {
    send(res, 404, 'Nao encontrado');
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET') return send(res, 405, 'Metodo nao permitido');
    return await serveStatic(req, res, url);
  } catch (err) {
    if (err instanceof LanHouseError) return send(res, err.status, { error: err.code, message: err.localized(langOf(req)) });
    console.error('[erro]', err);
    send(res, 500, { error: 'internal', message: msg(langOf(req), 'internal') });
  }
});

play = attachPlay(server, {
  house,
  accounts,
  hostSecret: config.hostSecret,
  hostGuard,
  cookieName: COOKIE,
  log: console.log,
  // O console conta como online quando o PC avisa que o video esta no ar (ou, em testes, pelo aviso HTTP).
  onBeat: (ready) => {
    lastHostBeat = ready ? Date.now() : 0;
    refreshConsole();
    house.tick();
    broadcast();
  },
});

server.listen(config.port, () => console.log(`Lan House PS5 em http://localhost:${config.port}`));
