# PC do console

Tudo o que roda no PC que fica junto do PS5. O passo a passo completo está em [`../docs/INSTALACAO-NO-PS5.md`](../docs/INSTALACAO-NO-PS5.md); o teste sem PS5, em [`../docs/TESTE-LOCAL.md`](../docs/TESTE-LOCAL.md).

| Arquivo | Para que serve |
|---|---|
| `agent.py` | Conecta no site, recebe os botões do jogador da vez e aperta um controle DualShock 4 virtual. Avisa a cada 5 s se o vídeo está no ar. Solta tudo se ficar 0,6 s sem quadros ou ao desconectar. |
| `padmap.py` / `test_padmap.py` | Validação dos quadros e do direcional (lógica pura, com testes: `python -m unittest discover -s . -p "test_*.py"`). |
| `start-agent.ps1` | Liga o agente (`-DryRun` testa sem driver; `-NoVideoCheck` ignora o vídeo; `-InvertY` inverte os analógicos). |
| `audio_loopback.py` / `audiopacer.py` | Captura o som de uma saída de áudio do Windows (loopback) e entrega ao FFmpeg por TCP local, em blocos de 20 ms (silêncio quando nada toca). |
| `start-video.ps1` | FFmpeg captura a janela do chiaki-ng e publica vídeo (H.264) + som (Opus) no MediaMTX (RTSP local por padrão; WHIP para um servidor na nuvem). |
| `start-mediamtx.ps1` / `mediamtx.yml` | Liga o MediaMTX, que entrega o vídeo aos navegadores. |
| `requirements.txt` | `websockets`, `vgamepad` (precisa do driver ViGEmBus), `soundcard` e `numpy` (áudio). |

Segurança embutida: o botão PS nunca é enviado; só o jogador da vez controla (o site filtra); o agente só aceita o que conhece.
