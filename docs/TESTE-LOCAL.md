# Teste local (sem o PS5)

Serve para testar tudo, menos o PS5 de verdade. Roda neste PC.

## O que dá para testar sem o PS5

| Parte | Como | Situação |
|---|---|---|
| Fila, leilão, contas, Pix de mentira | `npm start` | Testado |
| Canal de botões (site → servidor → agente) | agente com `-DryRun` | **Testado** (teclas viraram `cross` e `up`; ao encerrar o turno, tudo foi solto) |
| Vídeo WebRTC | FFmpeg com imagem de teste + MediaMTX | **Testado** (MediaMTX 1.21.4): imagem 1280×720 em movimento no site; queda e volta do vídeo recuperadas sozinhas |
| Áudio (captura do Windows → site) | `audio_loopback.py` + `start-video.ps1 -TestPattern -AudioPort 5004` + um tom baixo | **Testado**: o tom chegou ao navegador (trilha de áudio ativa, nível diferente de zero) |
| Controle virtual DS4 | driver ViGEmBus + `vgamepad` | Só vale a pena com o PS5 |
| Chiaki-ng, Remote Play, atraso real | PS5 ligado | Só no local do PS5 |

## 1. Site e agente em simulação

```powershell
cd lanhouse-ps5
Copy-Item .env.example .env       # ADMIN_PASSWORD e HOST_SECRET: ponha senhas de teste
npm run build
npm start                         # janela 1
```

Em outra janela (o `-NoVideoCheck` faz o agente dizer "pronto" mesmo sem vídeo):

```powershell
cd lanhouse-ps5\host-agent
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\start-agent.ps1 -Server ws://localhost:3000 -Secret SEU_HOST_SECRET -DryRun -NoVideoCheck
```

No navegador (`http://localhost:3000`): crie uma conta (o código de confirmar o e-mail **não é enviado**: ele aparece no terminal onde o servidor roda, em "[e-mail SIMULADO]"; ou ponha `REQUIRE_EMAIL_VERIFICATION=false` no `.env` para pular), dê um lance de R$ 10 por 10 min, clique em "Simular pagamento". Quando chegar a sua vez aparece **CONTROLE LIGADO**, e cada tecla que você apertar aparece no agente como `botoes=['cross', ...]`. Para o direcional analógico, em **Controles** mude para "Analógico esquerdo" e salve: o agente passa a mostrar `L=(+1.00,...)`.

Checklist:
- [ ] Fora da sua vez, apertar teclas **não** mostra nada no agente.
- [ ] Ao fechar a aba durante a vez, o agente imprime "botoes soltos".
- [ ] Encerrar o turno pelo `/admin.html` solta tudo e tira o controle da pessoa.
- [ ] Parar o agente: `/admin.html` mostra "PC do console: desconectado" e o site mostra "CONSOLE OFFLINE".

## 2. Vídeo (precisa do MediaMTX)

1. Baixe o MediaMTX para Windows (GitHub `bluenviron/mediamtx`, arquivo `windows_amd64.zip`; testado com a versão 1.21.4), confira o hash com o arquivo `checksums.sha256` da mesma página e extraia o `mediamtx.exe` em `host-agent`. Na primeira vez o Windows pergunta sobre o firewall: permita em **redes privadas**; se negar, o vídeo não conecta (o FFmpeg fica esperando e depois desiste).
2. Janela A: `.\start-mediamtx.ps1`
3. Janela B: publique uma imagem de teste no lugar do PS5 (barras coloridas com relógio):

```powershell
ffmpeg -hide_banner -re -f lavfi -i "testsrc2=size=1280x720:rate=30" -c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -pix_fmt yuv420p -g 30 -b:v 3M -f whip http://127.0.0.1:8889/ps5/whip
```

4. No `.env` do site: `WHEP_URL=http://localhost:8889/ps5/whep`. Reinicie o `npm start`.
5. Abra `http://localhost:3000`: a imagem de teste deve aparecer na tela principal. Se o agente rodar **sem** `-NoVideoCheck`, o painel passa a mostrar "pronto (vídeo no ar)" e o console some do "offline".

O que foi observado no teste: ao matar o FFmpeg à força, o MediaMTX levou mais de 30 s para perceber, mas o agente percebe sozinho que os bytes pararam de chegar (em 5 a 10 s) e o site passa para "CONSOLE OFFLINE"; o navegador também mostra "Sem sinal do console" se a imagem parar. Quando o vídeo volta, tudo se recupera sem recarregar a página.

Se o vídeo não aparecer: abra `http://localhost:8889/ps5` (página que o próprio MediaMTX serve) para ver se o problema é do site ou da publicação, e veja a janela do MediaMTX.

## 3. Áudio (sem o PS5)

Usa uma imagem de teste e um tom baixo no lugar do jogo:

```powershell
cd lanhouse-ps5\host-agent
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python audio_loopback.py --list                                  # veja o nome da saída por onde o som sai
.\.venv\Scripts\python audio_loopback.py --port 5004 --device "Headphones"       # janela A
.\start-video.ps1 -TestPattern -AudioPort 5004 -Encoder x264                      # janela B (com o MediaMTX rodando)
ffplay -nodisp -f lavfi -i "sine=frequency=440:duration=60" -af volume=0.08       # janela C: tom baixo
```

Abra `http://localhost:3000/?debug=1`, clique em "Ativar som": o painel deve mostrar "audio chegando".

O que aprendemos nos testes (já corrigido nos scripts):
- A entrada **UDP** do FFmpeg não recebeu nada no Windows; por isso o capturador é um servidor **TCP** local e o FFmpeg conecta nele.
- Com `use_wallclock_as_timestamps` o áudio nunca saía (o relógio do Windows ficava "no futuro" em relação ao vídeo).
- Se o capturador cair, o FFmpeg sai (`-shortest`) e o script reconecta tudo sozinho.
- A saída **padrão** do Windows costuma ficar muda (o som vai para outra saída): use `--device`.
- Com som, o FFmpeg só publica por WHIP se o MediaMTX anunciar no máximo 2 endereços; por isso o padrão local é RTSP.

## 4. Quando o PS5 estiver à mão

Siga `docs/INSTALACAO-NO-PS5.md`. Os mesmos comandos servem, trocando o `-DryRun` pelo controle virtual (driver ViGEmBus) e a imagem de teste pelo `start-video.ps1`.
