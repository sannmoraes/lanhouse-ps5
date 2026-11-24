# Confere se o PC do PS5 está pronto. Não muda nada. Rode quando algo não funcionar:   .\diagnostico.ps1
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$falhas = 0; $avisos = 0
function Ok($m)    { Write-Host "[OK]      $m" -ForegroundColor Green }
function Aviso($m) { $script:avisos++; Write-Host "[ATENÇÃO] $m" -ForegroundColor Yellow }
function Falta($m) { $script:falhas++; Write-Host "[FALTA]   $m" -ForegroundColor Red }

Write-Host '=== Diagnóstico do PC do PS5 ===' -ForegroundColor White

# config
$cfgPath = Join-Path $here 'config.ps1'
$Config = $null
if (Test-Path $cfgPath) {
  try { . $cfgPath; Ok 'config.ps1 encontrado' } catch { Falta "config.ps1 com erro: $($_.Exception.Message)" }
} else { Falta 'config.ps1 não existe (rode .\instalar.ps1)' }
if ($Config) {
  if ($Config.Segredo -match 'COLE-AQUI|^$') { Falta 'config.ps1: o Segredo ainda não foi preenchido (use o HOST_SECRET do site)' } else { Ok 'Segredo preenchido' }
  if ($Config.Servidor -notmatch '^wss?://') { Falta "config.ps1: Servidor precisa começar com ws:// ou wss:// (está: $($Config.Servidor))" }
}

# python e bibliotecas
$venvPy = Join-Path $here '.venv\Scripts\python.exe'
if (Test-Path $venvPy) {
  Ok 'Ambiente Python (.venv)'
  foreach ($mod in 'websockets', 'soundcard', 'numpy') {
    & $venvPy -c "import $mod" 2>$null
    if ($LASTEXITCODE -eq 0) { Ok "Biblioteca $mod" } else { Falta "Biblioteca $mod (rode .\instalar.ps1)" }
  }
  & $venvPy -c "import vgamepad" 2>$null
  if ($LASTEXITCODE -eq 0) { Ok 'Biblioteca vgamepad (controle virtual)' }
  elseif ($Config -and $Config.ControleVirtual -eq $false) { Aviso 'vgamepad não instalado (ok: ControleVirtual = $false)' }
  else { Falta 'vgamepad não instalado: sem ele não há controle virtual' }
} else { Falta 'Ambiente Python (.venv) não existe (rode .\instalar.ps1)' }

# driver
if (Get-Service -Name ViGEmBus -ErrorAction SilentlyContinue) { Ok 'Driver ViGEmBus (controle virtual)' }
elseif ($Config -and $Config.ControleVirtual -eq $false) { Aviso 'Driver ViGEmBus ausente (ok: ControleVirtual = $false)' }
else { Falta 'Driver ViGEmBus não instalado' }

# ffmpeg
$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ff) {
  Ok 'FFmpeg'
  $enc = & ffmpeg -hide_banner -encoders 2>$null | Out-String
  if ($Config -and $Config.Encoder -eq 'nvenc' -and $enc -notmatch 'h264_nvenc') { Falta "Encoder = 'nvenc', mas este FFmpeg não tem NVENC (use 'x264')" }
  elseif ($enc -match 'h264_nvenc') { Ok 'NVENC disponível (a placa precisa ser NVIDIA)' }
} else { Falta 'FFmpeg não está no caminho' }

# mediamtx
$mtx = Join-Path $here 'mediamtx.exe'
if ($Config -and $Config.Modo -eq 'nuvem') { Aviso 'Modo nuvem: o MediaMTX local não é usado' }
elseif (Test-Path $mtx) { Ok 'mediamtx.exe' } else { Falta 'mediamtx.exe não está na pasta (rode .\instalar.ps1)' }

# chiaki-ng
$chiaki = $false
foreach ($k in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*') {
  if (Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'chiaki' }) { $chiaki = $true }
}
if (-not $chiaki -and (Get-Process -Name 'chiaki*' -ErrorAction SilentlyContinue)) { $chiaki = $true }
if ($chiaki) { Ok 'chiaki-ng encontrado' }
elseif ($Config -and $Config.ImagemDeTeste) { Aviso 'chiaki-ng não encontrado (ok: ImagemDeTeste = $true)' }
else { Aviso 'chiaki-ng não encontrado: instale e registre o PS5 (veja o LEIA-ME.txt)' }

# saída de áudio
if ($Config -and $Config.AudioDispositivo -and (Test-Path $venvPy)) {
  $lista = & $venvPy (Join-Path $here 'audio_loopback.py') --list 2>$null | Out-String
  if ($lista -match [regex]::Escape($Config.AudioDispositivo)) { Ok "Saída de áudio '$($Config.AudioDispositivo)' encontrada" }
  else { Falta "Nenhuma saída de áudio com '$($Config.AudioDispositivo)' no nome. Veja as opções: .\.venv\Scripts\python audio_loopback.py --list" }
} elseif ($Config) { Aviso 'AudioDispositivo vazio: a transmissão vai SEM som' }

# site alcançável?
if ($Config -and $Config.Servidor -match '^wss?://') {
  $http = $Config.Servidor -replace '^ws', 'http'
  try {
    $r = Invoke-RestMethod -Uri ($http.TrimEnd('/') + '/api/state') -TimeoutSec 5
    Ok "Site respondendo em $http (console: $($r.console))"
  } catch { Falta "O site não responde em $http (está rodando? o endereço está certo?)" }
}

# MediaMTX no ar?
try {
  $p = Invoke-RestMethod -Uri 'http://127.0.0.1:9997/v3/paths/get/ps5' -TimeoutSec 2
  if ($p.ready) { Ok "MediaMTX no ar e recebendo vídeo ($($p.tracks -join ', '))" } else { Aviso 'MediaMTX no ar, mas ainda sem vídeo' }
} catch { Aviso 'MediaMTX não está rodando agora (normal se ainda não iniciou)' }

Write-Host ''
if ($falhas -eq 0) { Write-Host "Tudo certo ($avisos aviso(s))." -ForegroundColor Green } else { Write-Host "$falhas item(ns) faltando, $avisos aviso(s)." -ForegroundColor Red }
