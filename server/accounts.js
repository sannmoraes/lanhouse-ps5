import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { LanHouseError, validNickname } from './lanhouse.js';

const scryptAsync = promisify(scrypt);
const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MIN = 15;
export const VERIFY_TTL_MIN = 15;
const UNVERIFIED_KEEP_MS = 2 * 60 * 60_000; // conta que nunca confirmou o e-mail some depois de 2 horas (libera e-mail e apelido)
const RESET_MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// Botoes do console que o jogador pode mapear. Teclado usa KeyboardEvent.code; controle usa o indice do Gamepad API.
export const ACTIONS = [
  'up', 'down', 'left', 'right',
  'cross', 'circle', 'square', 'triangle',
  'l1', 'r1', 'l2', 'r2', 'l3', 'r3',
  'start', 'select',
];

export const DEFAULT_CONTROLS = {
  // 'dpad': as setas/WASD apertam o direcional; 'stick': controlam o analogico esquerdo (melhor para jogos 3D).
  mode: 'dpad',
  keyboard: {
    up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
    cross: 'KeyK', circle: 'KeyL', square: 'KeyJ', triangle: 'KeyI',
    l1: 'KeyQ', r1: 'KeyE', l2: 'KeyZ', r2: 'KeyC', l3: 'KeyF', r3: 'KeyG',
    start: 'Enter', select: 'Backspace',
  },
  // Indices do mapeamento "standard" do Gamepad API.
  pad: {
    up: 12, down: 13, left: 14, right: 15,
    cross: 0, circle: 1, square: 2, triangle: 3,
    l1: 4, r1: 5, l2: 6, r2: 7, l3: 10, r3: 11,
    start: 9, select: 8,
  },
};

export function validateControls(input) {
  if (!input || typeof input !== 'object') throw new LanHouseError('bad_controls', 'controls_invalid');
  const out = { mode: input.mode === 'stick' ? 'stick' : 'dpad', keyboard: {}, pad: {} };
  for (const a of ACTIONS) {
    const k = input.keyboard?.[a];
    if (typeof k !== 'string' || !/^[A-Za-z0-9]{1,20}$/.test(k)) {
      throw new LanHouseError('bad_controls', 'controls_bad_key', 400, { action: a });
    }
    out.keyboard[a] = k;
    const p = input.pad?.[a];
    if (!Number.isInteger(p) || p < 0 || p > 31) {
      throw new LanHouseError('bad_controls', 'controls_bad_button', 400, { action: a });
    }
    out.pad[a] = p;
  }
  const keys = Object.values(out.keyboard);
  if (new Set(keys).size !== keys.length) {
    throw new LanHouseError('bad_controls', 'controls_dup_key');
  }
  return out;
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

async function hashPassword(password, salt = randomBytes(16)) {
  const hash = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  return { salt, hash };
}

function checkPasswordRules(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new LanHouseError('bad_password', 'password_length');
  }
}

export class Accounts {
  constructor(db, { now = () => Date.now(), requireVerification = false } = {}) {
    this.db = db;
    this.now = now;
    this.requireVerification = requireVerification; // true: so entra depois de confirmar o e-mail por codigo
    // Usado para gastar o mesmo tempo quando o e-mail nao existe (evita descobrir e-mails pelo tempo de resposta).
    this.dummy = hashPassword('senha-falsa-para-igualar-tempo', Buffer.alloc(16));
  }

  publicUser(u) {
    return { id: u.id, email: u.email, nickname: u.nickname, createdAt: u.created_at };
  }

  async register({ email, emailConfirm, nickname, password, adult }) {
    const mail = String(email ?? '').trim().toLowerCase();
    if (mail.length > 254 || !EMAIL_RE.test(mail)) throw new LanHouseError('bad_email', 'email_invalid');
    if (emailConfirm !== undefined && String(emailConfirm).trim().toLowerCase() !== mail) {
      throw new LanHouseError('bad_email', 'email_mismatch');
    }
    const nick = validNickname(nickname);
    if (!nick) throw new LanHouseError('bad_nickname', 'nickname_rules');
    checkPasswordRules(password);
    if (adult !== true) throw new LanHouseError('adult_required', 'adult_required');

    const { salt, hash } = await hashPassword(password);
    if (this.requireVerification) this.#dropStaleUnverified(mail);
    try {
      const r = this.db
        .prepare(
          `INSERT INTO users (email, nickname, nick_key, pw_salt, pw_hash, adult_confirmed_at, created_at, email_verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(mail, nick, nick.toLowerCase(), salt, hash, this.now(), this.now(), this.requireVerification ? null : this.now());
      return this.userById(Number(r.lastInsertRowid));
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) {
        // Mesma mensagem para e-mail ou apelido repetidos nao e possivel (o apelido e publico); so o e-mail fica generico.
        const nickTaken = this.db.prepare('SELECT 1 FROM users WHERE nick_key = ?').get(nick.toLowerCase());
        if (nickTaken) throw new LanHouseError('nick_taken', 'nick_taken', 409);
        throw new LanHouseError('email_taken', 'account_create_failed', 409);
      }
      throw e;
    }
  }

  userById(id) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  async login({ email, password }) {
    const mail = String(email ?? '').trim().toLowerCase();
    const user = this.db.prepare('SELECT * FROM users WHERE email = ?').get(mail);
    const pw = typeof password === 'string' ? password : '';
    let ok = false;
    if (user) {
      const { hash } = await hashPassword(pw, user.pw_salt);
      ok = hash.length === user.pw_hash.length && timingSafeEqual(hash, user.pw_hash);
    } else {
      await hashPassword(pw, Buffer.alloc(16));
    }
    if (!ok) throw new LanHouseError('bad_login', 'login_wrong', 401);
    // Senha certa mas e-mail nunca confirmado: so avisa depois de acertar a senha (nao revela quem tem conta).
    if (this.requireVerification && !user.email_verified_at) {
      throw new LanHouseError('email_unverified', 'email_unverified', 403);
    }
    return { user, token: this.createSession(user.id) };
  }

  createSession(userId) {
    const token = randomBytes(32).toString('base64url');
    const t = this.now();
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha(token), userId, t, t + SESSION_TTL_MS);
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(t);
    return token;
  }

  userFromToken(token) {
    if (!token) return null;
    const s = this.db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha(token));
    if (!s || s.expires_at <= this.now()) return null;
    return this.userById(s.user_id) ?? null;
  }

  logout(token) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
  }

  updateNickname(userId, nickname) {
    const nick = validNickname(nickname);
    if (!nick) throw new LanHouseError('bad_nickname', 'nickname_rules');
    try {
      this.db.prepare('UPDATE users SET nickname = ?, nick_key = ? WHERE id = ?').run(nick, nick.toLowerCase(), userId);
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) throw new LanHouseError('nick_taken', 'nick_taken', 409);
      throw e;
    }
    return this.userById(userId);
  }

  /** Troca a senha e encerra todas as outras sessoes (mantem a atual). */
  async changePassword(userId, current, next, keepToken) {
    const user = this.userById(userId);
    const { hash } = await hashPassword(String(current ?? ''), user.pw_salt);
    if (!(hash.length === user.pw_hash.length && timingSafeEqual(hash, user.pw_hash))) {
      throw new LanHouseError('bad_login', 'password_current_wrong', 401);
    }
    checkPasswordRules(next);
    const fresh = await hashPassword(next);
    this.db.prepare('UPDATE users SET pw_salt = ?, pw_hash = ? WHERE id = ?').run(fresh.salt, fresh.hash, userId);
    this.db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
      .run(userId, keepToken ? sha(keepToken) : '');
  }


  // ---------- codigos de 6 digitos por e-mail (recuperar senha e confirmar cadastro) ----------
  // `table` vem sempre de uma constante interna: reset_codes ou verify_codes.
  #issueCode(table, mail, ttlMin) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const salt = randomBytes(8).toString('hex');
    const t = this.now();
    this.db
      .prepare(
        `INSERT INTO ${table} (email, code_hash, salt, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, salt = excluded.salt, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
      )
      .run(mail, sha(`${salt}:${code}`), salt, t + ttlMin * 60_000, t);
    return code;
  }

  /** true se o codigo confere. Errar 5 vezes (ou vencer o prazo) destroi o codigo. O codigo certo so e apagado por quem o usa. */
  #codeMatches(table, mail, code) {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE email = ?`).get(mail);
    if (!row || row.expires_at <= this.now()) {
      if (row) this.db.prepare(`DELETE FROM ${table} WHERE email = ?`).run(mail);
      return false;
    }
    const given = sha(`${row.salt}:${String(code ?? '').trim()}`);
    const same = given.length === row.code_hash.length && timingSafeEqual(Buffer.from(given), Buffer.from(row.code_hash));
    if (same) return true;
    if (row.attempts + 1 >= RESET_MAX_ATTEMPTS) this.db.prepare(`DELETE FROM ${table} WHERE email = ?`).run(mail);
    else this.db.prepare(`UPDATE ${table} SET attempts = attempts + 1 WHERE email = ?`).run(mail);
    return false;
  }

  // ---------- confirmar e-mail do cadastro ----------
  /** Apaga contas que nunca confirmaram (antigas, e a que esta sendo refeita com o mesmo e-mail). Elas nunca tiveram sessao nem compra. */
  purgeUnverified() {
    this.#dropStaleUnverified(null);
  }

  #dropStaleUnverified(mail) {
    const old = this.db
      .prepare('SELECT email FROM users WHERE email_verified_at IS NULL AND (created_at < ? OR email = ?)')
      .all(this.now() - UNVERIFIED_KEEP_MS, mail ?? '');
    for (const u of old) {
      this.db.prepare('DELETE FROM verify_codes WHERE email = ?').run(u.email);
      this.db.prepare('DELETE FROM users WHERE email = ? AND email_verified_at IS NULL').run(u.email);
    }
  }

  /** Gera o codigo de confirmacao. Devolve {email, code, minutes}, ou null se nao ha conta esperando confirmacao (sem avisar a ninguem). */
  issueVerification(email) {
    const mail = String(email ?? '').trim().toLowerCase();
    const user = this.db.prepare('SELECT id FROM users WHERE email = ? AND email_verified_at IS NULL').get(mail);
    if (!user) return null;
    return { email: mail, code: this.#issueCode('verify_codes', mail, VERIFY_TTL_MIN), minutes: VERIFY_TTL_MIN };
  }

  /** Confere o codigo, marca o e-mail como confirmado e ja entra na conta. Toda falha da a MESMA mensagem. */
  verifyEmail({ email, code }) {
    const mail = String(email ?? '').trim().toLowerCase();
    const user = this.db.prepare('SELECT * FROM users WHERE email = ? AND email_verified_at IS NULL').get(mail);
    if (!user || !this.#codeMatches('verify_codes', mail, code)) {
      throw new LanHouseError('bad_code', 'code_invalid', 400);
    }
    this.db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(this.now(), user.id);
    this.db.prepare('DELETE FROM verify_codes WHERE email = ?').run(mail);
    return { user: this.userById(user.id), token: this.createSession(user.id) };
  }

  // ---------- recuperar senha por codigo no e-mail ----------
  /** Gera um codigo de 6 digitos. Devolve {email, code} para o envio, ou null se o e-mail nao tem conta (sem avisar a ninguem). */
  requestReset(email) {
    const mail = String(email ?? '').trim().toLowerCase();
    const user = this.db.prepare('SELECT id FROM users WHERE email = ?').get(mail);
    if (!user) return null;
    return { email: mail, code: this.#issueCode('reset_codes', mail, RESET_TTL_MIN), minutes: RESET_TTL_MIN };
  }

  /**
   * Confere o codigo e troca a senha. Toda falha de codigo da a MESMA mensagem (nao revela se o e-mail existe).
   * Depois de 5 codigos errados o codigo e destruido e e preciso pedir outro.
   */
  async resetPassword({ email, code, password }) {
    const BAD = () => new LanHouseError('bad_code', 'code_invalid', 400);
    const mail = String(email ?? '').trim().toLowerCase();
    if (!this.#codeMatches('reset_codes', mail, code)) throw BAD();
    checkPasswordRules(password); // codigo certo, senha fraca: o codigo continua valido para a pessoa tentar de novo
    const user = this.db.prepare('SELECT id FROM users WHERE email = ?').get(mail);
    if (!user) throw BAD();
    const fresh = await hashPassword(password);
    // Receber o codigo no e-mail tambem prova que a pessoa e dona dele.
    this.db.prepare('UPDATE users SET pw_salt = ?, pw_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(fresh.salt, fresh.hash, this.now(), user.id);
    this.db.prepare('DELETE FROM reset_codes WHERE email = ?').run(mail);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id); // derruba todos os aparelhos
    return { id: user.id, email: mail };
  }

  getControls(userId) {
    const raw = this.userById(userId)?.controls;
    if (!raw) return DEFAULT_CONTROLS;
    try {
      return validateControls(JSON.parse(raw));
    } catch {
      return DEFAULT_CONTROLS;
    }
  }

  setControls(userId, controls) {
    const valid = validateControls(controls);
    this.db.prepare('UPDATE users SET controls = ? WHERE id = ?').run(JSON.stringify(valid), userId);
    return valid;
  }

  /** Apaga a conta. Pedidos pagos ficam (registro financeiro) mas deixam de ter conta ativa na fila. */
  async deleteAccount(userId, password) {
    const user = this.userById(userId);
    const { hash } = await hashPassword(String(password ?? ''), user.pw_salt);
    if (!(hash.length === user.pw_hash.length && timingSafeEqual(hash, user.pw_hash))) {
      throw new LanHouseError('bad_login', 'password_wrong', 401);
    }
    const busy = this.db
      .prepare("SELECT 1 FROM entries WHERE user_id = ? AND state IN ('waiting','active')")
      .get(userId);
    if (busy) throw new LanHouseError('has_tickets', 'has_tickets', 409);
    // Mantem as linhas de pedido para o financeiro, anonimizando o dono.
    this.db.exec('PRAGMA foreign_keys = OFF');
    try {
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      // Os registros financeiros ficam, mas sem o apelido da pessoa.
      this.db.prepare("UPDATE orders SET nickname = 'conta apagada' WHERE user_id = ?").run(userId);
      this.db.prepare("UPDATE entries SET nickname = 'conta apagada' WHERE user_id = ?").run(userId);
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON');
    }
  }
}
