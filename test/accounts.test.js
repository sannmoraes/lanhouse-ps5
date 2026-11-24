import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LanHouse, openDb } from '../server/lanhouse.js';
import { Accounts, ACTIONS, DEFAULT_CONTROLS, validateControls } from '../server/accounts.js';

function setup() {
  let t = 1_000_000;
  const db = openDb(':memory:');
  const accounts = new Accounts(db, { now: () => t });
  const house = new LanHouse(db, { now: () => t });
  return { accounts, house, db, advance: (ms) => (t += ms) };
}
const ok = { email: 'Ana@Exemplo.com', nickname: 'Ana', password: 'senha-forte-1', adult: true };

test('cadastro guarda e-mail em minusculas e nunca a senha em texto', async () => {
  const { accounts, db } = setup();
  const u = await accounts.register(ok);
  assert.equal(u.email, 'ana@exemplo.com');
  const raw = JSON.stringify(db.prepare('SELECT * FROM users').all().map((r) => [r.pw_hash.toString('hex'), r.pw_salt.toString('hex')]));
  assert.ok(!raw.includes('senha-forte-1'));
});

test('cadastro valida e-mail, apelido, senha e maioridade', async () => {
  const { accounts } = setup();
  await assert.rejects(accounts.register({ ...ok, email: 'x' }), (e) => e.code === 'bad_email');
  await assert.rejects(accounts.register({ ...ok, nickname: '<b>' }), (e) => e.code === 'bad_nickname');
  await assert.rejects(accounts.register({ ...ok, password: '1234567' }), (e) => e.code === 'bad_password');
  await assert.rejects(accounts.register({ ...ok, adult: false }), (e) => e.code === 'adult_required');
});

test('apelido repetido (sem diferenciar maiuscula) e e-mail repetido sao recusados', async () => {
  const { accounts } = setup();
  await accounts.register(ok);
  await assert.rejects(accounts.register({ ...ok, email: 'b@x.com', nickname: 'ANA' }), (e) => e.code === 'nick_taken');
  await assert.rejects(accounts.register({ ...ok, nickname: 'Outra' }), (e) => e.code === 'email_taken');
});

test('login certo cria sessao; senha errada e e-mail inexistente dao a mesma mensagem', async () => {
  const { accounts } = setup();
  await accounts.register(ok);
  const { token } = await accounts.login({ email: 'ana@exemplo.com', password: 'senha-forte-1' });
  assert.equal(accounts.userFromToken(token).nickname, 'Ana');
  const a = await accounts.login({ email: 'ana@exemplo.com', password: 'errada-errada' }).catch((e) => e);
  const b = await accounts.login({ email: 'nao@existe.com', password: 'errada-errada' }).catch((e) => e);
  assert.equal(a.code, 'bad_login');
  assert.equal(a.message, b.message);
});

test('sessao expira e logout invalida', async () => {
  const { accounts, advance } = setup();
  await accounts.register(ok);
  const { token } = await accounts.login({ email: ok.email, password: ok.password });
  accounts.logout(token);
  assert.equal(accounts.userFromToken(token), null);
  const { token: t2 } = await accounts.login({ email: ok.email, password: ok.password });
  advance(31 * 24 * 3600 * 1000);
  assert.equal(accounts.userFromToken(t2), null);
});

test('so o hash da sessao fica no banco', async () => {
  const { accounts, db } = setup();
  await accounts.register(ok);
  const { token } = await accounts.login({ email: ok.email, password: ok.password });
  const rows = JSON.stringify(db.prepare('SELECT * FROM sessions').all());
  assert.ok(!rows.includes(token));
});

test('trocar a senha exige a atual e derruba as outras sessoes', async () => {
  const { accounts } = setup();
  const u = await accounts.register(ok);
  const { token: a } = await accounts.login({ email: ok.email, password: ok.password });
  const { token: b } = await accounts.login({ email: ok.email, password: ok.password });
  await assert.rejects(accounts.changePassword(u.id, 'errada', 'nova-senha-123', a), (e) => e.code === 'bad_login');
  await accounts.changePassword(u.id, ok.password, 'nova-senha-123', a);
  assert.ok(accounts.userFromToken(a));
  assert.equal(accounts.userFromToken(b), null);
  await assert.rejects(accounts.login({ email: ok.email, password: ok.password }), (e) => e.code === 'bad_login');
  await accounts.login({ email: ok.email, password: 'nova-senha-123' });
});

test('trocar o apelido respeita unicidade', async () => {
  const { accounts } = setup();
  const a = await accounts.register(ok);
  await accounts.register({ ...ok, email: 'b@x.com', nickname: 'Bia' });
  assert.equal(accounts.updateNickname(a.id, 'Aninha').nickname, 'Aninha');
  assert.throws(() => accounts.updateNickname(a.id, 'bia'), (e) => e.code === 'nick_taken');
});

test('controles: padrao valido, sincroniza na conta e recusa teclas repetidas ou invalidas', async () => {
  const { accounts } = setup();
  const u = await accounts.register(ok);
  assert.deepEqual(accounts.getControls(u.id), DEFAULT_CONTROLS);
  assert.deepEqual(validateControls(DEFAULT_CONTROLS), DEFAULT_CONTROLS);
  const custom = structuredClone(DEFAULT_CONTROLS);
  custom.keyboard.cross = 'Space';
  accounts.setControls(u.id, custom);
  assert.equal(accounts.getControls(u.id).keyboard.cross, 'Space');
  const dup = structuredClone(DEFAULT_CONTROLS);
  dup.keyboard.cross = dup.keyboard.circle;
  assert.throws(() => accounts.setControls(u.id, dup), (e) => e.code === 'bad_controls');
  const bad = structuredClone(DEFAULT_CONTROLS);
  bad.keyboard.up = '<script>';
  assert.throws(() => validateControls(bad), (e) => e.code === 'bad_controls');
  const badPad = structuredClone(DEFAULT_CONTROLS);
  badPad.pad.up = 99;
  assert.throws(() => validateControls(badPad), (e) => e.code === 'bad_controls');
  assert.equal(ACTIONS.length, 16);
});

test('apagar conta exige senha e nao deixa se ha ficha na fila', async () => {
  const { accounts, house } = setup();
  const u = await accounts.register(ok);
  const o = house.createBidOrder({ userId: u.id, nickname: u.nickname, minutes: 10, cents: 1000 });
  house.markPaid(o.id);
  await assert.rejects(accounts.deleteAccount(u.id, 'errada'), (e) => e.code === 'bad_login');
  await assert.rejects(accounts.deleteAccount(u.id, ok.password), (e) => e.code === 'has_tickets');
  house.endActive();
  house.cancelEntry(1);
  await accounts.deleteAccount(u.id, ok.password);
  assert.equal(accounts.userById(u.id), undefined);
  // o pedido pago continua no banco para o financeiro
  assert.equal(house.getOrder(o.id).status, 'paid');
});
