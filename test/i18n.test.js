// Versao em ingles (/en/) e em portugues (/): dicionarios, paginas geradas, links e servidor respondendo no idioma pedido.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { MESSAGES, msg, langOf } from '../server/messages.js';
import { LanHouseError } from '../server/lanhouse.js';
import { resetEmail, verifyEmailMessage } from '../server/mailer.js';

const root = new URL('../', import.meta.url);
const file = (p) => new URL(p, root);
const read = (p) => readFileSync(file(p), 'utf8');

// ---------- dicionarios do cliente ----------
function loadDict(lang) {
  const ctx = { window: {} };
  vm.runInNewContext(read(`public/js/i18n/${lang}.js`), ctx);
  return ctx.window.LH_I18N;
}
const paramsOf = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('i18n cliente: pt e en tem as mesmas chaves, nenhum texto vazio e os mesmos {parametros}', () => {
  const pt = loadDict('pt');
  const en = loadDict('en');
  assert.equal(pt.lang, 'pt');
  assert.equal(en.lang, 'en');
  assert.deepEqual(Object.keys(en.strings).sort(), Object.keys(pt.strings).sort());
  for (const [k, v] of Object.entries(pt.strings)) {
    assert.ok(String(v).trim(), `pt vazio: ${k}`);
    assert.ok(String(en.strings[k]).trim(), `en vazio: ${k}`);
    assert.deepEqual(paramsOf(en.strings[k]), paramsOf(v), `parametros diferentes em ${k}`);
  }
});

test('i18n cliente: toda chave usada em LH.t(...) existe no dicionario', () => {
  const keys = new Set(Object.keys(loadDict('pt').strings));
  const dir = file('public/js/');
  const missing = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    for (const m of read(`public/js/${f}`).matchAll(/LH\.t\(\s*'([^']+)'/g)) if (!keys.has(m[1])) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

// ---------- catalogo do servidor ----------
const SAMPLE = { action: 'up', remaining: 2, min: 5, max: 3, step: 5, cents: 1000, minutes: 15, wait: 7, code: '123456', reason: 'too_many_tries' };

test('i18n servidor: pt e en tem as mesmas chaves e todas geram texto', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.pt).sort());
  for (const k of Object.keys(MESSAGES.pt)) {
    for (const lang of ['pt', 'en']) {
      const s = msg(lang, k, SAMPLE);
      assert.ok(typeof s === 'string' && s.trim(), `${lang}.${k} vazio`);
      assert.doesNotMatch(s, /undefined|\{\w+\}/, `${lang}.${k} com parametro faltando`);
    }
    // Texto em ingles sem letra acentuada do portugues (sinal de mensagem esquecida em pt).
    assert.doesNotMatch(msg('en', k, SAMPLE), /[ãõçáéíóúâêô]/i, `en.${k} parece portugues`);
  }
});

test('i18n servidor: erro guarda a chave, sai em pt por padrao e em ingles com x-lang: en', () => {
  const e = new LanHouseError('bad_login', 'login_wrong_remaining', 401, { remaining: 1 });
  assert.equal(e.message, 'E-mail ou senha incorretos. Você tem mais 1 tentativa.');
  assert.equal(e.localized('en'), 'Wrong email or password. You have 1 more attempt.');
  assert.equal(e.localized('pt'), e.message);
  const locked = new LanHouseError('locked', 'locked', 429, { reason: 'account_locked', min: 15 });
  assert.match(locked.localized('en'), /^Account locked .* Try again in 15 min\.$/);
  // Mensagem que nao e chave do catalogo continua como veio.
  assert.equal(new LanHouseError('x', 'texto livre').localized('en'), 'texto livre');
  assert.equal(langOf({ headers: { 'x-lang': 'en' } }), 'en');
  assert.equal(langOf({ headers: { 'x-lang': 'EN-us' } }), 'en');
  assert.equal(langOf({ headers: {} }), 'pt');
  assert.equal(langOf({ headers: { 'x-lang': 'fr' } }), 'pt');
});

test('i18n e-mails: codigo de recuperar senha e de confirmar e-mail nos dois idiomas', () => {
  assert.match(resetEmail('111222', 15).text, /Seu código para redefinir a senha é: 111222/);
  assert.match(resetEmail('111222', 15, 'en').subject, /password reset code/);
  assert.match(resetEmail('111222', 15, 'en').text, /Your password reset code is: 111222[\s\S]*15 minutes/);
  assert.match(verifyEmailMessage('333444', 30, 'en').subject, /^Confirm your email/);
  assert.match(verifyEmailMessage('333444', 30).subject, /^Confirme o seu e-mail/);
});

// ---------- paginas geradas ----------
const ptPages = readdirSync(file('public/')).filter((f) => f.endsWith('.html'));
const PT_ONLY = new Set(['admin.html']);

test('paginas: toda pagina pt (menos o painel do dono) tem a versao /en/, com lang certo e seletor de idioma', () => {
  assert.ok(ptPages.length >= 9, 'rode npm run build');
  assert.ok(!existsSync(file('public/en/admin.html')), 'o painel do dono fica so em portugues');
  for (const f of ptPages) {
    const pt = read(`public/${f}`);
    assert.match(pt, /<html lang="pt-BR"/, f);
    assert.match(pt, /<script src="\/js\/i18n\/pt\.js"><\/script>\s*<script src="\/js\/common\.js">/, `${f}: dicionario antes do common.js`);
    if (PT_ONLY.has(f)) continue;
    assert.ok(existsSync(file(`public/en/${f}`)), `falta public/en/${f}`);
    const en = read(`public/en/${f}`);
    assert.match(en, /<html lang="en"/, f);
    assert.match(en, /<script src="\/js\/i18n\/en\.js"><\/script>\s*<script src="\/js\/common\.js">/, `en/${f}`);
    const enUrl = f === 'index.html' ? '/en/' : `/en/${f}`;
    const ptUrl = f === 'index.html' ? '/' : `/${f}`;
    assert.ok(pt.includes(`href="${enUrl}" data-lang="en"`), `${f}: seletor leva para ${enUrl}`);
    assert.ok(en.includes(`href="${ptUrl}" data-lang="pt"`), `en/${f}: seletor leva para ${ptUrl}`);
  }
  // Nenhuma pagina sobrando em /en/ sem a versao pt.
  for (const f of readdirSync(file('public/en/'))) assert.ok(ptPages.includes(f), `public/en/${f} sem versao pt`);
});

test('paginas: links internos das paginas /en/ nao caem em paginas em portugues', () => {
  const bad = [];
  for (const f of readdirSync(file('public/en/')).filter((x) => x.endsWith('.html'))) {
    for (const m of read(`public/en/${f}`).matchAll(/<a\b[^>]*>/g)) {
      const tag = m[0];
      const href = tag.match(/href="([^"]*)"/)?.[1];
      if (!href || !href.startsWith('/') || href.startsWith('//')) continue;
      if (/^\/(en|api|js)\//.test(href)) continue;
      if (/class="lang-link/.test(tag) || /hreflang="pt-BR"/.test(tag)) continue; // seletor de idioma e "versao em portugues prevalece"
      bad.push(`${f}: ${href}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('paginas: o texto principal das paginas /en/ esta em ingles', () => {
  const pt = /\b(Entrar|Criar conta|Senha|Apelido|fila|lance|Controles|Esqueci)\b/;
  for (const f of readdirSync(file('public/en/')).filter((x) => x.endsWith('.html'))) {
    const main = read(`public/en/${f}`).match(/<main[^>]*>([\s\S]*)<\/main>/)[1].replace(/<a [^>]*hreflang="pt-BR"[^>]*>[\s\S]*?<\/a>/g, '');
    assert.doesNotMatch(main.replace(/<[^>]+>/g, ' '), pt, `public/en/${f} ainda tem texto em portugues`);
  }
  assert.match(read('public/en/termos.html'), /Brazil/);
  assert.match(read('public/en/privacidade.html'), /LGPD/);
});

// ---------- servidor de verdade ----------
let child;
let base;
let dir;
let out = '';

async function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'lh-i18n-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: fileURLToPath(root),
    env: { ...process.env, PORT: String(port), DB_FILE: path.join(dir, 't.db'), ADMIN_PASSWORD: 'senha-admin-de-teste', HOST_SECRET: 'segredo-do-host-de-teste', PIX_PROVIDER: 'mock', MAIL_PROVIDER: 'console', REGISTER_PER_HOUR: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (out += d.toString()));
  for (let i = 0; i < 50; i++) {
    if (out.includes('Lan House PS5 em')) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('servidor nao subiu: ' + out);
});

after(() => {
  child?.kill();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

async function call(p, { method = 'GET', body, lang } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-lh': '1', ...(lang ? { 'x-lang': lang } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('servidor: o mesmo erro sai em portugues sem x-lang e em ingles com x-lang: en', async () => {
  const body = { email: 'ninguem@teste.com', password: 'errada-errada' };
  const pt = await call('/api/auth/login', { method: 'POST', body });
  const en = await call('/api/auth/login', { method: 'POST', body, lang: 'en' });
  assert.equal(pt.status, 401);
  assert.equal(en.data.error, pt.data.error);
  assert.match(pt.data.message, /E-mail ou senha incorretos/);
  assert.match(en.data.message, /^Wrong email or password\. You have \d+ more attempts?\.$/);
  const login = await call('/api/me/controls', { lang: 'en' });
  assert.equal(login.data.message, 'Sign in to your account to continue.');
  const forgot = await call('/api/auth/forgot', { method: 'POST', body: { email: 'ninguem@teste.com' }, lang: 'en' });
  assert.match(forgot.data.message, /^If that email has an account/);
});

test('servidor: o e-mail de confirmacao sai no idioma de quem se cadastrou', async () => {
  const r = await call('/api/auth/register', {
    method: 'POST',
    lang: 'en',
    body: { email: 'english@teste.com', emailConfirm: 'english@teste.com', nickname: 'English1', password: 'senha-forte-1', adult: true },
  });
  assert.equal(r.status, 201);
  for (let i = 0; i < 40 && !/para: english@teste\.com/.test(out); i++) await new Promise((res) => setTimeout(res, 50));
  assert.match(out, /para: english@teste\.com\n\s+assunto: Confirm your email - Lan House PS5\n\s+Your email confirmation code is: \d{6}/);
});

test('servidor: /en/ entrega as paginas em ingles', async () => {
  for (const p of ['/en/', '/en/entrar.html', '/en/termos.html']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
    assert.match(await res.text(), /<html lang="en"/, p);
  }
  const js = await fetch(base + '/js/i18n/en.js');
  assert.equal(js.status, 200);
});
