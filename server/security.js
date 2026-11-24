import { LanHouseError } from './lanhouse.js';

/**
 * Contador de tentativas erradas com bloqueio, guardado no banco (nao some se o servidor reiniciar).
 *   check(key)  -> lanca 429 se a chave esta bloqueada
 *   fail(key, regras) -> conta uma falha; ao chegar em `max` dentro da janela, bloqueia por `lockMs`
 *   clear(key)  -> zera (ex.: login certo)
 */
export class Throttle {
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
  }

  get(key) {
    return this.db.prepare('SELECT * FROM throttle WHERE key = ?').get(key);
  }

  lockedMs(key) {
    const r = this.get(key);
    return r && r.locked_until > this.now() ? r.locked_until - this.now() : 0;
  }

  /** `reasonKey` e uma chave de server/messages.js que explica o bloqueio. */
  check(key, reasonKey) {
    const ms = this.lockedMs(key);
    if (ms > 0) {
      const min = Math.max(1, Math.ceil(ms / 60_000));
      throw new LanHouseError('locked', 'locked', 429, { reason: reasonKey ?? 'too_many_tries', min });
    }
  }

  /** Devolve { locked, remaining, fails }. */
  fail(key, { max, windowMs, lockMs }) {
    const t = this.now();
    const r = this.get(key);
    let fails = 1;
    let start = t;
    if (r && t - r.window_start < windowMs && !(r.locked_until && r.locked_until <= t)) {
      fails = r.fails + 1;
      start = r.window_start;
    }
    const locked = fails >= max;
    this.db
      .prepare(
        `INSERT INTO throttle (key, fails, window_start, locked_until) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start, locked_until = excluded.locked_until`,
      )
      .run(key, locked ? 0 : fails, start, locked ? t + lockMs : 0);
    return { locked, remaining: Math.max(0, max - fails), fails };
  }

  clear(key) {
    this.db.prepare('DELETE FROM throttle WHERE key = ?').run(key);
  }

  /** Limpa linhas velhas (chamar de vez em quando). */
  sweep(olderThanMs = 24 * 3600_000) {
    this.db.prepare('DELETE FROM throttle WHERE locked_until < ? AND window_start < ?').run(this.now(), this.now() - olderThanMs);
  }
}
