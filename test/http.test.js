// Teste de integracao: liga o servidor de verdade (processo separado) e usa a API como o navegador usaria.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let child;
let base;
let dir;
let out = '';
const ADMIN = 'senha-admin-de-teste';

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
  dir = mkdtempSync(path.join(tmpdir(), 'lh-http-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(port), DB_FILE: path.join(dir, 't.db'), ADMIN_PASSWORD: ADMIN, HOST_SECRET: 'segredo-do-host-de-teste', PIX_PROVIDER: 'mock', MAIL_PROVIDER: 'console', REGISTER_PER_HOUR: '1000' },
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

async function call(p, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-lh': '1', ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

const lastCode = () => {
  const all = [...out.matchAll(/código para redefinir a senha é: (\d{6})/g)];
  return all.at(-1)?.[1];
};
const emailsSent = () => [...out.matchAll(/\[e-mail SIMULADO/g)].length;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ultimo codigo de confirmar e-mail "enviado" (impresso no log) para este e-mail. */
const verifyCode = (email) => {
  const all = [...out.matchAll(/para: (\S+)\n\s+assunto: Confirme[^\n]*\n\s+Seu código para confirmar o e-mail é: (\d{6})/g)].filter((m) => m[1] === email);
  return all.at(-1)?.[2];
};
async function waitVerifyCode(email, before = null) {
  for (let i = 0; i < 40; i++) {
    const c = verifyCode(email);
    if (c && c !== before) return c;
    await wait(50);
  }
  throw new Error('o codigo de confirmacao nao apareceu no log');
}
const register = (email, nickname, extra = {}) =>
  call('/api/auth/register', { method: 'POST', body: { email, emailConfirm: email, nickname, password: 'senha-forte-1', adult: true, ...extra } });

let n = 0;
/** Cria e CONFIRMA uma conta (o cadastro de verdade: registrar, receber o codigo, digitar). */
async function newUser(prefix) {
  n += 1;
  const email = `${prefix}${n}@teste.com`;
  const r = await register(email, `${prefix}${n}`);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.needsVerification, true);
  const v = await call('/api/auth/verify', { method: 'POST', body: { email, code: await waitVerifyCode(email) } });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  return { email, cookie: v.cookie };
}

test('login errado avisa quantas tentativas restam e bloqueia na 5a (mesmo com a senha certa depois)', async () => {
  const { email } = await newUser('lock');
  const msgs = [];
  for (let i = 0; i < 5; i++) {
    const r = await call('/api/auth/login', { method: 'POST', body: { email, password: 'errada-errada' } });
    assert.equal(r.status, 401);
    msgs.push(r.data.message);
  }
  assert.match(msgs[0], /mais 4 tentativas/);
  assert.match(msgs[1], /mais 3 tentativas/);
  assert.match(msgs[3], /mais 1 tentativa\./);
  assert.match(msgs[4], /bloqueada por 15 minutos/);
  const certa = await call('/api/auth/login', { method: 'POST', body: { email, password: 'senha-forte-1' } });
  assert.equal(certa.status, 429);
  assert.match(certa.data.message, /15 min/);
});

test('e-mail que nao existe recebe a mesma mensagem (nao revela quem tem conta)', async () => {
  const r = await call('/api/auth/login', { method: 'POST', body: { email: 'fantasma@teste.com', password: 'errada-errada' } });
  assert.equal(r.status, 401);
  assert.match(r.data.message, /mais 4 tentativas/);
});

test('login certo zera o contador', async () => {
  const { email } = await newUser('zera');
  for (let i = 0; i < 3; i++) await call('/api/auth/login', { method: 'POST', body: { email, password: 'errada-errada' } });
  const ok = await call('/api/auth/login', { method: 'POST', body: { email, password: 'senha-forte-1' } });
  assert.equal(ok.status, 200);
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password: 'errada-errada' } });
  assert.match(r.data.message, /mais 4 tentativas/);
});

test('recuperar senha ponta a ponta (codigo por e-mail), inclusive liberar a conta bloqueada', async () => {
  const { email, cookie } = await newUser('rec');
  // bloqueia a conta
  for (let i = 0; i < 5; i++) await call('/api/auth/login', { method: 'POST', body: { email, password: 'errada-errada' } });
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email, password: 'senha-forte-1' } })).status, 429);

  const antes = emailsSent();
  const f = await call('/api/auth/forgot', { method: 'POST', body: { email } });
  assert.equal(f.status, 200);
  await wait(300);
  assert.equal(emailsSent(), antes + 1);
  const code = lastCode();
  assert.match(code, /^\d{6}$/);

  // codigo errado: mensagem generica
  const wrong = await call('/api/auth/reset', { method: 'POST', body: { email, code: code === '000000' ? '111111' : '000000', password: 'nova-senha-123' } });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.message, /inválido ou expirado/);
  // senha fraca com codigo certo
  const weak = await call('/api/auth/reset', { method: 'POST', body: { email, code, password: '123' } });
  assert.equal(weak.status, 400);
  // certo
  const good = await call('/api/auth/reset', { method: 'POST', body: { email, code, password: 'nova-senha-123' } });
  assert.equal(good.status, 200, JSON.stringify(good.data));
  // reuso do codigo
  const reuse = await call('/api/auth/reset', { method: 'POST', body: { email, code, password: 'outra-senha-123' } });
  assert.equal(reuse.status, 400);
  // a sessao antiga caiu, a senha velha nao vale, a nova vale (e o bloqueio foi liberado)
  assert.equal((await call('/api/me', { cookie })).data.user, null);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email, password: 'senha-forte-1' } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email, password: 'nova-senha-123' } })).status, 200);
});

test('pedir codigo: a resposta e identica com e sem conta, e so manda e-mail se a conta existe', async () => {
  const { email } = await newUser('ident');
  const antes = emailsSent();
  const a = await call('/api/auth/forgot', { method: 'POST', body: { email } });
  const b = await call('/api/auth/forgot', { method: 'POST', body: { email: 'ninguem@teste.com' } });
  await wait(300);
  assert.deepEqual(a, { ...a, data: b.data, status: b.status, cookie: a.cookie });
  assert.equal(emailsSent(), antes + 1);
});

test('no maximo 3 codigos por hora por e-mail (o 4o pedido nao envia e o 5o leva 429)', async () => {
  const { email } = await newUser('flood');
  const antes = emailsSent();
  const status = [];
  for (let i = 0; i < 5; i++) status.push((await call('/api/auth/forgot', { method: 'POST', body: { email } })).status);
  await wait(400);
  assert.deepEqual(status, [200, 200, 200, 200, 429]);
  assert.equal(emailsSent() - antes, 3);
});

test('5 codigos errados destroem o codigo pela API', async () => {
  const { email } = await newUser('brute');
  await call('/api/auth/forgot', { method: 'POST', body: { email } });
  await wait(300);
  const code = lastCode();
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/auth/reset', { method: 'POST', body: { email, code: wrong, password: 'nova-senha-123' } })).status, 400);
  assert.equal((await call('/api/auth/reset', { method: 'POST', body: { email, code, password: 'nova-senha-123' } })).status, 400);
});

test('painel do dono: 5 senhas erradas bloqueiam (antes era ilimitado)', async () => {
  const h = (p) => ({ 'x-admin-password': p });
  assert.equal((await call('/api/admin/overview', { headers: h(ADMIN) })).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/admin/overview', { headers: h('errada') })).status, 401);
  const r = await call('/api/admin/overview', { headers: h(ADMIN) }); // certa, mas ja bloqueado
  assert.equal(r.status, 429);
});

test('cadastro exige os dois e-mails iguais e a confirmacao de 18+', async () => {
  const a = await call('/api/auth/register', { method: 'POST', body: { email: 'x1@teste.com', emailConfirm: 'x2@teste.com', nickname: 'Xis1', password: 'senha-forte-1', adult: true } });
  assert.equal(a.status, 400);
  const b = await call('/api/auth/register', { method: 'POST', body: { email: 'x3@teste.com', emailConfirm: 'x3@teste.com', nickname: 'Xis3', password: 'senha-forte-1', adult: false } });
  assert.equal(b.status, 400);
});


// ---------- confirmar e-mail no cadastro ----------
test('CADASTRO: criar a conta NAO entra: precisa confirmar o e-mail com o codigo', async () => {
  const email = 'novo.conf@teste.com';
  const r = await register(email, 'NovoConf');
  assert.equal(r.status, 201);
  assert.equal(r.data.needsVerification, true);
  assert.equal(r.cookie, undefined, 'nao pode haver sessao antes de confirmar');
  assert.equal(r.data.user, undefined);
  const code = await waitVerifyCode(email);
  assert.match(code, /^\d{6}$/);
  assert.equal((await call('/api/me')).data.user, null);

  // sem o codigo, nao entra, nem com a senha certa (e a pessoa e avisada)
  const login = await call('/api/auth/login', { method: 'POST', body: { email, password: 'senha-forte-1' } });
  assert.equal(login.status, 403);
  assert.equal(login.data.error, 'email_unverified');
  assert.equal(login.cookie, undefined);

  // codigo errado e recusado; o certo entra
  const bad = await call('/api/auth/verify', { method: 'POST', body: { email, code: code === '000000' ? '111111' : '000000' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, 'bad_code');
  const novo = await waitVerifyCode(email); // o login acima mandou um codigo novo
  const ok = await call('/api/auth/verify', { method: 'POST', body: { email, code: novo } });
  assert.equal(ok.status, 200);
  assert.ok(ok.cookie?.startsWith('lh_session='));
  assert.equal((await call('/api/me', { cookie: ok.cookie })).data.user.email, email);

  // depois de confirmar, o login normal funciona
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email, password: 'senha-forte-1' } })).status, 200);
  // e o codigo nao serve de novo
  assert.equal((await call('/api/auth/verify', { method: 'POST', body: { email, code: novo } })).status, 400);
});

test('CADASTRO: login com senha ERRADA em conta nao confirmada nao revela nada (mesmo aviso de sempre)', async () => {
  const email = 'oculto.conf@teste.com';
  await register(email, 'OcultoConf');
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password: 'senha-errada-1' } });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'bad_login');
});

test('CADASTRO: 5 codigos errados destroem o codigo; pedir outro resolve', async () => {
  const email = 'cinco.conf@teste.com';
  await register(email, 'CincoConf');
  const first = await waitVerifyCode(email);
  const wrong = first === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/auth/verify', { method: 'POST', body: { email, code: wrong } })).status, 400);
  assert.equal((await call('/api/auth/verify', { method: 'POST', body: { email, code: first } })).status, 400, 'o codigo certo ja foi destruido');
  const re = await call('/api/auth/resend-verify', { method: 'POST', body: { email } });
  assert.equal(re.status, 200);
  const second = await waitVerifyCode(email, first);
  assert.equal((await call('/api/auth/verify', { method: 'POST', body: { email, code: second } })).status, 200);
});

test('CADASTRO: reenviar o codigo tem a mesma resposta exista a conta ou nao, e limita a 3 por hora', async () => {
  const a = await call('/api/auth/resend-verify', { method: 'POST', body: { email: 'ninguem.assim@teste.com' } });
  const email = 'reenvia.conf@teste.com';
  await register(email, 'ReenviaConf'); // 1o codigo
  await waitVerifyCode(email);
  const b = await call('/api/auth/resend-verify', { method: 'POST', body: { email } }); // 2o
  assert.deepEqual(a.data, b.data);
  assert.equal(a.status, b.status);
  await call('/api/auth/resend-verify', { method: 'POST', body: { email } }); // 3o
  await wait(300);
  const antes = [...out.matchAll(/Confirme o seu e-mail/g)].length;
  await call('/api/auth/resend-verify', { method: 'POST', body: { email } }); // 4o: passou do limite, nao envia
  await wait(300);
  assert.equal([...out.matchAll(/Confirme o seu e-mail/g)].length, antes);
});

test('CADASTRO: refazer o cadastro de um e-mail nao confirmado vale a ultima senha; o dono do e-mail nao fica preso', async () => {
  const email = 'refaz.conf@teste.com';
  await register(email, 'RefazConf', { password: 'senha-do-golpista-1' });
  const r = await register(email, 'RefazConf2'); // a pessoa de verdade se cadastra
  assert.equal(r.status, 201);
  const code = await waitVerifyCode(email);
  assert.equal((await call('/api/auth/verify', { method: 'POST', body: { email, code } })).status, 200);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email, password: 'senha-do-golpista-1' } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email, password: 'senha-forte-1' } })).status, 200);
});

test('CADASTRO: recuperar a senha tambem confirma o e-mail', async () => {
  const email = 'rec.conf@teste.com';
  await register(email, 'RecConf');
  await wait(300);
  const antes = lastCode();
  await call('/api/auth/forgot', { method: 'POST', body: { email } });
  let code;
  for (let i = 0; i < 40 && (!(code = lastCode()) || code === antes); i++) await wait(50);
  const r = await call('/api/auth/reset', { method: 'POST', body: { email, code, password: 'outra-senha-forte-2' } });
  assert.equal(r.status, 200);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email, password: 'outra-senha-forte-2' } })).status, 200);
});
