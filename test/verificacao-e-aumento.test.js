// Confirmacao de e-mail no cadastro (regras da conta) e aumento de lance (so vale depois de pago).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LanHouse, openDb } from '../server/lanhouse.js';
import { Accounts } from '../server/accounts.js';

const MIN = 60_000;
const NEW = { password: 'senha-forte-1', adult: true };

function contas() {
  let t = 10_000_000;
  const db = openDb(':memory:');
  const accounts = new Accounts(db, { now: () => t, requireVerification: true });
  return { db, accounts, advance: (ms) => (t += ms) };
}

// ---------- confirmar e-mail ----------
test('conta nova nao confirmada nao entra, nem com a senha certa; o codigo confirma e ja entra', async () => {
  const { accounts } = contas();
  const u = await accounts.register({ email: 'a@x.com', nickname: 'Ana', ...NEW });
  assert.equal(u.email_verified_at, null);
  await assert.rejects(accounts.login({ email: 'a@x.com', password: NEW.password }), (e) => e.code === 'email_unverified' && e.status === 403);
  // senha errada continua sendo "senha errada" (nao revela que a conta existe)
  await assert.rejects(accounts.login({ email: 'a@x.com', password: 'errada-errada' }), (e) => e.code === 'bad_login');

  const { code } = accounts.issueVerification('a@x.com');
  assert.match(code, /^\d{6}$/);
  const r = accounts.verifyEmail({ email: 'a@x.com', code });
  assert.ok(r.user.email_verified_at);
  assert.ok(accounts.userFromToken(r.token));
  assert.ok((await accounts.login({ email: 'a@x.com', password: NEW.password })).token);
  assert.equal(accounts.issueVerification('a@x.com'), null, 'conta ja confirmada nao recebe codigo de confirmacao');
});

test('codigo de confirmacao: errado, vencido, uso unico e 5 erros destroem', async () => {
  const { accounts, advance } = contas();
  await accounts.register({ email: 'b@x.com', nickname: 'Bia', ...NEW });
  const bad = (e) => e.code === 'bad_code';

  let { code } = accounts.issueVerification('b@x.com');
  const wrong = code === '000000' ? '111111' : '000000';
  assert.throws(() => accounts.verifyEmail({ email: 'b@x.com', code: wrong }), bad);
  advance(16 * MIN); // vence em 15 min
  assert.throws(() => accounts.verifyEmail({ email: 'b@x.com', code }), bad);

  ({ code } = accounts.issueVerification('b@x.com'));
  for (let i = 0; i < 5; i++) assert.throws(() => accounts.verifyEmail({ email: 'b@x.com', code: wrong }), bad);
  assert.throws(() => accounts.verifyEmail({ email: 'b@x.com', code }), bad, '5 erros destroem o codigo, ate o certo');

  ({ code } = accounts.issueVerification('b@x.com'));
  assert.ok(accounts.verifyEmail({ email: 'b@x.com', code }).token);
  assert.throws(() => accounts.verifyEmail({ email: 'b@x.com', code }), bad, 'uso unico');
  assert.throws(() => accounts.verifyEmail({ email: 'ninguem@x.com', code }), bad, 'e-mail sem conta: mesma mensagem');
});

test('o codigo e guardado so como hash', async () => {
  const { accounts, db } = contas();
  await accounts.register({ email: 'h@x.com', nickname: 'Hugo', ...NEW });
  const { code } = accounts.issueVerification('h@x.com');
  const row = db.prepare('SELECT * FROM verify_codes WHERE email = ?').get('h@x.com');
  assert.ok(!JSON.stringify(row).includes(code));
});

test('refazer o cadastro de e-mail nao confirmado substitui o anterior; conta velha sem confirmar libera e-mail e apelido', async () => {
  const { accounts, advance } = contas();
  await accounts.register({ email: 'c@x.com', nickname: 'Caio', password: 'senha-do-golpista-1', adult: true });
  await accounts.register({ email: 'c@x.com', nickname: 'Caio', ...NEW }); // a pessoa de verdade; mesmo apelido tambem passa
  const { code } = accounts.issueVerification('c@x.com');
  accounts.verifyEmail({ email: 'c@x.com', code });
  await assert.rejects(accounts.login({ email: 'c@x.com', password: 'senha-do-golpista-1' }), (e) => e.code === 'bad_login');
  assert.ok((await accounts.login({ email: 'c@x.com', password: NEW.password })).token);

  // apelido preso por alguem que nunca confirmou: livre depois de 2 horas
  await accounts.register({ email: 'd@x.com', nickname: 'Dudu', ...NEW });
  await assert.rejects(accounts.register({ email: 'e@x.com', nickname: 'Dudu', ...NEW }), (e) => e.code === 'nick_taken');
  advance(3 * 60 * MIN);
  await accounts.register({ email: 'e@x.com', nickname: 'Dudu', ...NEW });
  assert.equal(accounts.issueVerification('d@x.com'), null, 'a conta antiga foi removida');
});

test('conta ja confirmada nunca e apagada nem substituida por um novo cadastro', async () => {
  const { accounts } = contas();
  await accounts.register({ email: 'f@x.com', nickname: 'Fabi', ...NEW });
  accounts.verifyEmail({ email: 'f@x.com', code: accounts.issueVerification('f@x.com').code });
  await assert.rejects(accounts.register({ email: 'f@x.com', nickname: 'Outro', password: 'senha-do-golpista-1', adult: true }), (e) => e.code === 'email_taken');
  assert.ok((await accounts.login({ email: 'f@x.com', password: NEW.password })).token);
});

test('recuperar a senha por codigo tambem confirma o e-mail', async () => {
  const { accounts } = contas();
  await accounts.register({ email: 'g@x.com', nickname: 'Gabi', ...NEW });
  const { code } = accounts.requestReset('g@x.com');
  await accounts.resetPassword({ email: 'g@x.com', code, password: 'senha-nova-forte-3' });
  assert.ok((await accounts.login({ email: 'g@x.com', password: 'senha-nova-forte-3' })).token);
});

test('sem exigir confirmacao (testes locais), a conta ja nasce confirmada', async () => {
  const db = openDb(':memory:');
  const accounts = new Accounts(db);
  const u = await accounts.register({ email: 'z@x.com', nickname: 'Zeca', ...NEW });
  assert.ok(u.email_verified_at);
  assert.ok((await accounts.login({ email: 'z@x.com', password: NEW.password })).token);
});

test('banco antigo (sem as colunas novas) e atualizado sem perder nada, e contas antigas contam como confirmadas', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lh-mig-'));
  const file = path.join(dir, 'velho.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL, nick_key TEXT NOT NULL UNIQUE,
        pw_salt BLOB NOT NULL, pw_hash BLOB NOT NULL, adult_confirmed_at INTEGER NOT NULL, controls TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE orders (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, nickname TEXT NOT NULL, kind TEXT NOT NULL, entry_id INTEGER, minutes INTEGER NOT NULL,
        amount_cents INTEGER NOT NULL, status TEXT NOT NULL, pix_code TEXT, pix_qr TEXT, provider_ref TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, paid_at INTEGER);
      INSERT INTO users (email, nickname, nick_key, pw_salt, pw_hash, adult_confirmed_at, created_at) VALUES ('v@x.com', 'Velho', 'velho', x'00', x'00', 5, 123);
      INSERT INTO orders VALUES ('o1', 1, 'Velho', 'bid', NULL, 10, 1000, 'paid', NULL, NULL, NULL, 5, 6, 7);
    `);
    old.close();
    const db = openDb(file); // abre e migra
    assert.equal(db.prepare("SELECT email_verified_at v FROM users WHERE email = 'v@x.com'").get().v, 123);
    const o = db.prepare("SELECT refund_cents r, amount_cents a FROM orders WHERE id = 'o1'").get();
    assert.deepEqual({ r: Number(o.r), a: Number(o.a) }, { r: 0, a: 1000 });
    openDb(file).close(); // abrir de novo nao quebra
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- aumento de lance: so vale depois de pago ----------
function casa() {
  let t = 50_000_000;
  const db = openDb(':memory:');
  const house = new LanHouse(db, { now: () => t });
  house.setConsoleOnline(true);
  const mk = (n) => ({ id: Number(db.prepare("INSERT INTO users (email, nickname, nick_key, pw_salt, pw_hash, adult_confirmed_at, created_at) VALUES (?, ?, ?, x'00', x'00', 0, 0)").run(`${n}@x.com`, n, n.toLowerCase()).lastInsertRowid), nickname: n });
  const bid = (u, minutes, reais, pay = true) => {
    const o = house.createBidOrder({ userId: u.id, nickname: u.nickname, minutes, cents: reais * 100 });
    if (pay) house.markPaid(o.id);
    return o;
  };
  return { db, house, mk, bid, advance: (ms) => (t += ms) };
}

test('AUMENTO: o Pix do aumento pendente NAO muda lance nem posicao; so o pagamento muda', () => {
  const { house, mk, bid } = casa();
  const [dono, ana, bia] = [mk('Dono'), mk('Ana'), mk('Bia')];
  bid(dono, 30, 30); // joga
  bid(ana, 10, 10);
  bid(bia, 10, 15);
  const antes = house.upcoming().map((e) => [e.nickname, e.minutes, e.cents]);
  assert.deepEqual(antes, [['Bia', 10, 1500], ['Ana', 10, 1000]]);

  const e = house.ticketForUser(ana.id).raisable;
  const raise = house.createRaiseOrder({ userId: ana.id, entryId: e.entryId, minutes: 10, cents: 2500 });
  assert.equal(raise.status, 'pending');
  assert.deepEqual(house.upcoming().map((x) => [x.nickname, x.minutes, x.cents]), antes, 'pendente nao reposiciona');
  assert.equal(house.adminOverview().paid.cents, 3000 + 1000 + 1500, 'pendente nao entra no caixa');

  house.markPaid(raise.id);
  assert.deepEqual(house.upcoming().map((x) => [x.nickname, x.minutes, x.cents]), [['Ana', 10, 2500], ['Bia', 10, 1500]]);
  house.markPaid(raise.id); // webhook repetido
  assert.equal(house.upcoming().find((x) => x.nickname === 'Ana').cents, 2500, 'pagar duas vezes nao soma duas vezes');
});

test('AUMENTO: Pix de aumento expirado nao e pago e o lance continua igual', () => {
  const { house, mk, bid, advance } = casa();
  const [dono, ana] = [mk('Dono'), mk('Ana')];
  bid(dono, 30, 30);
  bid(ana, 10, 10);
  const raise = house.createRaiseOrder({ userId: ana.id, entryId: house.ticketForUser(ana.id).raisable.entryId, minutes: 10, cents: 2000 });
  advance(16 * MIN); // o Pix vale 15 min; o turno de 30 min de quem joga ainda nao acabou
  house.tick();
  assert.equal(house.ticketForUser(ana.id).pending, null, 'Pix vencido some da tela');
  assert.equal(house.upcoming().find((x) => x.nickname === 'Ana').cents, 1000);
  assert.equal(house.getOrder(raise.id).refund_cents, 0);
});

test('AUMENTO so de valor pago DEPOIS que o turno comecou: nada muda na fila e o valor fica marcado para devolver', () => {
  const { house, mk, bid, advance } = casa();
  const [dono, ana, bia] = [mk('Dono'), mk('Ana'), mk('Bia')];
  bid(dono, 5, 5); // joga 5 min
  bid(ana, 10, 10);
  bid(bia, 10, 12);
  const raise = house.createRaiseOrder({ userId: ana.id, entryId: house.ticketForUser(ana.id).raisable.entryId, minutes: 10, cents: 3000 }); // so valor (+R$ 20)
  assert.equal(raise.minutes, 0);
  // passa o tempo: Bia (R$ 1,20/min) joga primeiro, depois Ana comeca antes do Pix cair
  advance(5 * MIN + 1000);
  house.tick();
  advance(10 * MIN + 1000);
  house.tick();
  assert.equal(house.active().nickname, 'Ana');
  const entradas = house.db.prepare('SELECT COUNT(*) n FROM entries').get().n;

  house.markPaid(raise.id);
  assert.equal(house.db.prepare('SELECT COUNT(*) n FROM entries').get().n, entradas, 'nao cria lance novo');
  assert.equal(house.active().cents, 1000, 'o lance de quem joga nao muda');
  assert.equal(house.getOrder(raise.id).refund_cents, 2000);

  const dev = house.adminOverview().refundsDue;
  assert.deepEqual(dev.map((r) => [r.nickname, r.refund_cents]), [['Ana', 2000]]);
  assert.equal(house.ordersForUser(ana.id)[0].refund_cents, 2000, 'a pessoa ve que tem devolucao');
  assert.equal(house.markRefunded(raise.id), true);
  assert.equal(house.markRefunded(raise.id), false, 'so uma vez');
  assert.deepEqual(house.adminOverview().refundsDue, []);
});

test('AUMENTO que traz minutos a mais, pago depois do turno comecar, vira um lance novo (nada para devolver)', () => {
  const { house, mk, bid, advance } = casa();
  const [dono, ana] = [mk('Dono'), mk('Ana')];
  bid(dono, 5, 5);
  bid(ana, 10, 10);
  const raise = house.createRaiseOrder({ userId: ana.id, entryId: house.ticketForUser(ana.id).raisable.entryId, minutes: 20, cents: 2500 }); // +10 min, +R$ 15
  advance(5 * MIN + 1000);
  house.tick();
  assert.equal(house.active().nickname, 'Ana');
  house.markPaid(raise.id);
  assert.equal(house.getOrder(raise.id).refund_cents, 0);
  assert.deepEqual(house.upcoming().map((x) => [x.nickname, x.minutes, x.cents]), [['Ana', 10, 1500]]);
});

test('AUMENTO: ninguem aumenta o lance de outra pessoa nem um que nao esta mais esperando', () => {
  const { house, mk, bid } = casa();
  const [dono, ana, bia] = [mk('Dono'), mk('Ana'), mk('Bia')];
  bid(dono, 30, 30);
  bid(ana, 10, 10);
  const alvo = house.ticketForUser(ana.id).raisable.entryId;
  assert.throws(() => house.createRaiseOrder({ userId: bia.id, entryId: alvo, minutes: 10, cents: 2000 }), (e) => e.code === 'not_found');
  const ativo = house.active().id;
  assert.throws(() => house.createRaiseOrder({ userId: dono.id, entryId: ativo, minutes: 40, cents: 4000 }), (e) => e.code === 'not_found');
});

// ---------- promessas da politica de privacidade ----------
test('apagar a conta tira o apelido dos registros de pedidos e da fila (a politica de privacidade promete isso)', async () => {
  const db = openDb(':memory:');
  const house = new LanHouse(db, { now: () => 1_000_000 });
  const accounts = new Accounts(db);
  const u = await accounts.register({ email: 'del@x.com', nickname: 'Apagavel', ...NEW });
  const o = house.createBidOrder({ userId: u.id, nickname: 'Apagavel', minutes: 5, cents: 500 });
  house.markPaid(o.id); // sem console online: fica esperando
  house.cancelEntry(house.upcoming()[0].id); // sai da fila: a conta pode ser apagada
  await accounts.deleteAccount(u.id, NEW.password);
  assert.equal(db.prepare('SELECT nickname FROM orders WHERE id = ?').get(o.id).nickname, 'conta apagada');
  assert.equal(db.prepare('SELECT nickname FROM entries WHERE user_id = ?').get(u.id).nickname, 'conta apagada');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  assert.equal(house.adminOverview().paid.cents, 500, 'o registro financeiro continua');
});

test('contas nunca confirmadas somem sozinhas depois de 2 horas (purgeUnverified)', async () => {
  const { accounts, db, advance } = contas();
  await accounts.register({ email: 'p@x.com', nickname: 'Pendente', ...NEW });
  accounts.purgeUnverified();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 1, 'ainda dentro do prazo');
  advance(2 * 60 * MIN + 1000);
  accounts.purgeUnverified();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM verify_codes').get().n, 0);
});

test('as paginas de termos, privacidade e confirmar e-mail existem, estao ligadas no rodape e no cadastro', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
  for (const f of ['termos.html', 'privacidade.html', 'confirmar-email.html']) assert.ok(existsSync(new URL(`../public/${f}`, import.meta.url)), `${f} nao foi gerada (rode npm run build)`);
  assert.match(read('index.html'), /href="\/termos\.html"[\s\S]*href="\/privacidade\.html"/);
  assert.match(read('criar-conta.html'), /href="\/termos\.html"/);
  assert.match(read('criar-conta.html'), /href="\/privacidade\.html"/);
  assert.match(read('termos.html'), /18 anos/);
  assert.match(read('privacidade.html'), /LGPD/);
});
