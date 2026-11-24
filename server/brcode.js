// "Pix copia e cola" (BR Code, padrao EMV do Banco Central): montar, ler e conferir.
// Um BR Code e uma sequencia de campos ID(2) + TAMANHO(2) + VALOR. O ultimo (63) e o CRC16 de tudo que veio antes.

/** CRC16/CCITT-FALSE (polinomio 0x1021, inicio 0xFFFF), o do BR Code. Teste conhecido: "123456789" -> 0x29B1. */
export function crc16(text) {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

const tlv = (id, value) => id + String(Buffer.byteLength(value, 'utf8')).padStart(2, '0') + value;
const crcHex = (n) => n.toString(16).toUpperCase().padStart(4, '0');

/** Monta um BR Code com valor. Usado so no Pix de teste (a chave e falsa: nenhum banco consegue pagar). */
export function buildBrCode({ key, name, city, amountCents, txid }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('valor invalido');
  const account = tlv('00', 'br.gov.bcb.pix') + tlv('01', key);
  const body =
    tlv('00', '01') + // versao
    tlv('01', '12') + // 12 = uso unico
    tlv('26', account) +
    tlv('52', '0000') +
    tlv('53', '986') + // BRL
    tlv('54', (amountCents / 100).toFixed(2)) +
    tlv('58', 'BR') +
    tlv('59', name.slice(0, 25)) +
    tlv('60', city.slice(0, 15)) +
    tlv('62', tlv('05', txid.slice(0, 25))) +
    '6304';
  return body + crcHex(crc16(body));
}

/** Le uma sequencia ID+TAMANHO+VALOR. Devolve Map ou null se estiver mal formada. */
function parseTlv(text) {
  const fields = new Map();
  let i = 0;
  while (i < text.length) {
    const head = text.slice(i, i + 4);
    if (!/^\d{4}$/.test(head)) return null;
    const len = Number(head.slice(2));
    const value = text.slice(i + 4, i + 4 + len);
    if (value.length !== len) return null;
    fields.set(head.slice(0, 2), value);
    i += 4 + len;
  }
  return fields;
}

/** Le os campos de nivel superior. Devolve { ok, crcOk, amountCents, name, city, txid, key, error }. */
export function parseBrCode(code) {
  const out = { ok: false, crcOk: false, amountCents: null, name: null, city: null, txid: null, key: null, error: null };
  if (typeof code !== 'string' || code.length < 20 || code.length > 600) return { ...out, error: 'tamanho invalido' };
  const fields = parseTlv(code);
  if (!fields) return { ...out, error: 'campo mal formado' };
  const crc = fields.get('63');
  if (!crc || crc.length !== 4 || !code.endsWith('6304' + crc)) return { ...out, error: 'sem CRC no fim' };
  out.crcOk = crcHex(crc16(code.slice(0, -4))) === crc.toUpperCase();
  const amount = fields.get('54');
  if (amount !== undefined) {
    if (!/^\d+\.\d{2}$/.test(amount)) return { ...out, error: 'valor mal formado' };
    out.amountCents = Math.round(Number(amount) * 100);
  }
  out.name = fields.get('59') ?? null;
  out.city = fields.get('60') ?? null;
  out.key = parseTlv(fields.get('26') ?? '')?.get('01') ?? null;
  out.txid = parseTlv(fields.get('62') ?? '')?.get('05') ?? null;
  out.ok = out.crcOk;
  if (!out.crcOk) out.error = 'CRC nao confere';
  return out;
}

/** Recusa um codigo que nao seja um BR Code valido ou cujo valor nao seja o do pedido. */
export function checkBrCode(code, expectedCents) {
  const p = parseBrCode(code);
  if (!p.ok) return { ok: false, reason: `codigo Pix invalido (${p.error})` };
  if (p.amountCents !== null && p.amountCents !== expectedCents) {
    return { ok: false, reason: `valor do Pix (${p.amountCents}) diferente do pedido (${expectedCents})` };
  }
  return { ok: true, reason: null };
}
