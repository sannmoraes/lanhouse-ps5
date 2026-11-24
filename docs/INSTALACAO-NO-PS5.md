# Guia: instalar onde está o PS5

Este guia é para o **PC que fica junto do PS5** (o "PC do console"). Ele é o que liga o PS5 ao site. Você faz isso quando for instalar de verdade; os testes de agora são feitos no seu PC atual, sem o PS5 (veja `docs/TESTE-LOCAL.md`).

Tempo estimado: 1 a 2 horas na primeira vez. Os passos marcados com **(você)** envolvem a sua conta PSN ou a instalação de drivers; eu não faço esses passos por você.

## 1. Como as peças se ligam

```
PS5 ──(Remote Play, rede da casa)──► chiaki-ng (janela no PC) ──► FFmpeg ──vídeo──► MediaMTX ──WebRTC──► navegador
                                         ▲                                                              │
                                  controle virtual DS4 ◄── agente ◄──── site (WebSocket) ◄── botões ─────┘
```

- **Site** (esta pasta, `npm start`): fila, contas, Pix e o canal de controle.
- **PC do console**: roda chiaki-ng, FFmpeg, MediaMTX e o agente.
- O PC e o PS5 devem estar **na mesma casa e na mesma rede**, os dois no **cabo** (não use Wi-Fi no PS5 nem no PC).

### Onde fica o site e o vídeo?

| Opção | Como é | Quando usar |
|---|---|---|
| **A. Tudo no PC do PS5** | Site, MediaMTX e agente no mesmo PC. Você expõe o site pela internet (túnel ou abrindo portas). | Mais simples para começar. Depende da sua internet e do IP de casa. |
| **B. Site e MediaMTX num servidor na nuvem (recomendado)** | O PC de casa só **envia** vídeo e controle para a nuvem. Não abre nenhuma porta em casa. | Mais estável para o público. Custa um servidor (VPS) no Brasil. |

Em ambas, o PC de casa precisa de **upload de pelo menos 15 a 20 Mbps** estáveis (cada pessoa assistindo consome cerca de 6 Mbps; no modelo B esse tráfego sai da nuvem, não da sua casa).

## 2. Preparar o PS5 (você)

1. Conecte o PS5 por **cabo de rede** ao mesmo roteador do PC.
2. Crie uma **conta PSN só para a lan house** (não use a sua principal). Entre com ela no PS5 e deixe os jogos instalados nessa conta.
3. **Configurações > Sistema > Remote Play > Ativar Remote Play**.
4. **Configurações > Sistema > Economia de energia > Recursos disponíveis no modo de repouso**: ative **Permanecer conectado à Internet** e **Permitir ligar o PS5 pela rede**.
5. **Configurações > Sistema > Economia de energia > Definir tempo até o PS5 entrar em modo de repouso**: escolha **Não colocar em modo de repouso** (para jogos e apps), para ele não dormir no meio de um turno.
6. No roteador, **reserve um IP fixo** para o PS5 (procure "reserva de DHCP" ou "IP estático"). Anote o IP.
7. Em **Configurações > Sistema > Remote Play > Vincular dispositivo**, deixe a tela com o **código de 8 dígitos** pronta para o passo 3.4.

## 3. Instalar no PC do console

Use um PC com Windows 10 ou 11. Uma placa NVIDIA, AMD ou Intel recente ajuda no vídeo (a RTX 5060 do seu PC atual serve de referência).

### 3.1 Programas básicos

```powershell
winget install OpenJS.NodeJS.LTS        # só se este PC também vai rodar o site (opção A)
winget install Python.Python.3.12
winget install Gyan.FFmpeg
```

Depois feche e abra o PowerShell para o `ffmpeg` e o `python` entrarem no caminho. Confira:

```powershell
ffmpeg -version
python --version
```

### 3.2 O projeto

Copie a pasta `lanhouse-ps5` para o PC (por exemplo, `C:\lanhouse-ps5`). Se este PC vai rodar o site (opção A):

```powershell
cd C:\lanhouse-ps5
npm install
Copy-Item .env.example .env
```

Edite o `.env`: troque `ADMIN_PASSWORD` e `HOST_SECRET` por senhas longas e diferentes, e ponha `WHEP_URL=http://localhost:8889/ps5/whep` (veja o passo 5 para o endereço público).

### 3.3 O chiaki-ng (você)

1. Baixe o instalador do **chiaki-ng** na página oficial de lançamentos do projeto (GitHub `streetpea/chiaki-ng`) e instale. (Confira o nome exato do pacote no `winget search chiaki-ng` se preferir instalar por linha de comando.)
2. Abra o chiaki-ng. Ele deve achar o PS5 na rede. Escolha **Register** e informe:
   - o **ID da conta PSN** da lan house (o chiaki-ng explica como obtê-lo),
   - o **código de 8 dígitos** da tela "Vincular dispositivo" do PS5.
   Essa etapa usa a sua conta PSN: faça você mesmo, na janela do chiaki-ng. Nunca coloque esses dados no site nem em arquivos do projeto.
3. Nas configurações do console no chiaki-ng, use **1080p ou 720p, 60 fps**. Comece com **720p**: o vídeo fica mais leve e com menos atraso.
4. Deixe a janela do chiaki-ng em **modo janela**, com tamanho fixo (por exemplo 1280×720) e encostada no canto superior esquerdo do monitor. Anote a posição e o tamanho: são os números do passo 3.7.
5. Teste: conecte e jogue um pouco com um controle físico. Se funciona, o PS5 e o chiaki-ng estão certos.

### 3.4 Controle virtual (você, precisa de administrador)

O agente cria um controle DualShock 4 "de mentira" no Windows, e o chiaki-ng o usa como se fosse um controle de verdade.

1. Instale o driver **ViGEmBus** (da Nefarius, no GitHub `nefarius/ViGEmBus`, página de lançamentos). Observação: o projeto foi arquivado em 2023, mas continua funcionando; é o driver que a biblioteca `vgamepad` usa.
2. Reinicie o PC se o instalador pedir.
3. No PowerShell, dentro da pasta `host-agent`:

```powershell
cd C:\lanhouse-ps5\host-agent
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
```

4. No chiaki-ng, em **Configurações > Controle**, escolha o controle virtual (DualShock 4). **Desconecte qualquer outro controle** do PC para não misturar.

### 3.5 MediaMTX

1. Baixe o MediaMTX para Windows (GitHub `bluenviron/mediamtx`, página de lançamentos, arquivo `windows_amd64.zip`).
2. Confira o hash do `.zip` com o `checksums.sha256` da mesma página e extraia o `mediamtx.exe` para a pasta `host-agent`. (Testado com a versão 1.21.4.)
3. Para rodar: `.\start-mediamtx.ps1` (usa o `mediamtx.yml` da pasta). Deixe essa janela aberta.

Na primeira vez, o Windows pergunta sobre o firewall: permita em **redes privadas** (se negar, o vídeo não conecta). Se o MediaMTX reclamar de alguma chave do `mediamtx.yml`, é diferença de versão: o erro diz qual; ajuste o nome.

### 3.5b Som do jogo

O FFmpeg do Windows não captura "o que o PC está tocando" sozinho. O `audio_loopback.py` faz isso (loopback do Windows) e entrega o som ao FFmpeg; não precisa instalar driver de áudio.

1. Escolha **uma saída de áudio só para o chiaki-ng**, para o som de outros programas (notificações, música) não vazar para a transmissão. Pode ser a saída HDMI do monitor, fones, ou uma placa USB barata.
2. Mande o som do chiaki-ng para ela: **Configurações do Windows > Sistema > Som > Mixer de volume**, ache o chiaki-ng e escolha a saída dele.
3. Veja os nomes das saídas e anote um trecho do nome da escolhida:

```powershell
cd C:\lanhouse-ps5\host-agent
.\.venv\Scripts\python audio_loopback.py --list
```

4. Para rodar (em uma janela, antes do vídeo; troque o trecho do nome pela sua saída):

```powershell
.\.venv\Scripts\python audio_loopback.py --port 5004 --device "Headphones"
```

O capturador **escuta** em `127.0.0.1:5004` e o `start-video.ps1 -AudioPort 5004` conecta nele. Se um dos dois reiniciar, o script de vídeo reconecta sozinho. Se você não usar `--device`, ele captura a saída padrão do Windows, que muitas vezes não é a que o chiaki-ng usa (isso causou "silêncio" nos nossos testes).

### 3.6 O site

Se este PC roda o site: `npm start` na pasta do projeto (outra janela). Abra `http://localhost:3000` e crie a sua conta.

### 3.7 Vídeo, som e agente

Com o chiaki-ng aberto e o PS5 transmitindo, em três janelas do PowerShell na pasta `host-agent`:

```powershell
# janela 1: o som (veja o passo 3.5b; o trecho do nome é o da sua saída)
.\.venv\Scripts\python audio_loopback.py --port 5004 --device "Headphones"

# janela 2: captura a janela do chiaki-ng e publica vídeo + som (ajuste X, Y, W, H para a posição e o tamanho da janela)
.\start-video.ps1 -X 0 -Y 0 -W 1280 -H 720 -AudioPort 5004

# janela 3: o agente (o segredo é o HOST_SECRET do .env)
.\start-agent.ps1 -Server ws://localhost:3000 -Secret SEU_HOST_SECRET
```

Sem som, tire o `-AudioPort 5004` e não rode a janela 1. Se a placa não for NVIDIA, use `-Encoder x264` no `start-video.ps1`.

## 4. Teste de aceitação (faça nesta ordem)

1. **Painel do dono** (`/admin.html`): "PC do console: pronto (vídeo no ar)". Se disser "conectado, sem vídeo", o FFmpeg/MediaMTX não está publicando.
2. **Vídeo:** na página inicial aparece a tela do PS5 e o som do jogo toca ao clicar em "Ativar som" (o navegador começa mudo, por regra própria dele). Abra `/?debug=1` para ver fps, atraso do buffer, perda de pacotes e se o áudio está chegando.
3. **Fila:** crie duas contas de teste, dê um lance com Pix de mentira (`PIX_PROVIDER=mock`) e veja a vez começar.
4. **Controle:** na sua vez, aparece "CONTROLE LIGADO". Aperte as teclas: o PS5 deve responder.
   - Se **cima e baixo** nos analógicos estiverem ao contrário, reinicie o agente com `-InvertY`.
   - Se o **atraso** estiver grande, diminua para 720p e `-Bitrate 4M`.
5. **Soltar tudo:** durante a vez, feche a aba do navegador: os botões devem soltar na hora. Peça ao dono para encerrar o turno: o controle deve ser cortado.
6. **Queda:** feche o agente: o painel do dono mostra "desconectado" e o site para de iniciar turnos.
7. Só depois troque o Pix para o Mercado Pago (veja o `README.md`).

## 5. Colocar na internet

### Opção B (recomendada): site e vídeo na nuvem

1. Alugue um servidor Linux no Brasil (2 vCPU e 2 GB bastam para começar). Instale Node 24, o projeto e o MediaMTX nele.
2. Ponha o site atrás de **HTTPS** (por exemplo com Caddy, que emite o certificado sozinho). No `.env`: `COOKIE_SECURE=true`, `PUBLIC_BASE_URL=https://seusite.com.br`.
3. No `mediamtx.yml` do servidor: `webrtcAdditionalHosts: ['IP-PUBLICO-DO-SERVIDOR']`, `webrtcAllowOrigins: ['https://seusite.com.br']`. Libere no firewall do servidor: 443/TCP e a porta de mídia **8189/UDP** (e 8889/TCP se o MediaMTX ficar sem proxy).
4. No `.env` do site: `WHEP_URL=https://video.seusite.com.br/ps5/whep` (o MediaMTX atrás de HTTPS).
5. **No PC de casa**, aponte para a nuvem (só saída, nada de portas abertas em casa):
   - som: `.\.venv\Scripts\python audio_loopback.py --port 5004 --device "Headphones"`
   - vídeo: `.\start-video.ps1 -Publish whip -Url https://video.seusite.com.br/ps5/whip -X 0 -Y 0 -W 1280 -H 720 -AudioPort 5004`
   - agente: `.\start-agent.ps1 -Server wss://seusite.com.br -Secret SEU_HOST_SECRET`
6. Na nuvem, **proteja o WHIP**: só o PC de casa deve poder publicar (por exemplo, limitando por IP ou usando usuário e senha do MediaMTX). Sem isso, qualquer um poderia mandar vídeo no lugar do seu.

### Opção A: tudo em casa

Funciona, mas o MediaMTX precisa ser alcançável de fora: abra a **UDP 8189** (e a 8889) no roteador para o PC, ponha o IP público em `webrtcAdditionalHosts`, e exponha o site por HTTPS. Redes com CG-NAT (IP compartilhado pela operadora) não funcionam sem um servidor intermediário; nesse caso, use a opção B.

## 6. Deixar rodando sozinho

- No PC do console, desative a suspensão e o descanso de tela. Configure o Windows para entrar direto na conta ao ligar (ou use o Agendador de Tarefas).
- Crie uma tarefa no **Agendador de Tarefas** ("Ao fazer logon") para cada um: `start-mediamtx.ps1`, o chiaki-ng, `start-video.ps1` e `start-agent.ps1`. O vídeo e o agente já tentam reconectar sozinhos.
- Faça backup de `data\lanhouse.db` (contas e pedidos) todo dia.

## 7. Limitações conhecidas

- **Som:** vem da captura de uma saída de áudio do Windows (loopback); tudo o que tocar nessa saída vai para a transmissão. Se o site ficar mudo, quase sempre é a saída errada no `--device`. Som e vídeo vão juntos, mas a sincronia fina (lip sync) só se confirma com o PS5 de verdade.
- **WHIP com som (servidor na nuvem):** o FFmpeg só consegue publicar vídeo + som por WHIP se o MediaMTX anunciar **no máximo 2 endereços** (testado: com 3 falha). No servidor da nuvem use `webrtcIPsFromInterfaces: false` e `webrtcAdditionalHosts: [IP-PUBLICO]`. Em casa o padrão é RTSP local, que não tem esse limite.
- **Sem acesso ao botão PS:** é proposital. O jogador não consegue sair do jogo, trocar de usuário ou desligar o console pelo controle.
- **Troca de jogo:** como não há botão PS, quem muda o jogo é o dono (pelo chiaki-ng ou pelo controle físico).
- **Atraso:** soma Remote Play + captura + WebRTC. Em rede local costuma ficar na casa de 100 a 250 ms; a internet do jogador soma mais. Jogos de ação rápida sentem. Isso só se mede de verdade com o PS5 ligado.
- **O ViGEmBus está arquivado** e o `vgamepad` depende dele. Se um dia parar de funcionar no Windows, será preciso trocar o controle virtual.
- **Termos da Sony e das desenvolvedoras:** confira antes de cobrar (veja o `README.md`).

## 8. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Painel: "desconectado" | Agente fora do ar, segredo diferente do `HOST_SECRET`, ou o endereço `ws://`/`wss://` errado |
| Painel: "conectado, sem vídeo" | O `start-video.ps1` parou, o MediaMTX não está rodando, ou o caminho `ps5` não está publicando |
| Vídeo preto | A janela do chiaki-ng não está na área capturada; confira `-X -Y -W -H` e o monitor (`-Monitor`) |
| O PS5 não responde às teclas | O chiaki-ng não está usando o controle virtual (passo 3.4), ou há outro controle conectado |
| Chiaki não acha o PS5 | PS5 em outra rede/Wi-Fi, Remote Play desligado, ou firewall do Windows bloqueando o chiaki-ng |
| Sem som no site | Clique em "Ativar som"; o `--device` aponta para a saída errada (o chiaki-ng toca em outra); o capturador não está rodando (o `/?debug=1` mostra "sem audio") |
| Muito atraso | Cabo de rede nos dois, 720p, bitrate menor, `-Encoder nvenc` |
