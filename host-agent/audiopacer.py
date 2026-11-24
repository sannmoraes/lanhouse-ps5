"""Ritmo do audio: entrega sempre um bloco a cada 20 ms, mesmo quando o Windows nao entrega nada.

O loopback do Windows so gera dados enquanto ha som tocando. Se o FFmpeg ficar esperando audio em
silencio, o video trava junto. Entao, sem dados, mandamos silencio; com atraso acumulado, descartamos
o mais velho para o som nao ficar para tras do video.
"""
from collections import deque

RATE = 48000
CHANNELS = 2
FRAMES = 960  # 20 ms
CHUNK_BYTES = FRAMES * CHANNELS * 2  # PCM 16 bits
SILENCE = bytes(CHUNK_BYTES)

class Pacer:
    def __init__(self, max_backlog=4):
        self.max_backlog = max_backlog  # 4 blocos = 80 ms
        self.q = deque()
        self.dropped = 0

    def push(self, chunk):
        if len(chunk) != CHUNK_BYTES:
            return
        self.q.append(chunk)
        while len(self.q) > self.max_backlog:
            self.q.popleft()
            self.dropped += 1

    def next(self):
        return self.q.popleft() if self.q else SILENCE
