import { randomUUID } from 'node:crypto';
import { buildBrCode, checkBrCode } from './brcode.js';

/**
 * Cada provedor implementa:
 *   createCharge(order)  -> { code, qr, providerRef }   (code = Pix "copia e cola", qr = PNG base64 opcional)
 *   fetchPayment(ref)    -> { paid: boolean, amountCents: number, orderId: string|null }
 */

/**
 * Pix de mentira, so para desenvolver. NAO cobra nada. O codigo tem o formato oficial (valor e CRC certos), entao
 * o QR pode ser lido por um app de banco para conferir o VALOR, mas a chave e falsa: nenhum banco consegue pagar.
 */
export class MockPix {
  name = 'mock';
  async createCharge(order) {
    return {
      code: buildBrCode({
        key: 'teste-nao-pagavel@invalid',
        name: 'LANHOUSE PS5 TESTE',
        city: 'SAO PAULO',
        amountCents: order.amount_cents,
        txid: order.id.replace(/-/g, '').slice(0, 25),
      }),
      qr: null,
      providerRef: `mock-${randomUUID()}`,
    };
  }
  async fetchPayment() {
    throw new Error('MockPix nao tem consulta; use /api/dev/pay/:orderId');
  }
}

/**
 * Mercado Pago (Pix). Referencia: POST /v1/payments com payment_method_id "pix".
 * ATENCAO: escrito conforme a documentacao publica e ainda NAO testado com credenciais reais.
 * Teste primeiro com o token de teste da sua conta antes de colocar o de producao.
 */
export class MercadoPagoPix {
  name = 'mercadopago';
  constructor({ accessToken, publicBaseUrl, fetchImpl = fetch }) {
    this.token = accessToken;
    this.baseUrl = publicBaseUrl;
    this.fetch = fetchImpl;
  }

  async #call(path, init = {}) {
    const res = await this.fetch(`https://api.mercadopago.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${body.message ?? 'erro'}`);
    return body;
  }

  async createCharge(order) {
    const body = await this.#call('/v1/payments', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': order.id },
      body: JSON.stringify({
        transaction_amount: order.amount_cents / 100,
        description: 'Lan House PS5 - lance',
        payment_method_id: 'pix',
        external_reference: order.id,
        date_of_expiration: new Date(order.expires_at).toISOString().replace('Z', '-00:00'),
        notification_url: `${this.baseUrl}/api/webhooks/mercadopago`,
        payer: { email: `jogador+${order.id.slice(0, 8)}@lanhouse.invalid` },
      }),
    });
    const tx = body.point_of_interaction?.transaction_data ?? {};
    // Nunca mostrar a um cliente um QR que nao seja um Pix valido nem tenha o valor do pedido.
    const check = checkBrCode(tx.qr_code, order.amount_cents);
    if (!check.ok) throw new Error(`Mercado Pago devolveu um ${check.reason}`);
    return { code: tx.qr_code, qr: tx.qr_code_base64 ?? null, providerRef: String(body.id) };
  }

  /** O webhook so diz "o pagamento X mudou"; o status verdadeiro vem desta consulta, nunca do corpo do aviso. */
  async fetchPayment(ref) {
    const p = await this.#call(`/v1/payments/${encodeURIComponent(ref)}`);
    return {
      paid: p.status === 'approved',
      amountCents: Math.round(Number(p.transaction_amount) * 100),
      orderId: p.external_reference ?? null,
    };
  }
}

export function makePixProvider(config) {
  if (config.pixProvider === 'mercadopago') {
    return new MercadoPagoPix({ accessToken: config.mercadoPagoToken, publicBaseUrl: config.publicBaseUrl });
  }
  return new MockPix();
}
