"""Logica pura do agente (sem rede e sem driver): validar quadros e decidir o direcional.

Protocolo (igual ao de server/play.js):
  {"t":"in","buttons":["cross","up"],"lx":-1..1,"ly":-1..1,"rx":..,"ry":..,"l2":0..1,"r2":0..1}
  ly/ry positivo = CIMA.
"""

BUTTON_NAMES = (
    "up", "down", "left", "right",
    "cross", "circle", "square", "triangle",
    "l1", "r1", "l2", "r2", "l3", "r3",
    "start", "select",
)

NEUTRAL = {"buttons": frozenset(), "lx": 0.0, "ly": 0.0, "rx": 0.0, "ry": 0.0, "l2": 0.0, "r2": 0.0}


def _num(value, lo, hi):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    if value != value:  # NaN
        return 0.0
    return max(lo, min(hi, float(value)))


def normalize(msg):
    """Aceita so o que e conhecido; qualquer coisa estranha vira 'solto'. O botao PS nao existe."""
    if not isinstance(msg, dict) or msg.get("t") != "in":
        return None
    raw = msg.get("buttons")
    names = raw if isinstance(raw, list) else []
    buttons = frozenset(n for n in names if isinstance(n, str) and n in BUTTON_NAMES)
    frame = {
        "buttons": buttons,
        "lx": _num(msg.get("lx"), -1, 1),
        "ly": _num(msg.get("ly"), -1, 1),
        "rx": _num(msg.get("rx"), -1, 1),
        "ry": _num(msg.get("ry"), -1, 1),
        "l2": _num(msg.get("l2"), 0, 1),
        "r2": _num(msg.get("r2"), 0, 1),
    }
    if "l2" in buttons:
        frame["l2"] = 1.0
    if "r2" in buttons:
        frame["r2"] = 1.0
    return frame


def dpad_direction(buttons):
    """Devolve 'N','NE','E','SE','S','SW','W','NW' ou None. Cima+baixo (ou esq.+dir.) se anulam."""
    v = ("up" in buttons) - ("down" in buttons)
    h = ("right" in buttons) - ("left" in buttons)
    return {
        (1, 0): "N", (1, 1): "NE", (0, 1): "E", (-1, 1): "SE",
        (-1, 0): "S", (-1, -1): "SW", (0, -1): "W", (1, -1): "NW",
    }.get((v, h))


def is_neutral(frame):
    return (
        not frame["buttons"]
        and frame["lx"] == frame["ly"] == frame["rx"] == frame["ry"] == 0
        and frame["l2"] == frame["r2"] == 0
    )


def is_stale(last_input_at, now, timeout=0.6):
    """O navegador manda um quadro a cada 100 ms; sem receber nada por `timeout` s, solta tudo."""
    return last_input_at is not None and (now - last_input_at) > timeout
