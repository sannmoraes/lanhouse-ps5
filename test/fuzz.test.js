// Teste aleatorio (com semente fixa, entao e repetivel): milhares de sequencias de acoes na fila.
// Depois de CADA passo conferimos regras que nunca podem ser quebradas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LanHouse, LanHouseError, openDb } from '../server/lanhouse.js';

const MIN = 60_000;
const EXPECTED_ERRORS = new Set(['too_many', 'bad_bid', 'not_found', 'already_free', 'free_cooldown', 'free_full', 'amount_mismatch']);

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scenario(seed, steps) {
  const rnd = mulberry32(seed);
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const chance = (p) => rnd() < p;

  let t = 50_000_000;
  const db = openDb(':memory:');
  const house = new LanHouse(db, { now: () => t, pixExpiresMin: 15 });
  house.setConsoleOnline(true);
  const users = [];
  for (let i = 0; i < 7; i++) {
    const nick = `User${i}`;
    const id = Number(db.prepare("INSERT INTO users (email, nickname, nick_key, pw_salt, pw_hash, adult_confirmed_at, created_at) VALUES (?, ?, ?, x'00', x'00', 0, 0)").run(`f${i}@x.com`, nick, nick.toLowerCase()).lastInsertRowid);
    users.push({ id, nickname: nick });
  }
  const orders = []; // ids de pedidos criados
  const lost = { cents: 0, minutes: 0 }; // aumento pago sem efeito (turno ja tinha comecado e so subiu o valor)
  const sumPaidEntries = () => db.prepare("SELECT COALESCE(SUM(cents),0) c, COALESCE(SUM(minutes),0) m FROM entries WHERE lane = 'paid'").get();

  const label = (step, op) => `seed=${seed} passo=${step} op=${op}`;

  function pay(id) {
    const o = house.getOrder(id);
    if (!o || o.status === 'paid') return;
    const before = sumPaidEntries();
    house.markPaid(id);
    const after = sumPaidEntries();
    const gotCents = Number(after.c) - Number(before.c);
    const gotMin = Number(after.m) - Number(before.m);
    if (gotCents !== o.amount_cents || gotMin !== o.minutes) {
      // so e aceitavel quando foi um aumento so de valor sem entrada esperando (dinheiro sem efeito)
      assert.ok(o.kind === 'raise' && o.minutes === 0 && gotCents === 0, `pagamento nao conservou o valor: ${JSON.stringify({ o, gotCents, gotMin })}`);
      lost.cents += o.amount_cents;
    }
  }

  function check(step, op) {
    const L = label(step, op);
    // 1. no maximo um jogando
    const active = db.prepare("SELECT * FROM entries WHERE state = 'active'").all();
    assert.ok(active.length <= 1, `${L}: ${active.length} jogando ao mesmo tempo`);

    // 2. ordem da espera: preco por minuto (maior primeiro), empate por quem deu o lance antes
    const wp = house.waitingPaid();
    for (let i = 0; i + 1 < wp.length; i++) {
      const a = wp[i];
      const b = wp[i + 1];
      const ra = a.cents * b.minutes;
      const rb = b.cents * a.minutes;
      assert.ok(ra > rb || (ra === rb && (a.bid_at < b.bid_at || (a.bid_at === b.bid_at && a.id < b.id))), `${L}: ordem errada entre ${a.id} e ${b.id}`);
    }
    const wf = house.waitingFree();
    for (let i = 0; i + 1 < wf.length; i++) assert.ok(wf[i].bid_at <= wf[i + 1].bid_at, `${L}: fila gratis fora de ordem`);

    // 3. a ordem prevista tem cada espera exatamente uma vez
    const up = house.upcoming();
    const waitingCount = Number(db.prepare("SELECT COUNT(*) n FROM entries WHERE state = 'waiting'").get().n);
    assert.equal(up.length, waitingCount, `${L}: previsao nao bate com a espera`);
    assert.equal(new Set(up.map((e) => e.id)).size, up.length, `${L}: entrada repetida na previsao`);

    // 4. lances novos obedecem as regras (minutos de 5 em 5 ate 60, piso por minuto, teto)
    for (const e of db.prepare("SELECT e.* FROM entries e JOIN orders o ON o.id = e.order_id WHERE o.kind = 'bid'").all()) {
      assert.ok(e.minutes >= 5 && e.minutes <= 60 && e.minutes % 5 === 0, `${L}: minutos fora da regra (${e.minutes})`);
    }

    // 5. conservacao do dinheiro e dos minutos: tudo que foi pago esta numa entrada (ou foi um aumento sem efeito, anotado)
    const paid = db.prepare("SELECT COALESCE(SUM(amount_cents),0) c, COALESCE(SUM(minutes),0) m FROM orders WHERE status = 'paid'").get();
    const ent = sumPaidEntries();
    assert.equal(Number(paid.c), Number(ent.c) + lost.cents, `${L}: dinheiro nao confere`);
    assert.equal(Number(paid.m), Number(ent.m), `${L}: minutos pagos nao conferem`);
    assert.equal(house.adminOverview().paid.cents, Number(paid.c), `${L}: caixa do painel`);

    // 6. quem joga tem pelo menos os minutos que comprou
    if (active[0]) assert.ok(active[0].ends_at - active[0].started_at >= active[0].minutes * MIN, `${L}: turno mais curto que o comprado`);

    // 7. fila gratis: uma vaga por pessoa e espera entre turnos
    for (const u of users) {
      const open = Number(db.prepare("SELECT COUNT(*) n FROM entries WHERE user_id = ? AND lane = 'free' AND state IN ('waiting','active')").get(u.id).n);
      assert.ok(open <= 1, `${L}: ${u.nickname} em duas vagas gratis`);
      const starts = db.prepare("SELECT started_at FROM entries WHERE user_id = ? AND lane = 'free' AND started_at IS NOT NULL ORDER BY started_at").all(u.id).map((r) => r.started_at);
      for (let i = 0; i + 1 < starts.length; i++) assert.ok(starts[i + 1] - starts[i] >= house.rules.freeCooldownMin * MIN, `${L}: dois turnos gratis dentro da espera`);
    }

    // 8. console online, fila nao pausada e ninguem jogando => a espera esta vazia (a fila nao trava)
    if (house.consoleOnline && !house.paused && active.length === 0) assert.equal(waitingCount, 0, `${L}: fila travada com console livre`);

    // 9. o que cada pessoa ve bate com a ordem real
    for (const u of users) {
      for (const tk of house.ticketForUser(u.id).tickets.filter((x) => x.phase === 'waiting')) {
        assert.equal(up[tk.position - 1]?.id, tk.entryId, `${L}: posicao mostrada a ${u.nickname} esta errada`);
      }
    }
    const ps = house.publicState();
    assert.equal(ps.queueLength, waitingCount, `${L}: tamanho da fila publico`);
    if (active[0]) assert.ok(ps.current.remainingMs >= 0);
  }

  for (let step = 0; step < steps; step++) {
    const u = pick(users);
    const r = rnd();
    let op = '';
    try {
      if (r < 0.28) {
        op = 'lance';
        const minutes = 5 * int(1, 12);
        const o = house.createBidOrder({ userId: u.id, nickname: u.nickname, minutes, cents: (minutes + int(0, 25)) * 100 });
        orders.push(o.id);
        if (chance(0.8)) pay(o.id);
      } else if (r < 0.42) {
        op = 'aumento';
        const rz = house.ticketForUser(u.id).raisable;
        if (rz) {
          const minutes = Math.min(60, rz.minutes + 5 * int(0, 3));
          const cents = rz.cents + 100 * int(0, 9);
          const o = house.createRaiseOrder({ userId: u.id, entryId: rz.entryId, minutes, cents });
          orders.push(o.id);
          if (chance(0.8)) pay(o.id);
        }
      } else if (r < 0.52) {
        op = 'paga-pendente';
        if (orders.length) pay(pick(orders));
      } else if (r < 0.6) {
        op = 'gratis-entra';
        house.joinFree({ userId: u.id, nickname: u.nickname });
      } else if (r < 0.64) {
        op = 'gratis-sai';
        house.leaveFree(u.id);
      } else if (r < 0.88) {
        op = 'tempo';
        t += int(0, 12) * MIN + int(0, 59_000);
        house.tick();
      } else if (r < 0.93) {
        op = 'console';
        house.setConsoleOnline(!house.consoleOnline);
      } else if (r < 0.95) {
        op = 'pausa';
        house.setPaused(!house.paused);
      } else if (r < 0.97) {
        op = 'admin-encerra';
        house.endActive('admin');
      } else {
        op = 'admin-remove';
        const w = house.upcoming();
        if (w.length) house.cancelEntry(pick(w).id);
      }
    } catch (e) {
      if (!(e instanceof LanHouseError) || !EXPECTED_ERRORS.has(e.code)) throw e;
    }
    t += 1000;
    house.tick();
    check(step, op);
  }
}

// Padrao: 30 sequencias (~25 s). Completo: FUZZ_SEEDS=300 npm test  (~4 min, 36 mil passos).
const SEEDS = Number(process.env.FUZZ_SEEDS ?? 30);

test(`ALEATORIO: ${SEEDS} sequencias de 120 passos mantem todas as regras da fila, do dinheiro e do tempo`, () => {
  let total = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    scenario(seed, 120);
    total += 120;
  }
  assert.equal(total, SEEDS * 120);
});

// Regressao do caso 45 do teste completo: dois Pix de aumento pagos passavam do teto de 60 min por turno.
test('ALEATORIO (regressao): dois Pix de aumento pagos nao esticam o turno alem do maximo', () => {
  let t = 50_000_000;
  const db = openDb(':memory:');
  const house = new LanHouse(db, { now: () => t });
  house.setConsoleOnline(true);
  const mk = (n) => ({ id: Number(db.prepare("INSERT INTO users (email, nickname, nick_key, pw_salt, pw_hash, adult_confirmed_at, created_at) VALUES (?, ?, ?, x'00', x'00', 0, 0)").run(`${n}@x.com`, n, n.toLowerCase()).lastInsertRowid), nickname: n });
  const ocupa = mk('Ocupa');
  const ana = mk('Ana');
  house.markPaid(house.createBidOrder({ userId: ocupa.id, nickname: 'Ocupa', minutes: 5, cents: 500 }).id);
  house.markPaid(house.createBidOrder({ userId: ana.id, nickname: 'Ana', minutes: 30, cents: 3000 }).id);
  const e = house.ticketForUser(ana.id).raisable;
  const a = house.createRaiseOrder({ userId: ana.id, entryId: e.entryId, minutes: 45, cents: 4500 }); // +15 min, +R$15
  const b = house.createRaiseOrder({ userId: ana.id, entryId: e.entryId, minutes: 50, cents: 5000 }); // +20 min, +R$20 (cancela a pendente a)
  house.markPaid(a.id);
  house.markPaid(b.id); // a pessoa pagou os dois
  const lances = db.prepare("SELECT minutes, cents FROM entries WHERE user_id = ? ORDER BY id").all(ana.id);
  assert.ok(lances.every((l) => l.minutes <= 60), JSON.stringify(lances));
  assert.equal(lances.reduce((s, l) => s + Number(l.minutes), 0), 30 + 15 + 20); // todos os minutos pagos existem
  assert.equal(lances.reduce((s, l) => s + Number(l.cents), 0), 3000 + 1500 + 2000); // e todo o dinheiro tambem
});
