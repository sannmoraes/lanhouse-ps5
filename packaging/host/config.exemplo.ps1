# Configuração do PC do PS5. O instalador copia este arquivo para config.ps1 e preenche o servidor e o segredo.
# Edite o config.ps1 (não este) e rode iniciar-tudo.ps1 de novo para valer.

$Config = @{
  # 'local' = o MediaMTX roda neste PC (padrão, mais simples).
  # 'nuvem' = o vídeo é enviado para um MediaMTX na internet (veja docs\INSTALACAO-NO-PS5.md, seção 5). Neste modo o
  #           agente não consegue conferir se a imagem congelou (a API do MediaMTX fica na nuvem).
  Modo             = 'local'

  # Endereço do SITE: ws://IP:3000 (rede local) ou wss://seusite.com.br (internet, com HTTPS).
  Servidor         = 'ws://localhost:3000'

  # O mesmo HOST_SECRET do .env do site.
  Segredo          = 'COLE-AQUI-O-HOST_SECRET'

  # $true = controle virtual DualShock 4 (precisa do driver ViGEmBus). $false = só mostra os botões (teste sem driver).
  ControleVirtual  = $true

  # $true = manda uma imagem de teste no lugar da tela do PS5 (para testar sem o chiaki-ng).
  ImagemDeTeste    = $false

  # Área da tela capturada: deve coincidir com a janela do chiaki-ng (modo janela, sem nada por cima).
  Monitor          = 0
  X                = 0
  Y                = 0
  Largura          = 1280
  Altura           = 720
  Fps              = 60
  Bitrate          = '6M'

  # 'nvenc' (placa NVIDIA) ou 'x264' (processador).
  Encoder          = 'nvenc'

  # Som: trecho do nome da saída de áudio por onde o chiaki-ng toca. Veja os nomes com:
  #   .\.venv\Scripts\python audio_loopback.py --list
  # Deixe '' para transmitir sem som.
  AudioDispositivo = ''
  AudioPorta       = 5004

  # Só no modo 'nuvem': endereço WHIP do MediaMTX da nuvem (ex.: https://video.seusite.com.br/ps5/whip).
  UrlNuvem         = ''
}
