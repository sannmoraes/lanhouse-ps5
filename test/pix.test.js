import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import jsQR from 'jsqr';
import { buildBrCode, checkBrCode, crc16, parseBrCode } from '../server/brcode.js';
import { MercadoPagoPix, MockPix } from '../server/pix.js';

// O MESMO arquivo que o navegador carrega (public/vendor/qrcode.js), executado como um navegador o faria (variavel global `qrcode`).
const sandbox = {};
vm.runInNewContext(readFileSync(new URL('../public/vendor/qrcode.js', import.meta.url), 'utf8'), sandbox);
const qrcode = sandbox.qrcode;

const order = (cents) => ({ id: '2d8cb8dd-9340-4760-92fb-39a7d176295c', amount_cents: cents, minutes: 10, expires_at: Date.now() + 900_000 });

/** Desenha o QR como o navegador desenha (modulos de 6 px, 4 de margem) e le de volta com um leitor de QR. */
function readBack(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const scale = 6;
  const quiet = 4;
  const size = (n + quiet * 2) * scale;
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(px, size, size)?.data ?? null;
}

test('CRC16 do Pix confere com o valor de referencia do padrao (123456789 -> 29B1)', () => {
  assert.equal(crc16('123456789'), 0x29b1);
});

test('montar e ler um BR Code: valor, nome e CRC', () => {
  const c = buildBrCode({ key: 'teste@invalid', name: 'LANHOUSE PS5 TESTE', city: 'SAO PAULO', amountCents: 1050, txid: 'ABC123' });
  const p = parseBrCode(c);
  assert.equal(p.ok, true);
  assert.equal(p.amountCents, 1050);
  assert.equal(p.name, 'LANHOUSE PS5 TESTE');
  assert.equal(p.txid, 'ABC123');
  assert.match(c, /^000201/);
  assert.match(c, /5802BR/);
  assert.match(c, /5303986/); // moeda BRL
});

test('um digito alterado (valor trocado) quebra o CRC e e recusado', () => {
  const c = buildBrCode({ key: 'k@invalid', name: 'X', city: 'Y', amountCents: 1000, txid: 'T' });
  const fraudado = c.replace('10.00', '01.00');
  assert.notEqual(fraudado, c);
  assert.equal(parseBrCode(fraudado).crcOk, false);
  assert.equal(checkBrCode(fraudado, 1000).ok, false);
});

test('o Pix de teste carrega EXATAMENTE o valor do pedido (varios valores)', async () => {
  const pix = new MockPix();
  for (const cents of [500, 900, 1000, 1050 * 0 + 1200, 2000, 2500, 6000, 20000]) {
    const { code } = await pix.createCharge(order(cents));
    const p = parseBrCode(code);
    assert.equal(p.ok, true, `crc ${cents}`);
    assert.equal(p.amountCents, cents, `valor ${cents}`);
    assert.equal(checkBrCode(code, cents).ok, true);
    assert.equal(checkBrCode(code, cents + 100).ok, false);
  }
});

test('o QR desenhado no navegador, lido por um leitor, devolve exatamente o codigo copia e cola', async () => {
  const pix = new MockPix();
  for (const cents of [500, 1000, 2500, 20000]) {
    const { code } = await pix.createCharge(order(cents));
    assert.equal(readBack(code), code, `QR de ${cents} centavos`);
  }
});

test('Mercado Pago: aceita codigo com o valor certo e recusa valor errado ou codigo invalido', async () => {
  const good = buildBrCode({ key: 'chave@mp', name: 'LOJA', city: 'SAO PAULO', amountCents: 1000, txid: 'MP1' });
  const resp = (qr) => async () => ({ ok: true, json: async () => ({ id: 987, point_of_interaction: { transaction_data: { qr_code: qr, qr_code_base64: 'AAAA' } } }) });
  const mk = (qr) => new MercadoPagoPix({ accessToken: 't', publicBaseUrl: 'https://x', fetchImpl: resp(qr) });

  const ok = await mk(good).createCharge(order(1000));
  assert.equal(ok.code, good);
  assert.equal(ok.providerRef, '987');

  const wrongAmount = buildBrCode({ key: 'chave@mp', name: 'LOJA', city: 'SAO PAULO', amountCents: 100, txid: 'MP1' });
  await assert.rejects(mk(wrongAmount).createCharge(order(1000)), /diferente do pedido/);
  await assert.rejects(mk('00020126nada-a-ver').createCharge(order(1000)), /invalido/);
  await assert.rejects(mk(undefined).createCharge(order(1000)), /invalido/);
});

test('Mercado Pago: o valor enviado ao provedor e o do pedido em reais, com o id do pedido como referencia', async () => {
  let sent;
  const good = buildBrCode({ key: 'chave@mp', name: 'LOJA', city: 'SAO PAULO', amountCents: 2500, txid: 'MP2' });
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return { ok: true, json: async () => ({ id: 1, point_of_interaction: { transaction_data: { qr_code: good } } }) };
  };
  const mp = new MercadoPagoPix({ accessToken: 'tok', publicBaseUrl: 'https://site.com', fetchImpl });
  await mp.createCharge(order(2500));
  const body = JSON.parse(sent.init.body);
  assert.equal(body.transaction_amount, 25);
  assert.equal(body.payment_method_id, 'pix');
  assert.equal(body.external_reference, '2d8cb8dd-9340-4760-92fb-39a7d176295c');
  assert.equal(body.notification_url, 'https://site.com/api/webhooks/mercadopago');
  assert.equal(sent.init.headers['X-Idempotency-Key'], '2d8cb8dd-9340-4760-92fb-39a7d176295c');
});
