import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LanHouse, LanHouseError, MAX_ACTIVE_ENTRIES_PER_USER, openDb } from '../server/lanhouse.js';
import { Accounts } from '../server/accounts.js';

const R = (reais) => reais * 100;

async function setup(rules = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const db = openDb(':memory:');
  const house = new LanHouse(db, { rules, now: clock.now, pixExpiresMin: 15 });
  const accounts = new Accounts(db, { now: clock.now });
  house.setConsoleOnline(true);
  let n = 0;
  const user = async (nickname) => {
    n += 1;
    const u = await accounts.register({ email: `u${n}@ex.com`, nickname, password: 'senha-forte-1', adult: true });
    return { id: u.id, nickname: u.nickname };
  };
  const bid = (u, minutes, reais) => {
    const o = house.createBidOrder({ userId: u.id, nickname: u.nickname, minutes, cents: R(reais) });
    house.markPaid(o.id);
    clock.advance(1000); // cada lance chega em um instante diferente
    return o;
  };
  return { house, clock, user, bid, accounts };
}

const names = (house) => house.publicState().queue.map((q) => q.nickname);

test('regras do lance: minutos, reais inteiros, piso por minuto e teto', async () => {
  const { house, user } = await setup();
  const ana = await user('Ana');
  const bad = (minutes, reais) => () => house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes, cents: R(reais) });
  assert.throws(bad(7, 10), (e) => e.code === 'bad_bid'); // nao e multiplo de 5
  assert.throws(bad(65, 100), (e) => e.code === 'bad_bid'); // acima de 60
  assert.throws(bad(10, 9), (e) => e.code === 'bad_bid'); // abaixo de R$ 1/min
  assert.throws(() => house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: 10, cents: 1050 }), (e) => e.code === 'bad_bid'); // centavos
  assert.throws(bad(60, 300), (e) => e.code === 'bad_bid'); // acima do teto de R$ 200
  assert.equal(house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: 10, cents: R(10) }).status, 'pending'); // R$ 10 por 10 min passa
});

test('o exemplo do dono: R$ 25 por 15 min passa na frente de R$ 10 por 10 min', async () => {
  const { house, user, bid } = await setup();
  const dono = await user('Dono');
  bid(dono, 10, 10); // joga ja (console livre)
  const bia = await user('Bia');
  const caio = await user('Caio');
  bid(bia, 10, 10);
  bid(caio, 15, 25);
  assert.equal(house.publicState().current.nickname, 'Dono');
  assert.deepEqual(names(house), ['Caio', 'Bia']);
});

test('ordem e por preco por minuto, nao pelo total; empate fica com quem deu primeiro', async () => {
  const { house, user, bid } = await setup();
  const ocupa = await user('Ocupa');
  bid(ocupa, 5, 5);
  const a = await user('Aaa');
  const b = await user('Bbb');
  const c = await user('Ccc');
  const d = await user('Ddd');
  bid(a, 60, 60); // R$ 1,00/min (total alto)
  bid(b, 10, 20); // R$ 2,00/min
  bid(c, 10, 20); // empate com B, chegou depois
  bid(d, 5, 5); // R$ 1,00/min, chegou depois de A
  assert.deepEqual(names(house), ['Bbb', 'Ccc', 'Aaa', 'Ddd']);
});

test('um lance maior nunca interrompe quem esta jogando', async () => {
  const { house, user, bid } = await setup();
  const ana = await user('Ana');
  bid(ana, 10, 10);
  const rico = await user('Rico');
  bid(rico, 60, 200);
  assert.equal(house.publicState().current.nickname, 'Ana');
  assert.deepEqual(names(house), ['Rico']);
});

test('quando o turno acaba entra o de maior lance', async () => {
  const { house, clock, user, bid } = await setup();
  bid(await user('Ana'), 10, 10);
  bid(await user('Bia'), 10, 10);
  bid(await user('Caio'), 15, 25);
  clock.advance(10 * 60_000);
  house.tick();
  assert.equal(house.publicState().current.nickname, 'Caio');
  assert.equal(house.publicState().current.remainingMs, 15 * 60_000);
});

test('aumentar o lance: paga so a diferenca e sobe na fila', async () => {
  const { house, user, bid, accounts } = await setup();
  bid(await user('Ocupa'), 5, 5);
  const bia = await user('Bia');
  const caio = await user('Caio');
  bid(bia, 10, 10);
  bid(caio, 10, 15);
  assert.deepEqual(names(house), ['Caio', 'Bia']);
  const entry = house.ticketForUser(bia.id).raisable;
  const raise = house.createRaiseOrder({ userId: bia.id, entryId: entry.entryId, minutes: 10, cents: R(20) });
  assert.equal(raise.amount_cents, R(10)); // so a diferenca
  assert.equal(raise.minutes, 0);
  assert.deepEqual(names(house), ['Caio', 'Bia']); // ainda nao pagou
  house.markPaid(raise.id);
  assert.deepEqual(names(house), ['Bia', 'Caio']);
  assert.equal(house.publicState().queue[0].cents, R(20));
  assert.equal(house.markPaid(raise.id).created, false); // webhook repetido nao soma de novo
  assert.equal(house.publicState().queue[0].cents, R(20));
  void accounts;
});

test('aumento precisa ser maior que o lance atual', async () => {
  const { house, user, bid } = await setup();
  bid(await user('Ocupa'), 5, 5);
  const bia = await user('Bia');
  bid(bia, 10, 10);
  const e = house.ticketForUser(bia.id).raisable;
  assert.throws(() => house.createRaiseOrder({ userId: bia.id, entryId: e.entryId, minutes: 10, cents: R(10) }), (er) => er.code === 'bad_bid');
  assert.throws(() => house.createRaiseOrder({ userId: bia.id, entryId: e.entryId, minutes: 5, cents: R(20) }), (er) => er.code === 'bad_bid');
  assert.throws(() => house.createRaiseOrder({ userId: 999, entryId: e.entryId, minutes: 10, cents: R(20) }), (er) => er.code === 'not_found');
});

test('aumento pago depois que o turno ja comecou vira um lance novo (o dinheiro nao se perde)', async () => {
  const { house, user, bid } = await setup();
  bid(await user('Ocupa'), 5, 5);
  const bia = await user('Bia');
  bid(bia, 10, 10);
  const e = house.ticketForUser(bia.id).raisable;
  const raise = house.createRaiseOrder({ userId: bia.id, entryId: e.entryId, minutes: 20, cents: R(40) });
  house.endActive(); // a vez da Bia chega antes de o Pix cair
  assert.equal(house.publicState().current.nickname, 'Bia');
  house.markPaid(raise.id);
  const q = house.publicState().queue;
  assert.equal(q.length, 1);
  assert.equal(q[0].nickname, 'Bia');
  assert.equal(q[0].minutes, 10);
  assert.equal(q[0].cents, R(30));
});

test('preview mostra a posicao e quanto falta para ser o primeiro', async () => {
  const { house, user, bid } = await setup();
  bid(await user('Ocupa'), 5, 5);
  bid(await user('Bia'), 10, 10);
  bid(await user('Caio'), 10, 15);
  const p = house.previewBid({ minutes: 15, cents: R(25) });
  assert.equal(p.position, 1);
  const low = house.previewBid({ minutes: 10, cents: R(10) });
  assert.equal(low.position, 3);
  // para passar o Caio (R$ 1,50/min) em 10 min precisa de mais de R$ 15 -> R$ 16
  assert.equal(low.toBeFirstCents, R(16));
  assert.equal(house.previewBid({ minutes: 10, cents: R(16) }).position, 1);
});

// ---------- fila gratis ----------
test('fila gratis: 10 minutos, so quando nao ha pagante ou na rotacao', async () => {
  const { house, clock, user, bid } = await setup({ freeEvery: 0 });
  bid(await user('Ocupa'), 5, 5);
  const gil = await user('Gil');
  const bia = await user('Bia');
  house.joinFree({ userId: gil.id, nickname: 'Gil' });
  bid(bia, 10, 10);
  // freeEvery 0: gratis so entra quando nao ha pagante esperando
  assert.deepEqual(names(house), ['Bia', 'Gil']);
  clock.advance(5 * 60_000);
  house.tick();
  assert.equal(house.publicState().current.nickname, 'Bia');
  clock.advance(10 * 60_000);
  house.tick();
  assert.equal(house.publicState().current.nickname, 'Gil');
  assert.equal(house.publicState().current.minutes, 10);
  assert.equal(house.publicState().current.lane, 'free');
});

test('fila gratis: depois de 3 turnos pagos entra 1 gratis', async () => {
  const { house, user, bid } = await setup({ freeEvery: 3 });
  const p = [];
  for (const n of ['P1', 'P2', 'P3', 'P4', 'P5']) p.push(await user(n));
  const gil = await user('Gil');
  const hel = await user('Hel');
  bid(p[0], 5, 5); // joga agora (contador = 1)
  house.joinFree({ userId: gil.id, nickname: 'Gil' });
  house.joinFree({ userId: hel.id, nickname: 'Hel' });
  bid(p[1], 5, 5);
  bid(p[2], 5, 5);
  bid(p[3], 5, 5);
  bid(p[4], 5, 5);
  // contador ja em 1; P2 e P3 sao pagos (2 e 3), depois 1 gratis, depois P4, P5, e Hel so quando acabar o ciclo
  assert.deepEqual(names(house), ['P2', 'P3', 'Gil', 'P4', 'P5', 'Hel']);
});

test('fila gratis: uma vaga por conta, espera entre turnos e limite de fila', async () => {
  const { house, clock, user, bid } = await setup({ freeCooldownMin: 60, freeMaxQueue: 1 });
  bid(await user('Ocupa'), 60, 60);
  const gil = await user('Gil');
  const hel = await user('Hel');
  house.joinFree({ userId: gil.id, nickname: 'Gil' });
  assert.throws(() => house.joinFree({ userId: gil.id, nickname: 'Gil' }), (e) => e.code === 'already_free');
  assert.throws(() => house.joinFree({ userId: hel.id, nickname: 'Hel' }), (e) => e.code === 'free_full');
  assert.equal(house.leaveFree(gil.id), true);
  house.joinFree({ userId: gil.id, nickname: 'Gil' });
  clock.advance(60 * 60_000);
  house.tick(); // Gil joga
  assert.equal(house.publicState().current.nickname, 'Gil');
  clock.advance(10 * 60_000);
  house.tick();
  assert.throws(() => house.joinFree({ userId: gil.id, nickname: 'Gil' }), (e) => e.code === 'free_cooldown');
  clock.advance(60 * 60_000);
  house.joinFree({ userId: gil.id, nickname: 'Gil' }); // passou o tempo de espera
  assert.equal(house.ticketForUser(gil.id).free.inQueue, true);
});

// ---------- o que ja existia ----------
test('webhook repetido nao duplica a entrada na fila', async () => {
  const { house, user } = await setup();
  const ana = await user('Ana');
  const o = house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: 10, cents: R(10) });
  assert.equal(house.markPaid(o.id).created, true);
  assert.equal(house.markPaid(o.id).created, false);
  assert.equal(house.db.prepare('SELECT COUNT(*) n FROM entries').get().n, 1);
});

test('valor pago diferente do pedido e recusado', async () => {
  const { house, user } = await setup();
  const ana = await user('Ana');
  const o = house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: 10, cents: R(10) });
  assert.throws(() => house.markPaid(o.id, { amountCents: 100 }), (e) => e.code === 'amount_mismatch');
  assert.equal(house.getOrder(o.id).status, 'pending');
});

test('console offline: o lance fica guardado e o tempo nao queima', async () => {
  const { house, clock, user, bid } = await setup();
  house.setConsoleOnline(false);
  bid(await user('Ana'), 10, 10);
  clock.advance(60 * 60_000);
  house.tick();
  assert.equal(house.publicState().console, 'offline');
  assert.equal(house.publicState().queueLength, 1);
  house.setConsoleOnline(true);
  assert.equal(house.publicState().current.nickname, 'Ana');
  assert.equal(house.publicState().current.remainingMs, 10 * 60_000);
});

test('pix nao pago expira, mas pix pago depois do prazo ainda entrega o lance', async () => {
  const { house, clock, user } = await setup();
  const ana = await user('Ana');
  const o = house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: 10, cents: R(10) });
  clock.advance(16 * 60_000);
  house.tick();
  assert.equal(house.getOrder(o.id).status, 'expired');
  house.markPaid(o.id);
  assert.equal(house.publicState().current.nickname, 'Ana');
});

test('um novo pedido cancela o Pix pendente anterior da mesma pessoa', async () => {
  const { house, user } = await setup();
  const ana = await user('Ana');
  const a = house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: 10, cents: R(10) });
  const b = house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: 15, cents: R(25) });
  assert.equal(house.getOrder(a.id).status, 'expired');
  assert.equal(house.ticketForUser(ana.id).pending.orderId, b.id);
});

test('limite de lances simultaneos por pessoa', async () => {
  const { house, user, bid } = await setup();
  const ana = await user('Ana');
  for (let i = 0; i < MAX_ACTIVE_ENTRIES_PER_USER; i++) bid(ana, 5, 5);
  assert.throws(() => house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: 5, cents: R(5) }), (e) => e.code === 'too_many');
});

test('estado publico mostra os lances, mas nunca ids, e-mails ou codigo pix', async () => {
  const { house, user, bid } = await setup();
  const ana = await user('Ana');
  const o = bid(ana, 10, 10);
  bid(await user('Bia'), 10, 12);
  const s = house.publicState();
  assert.equal(s.queue[0].cents, R(12));
  const json = JSON.stringify(s);
  assert.ok(!json.includes(o.id));
  assert.ok(!/@|token|pix|user_id/i.test(json));
});

test('ticketForUser mostra posicao, espera e lance', async () => {
  const { house, clock, user, bid } = await setup();
  const ana = await user('Ana');
  const bia = await user('Bia');
  bid(ana, 10, 10);
  bid(bia, 10, 10);
  assert.equal(house.ticketForUser(ana.id).ticket.phase, 'active');
  const w = house.ticketForUser(bia.id).ticket;
  assert.equal(w.phase, 'waiting');
  assert.equal(w.position, 1);
  assert.equal(w.cents, R(10));
  assert.ok(Math.abs(w.estimatedWaitMs - 10 * 60_000) < 5_000);
  clock.advance(60_000);
  assert.ok(Math.abs(house.ticketForUser(ana.id).ticket.remainingMs - 9 * 60_000) < 5_000);
  assert.equal(house.ticketForUser(999).ticket, null);
});

test('so o dono do turno ativo tem permissao de controle', async () => {
  const { house, user, bid } = await setup();
  const ana = await user('Ana');
  const bia = await user('Bia');
  bid(ana, 10, 10);
  bid(bia, 10, 10);
  assert.equal(house.isActiveUser(ana.id), true);
  assert.equal(house.isActiveUser(bia.id), false);
});

test('admin encerra o turno, remove da fila e pausa', async () => {
  const { house, user, bid } = await setup();
  bid(await user('Ana'), 10, 10);
  bid(await user('Bia'), 10, 10);
  bid(await user('Caio'), 10, 10);
  assert.equal(house.endActive(), true);
  assert.equal(house.publicState().current.nickname, 'Bia');
  assert.equal(house.cancelEntry(house.adminOverview().adminQueue[0].id), true);
  assert.equal(house.publicState().queueLength, 0);
  house.setPaused(true);
  assert.equal(house.endActive(), true);
  assert.equal(house.publicState().console, 'paused');
});

test('LanHouseError carrega status HTTP', () => {
  assert.equal(new LanHouseError('x', 'y', 418).status, 418);
});
