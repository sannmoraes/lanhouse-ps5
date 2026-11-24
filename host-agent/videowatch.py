"""Decide se o video do console esta mesmo no ar.

So "ready" no MediaMTX nao basta: se o FFmpeg for morto a forca, o MediaMTX pode demorar mais de 30 s
para perceber. Por isso, alem de "ready", o contador de bytes recebidos precisa CRESCER entre uma
checagem e a seguinte (o agente checa a cada 5 s).
"""


class VideoWatch:
    def __init__(self, fetch):
        """fetch() devolve o JSON do caminho no MediaMTX (dict) ou levanta erro."""
        self.fetch = fetch
        self.last_total = None

    def check(self):
        try:
            data = self.fetch()
        except Exception:
            self.last_total = None
            return False
        if not isinstance(data, dict) or not data.get("ready"):
            self.last_total = None
            return False
        total = data.get("inboundBytes", data.get("bytesReceived"))
        if not isinstance(total, (int, float)):
            return True  # versao sem contador: confia no "ready"
        prev, self.last_total = self.last_total, total
        return prev is None or total > prev  # primeira leitura: da o beneficio da duvida
