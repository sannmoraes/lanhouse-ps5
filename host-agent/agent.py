"""Agente do PC do console.

Faz tres coisas:
  1. Conecta no site (WebSocket /ws/host) e recebe os botoes do jogador da vez.
  2. Aplica esses botoes em um controle virtual DualShock 4 (ViGEmBus), que o chiaki-ng repassa ao PS5.
  3. A cada 5 s avisa o site se o video do console esta no ar (so entao o site inicia turnos).

Seguranca: o botao PS nunca e enviado; sem quadros por 0,6 s, ou ao desconectar, solta tudo.
Uso:  python agent.py --server ws://localhost:3000 --secret SEU_HOST_SECRET [--dry-run]
"""
import argparse
import asyncio
import json
import os
import sys
import time
import urllib.request

import padmap
from videowatch import VideoWatch

try:
    import websockets
except ImportError:  # mensagem clara em vez de erro estranho
    sys.exit("Falta a biblioteca 'websockets'. Rode:  pip install -r requirements.txt")


# ---------------- controle virtual ----------------
class DryPad:
    """Nao mexe em nada: so imprime. Serve para testar a rede sem o driver nem o PS5."""

    def __init__(self):
        self._last = None

    def apply(self, f):
        line = f"botoes={sorted(f['buttons'])} L=({f['lx']:+.2f},{f['ly']:+.2f}) R=({f['rx']:+.2f},{f['ry']:+.2f}) L2={f['l2']:.2f} R2={f['r2']:.2f}"
        if line != self._last:
            print(f"[dry-run] {line}")
            self._last = line

    def close(self):
        pass


class DS4Pad:
    def __init__(self, invert_y=False):
        try:
            import vgamepad as vg
        except ImportError:
            sys.exit("Falta o 'vgamepad' (e o driver ViGEmBus). Veja docs/INSTALACAO-NO-PS5.md, passo do controle virtual.")
        self.vg = vg
        self.pad = vg.VDS4Gamepad()
        b = vg.DS4_BUTTONS
        d = vg.DS4_DPAD_DIRECTIONS
        # Nao ha mapeamento para o botao PS (DS4_SPECIAL_BUTTON_PS) de proposito.
        self.buttons = {
            "cross": b.DS4_BUTTON_CROSS, "circle": b.DS4_BUTTON_CIRCLE,
            "square": b.DS4_BUTTON_SQUARE, "triangle": b.DS4_BUTTON_TRIANGLE,
            "l1": b.DS4_BUTTON_SHOULDER_LEFT, "r1": b.DS4_BUTTON_SHOULDER_RIGHT,
            "l2": b.DS4_BUTTON_TRIGGER_LEFT, "r2": b.DS4_BUTTON_TRIGGER_RIGHT,
            "l3": b.DS4_BUTTON_THUMB_LEFT, "r3": b.DS4_BUTTON_THUMB_RIGHT,
            "start": b.DS4_BUTTON_OPTIONS, "select": b.DS4_BUTTON_SHARE,
        }
        self.dirs = {
            None: d.DS4_BUTTON_DPAD_NONE, "N": d.DS4_BUTTON_DPAD_NORTH, "NE": d.DS4_BUTTON_DPAD_NORTHEAST,
            "E": d.DS4_BUTTON_DPAD_EAST, "SE": d.DS4_BUTTON_DPAD_SOUTHEAST, "S": d.DS4_BUTTON_DPAD_SOUTH,
            "SW": d.DS4_BUTTON_DPAD_SOUTHWEST, "W": d.DS4_BUTTON_DPAD_WEST, "NW": d.DS4_BUTTON_DPAD_NORTHWEST,
        }
        self.sign = -1.0 if invert_y else 1.0

    def apply(self, f):
        for name, btn in self.buttons.items():
            if name in f["buttons"]:
                self.pad.press_button(button=btn)
            else:
                self.pad.release_button(button=btn)
        self.pad.directional_pad(direction=self.dirs[padmap.dpad_direction(f["buttons"])])
        self.pad.left_joystick_float(x_value_float=f["lx"], y_value_float=f["ly"] * self.sign)
        self.pad.right_joystick_float(x_value_float=f["rx"], y_value_float=f["ry"] * self.sign)
        self.pad.left_trigger_float(value_float=f["l2"])
        self.pad.right_trigger_float(value_float=f["r2"])
        self.pad.update()

    def close(self):
        try:
            self.apply(padmap.NEUTRAL)
        except Exception:
            pass


# ---------------- video no ar? ----------------
def make_video_watch(api_url):
    """Pergunta ao MediaMTX (ex.: .../v3/paths/get/ps5) se ha video E se ele nao congelou."""

    def fetch():
        with urllib.request.urlopen(api_url, timeout=2) as r:
            return json.load(r)

    return VideoWatch(fetch)


# ---------------- principal ----------------
class Agent:
    def __init__(self, args, pad):
        self.args = args
        self.pad = pad
        self.last_input_at = None
        self.held = False  # ha algo apertado agora?
        self.video = make_video_watch(args.video_api)

    def release(self, why=""):
        if self.held or why == "start":
            self.pad.apply(padmap.NEUTRAL)
            self.held = False
            if why and why != "start":
                print(f"[agente] botoes soltos ({why})")

    async def heartbeat(self, ws):
        while True:
            ready = True if self.args.no_video_check else await asyncio.to_thread(self.video.check)
            await ws.send(json.dumps({"t": "hb", "ready": ready}))
            await asyncio.sleep(5)

    async def watchdog(self):
        while True:
            await asyncio.sleep(0.1)
            if self.held and padmap.is_stale(self.last_input_at, time.monotonic(), self.args.timeout):
                self.release("sem quadros")

    async def session(self):
        url = self.args.server.rstrip("/") + "/ws/host"
        async with websockets.connect(url, additional_headers={"x-host-secret": self.args.secret}, ping_interval=20) as ws:
            print(f"[agente] conectado a {url}")
            self.release("start")
            tasks = [asyncio.create_task(self.heartbeat(ws)), asyncio.create_task(self.watchdog())]
            try:
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except ValueError:
                        continue
                    if msg.get("t") == "in":
                        f = padmap.normalize(msg)
                        if f is None:
                            continue
                        self.pad.apply(f)
                        self.held = not padmap.is_neutral(f)
                        self.last_input_at = time.monotonic()
                    elif msg.get("t") == "turn":
                        if msg.get("active"):
                            print(f"[agente] vez de {msg.get('nickname')} ({msg.get('minutes')} min)")
                        else:
                            print("[agente] ninguem jogando")
            finally:
                for t in tasks:
                    t.cancel()
                self.release("desconectou")

    async def run(self):
        delay = 1
        while True:
            try:
                await self.session()
                delay = 1
            except (OSError, websockets.exceptions.WebSocketException) as e:
                print(f"[agente] sem conexao ({e.__class__.__name__}: {e}); tentando de novo em {delay}s")
            await asyncio.sleep(delay)
            delay = min(delay * 2, 10)


def main():
    ap = argparse.ArgumentParser(description="Agente do PC do console")
    ap.add_argument("--server", default=os.environ.get("LH_SERVER", "ws://localhost:3000"), help="ws://... ou wss://... do site")
    ap.add_argument("--secret", default=os.environ.get("HOST_SECRET", ""), help="o mesmo HOST_SECRET do site")
    ap.add_argument("--video-api", default=os.environ.get("LH_VIDEO_API", "http://127.0.0.1:9997/v3/paths/get/ps5"), help="API do MediaMTX para saber se o video esta no ar")
    ap.add_argument("--no-video-check", action="store_true", help="avisa 'pronto' sem checar o video (so para testar o controle)")
    ap.add_argument("--dry-run", action="store_true", help="nao usa o controle virtual: so imprime o que chegar")
    ap.add_argument("--invert-y", action="store_true", help="inverte cima/baixo dos analogicos (se no teste estiver ao contrario)")
    ap.add_argument("--timeout", type=float, default=0.6, help="segundos sem quadros ate soltar tudo")
    args = ap.parse_args()
    if not args.secret:
        sys.exit("Informe o segredo: --secret SEU_HOST_SECRET (ou a variavel HOST_SECRET).")

    pad = DryPad() if args.dry_run else DS4Pad(invert_y=args.invert_y)
    agent = Agent(args, pad)
    try:
        asyncio.run(agent.run())
    except KeyboardInterrupt:
        pass
    finally:
        pad.close()


if __name__ == "__main__":
    main()
