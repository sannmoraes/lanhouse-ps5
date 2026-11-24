import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Leitor minimo de .env (sem dependencias).
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnvFile(path.join(ROOT, '.env'));

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  pixProvider: env.PIX_PROVIDER ?? 'mock',
  mercadoPagoToken: env.MERCADOPAGO_ACCESS_TOKEN ?? '',
  publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').replace(/\/$/, ''),
  adminPassword: env.ADMIN_PASSWORD ?? '',
  hostSecret: env.HOST_SECRET ?? '',
  pixExpiresMin: Number(env.PIX_EXPIRES_MIN ?? 15),
  // true quando o site roda em HTTPS (cookie de sessao so viaja por HTTPS).
  cookieSecure: env.COOKIE_SECURE === 'true',
  // Cadastro so vale depois de digitar o codigo enviado ao e-mail. Desligue (false) so em testes locais.
  // Link para o codigo-fonte desta versao do site (a AGPL pede isso de quem modifica e poe no ar). So https.
  sourceUrl: /^https:\/\//.test(env.SOURCE_URL ?? '') ? env.SOURCE_URL : '',
  operatorName: env.OPERATOR_NAME ?? '',
  contactEmail: env.CONTACT_EMAIL ?? '',
  registerPerHour: Number(env.REGISTER_PER_HOUR ?? 10), // contas novas por hora por IP (sobe em testes)
  requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION !== 'false',
  // E-mail (recuperar senha). console = nao envia, so imprime no log; smtp = envia de verdade.
  mailProvider: env.MAIL_PROVIDER === 'smtp' ? 'smtp' : 'console',
  mailFrom: env.MAIL_FROM ?? 'Lan House PS5 <nao-responder@localhost>',
  smtp: {
    host: env.SMTP_HOST ?? '',
    port: Number(env.SMTP_PORT ?? 587),
    secure: env.SMTP_SECURE === 'true', // true = porta 465 (TLS direto); false = 587 com STARTTLS
    user: env.SMTP_USER ?? '',
    pass: env.SMTP_PASS ?? '',
  },
  // Video por WebRTC (WHEP), ex.: http://localhost:8889/ps5/whep (MediaMTX). Tem prioridade sobre STREAM_EMBED_URL.
  whepUrl: /^https?:\/\//.test(env.WHEP_URL ?? '') ? env.WHEP_URL : '',
  stunUrl: env.STUN_URL ?? 'stun:stun.l.google.com:19302',
  // Transmissao ao vivo para quem assiste (URL de "embed" https da Kick, Twitch, YouTube...). Vazio = sem video.
  streamUrl: /^https:\/\//.test(env.STREAM_EMBED_URL ?? '') ? env.STREAM_EMBED_URL : '',
  dbFile: env.DB_FILE ?? path.join(ROOT, 'data', 'lanhouse.db'),
  publicDir: path.join(ROOT, 'public'),
};

// Regras do leilao e da fila gratis. Valores em reais viram centavos aqui; ajuste pelo .env.
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
export const RULES = {
  minMinutes: num(env.BID_MIN_MINUTES, 5),
  maxMinutes: num(env.BID_MAX_MINUTES, 60),
  stepMinutes: num(env.BID_STEP_MINUTES, 5),
  minCentsPerMinute: Math.round(num(env.BID_MIN_REAIS_PER_MINUTE, 1) * 100),
  maxCents: Math.round(num(env.BID_MAX_REAIS, 200) * 100),
  freeMinutes: num(env.FREE_MINUTES, 10),
  freeEvery: num(env.FREE_EVERY, 3),
  freeCooldownMin: num(env.FREE_COOLDOWN_MIN, 60),
  freeMaxQueue: num(env.FREE_MAX_QUEUE, 20),
};

export function assertProductionConfig() {
  const problems = [];
  if (config.pixProvider === 'mercadopago') {
    if (!config.mercadoPagoToken) problems.push('MERCADOPAGO_ACCESS_TOKEN vazio');
    if (!config.publicBaseUrl) problems.push('PUBLIC_BASE_URL vazio (o Mercado Pago nao conseguira avisar os pagamentos)');
  }
  if (config.mailProvider === 'smtp' && (!config.smtp.host || !config.mailFrom)) problems.push('MAIL_PROVIDER=smtp pede SMTP_HOST e MAIL_FROM');
  if (!config.adminPassword || config.adminPassword.startsWith('troque')) problems.push('ADMIN_PASSWORD nao definida');
  if (!config.hostSecret || config.hostSecret.startsWith('troque')) problems.push('HOST_SECRET nao definido');
  if (config.requireEmailVerification && config.mailProvider === 'console') problems.push('MAIL_PROVIDER=console: ninguem recebe o codigo de confirmar e-mail (ele so aparece no log). Configure o SMTP; REQUIRE_EMAIL_VERIFICATION=false so serve para teste local');
  if (!config.operatorName || !config.contactEmail) problems.push('OPERATOR_NAME e CONTACT_EMAIL vazios (as paginas de termos e privacidade ficam sem dono)');
  return problems;
}
