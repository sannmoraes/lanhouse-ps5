import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/lanhouse.js';
import { Accounts, RESET_TTL_MIN } from '../server/accounts.js';
import { Throttle } from '../server/security.js';
import { createMailer, resetEmail } from '../server/mailer.js';

function setup() {
  let t = 1_000_000;
  const now = () => t;
  const db = openDb(':memory:');
  return { db, accounts: new Accounts(db, { now }), throttle: new Throttle(db, { now }), advance: (ms) => (t += ms) };
}
const RULES = { max: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };
const ok = { email: 'ana@exemplo.com', nickname: 'Ana', password: 'senha-forte-1', adult: true };

// ---------- bloqueio por tentativas ----------
test('5 erros bloqueiam; antes disso avisa quantas restam', () => {
  const { throttle } = setup();
  const rem = [];
  for (let i = 0; i < 4; i++) rem.push(throttle.fail('k', RULES).remaining);
  assert.deepEqual(rem, [4, 3, 2, 1]);
  assert.doesNotThrow(() => throttle.check('k'));
  const last = throttle.fail('k', RULES);
  assert.equal(last.locked, true);
  assert.throws(() => throttle.check('k'), (e) => e.status === 429 && /15 min/.test(e.message));
});

test('o bloqueio expira depois de 15 minutos e o contador recomeca', () => {
  const { throttle, advance } = setup();
  for (let i = 0; i < 5; i++) throttle.fail('k', RULES);
  assert.throws(() => throttle.check('k'));
  advance(14 * 60_000);
  assert.throws(() => throttle.check('k'), (e) => /1 min/.test(e.message));
  advance(61_000);
  assert.doesNotThrow(() => throttle.check('k'));
  assert.equal(throttle.fail('k', RULES).remaining, 4); // recomecou do zero
});

test('erros espalhados fora da janela nao acumulam; login certo zera', () => {
  const { throttle, advance } = setup();
  for (let i = 0; i < 4; i++) throttle.fail('k', RULES);
  advance(16 * 60_000);
  assert.equal(throttle.fail('k', RULES).remaining, 4);
  throttle.clear('k');
  assert.equal(throttle.fail('k', RULES).remaining, 4);
});

test('o bloqueio sobrevive a um reinicio (esta no banco)', () => {
  const { db, throttle } = setup();
  for (let i = 0; i < 5; i++) throttle.fail('k', RULES);
  const outro = new Throttle(db, { now: () => 1_000_000 }); // "servidor novo" lendo o mesmo banco
  assert.throws(() => outro.check('k'));
});

// ---------- recuperar senha ----------
test('codigo de 6 digitos: so o hash fica no banco e a senha troca', async () => {
  const { db, accounts } = setup();
  await accounts.register(ok);
  const { code } = accounts.requestReset('ANA@exemplo.com'); // maiuscula nao atrapalha
  assert.match(code, /^\d{6}$/);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM reset_codes').all()).includes(code));
  await accounts.resetPassword({ email: 'ana@exemplo.com', code, password: 'nova-senha-123' });
  await assert.rejects(accounts.login({ email: ok.email, password: ok.password }), (e) => e.code === 'bad_login');
  await accounts.login({ email: ok.email, password: 'nova-senha-123' });
});

test('e-mail sem conta: nada e gerado e ninguem e avisado', async () => {
  const { db, accounts } = setup();
  assert.equal(accounts.requestReset('naoexiste@x.com'), null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reset_codes').get().n, 0);
  await assert.rejects(accounts.resetPassword({ email: 'naoexiste@x.com', code: '123456', password: 'senha-forte-1' }), (e) => e.code === 'bad_code');
});

test('o codigo vale uma vez so e expira em 15 minutos', async () => {
  const { accounts, advance } = setup();
  await accounts.register(ok);
  const a = accounts.requestReset(ok.email);
  await accounts.resetPassword({ email: ok.email, code: a.code, password: 'nova-senha-123' });
  await assert.rejects(accounts.resetPassword({ email: ok.email, code: a.code, password: 'outra-senha-123' }), (e) => e.code === 'bad_code');
  const b = accounts.requestReset(ok.email);
  advance((RESET_TTL_MIN * 60 + 1) * 1000);
  await assert.rejects(accounts.resetPassword({ email: ok.email, code: b.code, password: 'outra-senha-123' }), (e) => e.code === 'bad_code');
});

test('5 codigos errados destroem o codigo (nem o certo funciona mais)', async () => {
  const { accounts } = setup();
  await accounts.register(ok);
  const { code } = accounts.requestReset(ok.email);
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    await assert.rejects(accounts.resetPassword({ email: ok.email, code: wrong, password: 'nova-senha-123' }), (e) => e.code === 'bad_code');
  }
  await assert.rejects(accounts.resetPassword({ email: ok.email, code, password: 'nova-senha-123' }), (e) => e.code === 'bad_code');
});

test('um novo pedido invalida o codigo anterior', async () => {
  const { accounts } = setup();
  await accounts.register(ok);
  const a = accounts.requestReset(ok.email);
  const b = accounts.requestReset(ok.email);
  if (a.code !== b.code) {
    await assert.rejects(accounts.resetPassword({ email: ok.email, code: a.code, password: 'nova-senha-123' }), (e) => e.code === 'bad_code');
  }
  await accounts.resetPassword({ email: ok.email, code: b.code, password: 'nova-senha-123' });
});

test('codigo certo com senha fraca: recusa, mas o codigo continua valido', async () => {
  const { accounts } = setup();
  await accounts.register(ok);
  const { code } = accounts.requestReset(ok.email);
  await assert.rejects(accounts.resetPassword({ email: ok.email, code, password: '123' }), (e) => e.code === 'bad_password');
  await accounts.resetPassword({ email: ok.email, code, password: 'nova-senha-123' });
});

test('trocar a senha por codigo derruba todas as sessoes abertas', async () => {
  const { accounts } = setup();
  await accounts.register(ok);
  const { token } = await accounts.login({ email: ok.email, password: ok.password });
  assert.ok(accounts.userFromToken(token));
  const { code } = accounts.requestReset(ok.email);
  await accounts.resetPassword({ email: ok.email, code, password: 'nova-senha-123' });
  assert.equal(accounts.userFromToken(token), null);
});

test('cadastro: os dois e-mails precisam ser iguais (quando enviados)', async () => {
  const { accounts } = setup();
  await assert.rejects(accounts.register({ ...ok, emailConfirm: 'outro@exemplo.com' }), (e) => e.code === 'bad_email');
  const u = await accounts.register({ ...ok, emailConfirm: 'ANA@exemplo.com' });
  assert.equal(u.email, 'ana@exemplo.com');
});

// ---------- e-mail ----------
test('modo console nao envia nada, so imprime; modo smtp usa o transporte', async () => {
  const logs = [];
  const c = createMailer({ mailProvider: 'console' }, { log: (m) => logs.push(m) });
  await c.send({ to: 'a@b.com', subject: 'x', text: 'codigo 123456' });
  assert.match(logs[0], /SIMULADO/);
  const sent = [];
  const s = createMailer({ mailProvider: 'smtp', mailFrom: 'Loja <l@x.com>', smtp: {} }, { transport: { sendMail: async (m) => sent.push(m) } });
  await s.send({ to: 'a@b.com', subject: 'assunto', text: 'texto' });
  assert.deepEqual(sent, [{ from: 'Loja <l@x.com>', to: 'a@b.com', subject: 'assunto', text: 'texto' }]);
  const m = resetEmail('654321', 15);
  assert.match(m.text, /654321/);
  assert.match(m.text, /15 minutos/);
});

test('primeira execucao: o banco cria a pasta data/ sozinho (regressao: pacote novo nao subia sem ela)', async () => {
  const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { openDb } = await import('../server/lanhouse.js');
  const root = mkdtempSync(path.join(os.tmpdir(), 'lh-'));
  const file = path.join(root, 'data', 'novo.db');
  const db = openDb(file);
  db.close();
  assert.equal(existsSync(file), true);
  rmSync(root, { recursive: true, force: true });
});
