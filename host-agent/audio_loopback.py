"""Captura o SOM que sai de uma saida de audio do Windows (loopback) e entrega ao FFmpeg por TCP local.

Por que: o FFmpeg do Windows nao captura "o que o PC esta tocando" sozinho, e assim nao precisa instalar
driver de audio virtual. Roteie o audio do chiaki-ng para uma saida (veja o guia) e capture essa saida.

Uso:
  python audio_loopback.py --list
  python audio_loopback.py --device "Headphones" --port 5004
Este programa ESCUTA em 127.0.0.1:PORTA; o FFmpeg (start-video.ps1 -AudioPort 5004) conecta e le: s16le, 48000 Hz, 2 canais.
(Nao usamos UDP: a entrada UDP do FFmpeg no Windows nao recebeu nada nos testes.)
"""
import argparse
import socket
import sys
import threading
import time

import numpy as np

import audiopacer as ap

try:
    import soundcard as sc
except ImportError:
    sys.exit("Falta o 'soundcard'. Rode:  pip install -r requirements.txt")


def to_pcm16(block):
    """float32 [-1, 1] (frames x canais) -> bytes PCM 16 bits."""
    return (np.clip(block, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


def pick_speaker(name):
    if not name:
        return sc.default_speaker()
    want = name.lower()
    for s in sc.all_speakers():
        if want in s.name.lower():
            return s
    sys.exit(f"Nenhuma saida de audio com '{name}' no nome. Use --list para ver as opcoes.")


def reader(speaker, pacer, stop, errors):
    """Le o loopback em uma thread; o ritmo de envio e controlado pelo laco principal."""
    try:
        mic = sc.get_microphone(id=str(speaker.id), include_loopback=True)
        with mic.recorder(samplerate=ap.RATE, channels=ap.CHANNELS, blocksize=ap.FRAMES) as rec:
            while not stop.is_set():
                pacer.push(to_pcm16(rec.record(numframes=ap.FRAMES)))
    except Exception as e:  # dispositivo removido, driver reiniciou...
        errors.append(e)


def main():
    ap_ = argparse.ArgumentParser(description="Loopback de audio do Windows para o FFmpeg")
    ap_.add_argument("--list", action="store_true", help="mostra as saidas de audio e sai")
    ap_.add_argument("--device", default="", help="parte do nome da saida de audio a capturar (padrao: a saida padrao do Windows)")
    ap_.add_argument("--port", type=int, default=5004, help="porta TCP local em que este programa escuta")
    args = ap_.parse_args()

    if args.list:
        default = sc.default_speaker().name
        for s in sc.all_speakers():
            print(("* " if s.name == default else "  ") + s.name)
        print("\n(* = saida padrao do Windows)")
        return

    speaker = pick_speaker(args.device)
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", args.port))
    srv.listen(1)
    srv.settimeout(0)
    print(f"[audio] capturando o som de: {speaker.name} | escutando em 127.0.0.1:{args.port}")

    while True:
        pacer = ap.Pacer()
        stop = threading.Event()
        errors = []
        th = threading.Thread(target=reader, args=(speaker, pacer, stop, errors), daemon=True)
        th.start()
        client = None
        tick = time.monotonic()
        try:
            while th.is_alive():
                # um bloco de 20 ms por vez, sem acumular erro de relogio
                tick += ap.FRAMES / ap.RATE
                chunk = pacer.next()
                if client is None:
                    try:
                        client, addr = srv.accept()
                        client.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                        client.settimeout(1.0)
                        print(f"[audio] FFmpeg conectado ({addr[0]}:{addr[1]})")
                    except BlockingIOError:
                        pass  # ninguem conectou ainda: o som e descartado para nao acumular atraso
                if client is not None:
                    try:
                        client.sendall(chunk)
                    except OSError:
                        print("[audio] FFmpeg desconectou; esperando reconectar")
                        client.close()
                        client = None
                delay = tick - time.monotonic()
                if delay > 0:
                    time.sleep(delay)
                elif delay < -0.5:
                    tick = time.monotonic()  # o PC engasgou: nao tenta recuperar o atraso
        except KeyboardInterrupt:
            stop.set()
            return
        stop.set()
        if client is not None:
            client.close()
        print(f"[audio] captura parou ({errors[0] if errors else 'sem detalhe'}); tentando de novo em 2 s")
        time.sleep(2)


if __name__ == "__main__":
    main()
