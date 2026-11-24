import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { ACTIONS } from './accounts.js';

// ---------- protocolo dos botoes ----------
// Jogador -> servidor: {"t":"in","b":<mascara de botoes>,"lx":-1..1,"ly":-1..1,"rx":-1..1,"ry":-1..1,"l2":0..1,"r2":0..1}
// A mascara usa a ordem de ACTIONS (bit 0 = up ... bit 15 = select). O botao PS nao existe de proposito:
// com ele o jogador poderia sair do jogo, trocar de perfil ou desligar o console.
// Servidor -> PC do console: {"t":"in","buttons":["cross","up"],"lx":..., ...}  (nomes, para o agente nao depender da ordem dos bits)
export const NEUTRAL = Object.freeze({ t: 'in', buttons: [], lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0 });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : 0);

/** Valida e converte um quadro do jogador. Devolve null se for lixo. */
export function parseFrame(raw) {
  if (typeof raw !== 'string' || raw.length > 400) return null;
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || m.t !== 'in' || !Number.isInteger(m.b) || m.b < 0 || m.b >= 1 << ACTIONS.length) return null;
  const buttons = ACTIONS.filter((_, i) => (m.b >> i) & 1);
  const f = { t: 'in', buttons, lx: num(m.lx, -1, 1), ly: num(m.ly, -1, 1), rx: num(m.rx, -1, 1), ry: num(m.ry, -1, 1), l2: num(m.l2, 0, 1), r2: num(m.r2, 0, 1) };
  // gatilho digital aperta o analogico por inteiro
  if (buttons.includes('l2')) f.l2 = 1;
  if (buttons.includes('r2')) f.r2 = 1;
  return f;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

function reject(socket, code, text) {
  socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function cookieValue(req, name) {
  const m = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]+)`));
  return m ? m[1] : null;
}

const MAX_FRAMES_PER_SEC = 90;

/**
 * Liga dois canais WebSocket ao servidor HTTP:
 *   /ws/play  o jogador (cookie de sessao). So o jogador da vez tem os quadros repassados ao console.
 *   /ws/host  o PC ligado ao PS5 (cabecalho x-host-secret). Recebe os quadros e avisa que o video esta no ar.
 */
export function attachPlay(server, { house, accounts, hostSecret, cookieName, hostGuard = null, pingMs = 15_000, onBeat = () => {}, log = () => {} }) {
  const wssPlay = new WebSocketServer({ noServer: true, maxPayload: 512 });
  const wssHost = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  let host = null; // { ws }
  let hostReady = false;
  let lastBeatAt = 0;
  let activeUserId = null;
  const players = new Set();

  const sendJson = (ws, obj) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  };
  const toHost = (obj) => host && sendJson(host.ws, obj);

  function statusFor(ws) {
    return { t: 'status', active: activeUserId !== null && ws.userId === activeUserId, hostReady: Boolean(host && hostReady) };
  }
  function notifyPlayers() {
    for (const ws of players) sendJson(ws, statusFor(ws));
  }

  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch {
      return reject(socket, 400, 'Bad Request');
    }

    if (pathname === '/ws/play') {
      // Navegadores sempre mandam Origin; um site de fora nao consegue abrir este canal com o cookie do jogador.
      let ok = false;
      try {
        ok = Boolean(req.headers.origin) && new URL(req.headers.origin).host === req.headers.host;
      } catch {}
      if (!ok) return reject(socket, 403, 'Forbidden');
      const user = accounts.userFromToken(cookieValue(req, cookieName));
      if (!user) return reject(socket, 401, 'Unauthorized');
      wssPlay.handleUpgrade(req, socket, head, (ws) => {
        trackAlive(ws);
        ws.userId = user.id;
        ws.frames = { sec: 0, n: 0 };
        players.add(ws);
        sendJson(ws, statusFor(ws));
        ws.on('message', (data, isBinary) => onPlayerMessage(ws, isBinary ? null : data.toString()));
        ws.on('close', () => {
          players.delete(ws);
          // Se era o jogador da vez e nao sobrou outra aba dele, solta todos os botoes.
          if (ws.userId === activeUserId && ![...players].some((p) => p.userId === ws.userId)) toHost(NEUTRAL);
        });
        ws.on('error', () => {});
      });
      return;
    }

    if (pathname === '/ws/host') {
      const addr = req.socket.remoteAddress ?? 'x';
      try {
        hostGuard?.check(addr);
      } catch {
        return reject(socket, 429, 'Too Many Requests');
      }
      if (!hostSecret || !safeEqual(req.headers['x-host-secret'], hostSecret)) {
        hostGuard?.fail(addr);
        return reject(socket, 401, 'Unauthorized');
      }
      hostGuard?.clear(addr);
      wssHost.handleUpgrade(req, socket, head, (ws) => {
        trackAlive(ws);
        if (host) host.ws.close(4000, 'replaced');
        host = { ws };
        hostReady = false;
        log('[host] PC do console conectado');
        sendJson(ws, NEUTRAL);
        sendTurn(ws);
        ws.on('message', (data, isBinary) => {
          if (isBinary) return;
          let m;
          try {
            m = JSON.parse(data.toString());
          } catch {
            return;
          }
          if (m?.t === 'hb') {
            hostReady = m.ready === true;
            lastBeatAt = Date.now();
            onBeat(hostReady);
            notifyPlayers();
          }
        });
        ws.on('close', () => {
          if (host && host.ws === ws) {
            host = null;
            hostReady = false;
            onBeat(false);
            notifyPlayers();
            log('[host] PC do console desconectou');
          }
        });
        ws.on('error', () => {});
      });
      return;
    }

    reject(socket, 404, 'Not Found');
  });

  function onPlayerMessage(ws, text) {
    if (text === null || !house.isActiveUser(ws.userId)) return; // so o jogador da vez controla
    const sec = Math.floor(Date.now() / 1000);
    if (ws.frames.sec !== sec) ws.frames = { sec, n: 0 };
    if (++ws.frames.n > MAX_FRAMES_PER_SEC) return;
    const frame = parseFrame(text);
    if (frame) toHost(frame);
  }

  function sendTurn(ws) {
    const act = house.active();
    sendJson(ws, act ? { t: 'turn', active: true, nickname: act.nickname, minutes: act.minutes, endsAt: act.ends_at } : { t: 'turn', active: false });
  }

  /** Chame de vez em quando: se a vez mudou, solta todos os botoes e avisa todo mundo. */
  function sync() {
    const act = house.active();
    const id = act ? act.user_id : null;
    if (id === activeUserId) return;
    activeUserId = id;
    toHost(NEUTRAL);
    if (host) sendTurn(host.ws);
    notifyPlayers();
  }

  // Derruba conexoes mortas: cada conexao precisa responder ao "ping" antes do proximo. (O evento de resposta e
  // registrado em cada conexao nova, em trackAlive; com noServer o evento 'connection' do ws nao dispara sozinho.)
  function trackAlive(ws) {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
  }
  const pinger = setInterval(() => {
    for (const ws of [...players, ...(host ? [host.ws] : [])]) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, pingMs);
  pinger.unref();

  return {
    sync,
    hostStatus: () => ({ connected: Boolean(host), ready: Boolean(host && hostReady), lastBeatAt }),
    close() {
      clearInterval(pinger);
      for (const ws of players) ws.terminate();
      host?.ws.terminate();
      wssPlay.close();
      wssHost.close();
    },
  };
}
