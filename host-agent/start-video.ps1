# Captura uma area da tela (a janela do chiaki-ng) e publica no MediaMTX, com audio opcional.
# Padrao: RTSP para o MediaMTX do proprio PC (robusto). Para um MediaMTX na nuvem use  -Publish whip -Url https://.../ps5/whip
# Exemplos:
#   .\start-video.ps1 -X 0 -Y 0 -W 1280 -H 720                 # so video
#   .\start-video.ps1 -X 0 -Y 0 -W 1280 -H 720 -AudioPort 5004  # video + som (rode antes: python audio_loopback.py --port 5004)
#   .\start-video.ps1 -TestPattern -AudioPort 5004               # imagem de teste no lugar do PS5
#   .\start-video.ps1 -Publish whip -Url https://video.seusite.com.br/ps5/whip -AudioPort 5004   # servidor de video na nuvem
# Deixe a janela do chiaki-ng exatamente nessa area do monitor, sem nada por cima.
param(
  [int]$Monitor = 0,                 # numero do monitor (0 = principal)
  [int]$X = 0, [int]$Y = 0,          # canto superior esquerdo da area
  [int]$W = 1280, [int]$H = 720,     # tamanho da area (use o mesmo da janela do chiaki-ng)
  [int]$Fps = 60,
  [string]$Bitrate = '6M',
  [ValidateSet('rtsp', 'whip')][string]$Publish = 'rtsp',   # como entregar ao MediaMTX
  [string]$Url = '',                 # padrao: rtsp://127.0.0.1:8554/ps5  (ou http://127.0.0.1:8889/ps5/whip no modo whip)
  [ValidateSet('nvenc', 'x264')][string]$Encoder = 'nvenc',  # nvenc = placa NVIDIA; x264 = processador
  [int]$AudioPort = 0,               # porta TCP local do som (audio_loopback.py precisa estar rodando); 0 = sem audio
  [switch]$TestPattern               # usa uma imagem de teste em vez de capturar a tela
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw 'FFmpeg nao encontrado. Instale: winget install Gyan.FFmpeg' }

if (-not $Url) { $Url = if ($Publish -eq 'rtsp') { 'rtsp://127.0.0.1:8554/ps5' } else { 'http://127.0.0.1:8889/ps5/whip' } }
$outFmt = if ($Publish -eq 'rtsp') { @('-f', 'rtsp', '-rtsp_transport', 'tcp') } else { @('-f', 'whip') }

# ---- video: de onde vem ----
if ($TestPattern) {
  $inV = @('-re', '-f', 'lavfi', '-i', "testsrc2=size=${W}x${H}:rate=$Fps")
  $vf = @('-vf', 'format=yuv420p')
} else {
  $inV = @('-f', 'lavfi', '-i', "ddagrab=output_idx=${Monitor}:framerate=${Fps}:offset_x=${X}:offset_y=${Y}:video_size=${W}x${H}")
  # ddagrab entrega quadros na GPU: o nvenc le direto; o x264 precisa baixar para a memoria
  $vf = if ($Encoder -eq 'x264') { @('-vf', 'hwdownload,format=bgra,format=yuv420p') } else { @() }
}

# ---- video: como codifica (baixa latencia, H.264 baseline, que o WebRTC aceita em qualquer navegador) ----
if ($Encoder -eq 'nvenc') {
  $encV = @('-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'll', '-rc', 'cbr', '-b:v', $Bitrate, '-bf', '0', '-g', "$Fps", '-profile:v', 'baseline')
} else {
  $encV = @('-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', $Bitrate, '-maxrate', $Bitrate, '-bufsize', $Bitrate, '-bf', '0', '-g', "$Fps", '-profile:v', 'baseline')
}

# ---- audio (opcional): PCM vindo do audio_loopback.py por TCP local, codificado em Opus de baixa latencia ----
# Sem 'use_wallclock_as_timestamps': com o relogio do Windows o audio ficava ~1,7 bilhao de segundos "no futuro" e o
# FFmpeg segurava os pacotes de audio para sempre esperando o video alcanca-los.
if ($AudioPort -gt 0) {
  $inA = @('-f', 's16le', '-ar', '48000', '-ac', '2', '-thread_queue_size', '512', '-probesize', '32', '-analyzeduration', '0', '-i', "tcp://127.0.0.1:${AudioPort}")
  $encA = @('-c:a', 'libopus', '-b:a', '96k', '-ar', '48000', '-ac', '2', '-application', 'lowdelay', '-frame_duration', '20', '-af', 'aresample=async=1000', '-shortest')
  $map = @('-map', '0:v:0', '-map', '1:a:0')  # -shortest (acima): se o audio_loopback cair, o FFmpeg sai e o laco abaixo reconecta tudo
} else {
  $inA = @(); $encA = @('-an'); $map = @()
}

Write-Host ("Publicando {0}x{1}@{2}{3} em {4} (Ctrl+C para parar)" -f $W, $H, $Fps, $(if ($AudioPort -gt 0) { " + audio (tcp $AudioPort)" } else { ' sem audio' }), $Url)
while ($true) {
  # Se o MediaMTX ainda nao estiver no ar ou a conexao cair, tenta de novo.
  & ffmpeg -hide_banner -loglevel warning @inV @inA @map @vf @encV @encA @outFmt $Url
  Write-Host 'Publicacao parou. Tentando de novo em 3 s...'
  Start-Sleep 3
}
