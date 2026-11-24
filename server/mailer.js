// Envio de e-mail. Dois modos (MAIL_PROVIDER):
//   console  -> NAO envia: imprime a mensagem no log do servidor (para desenvolver e testar)
//   smtp     -> envia de verdade por SMTP (precisa de SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM)
import nodemailer from 'nodemailer';
import { msg } from './messages.js';

export function createMailer(config, { log = console.log, transport } = {}) {
  if (config.mailProvider === 'smtp') {
    const t =
      transport ??
      nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      });
    return {
      name: 'smtp',
      async send({ to, subject, text }) {
        await t.sendMail({ from: config.mailFrom, to, subject, text });
      },
    };
  }
  return {
    name: 'console',
    async send({ to, subject, text }) {
      log(`[e-mail SIMULADO, nada foi enviado]\n  para: ${to}\n  assunto: ${subject}\n  ${text.replace(/\n/g, '\n  ')}`);
    },
  };
}

export function resetEmail(code, minutes, lang = 'pt') {
  return { subject: msg(lang, 'email_reset_subject'), text: msg(lang, 'email_reset_text', { code, minutes }) };
}

export function verifyEmailMessage(code, minutes, lang = 'pt') {
  return { subject: msg(lang, 'email_verify_subject'), text: msg(lang, 'email_verify_text', { code, minutes }) };
}
