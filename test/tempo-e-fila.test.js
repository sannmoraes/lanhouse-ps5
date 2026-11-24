// Auditoria da fila, dos lances e do relogio: cada teste descreve uma situacao real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LanHouse, openDb } from '../server/lanhouse.js';

const R = (reais) => reais * 100;
const MIN = 60_000;

function setup(rules = {}) {
  let t = 10_000_000;
  const db = openDb(':memory:');
  const house = new LanHouse(db, { rules, now: () => t, pixExpiresMin: 15 });
  house.setConsoleOnline(true);
  let n = 0;
  const user = (nickname) => {
    n += 1;
    const id = Number(db.prepare("INSERT INTO users (email, nickname, nick_key, pw_salt, pw_hash, adult_confirmed_at, created_at) VALUES (?, ?, ?, x'00', x'00', 0, 0)").run(`u${n}@x.com`, nickname, nickname.toLowerCase()).lastInsertRowid);
    return { id, nickname };
  };
  const bid = (u, minutes, reais) => {
    const o = house.createBidOrder({ userId: u.id, nickname: u.nickname, minutes, cents: R(reais) });
    house.markPaid(o.id);
    t += 1000;
    return o;
  };
  return { house, db, user, bid, now: () => t, advance: (ms) => { t += ms; house.tick(); } };
}
const names = (house) => house.publicState().queue.map((q) => q.nickname);

// ============ TEMPO: conforme o pagamento ============
test('TEMPO: 10 minutos pagos = 10 minutos exatos de jogo (nem 1 ms a menos ou a mais)', () => {
  const s = setup();
  const ana = s.user('Ana');
  const t0 = s.now();
  s.bid(ana, 10, 10);
  const a = s.house.active();
  assert.equal(a.ends_at - a.started_at, 10 * MIN);
  s.advance(10 * MIN - 1500); // ainda faltam ~1,5 s (o lance de Ana foi 1 s antes do relogio atual)
  assert.equal(s.house.publicState().current?.nickname, 'Ana');
  s.advance(2000);
  assert.equal(s.house.publicState().current, null);
  assert.equal(s.house.db.prepare("SELECT ended_reason FROM entries WHERE id = ?").get(a.id).ended_reason, 'time_up');
  void t0;
});

test('TEMPO: 15, 30 e 60 minutos pagos tocam 15, 30 e 60 minutos', () => {
  for (const [min, reais] of [[15, 25], [30, 30], [60, 60]]) {
    const s = setup();
    const u = s.user('Jogador');
    s.bid(u, min, reais);
    assert.equal(s.house.active().ends_at - s.house.active().started_at, min * MIN);
  }
});

test('TEMPO: aumentar o lance ANTES de comecar soma os minutos comprados', () => {
  const s = setup();
  s.bid(s.user('Ocupa'), 5, 5);
  const bia = s.user('Bia');
  s.bid(bia, 10, 10);
  const e = s.house.ticketForUser(bia.id).raisable;
  const raise = s.house.createRaiseOrder({ userId: bia.id, entryId: e.entryId, minutes: 20, cents: R(40) });
  assert.equal(raise.minutes, 10); // so os 10 minutos a mais
  assert.equal(raise.amount_cents, R(30)); // so a diferenca
  s.house.markPaid(raise.id);
  s.advance(5 * MIN); // Ocupa termina
  const a = s.house.active();
  assert.equal(a.nickname, 'Bia');
  assert.equal(a.ends_at - a.started_at, 20 * MIN);
});

test('TEMPO: o relogio NAO para quando o jogador sai da pagina (so o console offline pausa)', () => {
  const s = setup();
  s.bid(s.user('Ana'), 10, 10);
  s.advance(4 * MIN);
  assert.ok(Math.abs(s.house.publicState().current.remainingMs - 6 * MIN) < 2000);
});

test('TEMPO: console offline no meio do turno pausa o relogio e devolve o tempo', () => {
  const s = setup();
  s.bid(s.user('Ana'), 10, 10);
  s.advance(3 * MIN); // jogou 3 min
  const antes = s.house.publicState().current.remainingMs;
  s.house.setConsoleOnline(false); // o PC do PS5 caiu
  assert.equal(s.house.publicState().current.clockPaused, true);
  s.advance(8 * MIN); // 8 min fora do ar
  s.advance(1 * MIN);
  assert.equal(s.house.publicState().current.nickname, 'Ana', 'nao pode perder o turno enquanto o console esta fora');
  s.house.setConsoleOnline(true);
  const depois = s.house.publicState().current.remainingMs;
  assert.ok(Math.abs(depois - antes) < 2000, `tinha ${antes} ms e voltou com ${depois} ms`);
  assert.equal(s.house.publicState().current.clockPaused, false);
  s.advance(antes + 2000);
  assert.equal(s.house.publicState().current, null); // e termina no tempo certo depois da volta
});

test('TEMPO: servidor reiniciado com turno aberto credita o tempo que ficou desligado', () => {
  const s = setup();
  s.bid(s.user('Ana'), 10, 10);
  s.advance(2 * MIN);
  const restante = s.house.publicState().current.remainingMs;
  // "servidor novo" lendo o mesmo banco, 30 min depois: nasce com o console offline
  const t = s.now() + 30 * MIN;
  const novo = new LanHouse(s.db, { now: () => t });
  novo.tick();
  assert.equal(novo.publicState().current.nickname, 'Ana');
  assert.ok(Math.abs(novo.publicState().current.remainingMs - restante) < 2000);
});

test('TEMPO: pausar a fila (admin) nao corta quem ja esta jogando', () => {
  const s = setup();
  s.bid(s.user('Ana'), 10, 10);
  s.bid(s.user('Bia'), 10, 10);
  s.house.setPaused(true);
  s.advance(4 * MIN);
  assert.equal(s.house.publicState().current.nickname, 'Ana');
  s.advance(7 * MIN); // acabou o turno da Ana; a fila esta pausada, Bia nao entra
  assert.equal(s.house.publicState().current, null);
  assert.deepEqual(names(s.house), ['Bia']);
  s.house.setPaused(false);
  assert.equal(s.house.publicState().current.nickname, 'Bia');
});

test('TEMPO: console offline antes da vez: tempo comprado guardado, comeca inteiro quando volta', () => {
  const s = setup();
  s.house.setConsoleOnline(false);
  s.bid(s.user('Ana'), 15, 25);
  s.advance(60 * MIN);
  assert.equal(s.house.publicState().current, null);
  s.house.setConsoleOnline(true);
  assert.equal(s.house.publicState().current.remainingMs, 15 * MIN);
});

// ============ LANCES: passar na frente ============
test('FILA: quem paga mais por minuto passa na frente, mesmo chegando depois', () => {
  const s = setup();
  s.bid(s.user('Ocupa'), 5, 5);
  s.bid(s.user('Dono'), 10, 10);
  s.bid(s.user('Bia'), 10, 12);
  s.bid(s.user('Caio'), 15, 25); // R$ 1,67/min
  assert.deepEqual(names(s.house), ['Caio', 'Bia', 'Dono']);
});

test('FILA: passar o lance do 1o por 1 centavo por minuto de diferenca ja ganha a frente (sem arredondar)', () => {
  const s = setup({ minCentsPerMinute: 1, maxCents: 100000 });
  s.bid(s.user('Ocupa'), 5, 5);
  // 7 por 5 min (1,40/min) x 8 por 5 min (1,60/min); e 33 por 20 min (1,65) x 32 por 20 min (1,60)
  s.bid(s.user('Aaa'), 5, 7);
  s.bid(s.user('Bbb'), 5, 8);
  s.bid(s.user('Ccc'), 20, 33);
  s.bid(s.user('Ddd'), 20, 32);
  assert.deepEqual(names(s.house), ['Ccc', 'Bbb', 'Ddd', 'Aaa']);
});

test('FILA: empate de preco por minuto fica com quem deu o lance primeiro', () => {
  const s = setup();
  s.bid(s.user('Ocupa'), 5, 5);
  s.bid(s.user('Primeiro'), 10, 20);
  s.bid(s.user('Segundo'), 5, 10); // mesmo R$ 2/min
  assert.deepEqual(names(s.house), ['Primeiro', 'Segundo']);
});

test('FILA: quem paga mais nunca derruba quem esta jogando, so reorganiza a espera', () => {
  const s = setup();
  s.bid(s.user('Ana'), 10, 10);
  s.advance(1 * MIN);
  s.bid(s.user('Rico'), 60, 200);
  assert.equal(s.house.publicState().current.nickname, 'Ana');
  assert.ok(Math.abs(s.house.publicState().current.remainingMs - 9 * MIN) < 3000);
  s.advance(10 * MIN);
  assert.equal(s.house.publicState().current.nickname, 'Rico');
});

test('FILA: ser ultrapassado e recuperar a vez aumentando o lance', () => {
  const s = setup();
  s.bid(s.user('Ocupa'), 5, 5);
  const bia = s.user('Bia');
  const caio = s.user('Caio');
  s.bid(bia, 10, 10);
  assert.equal(s.house.ticketForUser(bia.id).ticket.position, 1);
  s.bid(caio, 10, 20); // passa a Bia
  assert.equal(s.house.ticketForUser(bia.id).ticket.position, 2);
  const e = s.house.ticketForUser(bia.id).raisable;
  const prev = s.house.previewBid({ minutes: 10, cents: R(21), replaceEntryId: e.entryId });
  assert.equal(prev.position, 1); // o simulador ja avisa que R$ 21 recupera a frente
  const r = s.house.createRaiseOrder({ userId: bia.id, entryId: e.entryId, minutes: 10, cents: R(21) });
  assert.equal(r.amount_cents, R(11));
  s.house.markPaid(r.id);
  assert.equal(s.house.ticketForUser(bia.id).ticket.position, 1);
  assert.deepEqual(names(s.house), ['Bia', 'Caio']);
});

test('FILA: duas pessoas aumentando ao mesmo tempo (Pix de ambas caindo): vale a ordem final por valor', () => {
  const s = setup();
  s.bid(s.user('Ocupa'), 5, 5);
  const a = s.user('Aaa');
  const b = s.user('Bbb');
  s.bid(a, 10, 10);
  s.bid(b, 10, 10);
  const ea = s.house.ticketForUser(a.id).raisable;
  const eb = s.house.ticketForUser(b.id).raisable;
  const ra = s.house.createRaiseOrder({ userId: a.id, entryId: ea.entryId, minutes: 10, cents: R(15) });
  const rb = s.house.createRaiseOrder({ userId: b.id, entryId: eb.entryId, minutes: 10, cents: R(18) });
  s.house.markPaid(rb.id);
  s.house.markPaid(ra.id);
  assert.deepEqual(names(s.house), ['Bbb', 'Aaa']);
});

// ============ SUBSTITUIR um lance ============
test('SUBSTITUIR: pedir outro Pix cancela o anterior que nao foi pago; pagar so o novo cria so um lance', () => {
  const s = setup();
  s.bid(s.user('Ocupa'), 5, 5);
  const ana = s.user('Ana');
  const velho = s.house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: 10, cents: R(10) });
  const novo = s.house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: 15, cents: R(25) });
  assert.equal(s.house.getOrder(velho.id).status, 'expired');
  s.house.markPaid(novo.id);
  const q = s.house.publicState().queue;
  assert.equal(q.length, 1);
  assert.equal(q[0].cents, R(25));
});

test('SUBSTITUIR: pagar o Pix antigo que a pessoa ja tinha pago NAO se perde (entra como outro lance)', () => {
  const s = setup();
  s.bid(s.user('Ocupa'), 5, 5);
  const ana = s.user('Ana');
  const velho = s.house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: 10, cents: R(10) });
  const novo = s.house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: 15, cents: R(25) });
  s.house.markPaid(novo.id);
  s.house.markPaid(velho.id); // pagou os dois (o banco avisou o antigo depois)
  assert.equal(s.house.publicState().queue.length, 2);
  assert.equal(s.house.adminOverview().paid.cents, R(5) + R(25) + R(10));
});

test('SUBSTITUIR: aumentar um lance que ja comecou a jogar nao e permitido (so lance novo)', () => {
  const s = setup();
  const ana = s.user('Ana');
  s.bid(ana, 10, 10); // joga agora
  assert.equal(s.house.ticketForUser(ana.id).raisable, null);
  assert.throws(() => s.house.createRaiseOrder({ userId: ana.id, entryId: s.house.active().id, minutes: 20, cents: R(40) }), (e) => e.code === 'not_found');
});

test('SUBSTITUIR: ninguem aumenta o lance de outra pessoa', () => {
  const s = setup();
  s.bid(s.user('Ocupa'), 5, 5);
  const ana = s.user('Ana');
  const eva = s.user('Eva');
  s.bid(ana, 10, 10);
  const e = s.house.ticketForUser(ana.id).raisable;
  assert.throws(() => s.house.createRaiseOrder({ userId: eva.id, entryId: e.entryId, minutes: 10, cents: R(20) }), (er) => er.code === 'not_found');
});

test('SUBSTITUIR: a admin remove o lance da fila e o dinheiro continua no caixa (devolver e manual)', () => {
  const s = setup();
  s.bid(s.user('Ocupa'), 5, 5);
  const ana = s.user('Ana');
  s.bid(ana, 10, 10);
  s.house.cancelEntry(s.house.ticketForUser(ana.id).ticket.entryId);
  assert.equal(s.house.publicState().queueLength, 0);
  assert.equal(s.house.adminOverview().paid.cents, R(15));
});

// ============ outras conferencias ============
test('FILA: lance fora das regras e recusado (minutos, centavos, piso, teto)', () => {
  const s = setup();
  const ana = s.user('Ana');
  for (const [m, c] of [[7, R(10)], [10, R(9)], [10, 1050], [65, R(100)], [5, 0], [10, -100], [NaN, R(10)], [10, NaN]]) {
    assert.throws(() => s.house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: m, cents: c }), (e) => e.code === 'bad_bid', `${m}/${c}`);
  }
});

test('FILA: posicao e espera estimada de quem esta esperando batem com a soma dos turnos a frente', () => {
  const s = setup();
  const a = s.user('Aaa');
  const b = s.user('Bbb');
  const c = s.user('Ccc');
  s.bid(a, 10, 10); // joga
  s.bid(b, 15, 30); // 1o da espera
  s.bid(c, 10, 11);
  s.advance(2 * MIN);
  const tc = s.house.ticketForUser(c.id).ticket;
  assert.equal(tc.position, 2);
  const esperado = (s.house.active().ends_at - s.now()) + 15 * MIN; // o que falta da Aaa + a Bbb inteira
  assert.equal(tc.estimatedWaitMs, esperado);
});
