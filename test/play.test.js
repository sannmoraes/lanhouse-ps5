import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { LanHouse, openDb } from '../server/lanhouse.js';
import { Accounts, ACTIONS } from '../server/accounts.js';
import { attachPlay, parseFrame, NEUTRAL } from '../server/play.js';

const SECRET = 'segredo-do-host';
const bit = (...names) => names.reduce((m, n) => m | (1 << ACTIONS.indexOf(n)), 0);
const frame = (o) => JSON.stringify({ t: 'in', b: 0, lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0, ...o });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- parseFrame (puro) ----------
test('parseFrame converte a mascara em nomes e limita os eixos', () => {
  const f = parseFrame(frame({ b: bit('cross', 'up'), lx: 5, ly: -9, l2: 0.4 }));
  assert.deepEqual(f.buttons, ['up', 'cross']);
  assert.equal(f.lx, 1);
  assert.equal(f.ly, -1);
  assert.equal(f.l2, 0.4);
});

test('parseFrame: gatilho digital aperta o analogico por inteiro', () => {
  const f = parseFrame(frame({ b: bit('l2'), l2: 0 }));
  assert.equal(f.l2, 1);
});

test('parseFrame recusa lixo', () => {
  for (const bad of ['', 'nao-json', '{}', '{"t":"x"}', frame({ b: -1 }), frame({ b: 1 << 16 }), frame({ b: 1.5 }), 'x'.repeat(500), null, 42]) {
    assert.equal(parseFrame(bad), null, String(bad).slice(0, 20));
  }
  const f = parseFrame(frame({ lx: 'abc', ly: NaN, l2: Infinity }));
  assert.equal(f.lx, 0);
  assert.equal(f.l2, 0);
});

test('nao existe botao PS na mascara (o jogador nao sai do jogo nem desliga o console)', () => {
  assert.ok(!ACTIONS.some((a) => /ps|home|guide/i.test(a)));
});

// ---------- canal completo ----------
async function setup({ pingMs } = {}) {
  let t = 1_000_000;
  const now = () => t;
  const db = openDb(':memory:');
  const house = new LanHouse(db, { now });
  const accounts = new Accounts(db, { now });
  house.setConsoleOnline(true);
  const beats = [];
  const server = createServer();
  const play = attachPlay(server, { house, accounts, hostSecret: SECRET, cookieName: 'lh_session', pingMs, onBeat: (r) => beats.push(r) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const host = `127.0.0.1:${port}`;

  let n = 0;
  const user = async (nickname) => {
    n += 1;
    const u = await accounts.register({ email: `p${n}@ex.com`, nickname, password: 'senha-forte-1', adult: true });
    const { token } = await accounts.login({ email: u.email, password: 'senha-forte-1' });
    return { id: u.id, nickname, token };
  };
  const bid = (u, minutes = 10, reais = 10) => {
    const o = house.createBidOrder({ userId: u.id, nickname: u.nickname, minutes, cents: reais * 100 });
    house.markPaid(o.id);
    t += 1000;
  };

  const open = (path, headers) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${host}${path}`, { headers });
      ws.msgs = [];
      ws.on('message', (d) => ws.msgs.push(JSON.parse(d.toString())));
      ws.on('open', () => resolve(ws));
      ws.on('unexpected-response', (_req, res) => reject(Object.assign(new Error('rejeitado'), { status: res.statusCode })));
      ws.on('error', reject);
    });
  const connectHost = (secret = SECRET) => open('/ws/host', { 'x-host-secret': secret });
  const connectPlayer = (u, origin = `http://${host}`) => open('/ws/play', { origin, cookie: `lh_session=${u.token}` });

  const close = async () => {
    play.close();
    await new Promise((r) => server.close(r));
  };
  return { house, play, beats, user, bid, connectHost, connectPlayer, close, advance: (ms) => (t += ms) };
}

test('o PC do console precisa do segredo certo', async () => {
  const s = await setup();
  await assert.rejects(s.connectHost('errado'), (e) => e.status === 401);
  const h = await s.connectHost();
  assert.equal(h.readyState, 1);
  h.close();
  await s.close();
});

test('o jogador precisa estar logado e vir do proprio site', async () => {
  const s = await setup();
  const ana = await s.user('Ana');
  await assert.rejects(s.connectPlayer({ token: 'invalido' }), (e) => e.status === 401);
  await assert.rejects(s.connectPlayer(ana, 'http://site-de-fora.com'), (e) => e.status === 403);
  const p = await s.connectPlayer(ana);
  assert.equal(p.readyState, 1);
  p.close();
  await s.close();
});

test('so o jogador da vez controla; os outros sao ignorados', async () => {
  const s = await setup();
  const ana = await s.user('Ana');
  const bia = await s.user('Bia');
  s.bid(ana);
  s.bid(bia);
  s.play.sync();
  const host = await s.connectHost();
  const pa = await s.connectPlayer(ana);
  const pb = await s.connectPlayer(bia);
  await wait(50);
  host.msgs.length = 0;

  pb.send(frame({ b: bit('cross') })); // Bia ainda espera: ignorado
  pa.send(frame({ b: bit('cross', 'right'), lx: 0.5 }));
  await wait(100);
  const inputs = host.msgs.filter((m) => m.t === 'in');
  assert.equal(inputs.length, 1);
  assert.deepEqual(inputs[0].buttons, ['right', 'cross']);
  assert.equal(inputs[0].lx, 0.5);

  assert.equal(pa.msgs.find((m) => m.t === 'status').active, true);
  assert.equal(pb.msgs.find((m) => m.t === 'status').active, false);
  [host, pa, pb].forEach((w) => w.close());
  await s.close();
});

test('quando a vez muda, todos os botoes sao soltos e os jogadores sao avisados', async () => {
  const s = await setup();
  const ana = await s.user('Ana');
  const bia = await s.user('Bia');
  s.bid(ana);
  s.bid(bia);
  s.play.sync();
  const host = await s.connectHost();
  const pa = await s.connectPlayer(ana);
  const pb = await s.connectPlayer(bia);
  await wait(50);
  pa.send(frame({ b: bit('cross') }));
  await wait(50);
  host.msgs.length = 0;

  s.house.endActive('admin'); // Bia assume
  s.play.sync();
  await wait(100);
  assert.deepEqual(host.msgs.find((m) => m.t === 'in'), NEUTRAL);
  assert.equal(host.msgs.find((m) => m.t === 'turn').nickname, 'Bia');
  assert.equal(pb.msgs.filter((m) => m.t === 'status').pop().active, true);
  assert.equal(pa.msgs.filter((m) => m.t === 'status').pop().active, false);

  // a Ana nao controla mais
  host.msgs.length = 0;
  pa.send(frame({ b: bit('cross') }));
  await wait(80);
  assert.equal(host.msgs.filter((m) => m.t === 'in').length, 0);
  [host, pa, pb].forEach((w) => w.close());
  await s.close();
});

test('se o jogador da vez desconecta, os botoes sao soltos', async () => {
  const s = await setup();
  const ana = await s.user('Ana');
  s.bid(ana);
  s.play.sync();
  const host = await s.connectHost();
  const pa = await s.connectPlayer(ana);
  await wait(50);
  pa.send(frame({ b: bit('cross') }));
  await wait(50);
  host.msgs.length = 0;
  pa.close();
  await wait(100);
  assert.deepEqual(host.msgs.find((m) => m.t === 'in'), NEUTRAL);
  host.close();
  await s.close();
});

test('o aviso de pronto do PC liga e desliga o console e chega aos jogadores', async () => {
  const s = await setup();
  const ana = await s.user('Ana');
  const host = await s.connectHost();
  const pa = await s.connectPlayer(ana);
  await wait(50);
  assert.equal(pa.msgs.find((m) => m.t === 'status').hostReady, false);
  host.send(JSON.stringify({ t: 'hb', ready: true }));
  await wait(80);
  assert.deepEqual(s.beats, [true]);
  assert.equal(pa.msgs.filter((m) => m.t === 'status').pop().hostReady, true);
  assert.deepEqual({ ...s.play.hostStatus(), lastBeatAt: 0 }, { connected: true, ready: true, lastBeatAt: 0 });
  host.close();
  await wait(80);
  assert.equal(s.beats.at(-1), false);
  assert.equal(s.play.hostStatus().connected, false);
  pa.close();
  await s.close();
});

test('excesso de quadros por segundo e descartado', async () => {
  const s = await setup();
  const ana = await s.user('Ana');
  s.bid(ana);
  s.play.sync();
  const host = await s.connectHost();
  const pa = await s.connectPlayer(ana);
  await wait(50);
  host.msgs.length = 0;
  for (let i = 0; i < 300; i++) pa.send(frame({ b: bit('cross') }));
  await wait(300);
  const got = host.msgs.filter((m) => m.t === 'in').length;
  assert.ok(got <= 100, `recebeu ${got}`);
  assert.ok(got > 0);
  [host, pa].forEach((w) => w.close());
  await s.close();
});

test('conexoes saudaveis NAO sao derrubadas pelo batimento (regressao: caiam a cada ~30 s)', async () => {
  const s = await setup({ pingMs: 80 }); // 80 ms em vez de 15 s: 10 ciclos em ~800 ms
  const ana = await s.user('Ana');
  s.bid(ana);
  s.play.sync();
  const host = await s.connectHost();
  const pa = await s.connectPlayer(ana);
  let hostClosed = false;
  let playerClosed = false;
  host.on('close', () => (hostClosed = true));
  pa.on('close', () => (playerClosed = true));
  await wait(900);
  assert.equal(hostClosed, false, 'o PC do console foi derrubado');
  assert.equal(playerClosed, false, 'o jogador foi derrubado');
  // e ainda funciona depois de varios ciclos
  host.msgs.length = 0;
  pa.send(frame({ b: bit('cross') }));
  await wait(100);
  assert.equal(host.msgs.filter((m) => m.t === 'in').length, 1);
  [host, pa].forEach((w) => w.close());
  await s.close();
});

test('conexao morta (que nao responde ao ping) E derrubada', async () => {
  const s = await setup({ pingMs: 80 });
  const ana = await s.user('Ana');
  const pa = await s.connectPlayer(ana);
  pa.pong = () => {}; // o cliente "congela": nao responde
  pa._receiver.removeAllListeners('ping');
  let closed = false;
  pa.on('close', () => (closed = true));
  await wait(600);
  assert.equal(closed, true);
  await s.close();
});
