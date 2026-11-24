# Instalador do PC do PS5. Rode no PowerShell, dentro desta pasta:   .\instalar.ps1
# Ele confere o que falta, instala só o que você aprovar e termina rodando o diagnóstico.
# Parâmetros (para testes): -Automatico (responde "sim" a tudo), -SemControleVirtual, -MediaMtxZip <arquivo.zip>,
#                           -Servidor ws://..., -Segredo ...
param(
  [switch]$Automatico,
  [switch]$SemControleVirtual,
  [string]$MediaMtxZip = '',
  [string]$Servidor = '',
  [string]$Segredo = ''
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

# MediaMTX: versão e hash fixos. O arquivo baixado só é usado se o SHA-256 bater.
$MtxVersion = 'v1.21.4'
$MtxUrl = "https://github.com/bluenviron/mediamtx/releases/download/$MtxVersion/mediamtx_${MtxVersion}_windows_amd64.zip"
$MtxSha256 = '835645b2700ffce4d2b6cb04bfa0aadce95335da6dfc0d7c2114e6da585734f8'

function Ok($m)   { Write-Host "[OK]     $m" -ForegroundColor Green }
function Info($m) { Write-Host "[...]    $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[ATENÇÃO] $m" -ForegroundColor Yellow }
function Falha($m) { Write-Host "[FALHOU] $m" -ForegroundColor Red }
function Pergunta($q) {
  if ($Automatico) { return $true }
  $r = Read-Host "$q [S/n]"
  return ($r -eq '' -or $r -match '^[sSyY]')
}

Write-Host ''
Write-Host '=== Instalador do PC do PS5 ===' -ForegroundColor White
Write-Host ''

# ---------- 1. Python ----------
$py = $null
foreach ($cand in @(@('py', '-3'), @('python'))) {
  try {
    $exe = $cand[0]
    $extra = @($cand | Select-Object -Skip 1)
    $v = & $exe @extra -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
    if ($LASTEXITCODE -eq 0 -and $v -match '^(\d+)\.(\d+)$' -and ([int]$Matches[1] -gt 3 -or ([int]$Matches[1] -eq 3 -and [int]$Matches[2] -ge 10))) {
      $py = @{ Exe = $exe; Extra = $extra; Version = $v }
      break
    }
  } catch { }
}
if ($py) {
  Ok "Python $($py.Version)"
} else {
  Falha 'Python 3.10 ou mais novo não encontrado.'
  if (Pergunta 'Instalar o Python 3.12 agora com o winget?') {
    winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
    Warn 'Feche este PowerShell, abra outro e rode .\instalar.ps1 de novo.'
  } else {
    Warn 'Instale o Python (python.org) e rode .\instalar.ps1 de novo.'
  }
  exit 1
}

# ---------- 2. FFmpeg ----------
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
  Falha 'FFmpeg não encontrado.'
  if (Pergunta 'Instalar o FFmpeg agora com o winget?') {
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    Warn 'Feche este PowerShell, abra outro e rode .\instalar.ps1 de novo (o ffmpeg precisa entrar no caminho).'
  } else {
    Warn 'Instale o FFmpeg (winget install Gyan.FFmpeg) e rode .\instalar.ps1 de novo.'
  }
  exit 1
}
$enc = & ffmpeg -hide_banner -encoders 2>$null | Out-String
$mux = & ffmpeg -hide_banner -muxers 2>$null | Out-String
if ($mux -notmatch '\brtsp\b') { Falha 'Este FFmpeg não tem o formato RTSP. Instale a versão "full" (winget install Gyan.FFmpeg).'; exit 1 }
$temNvenc = $enc -match 'h264_nvenc'
Ok ("FFmpeg encontrado" + $(if ($temNvenc) { ' (com NVENC: use Encoder = nvenc)' } else { ' (sem NVENC: use Encoder = x264 no config.ps1)' }))

# ---------- 3. ambiente Python ----------
$venvPy = Join-Path $here '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
  Info 'Criando o ambiente Python (.venv)...'
  & $py.Exe @($py.Extra) -m venv (Join-Path $here '.venv')
}
Info 'Instalando websockets, soundcard e numpy...'
& $venvPy -m pip install --disable-pip-version-check -q websockets soundcard numpy
if ($LASTEXITCODE -ne 0) { Falha 'Não consegui instalar as bibliotecas (sem internet?).'; exit 1 }
Ok 'Bibliotecas básicas instaladas'

# ---------- 4. controle virtual ----------
if ($SemControleVirtual) {
  Warn 'Controle virtual pulado. No config.ps1 deixe ControleVirtual = $false para testar sem ele.'
} else {
  Write-Host ''
  Warn 'O controle virtual usa o driver ViGEmBus. A biblioteca "vgamepad" pode abrir o instalador desse driver'
  Warn '(o Windows vai pedir permissão de administrador). O projeto do driver foi arquivado em 2023, mas funciona.'
  if (Pergunta 'Instalar o controle virtual (vgamepad) agora?') {
    & $venvPy -m pip install --disable-pip-version-check -q vgamepad
    if ($LASTEXITCODE -ne 0) { Falha 'A instalação do vgamepad falhou. Veja docs\INSTALACAO-NO-PS5.md, passo 3.4.' } else { Ok 'vgamepad instalado' }
  } else {
    Warn 'Pulado. Instale depois com:  .\.venv\Scripts\pip install vgamepad'
  }
}
if (-not (Get-Service -Name ViGEmBus -ErrorAction SilentlyContinue)) {
  Warn 'O serviço do driver ViGEmBus não aparece. Sem ele não há controle virtual. Instale o driver (GitHub nefarius/ViGEmBus, lançamentos) e reinicie o PC.'
}

# ---------- 5. MediaMTX ----------
$mtxExe = Join-Path $here 'mediamtx.exe'
if (Test-Path $mtxExe) {
  Ok 'mediamtx.exe já está na pasta'
} else {
  $zip = $MediaMtxZip
  if (-not $zip) {
    Write-Host ''
    Info "O MediaMTX $MtxVersion (servidor de vídeo, ~29 MB) será baixado de:"
    Info "  $MtxUrl"
    Info "  e conferido pelo SHA-256 $MtxSha256"
    if (Pergunta 'Baixar agora?') {
      $zip = Join-Path $env:TEMP "mediamtx_$MtxVersion.zip"
      Invoke-WebRequest -Uri $MtxUrl -OutFile $zip -UseBasicParsing
    } else {
      Warn 'Pulado. Baixe o mediamtx_..._windows_amd64.zip do GitHub bluenviron/mediamtx e coloque o mediamtx.exe nesta pasta.'
    }
  }
  if ($zip) {
    $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower()
    if ($got -ne $MtxSha256) {
      Falha "O arquivo do MediaMTX NÃO confere (SHA-256 $got). Não vou usar. Apague-o e tente de novo."
      exit 1
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [System.IO.Compression.ZipFile]::OpenRead($zip)
    try {
      $entry = $z.Entries | Where-Object { $_.Name -eq 'mediamtx.exe' } | Select-Object -First 1
      if (-not $entry) { Falha 'mediamtx.exe não está no zip.'; exit 1 }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $mtxExe, $true)
    } finally { $z.Dispose() }
    Ok "MediaMTX $MtxVersion instalado (hash conferido)"
  }
}

# ---------- 6. config.ps1 ----------
$cfg = Join-Path $here 'config.ps1'
if (-not (Test-Path $cfg)) {
  Copy-Item (Join-Path $here 'config.exemplo.ps1') $cfg
  $text = Get-Content -Raw -Encoding UTF8 $cfg
  if (-not $Servidor -and -not $Automatico) {
    $Servidor = Read-Host 'Endereço do site (ex.: ws://192.168.1.10:3000 ou wss://seusite.com.br) [Enter = ws://localhost:3000]'
  }
  if (-not $Segredo -and -not $Automatico) {
    $Segredo = Read-Host 'HOST_SECRET do site (o mesmo do .env do site; Enter para preencher depois)'
  }
  if ($Servidor) { $text = $text.Replace("'ws://localhost:3000'", "'$Servidor'") }
  if ($Segredo) { $text = $text.Replace("'COLE-AQUI-O-HOST_SECRET'", "'$Segredo'") }
  if (-not $temNvenc) { $text = $text.Replace("Encoder          = 'nvenc'", "Encoder          = 'x264'") }
  Set-Content -Path $cfg -Value $text -Encoding UTF8
  Ok 'config.ps1 criado (edite-o para ajustar a área da tela, o som etc.)'
} else {
  Ok 'config.ps1 já existe (mantido)'
}

# ---------- 7. diagnóstico ----------
Write-Host ''
& (Join-Path $here 'diagnostico.ps1')
Write-Host ''
Write-Host 'Próximos passos: leia o LEIA-ME.txt (instalar o chiaki-ng e registrar o PS5) e depois rode .\iniciar-tudo.ps1' -ForegroundColor White
