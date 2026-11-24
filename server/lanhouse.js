import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hasMessage, msg } from './messages.js';

const NICK_RE = /^[\p{L}\p{N} _.\-]{2,16}$/u;
export const MAX_ACTIVE_ENTRIES_PER_USER = 3;

/**
 * Erro de regra de negocio. `message` pode ser uma chave de server/messages.js (com `params`):
 * a mensagem fica em portugues e `localized(lang)` devolve o texto no idioma da requisicao.
 */
export class LanHouseError extends Error {
  constructor(code, message, status = 400, params = {}) {
    const key = hasMessage(message) ? message : null;
    super(key ? msg('pt', key, params) : message);
    this.code = code;
    this.status = status;
    this.key = key;
    this.params = params;
  }

  localized(lang) {
    return this.key ? msg(lang, this.key, this.params) : this.message;
  }
}

export function validNickname(value) {
  const nick = String(value ?? '').trim().replace(/\s+/g, ' ');
  return NICK_RE.test(nick) ? nick : null;
}

export const DEFAULT_RULES = {
  minMinutes: 5,
  maxMinutes: 60,
  stepMinutes: 5,
  minCentsPerMinute: 100, // piso do leilao: R$ 1,00 por minuto (ex.: R$ 10 por 10 min)
  maxCents: 20_000, // teto de um lance (R$ 200), so para barrar erro de digitacao
  freeMinutes: 10,
  freeEvery: 3, // depois de N turnos pagos, 1 turno gratis (0 = gratis so quando nao ha pagantes)
  freeCooldownMin: 60, // tempo minimo entre dois turnos gratis da mesma conta
  freeMaxQueue: 20,
};

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true }); // primeira execucao: a pasta data/ ainda nao existe
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      nick_key TEXT NOT NULL UNIQUE,
      pw_salt BLOB NOT NULL,
      pw_hash BLOB NOT NULL,
      adult_confirmed_at INTEGER NOT NULL,
      controls TEXT,
      created_at INTEGER NOT NULL,
      email_verified_at INTEGER           -- vazio ate a pessoa digitar o codigo enviado por e-mail
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      nickname TEXT NOT NULL,
      kind TEXT NOT NULL,              -- bid (lance novo) | raise (aumento de um lance na fila)
      entry_id INTEGER,                -- so no raise: qual entrada da fila sera aumentada
      minutes INTEGER NOT NULL,        -- minutos comprados (no raise: so os minutos a mais)
      amount_cents INTEGER NOT NULL,   -- valor do Pix (no raise: so a diferenca)
      status TEXT NOT NULL,            -- pending | paid | expired
      pix_code TEXT,
      pix_qr TEXT,
      provider_ref TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      paid_at INTEGER,
      refund_cents INTEGER NOT NULL DEFAULT 0,   -- pago mas sem efeito (aumento so de valor sobre turno que ja comecou): o dono devolve
      refunded_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE REFERENCES orders(id),   -- vazio na fila gratis
      user_id INTEGER NOT NULL,
      nickname TEXT NOT NULL,
      lane TEXT NOT NULL,              -- paid | free
      minutes INTEGER NOT NULL,
      cents INTEGER NOT NULL,          -- total pago ate agora (0 na fila gratis)
      state TEXT NOT NULL,             -- waiting | active | done | cancelled
      bid_at INTEGER NOT NULL,         -- ultimo lance (desempata: quem deu primeiro fica na frente)
      started_at INTEGER,
      ends_at INTEGER,
      ended_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_entries_state ON entries(state, lane);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS throttle (          -- tentativas erradas e bloqueios (sobrevive a reinicio do servidor)
      key TEXT PRIMARY KEY,
      fails INTEGER NOT NULL,
      window_start INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS verify_codes (      -- codigo de 6 digitos para confirmar o e-mail do cadastro (mesma forma do reset_codes)
      email TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reset_codes (       -- codigo de 6 digitos enviado por e-mail para trocar a senha
      email TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,                     -- so o hash; o codigo em si nunca fica no banco
      salt TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  // Bancos criados antes destas colunas: acrescenta sem perder nada. Contas antigas contam como e-mail ja confirmado.
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (!cols('users').includes('email_verified_at')) {
    db.exec('ALTER TABLE users ADD COLUMN email_verified_at INTEGER');
    db.exec('UPDATE users SET email_verified_at = created_at');
  }
  if (!cols('orders').includes('refund_cents')) {
    db.exec('ALTER TABLE orders ADD COLUMN refund_cents INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE orders ADD COLUMN refunded_at INTEGER');
  }
  return db;
}

// a/b > c/d  <=>  a*d > c*b  (sem divisao, sem arredondar)
const rateGreater = (c1, m1, c2, m2) => c1 * m2 > c2 * m1;

/**
 * Regras da lan house (leilao):
 * - Um PS5, um jogador por vez. Um lance NUNCA interrompe quem ja esta jogando.
 * - Quem espera e ordenado pelo preco por minuto (maior primeiro); empate: quem deu o lance antes.
 * - Fila gratis separada, com turnos curtos: depois de `freeEvery` turnos pagos entra 1 turno gratis.
 * - O relogio so corre com o console online; o tempo comprado nao e perdido se o PC do PS5 cair.
 */
export class LanHouse {
  constructor(db, { rules = {}, now = () => Date.now(), pixExpiresMin = 15 } = {}) {
    this.db = db;
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.now = now;
    this.pixExpiresMs = pixExpiresMin * 60_000;
    this.consoleOnline = false;
    this.paused = false;
  }

  // ---------- regras de lance ----------
  validateBid({ minutes, cents }) {
    const r = this.rules;
    if (!Number.isInteger(minutes) || minutes < r.minMinutes || minutes > r.maxMinutes || minutes % r.stepMinutes !== 0) {
      throw new LanHouseError('bad_bid', 'bid_minutes_range', 400, { min: r.minMinutes, max: r.maxMinutes, step: r.stepMinutes });
    }
    if (!Number.isInteger(cents) || cents <= 0 || cents % 100 !== 0) {
      throw new LanHouseError('bad_bid', 'bid_whole_reais');
    }
    if (cents > r.maxCents) {
      throw new LanHouseError('bad_bid', 'bid_max', 400, { cents: r.maxCents });
    }
    if (cents < r.minCentsPerMinute * minutes) {
      throw new LanHouseError('bad_bid', 'bid_below_min', 400, { minutes, cents: r.minCentsPerMinute * minutes });
    }
  }

  // ---------- ordem da fila ----------
  waitingPaid() {
    return this.db
      .prepare("SELECT * FROM entries WHERE state = 'waiting' AND lane = 'paid'")
      .all()
      .sort((a, b) => (rateGreater(b.cents, b.minutes, a.cents, a.minutes) ? 1 : rateGreater(a.cents, a.minutes, b.cents, b.minutes) ? -1 : a.bid_at - b.bid_at || a.id - b.id));
  }

  waitingFree() {
    return this.db.prepare("SELECT * FROM entries WHERE state = 'waiting' AND lane = 'free' ORDER BY bid_at, id").all();
  }

  paidSinceFree() {
    return Number(this.db.prepare("SELECT value FROM meta WHERE key = 'paid_since_free'").get()?.value ?? 0);
  }

  setPaidSinceFree(n) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('paid_since_free', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(n));
  }

  /** Ordem prevista dos proximos turnos, ja com a rotacao da fila gratis. A primeira e quem entra quando o console liberar. */
  upcoming(paid = this.waitingPaid(), free = this.waitingFree()) {
    const out = [];
    const p = [...paid];
    const f = [...free];
    let counter = this.paidSinceFree();
    const every = this.rules.freeEvery;
    while (p.length || f.length) {
      const takeFree = f.length && (!p.length || (every > 0 && counter >= every));
      if (takeFree) {
        out.push(f.shift());
        counter = 0;
      } else {
        out.push(p.shift());
        counter += 1;
      }
    }
    return out;
  }

  /** Onde ficaria um lance (sem criar nada). `replaceEntryId` simula o aumento de um lance que ja esta na fila. */
  previewBid({ minutes, cents, replaceEntryId }) {
    this.validateBid({ minutes, cents });
    const paid = this.waitingPaid().filter((e) => e.id !== replaceEntryId);
    const ghost = { id: -1, nickname: '', minutes, cents, lane: 'paid', bid_at: this.now() };
    const sorted = [...paid, ghost].sort((a, b) => (rateGreater(b.cents, b.minutes, a.cents, a.minutes) ? 1 : rateGreater(a.cents, a.minutes, b.cents, b.minutes) ? -1 : a.bid_at - b.bid_at || a.id - b.id));
    const order = this.upcoming(sorted, this.waitingFree());
    const position = order.findIndex((e) => e.id === -1) + 1;
    const top = paid[0];
    // menor valor inteiro em reais que passa o 1o pagante para esta quantidade de minutos
    let toBeFirst = null;
    if (top) {
      const need = Math.floor((top.cents * minutes) / top.minutes) + 1;
      toBeFirst = Math.ceil(need / 100) * 100;
    }
    return { position, centsPerMinute: cents / minutes, toBeFirstCents: toBeFirst };
  }

  // ---------- pedidos (Pix) ----------
  openEntriesOf(userId, lane) {
    return Number(
      this.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE user_id = ? AND lane = ? AND state IN ('waiting','active')").get(userId, lane).n,
    );
  }

  insertOrder(o) {
    this.db.prepare("UPDATE orders SET status = 'expired' WHERE user_id = ? AND status = 'pending'").run(o.user_id);
    this.db
      .prepare(
        `INSERT INTO orders (id, user_id, nickname, kind, entry_id, minutes, amount_cents, status, created_at, expires_at)
         VALUES (@id, @user_id, @nickname, @kind, @entry_id, @minutes, @amount_cents, 'pending', @created_at, @expires_at)`,
      )
      .run(o);
    return this.getOrder(o.id);
  }

  /** Novo lance: o Pix e do valor total do lance. */
  createBidOrder({ userId, nickname, minutes, cents }) {
    const nick = validNickname(nickname);
    if (!nick) throw new LanHouseError('bad_nickname', 'nickname_invalid');
    this.validateBid({ minutes, cents });
    if (this.openEntriesOf(userId, 'paid') >= MAX_ACTIVE_ENTRIES_PER_USER) {
      throw new LanHouseError('too_many', 'too_many_bids', 409, { max: MAX_ACTIVE_ENTRIES_PER_USER });
    }
    const t = this.now();
    return this.insertOrder({
      id: randomUUID(), user_id: userId, nickname: nick, kind: 'bid', entry_id: null,
      minutes, amount_cents: cents, created_at: t, expires_at: t + this.pixExpiresMs,
    });
  }

  /** Aumentar um lance que esta esperando: informe os NOVOS totais; o Pix e so a diferenca. */
  createRaiseOrder({ userId, entryId, minutes, cents }) {
    const e = this.db.prepare("SELECT * FROM entries WHERE id = ? AND user_id = ? AND lane = 'paid' AND state = 'waiting'").get(entryId, userId);
    if (!e) throw new LanHouseError('not_found', 'bid_not_waiting', 404);
    this.validateBid({ minutes, cents });
    if (minutes < e.minutes || cents < e.cents || (minutes === e.minutes && cents === e.cents)) {
      throw new LanHouseError('bad_bid', 'bid_raise_higher');
    }
    const t = this.now();
    return this.insertOrder({
      id: randomUUID(), user_id: userId, nickname: e.nickname, kind: 'raise', entry_id: e.id,
      minutes: minutes - e.minutes, amount_cents: cents - e.cents, created_at: t, expires_at: t + this.pixExpiresMs,
    });
  }

  attachPix(orderId, { code, qr, providerRef }) {
    this.db.prepare('UPDATE orders SET pix_code = ?, pix_qr = ?, provider_ref = ? WHERE id = ?').run(code ?? null, qr ?? null, providerRef ?? null, orderId);
  }

  getOrder(id) {
    return this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  }

  findOrderByProviderRef(ref) {
    return this.db.prepare('SELECT * FROM orders WHERE provider_ref = ?').get(String(ref));
  }

  /** Idempotente: pagar duas vezes (webhook repetido) nao cria duas entradas nem soma duas vezes. */
  markPaid(orderId, { amountCents } = {}) {
    const order = this.getOrder(orderId);
    if (!order) throw new LanHouseError('not_found', 'order_not_found', 404);
    if (amountCents !== undefined && amountCents !== order.amount_cents) {
      throw new LanHouseError('amount_mismatch', 'amount_mismatch', 409);
    }
    if (order.status === 'paid') return { order, created: false };
    const t = this.now();
    // Pix confirmado depois do prazo ainda vale: o dinheiro entrou, entao o lance e entregue.
    this.db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?").run(t, orderId);

    const waiting = order.kind === 'raise' ? this.db.prepare("SELECT * FROM entries WHERE id = ? AND state = 'waiting'").get(order.entry_id) : null;
    const insertEntry = this.db.prepare(
      `INSERT INTO entries (order_id, user_id, nickname, lane, minutes, cents, state, bid_at)
       VALUES (?, ?, ?, 'paid', ?, ?, 'waiting', ?)`,
    );
    if (waiting) {
      // Aumento: soma ao lance e reposiciona (bid_at novo: quem empata e chegou antes continua na frente).
      // Um turno nunca passa do maximo de minutos: se (por dois Pix de aumento pagos) passaria, o excesso vira outro lance.
      const room = Math.max(0, this.rules.maxMinutes - waiting.minutes);
      const fits = Math.min(order.minutes, room);
      const excess = order.minutes - fits;
      const excessCents = excess > 0 ? Math.round((order.amount_cents * excess) / order.minutes) : 0;
      this.db
        .prepare('UPDATE entries SET minutes = minutes + ?, cents = cents + ?, bid_at = ? WHERE id = ?')
        .run(fits, order.amount_cents - excessCents, t, waiting.id);
      if (excess > 0) insertEntry.run(order.id, order.user_id, order.nickname, excess, excessCents, t);
    } else if (order.kind === 'bid' || order.minutes > 0) {
      // Lance novo; ou aumento de uma entrada que ja comecou: o que foi pago vira um lance novo.
      insertEntry.run(order.id, order.user_id, order.nickname, order.minutes, order.amount_cents, t);
    }
    if (order.kind === 'raise' && !waiting && order.minutes === 0) {
      // Aumento so de valor sobre um lance que ja comecou (ou saiu da fila) antes do Pix cair: o valor nao compra nada.
      // Fica marcado para o dono devolver; a posicao de ninguem muda.
      this.db.prepare('UPDATE orders SET refund_cents = ? WHERE id = ?').run(order.amount_cents, orderId);
    }
    this.tick();
    return { order: this.getOrder(orderId), created: true };
  }

  // ---------- fila gratis ----------
  joinFree({ userId, nickname }) {
    const nick = validNickname(nickname);
    if (!nick) throw new LanHouseError('bad_nickname', 'nickname_invalid');
    const r = this.rules;
    if (this.openEntriesOf(userId, 'free') > 0) throw new LanHouseError('already_free', 'already_free', 409);
    const t = this.now();
    const last = this.db.prepare("SELECT started_at FROM entries WHERE user_id = ? AND lane = 'free' AND started_at IS NOT NULL ORDER BY started_at DESC LIMIT 1").get(userId);
    if (last && t - last.started_at < r.freeCooldownMin * 60_000) {
      const wait = Math.ceil((r.freeCooldownMin * 60_000 - (t - last.started_at)) / 60_000);
      throw new LanHouseError('free_cooldown', 'free_cooldown', 429, { wait });
    }
    if (this.waitingFree().length >= r.freeMaxQueue) throw new LanHouseError('free_full', 'free_full', 409);
    this.db
      .prepare(`INSERT INTO entries (order_id, user_id, nickname, lane, minutes, cents, state, bid_at) VALUES (NULL, ?, ?, 'free', ?, 0, 'waiting', ?)`)
      .run(userId, nick, r.freeMinutes, t);
    this.tick();
  }

  leaveFree(userId) {
    return this.db.prepare("UPDATE entries SET state = 'cancelled', ended_reason = 'left' WHERE user_id = ? AND lane = 'free' AND state = 'waiting'").run(userId).changes > 0;
  }

  // ---------- turnos ----------
  active() {
    return this.db.prepare("SELECT * FROM entries WHERE state = 'active'").get();
  }

  lastTick() {
    const v = this.db.prepare("SELECT value FROM meta WHERE key = 'last_tick'").get();
    return v ? Number(v.value) : null;
  }

  stampTick(t) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('last_tick', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(t));
  }

  /**
   * O relogio do jogador so corre com o console online. Enquanto o console esta offline no meio de um turno,
   * devolvemos o tempo (empurramos o fim do turno). Isso tambem cobre o servidor ter ficado desligado.
   */
  creditOffline(t) {
    const act = this.active();
    if (!act) return false;
    const last = this.lastTick();
    let credited = false;
    if (!this.consoleOnline && last !== null && t > last) {
      this.db.prepare('UPDATE entries SET ends_at = ends_at + ? WHERE id = ?').run(t - last, act.id);
      credited = true;
    }
    this.stampTick(t);
    return credited;
  }

  /** Avanca o relogio: expira pedidos Pix, encerra turno vencido e promove o proximo. */
  tick() {
    const t = this.now();
    let changed = false;
    if (this.db.prepare("UPDATE orders SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?").run(t).changes) changed = true;

    if (this.creditOffline(t)) changed = true;
    const act = this.active();
    if (act && act.ends_at <= t) {
      this.finish(act.id, 'time_up');
      changed = true;
    }
    if (!this.active() && this.consoleOnline && !this.paused) {
      const next = this.upcoming()[0];
      if (next) {
        this.db.prepare("UPDATE entries SET state = 'active', started_at = ?, ends_at = ? WHERE id = ?").run(t, t + next.minutes * 60_000, next.id);
        this.setPaidSinceFree(next.lane === 'free' ? 0 : this.paidSinceFree() + 1);
        this.stampTick(t);
        changed = true;
      }
    }
    return changed;
  }

  finish(entryId, reason) {
    this.db
      .prepare("UPDATE entries SET state = 'done', ended_reason = ?, ends_at = MIN(COALESCE(ends_at, ?), ?) WHERE id = ?")
      .run(reason, this.now(), this.now(), entryId);
  }

  endActive(reason = 'admin') {
    const act = this.active();
    if (!act) return false;
    this.finish(act.id, reason);
    this.tick();
    return true;
  }

  /** Admin: tira alguem da fila (ex.: apelido ofensivo). Sem reembolso automatico. */
  cancelEntry(entryId) {
    return this.db.prepare("UPDATE entries SET state = 'cancelled', ended_reason = 'admin' WHERE id = ? AND state = 'waiting'").run(entryId).changes > 0;
  }

  setConsoleOnline(online) {
    const was = this.consoleOnline;
    const t = this.now();
    if (was && !online) {
      this.creditOffline(t); // carimba o instante em que o console caiu (ainda "online" aqui)
    } else if (!was && online) {
      this.creditOffline(t); // credita o tempo todo em que ficou fora
    }
    this.consoleOnline = Boolean(online);
    if (this.consoleOnline && !was) this.tick();
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    if (!this.paused) this.tick();
  }

  // ---------- visoes ----------
  /** Estado publico: lances sao visiveis (e o leilao), mas nunca ids de usuario/pedido, e-mails ou codigos Pix. */
  publicState() {
    const t = this.now();
    const act = this.active();
    const order = this.upcoming();
    const paid = this.waitingPaid();
    return {
      now: t,
      console: this.paused ? 'paused' : this.consoleOnline ? (act ? 'busy' : 'free') : 'offline',
      current: act
        ? { nickname: act.nickname, minutes: act.minutes, cents: act.cents, lane: act.lane, startedAt: act.started_at, endsAt: act.ends_at, remainingMs: Math.max(0, act.ends_at - t), clockPaused: !this.consoleOnline }
        : null,
      queueLength: order.length,
      freeLength: order.filter((e) => e.lane === 'free').length,
      queue: order.slice(0, 10).map((e, i) => ({ position: i + 1, nickname: e.nickname, minutes: e.minutes, cents: e.cents, lane: e.lane })),
      topBid: paid[0] ? { cents: paid[0].cents, minutes: paid[0].minutes } : null,
    };
  }

  /** O que a pessoa logada tem: ficha na fila/jogando, Pix pendente e se pode entrar na fila gratis. */
  ticketForUser(userId) {
    const t = this.now();
    const mine = this.db.prepare("SELECT * FROM entries WHERE user_id = ? AND state IN ('active','waiting')").all(userId);
    const order = this.upcoming();
    const act = this.active();
    const toTicket = (e) => {
      if (e.state === 'active') {
        return { entryId: e.id, phase: 'active', lane: e.lane, nickname: e.nickname, minutes: e.minutes, cents: e.cents, endsAt: e.ends_at, remainingMs: Math.max(0, e.ends_at - t) };
      }
      const idx = order.findIndex((x) => x.id === e.id);
      const waitMs = (act ? Math.max(0, act.ends_at - t) : 0) + order.slice(0, idx).reduce((s, x) => s + x.minutes * 60_000, 0);
      return { entryId: e.id, phase: 'waiting', lane: e.lane, nickname: e.nickname, minutes: e.minutes, cents: e.cents, position: idx + 1, estimatedWaitMs: waitMs };
    };
    const sorted = mine.sort((a, b) => (a.state === 'active' ? -1 : b.state === 'active' ? 1 : order.findIndex((x) => x.id === a.id) - order.findIndex((x) => x.id === b.id)));
    const tickets = sorted.map(toTicket);
    const p = this.db
      .prepare("SELECT * FROM orders WHERE user_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
      .get(userId, t);
    const pending = p
      ? { orderId: p.id, kind: p.kind, minutes: p.minutes, amountCents: p.amount_cents, expiresAt: p.expires_at, pixCode: p.pix_code, pixQr: p.pix_qr }
      : null;
    const last = this.db.prepare("SELECT started_at FROM entries WHERE user_id = ? AND lane = 'free' AND started_at IS NOT NULL ORDER BY started_at DESC LIMIT 1").get(userId);
    const cooldownMs = last ? Math.max(0, this.rules.freeCooldownMin * 60_000 - (t - last.started_at)) : 0;
    return {
      tickets,
      ticket: tickets[0] ?? null,
      raisable: tickets.find((x) => x.phase === 'waiting' && x.lane === 'paid') ?? null,
      pending,
      free: { inQueue: mine.some((e) => e.lane === 'free'), cooldownMs },
    };
  }

  ordersForUser(userId, limit = 10) {
    return this.db
      .prepare('SELECT kind, minutes, amount_cents, status, created_at, paid_at, refund_cents, refunded_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit);
  }

  /** Esta pessoa e o jogador da vez? Usado pelo canal de controle (etapa 2). */
  isActiveUser(userId) {
    const act = this.active();
    return Boolean(act && act.user_id === userId);
  }

  /** O dono avisa que ja devolveu o valor de um pedido marcado para devolucao. */
  markRefunded(orderId) {
    return this.db.prepare('UPDATE orders SET refunded_at = ? WHERE id = ? AND refund_cents > 0 AND refunded_at IS NULL').run(this.now(), orderId).changes > 0;
  }

  adminOverview() {
    const sum = this.db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS cents FROM orders WHERE status = 'paid'").get();
    const recent = this.db
      .prepare("SELECT nickname, kind, minutes, amount_cents, paid_at FROM orders WHERE status = 'paid' ORDER BY paid_at DESC LIMIT 20")
      .all();
    const queue = this.upcoming().map((e, i) => ({ id: e.id, position: i + 1, nickname: e.nickname, minutes: e.minutes, cents: e.cents, lane: e.lane }));
    const refunds = this.db
      .prepare('SELECT id, nickname, refund_cents, paid_at FROM orders WHERE refund_cents > 0 AND refunded_at IS NULL ORDER BY paid_at')
      .all();
    return { ...this.publicState(), paid: { orders: Number(sum.n), cents: Number(sum.cents) }, recent, adminQueue: queue, refundsDue: refunds };
  }
}
