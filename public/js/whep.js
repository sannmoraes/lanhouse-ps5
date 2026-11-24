// Player WebRTC (WHEP): le o video que o PC do console publica no MediaMTX.
// startWhep(url, videoEl, { stun, onState }) -> { stop() }.  Estados: connecting | live | offline
window.startWhep = function startWhep(url, video, { stun, onState = () => {} } = {}) {
  let pc = null;
  let stopped = false;
  let retryTimer = null;
  let frames = -1;
  let framesAt = Date.now();
  let stalled = false;

  // Imagem congelada: a conexao pode continuar de pe enquanto nao chega quadro novo (ex.: o video de origem parou).
  const watchdog = setInterval(() => {
    if (stopped || !pc || pc.connectionState !== 'connected') return;
    const q = video.getVideoPlaybackQuality?.();
    if (!q) return;
    if (q.totalVideoFrames !== frames) {
      frames = q.totalVideoFrames;
      framesAt = Date.now();
      if (stalled) {
        stalled = false;
        onState('live');
      }
    } else if (!stalled && Date.now() - framesAt > 5000) {
      stalled = true;
      onState('offline');
    }
  }, 1000);

  function cleanup() {
    clearTimeout(retryTimer);
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.ontrack = null;
      try {
        pc.close();
      } catch {}
      pc = null;
    }
  }

  function retry(ms = 3000) {
    if (stopped) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, ms);
  }

  function gathered(conn, timeoutMs) {
    return new Promise((resolve) => {
      if (conn.iceGatheringState === 'complete') return resolve();
      const done = () => {
        conn.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => conn.iceGatheringState === 'complete' && done();
      conn.addEventListener('icegatheringstatechange', check);
      setTimeout(done, timeoutMs); // manda com o que ja foi coletado
    });
  }

  async function connect() {
    if (stopped) return;
    cleanup();
    onState('connecting');
    const conn = new RTCPeerConnection({ iceServers: stun ? [{ urls: stun }] : [] });
    pc = conn;
    conn.addTransceiver('video', { direction: 'recvonly' });
    conn.addTransceiver('audio', { direction: 'recvonly' });
    conn.ontrack = (e) => {
      if (video.srcObject !== e.streams[0]) video.srcObject = e.streams[0];
      // menor atraso possivel no buffer do Chrome (ignorado onde nao existe)
      try {
        if (e.track.kind === 'video') e.receiver.jitterBufferTarget = 0;
      } catch {}
    };
    conn.onconnectionstatechange = () => {
      if (conn !== pc) return;
      if (conn.connectionState === 'connected') onState('live');
      if (['failed', 'disconnected', 'closed'].includes(conn.connectionState)) {
        onState('offline');
        retry();
      }
    };
    try {
      await conn.setLocalDescription(await conn.createOffer());
      await gathered(conn, 2000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: conn.localDescription.sdp });
      if (!res.ok) throw new Error(`WHEP ${res.status}`); // 404 = ninguem esta publicando video ainda
      await conn.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    } catch (e) {
      if (conn === pc) {
        onState('offline');
        retry();
      }
    }
  }

  connect();
  return {
    // Numeros para diagnostico (painel ?debug=1): fps, atraso do buffer, perda, RTT e nivel do audio.
    async stats() {
      const out = {};
      if (!pc) return out;
      const report = await pc.getStats();
      report.forEach((r) => {
        if (r.type === 'inbound-rtp' && (r.kind === 'video' || r.kind === 'audio')) {
          out[r.kind] = {
            bytes: r.bytesReceived,
            packetsLost: r.packetsLost,
            fps: r.framesPerSecond,
            bufferMs: r.jitterBufferEmittedCount ? Math.round((r.jitterBufferDelay / r.jitterBufferEmittedCount) * 1000) : null,
            audioLevel: r.audioLevel,
            energy: r.totalAudioEnergy,
            decoded: r.framesDecoded,
          };
        }
        if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) out.rttMs = Math.round(r.currentRoundTripTime * 1000);
      });
      return out;
    },
    stop() {
      stopped = true;
      clearInterval(watchdog);
      cleanup();
    },
  };
};
