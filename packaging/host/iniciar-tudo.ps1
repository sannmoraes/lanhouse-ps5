# Liga tudo do PC do PS5, cada parte numa janela (assim você vê os avisos de cada uma):
#   MediaMTX (vídeo) -> capturador de som -> vídeo -> agente (botões).
# Para parar: .\parar-tudo.ps1.   Antes de tudo: o chiaki-ng deve estar aberto e conectado ao PS5.
param([switch]$Minimizado)   # abre as janelas minimizadas (o PC do PS5 fica mais limpo)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$cfgPath = Join-Path $here 'config.ps1'
if (-not (Test-Path $cfgPath)) { throw 'config.ps1 não existe. Rode .\instalar.ps1 primeiro.' }
. $cfgPath
if ($Config.Segredo -match 'COLE-AQUI|^$') { throw 'Preencha o Segredo no config.ps1 (o HOST_SECRET do site).' }
if ($Config.Servidor -notmatch '^wss?://') { throw 'config.ps1: Servidor precisa começar com ws:// ou wss://.' }

$runDir = Join-Path $here 'run'
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$pidFile = Join-Path $runDir 'pids.txt'
if (Test-Path $pidFile) {
  $vivos = Get-Content $pidFile | ForEach-Object { Get-Process -Id ([int]$_) -ErrorAction SilentlyContinue } | Where-Object { $_ }
  if ($vivos) { throw 'Já tem coisa rodando (veja as janelas). Rode .\parar-tudo.ps1 antes de iniciar de novo.' }
}
Set-Content -Path $pidFile -Value @()

$venvPy = Join-Path $here '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) { throw 'Falta o ambiente Python. Rode .\instalar.ps1.' }

function Abrir($titulo, [string[]]$argumentos) {
  $estilo = if ($Minimizado) { 'Minimized' } else { 'Normal' }
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList (@('-NoProfile', '-NoExit') + $argumentos) -WorkingDirectory $here -WindowStyle $estilo -PassThru
  Add-Content -Path $pidFile -Value $p.Id
  Write-Host ("  {0,-22} (PID {1})" -f $titulo, $p.Id)
  return $p
}

Write-Host 'Iniciando...' -ForegroundColor White

# 1. MediaMTX (só no modo local)
if ($Config.Modo -eq 'nuvem') {
  Write-Host '  (modo nuvem: sem MediaMTX local)'
} else {
  $null = Abrir 'MediaMTX' @('-File', (Join-Path $here 'start-mediamtx.ps1'))
  Start-Sleep -Seconds 2
}

# 2. som
$comSom = ($Config.AudioDispositivo -ne '' -and $Config.AudioPorta -gt 0)
if ($comSom) {
  $cmd = "& '$venvPy' -u 'audio_loopback.py' --port $($Config.AudioPorta) --device '$($Config.AudioDispositivo)'"
  $null = Abrir 'Som (loopback)' @('-Command', $cmd)
  Start-Sleep -Seconds 2
} else {
  Write-Host '  (sem som: AudioDispositivo vazio)'
}

# 3. vídeo
$v = @('-File', (Join-Path $here 'start-video.ps1'),
  '-Monitor', $Config.Monitor, '-X', $Config.X, '-Y', $Config.Y, '-W', $Config.Largura, '-H', $Config.Altura,
  '-Fps', $Config.Fps, '-Bitrate', $Config.Bitrate, '-Encoder', $Config.Encoder)
if ($comSom) { $v += @('-AudioPort', $Config.AudioPorta) }
if ($Config.ImagemDeTeste) { $v += '-TestPattern' }
if ($Config.Modo -eq 'nuvem') {
  if (-not $Config.UrlNuvem) { throw "Modo 'nuvem' pede UrlNuvem no config.ps1." }
  $v += @('-Publish', 'whip', '-Url', $Config.UrlNuvem)
}
$null = Abrir 'Vídeo' ($v | ForEach-Object { "$_" })
Start-Sleep -Seconds 3

# 4. agente (o segredo vai por variável de ambiente, não pela linha de comando)
$env:HOST_SECRET = $Config.Segredo
$a = @('-File', (Join-Path $here 'start-agent.ps1'), '-Server', $Config.Servidor)
if (-not $Config.ControleVirtual) { $a += '-DryRun' }
if ($Config.Modo -eq 'nuvem') { $a += '-NoVideoCheck' }
$null = Abrir 'Agente (botões)' $a
Remove-Item Env:\HOST_SECRET -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'Pronto. Abra o painel do dono do site (/admin.html): deve mostrar "PC do console: pronto (vídeo no ar)".' -ForegroundColor Green
Write-Host 'Para parar tudo: .\parar-tudo.ps1' -ForegroundColor Green
