# Instalador do SITE. Rode no PowerShell, dentro desta pasta:   .\instalar-site.ps1
# Confere o Node, instala a dependência, cria o .env com senhas ALEATÓRIAS e mostra o que você precisa anotar.
# Parâmetros (para testes): -Automatico, -Ip <endereço do PC na rede>, -Porta <3000>
param(
  [switch]$Automatico,
  [string]$Ip = '',
  [int]$Porta = 3000
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

function Ok($m)   { Write-Host "[OK]     $m" -ForegroundColor Green }
function Info($m) { Write-Host "[...]    $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[ATENÇÃO] $m" -ForegroundColor Yellow }
function Falha($m) { Write-Host "[FALHOU] $m" -ForegroundColor Red }
function Pergunta($q) {
  if ($Automatico) { return $true }
  $r = Read-Host "$q [S/n]"
  return ($r -eq '' -or $r -match '^[sSyY]')
}
function Segredo([int]$bytes = 24) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return ([Convert]::ToBase64String($b)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

Write-Host ''
Write-Host '=== Instalador do site ===' -ForegroundColor White

# ---------- Node ----------
$nodeOk = $false
try {
  $v = (& node -v 2>$null)
  if ($v -match '^v(\d+)\.') {
    if ([int]$Matches[1] -ge 24) { $nodeOk = $true; Ok "Node $v" } else { Falha "Node $v é antigo: o site precisa do Node 24 ou mais novo (usa o SQLite embutido)." }
  }
} catch { }
if (-not $nodeOk) {
  if (-not $v) { Falha 'Node não encontrado.' }
  if (Pergunta 'Instalar o Node.js LTS agora com o winget?') {
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    Warn 'Feche este PowerShell, abra outro e rode .\instalar-site.ps1 de novo. Confira com "node -v" (precisa ser 24 ou mais).'
  } else {
    Warn 'Instale o Node 24 ou mais novo (nodejs.org) e rode .\instalar-site.ps1 de novo.'
  }
  exit 1
}

# ---------- dependência ----------
Info 'Instalando a dependência do site (ws)...'
& npm ci --omit=dev --no-audit --no-fund 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  & npm install --omit=dev --no-audit --no-fund 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Falha 'npm não conseguiu instalar (sem internet?).'; exit 1 }
}
if (-not (Test-Path (Join-Path $here 'node_modules\ws'))) { Falha 'A dependência ws não foi instalada.'; exit 1 }
Ok 'Dependência instalada'
New-Item -ItemType Directory -Force -Path (Join-Path $here 'data') | Out-Null

# ---------- .env ----------
$envFile = Join-Path $here '.env'
if (Test-Path $envFile) {
  Ok '.env já existe (mantido). As senhas continuam as de antes.'
} else {
  if (-not $Ip) {
    $cands = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -ExpandProperty IPAddress)
    $sug = if ($cands.Count) { $cands[0] } else { 'localhost' }
    if ($Automatico) { $Ip = $sug } else {
      $r = Read-Host "Endereço deste PC na rede, usado no link do vídeo [Enter = $sug]"
      $Ip = if ($r) { $r } else { $sug }
    }
  }
  $admin = Segredo 18
  $host_ = Segredo 24
  $text = Get-Content -Raw -Encoding UTF8 (Join-Path $here '.env.example')
  $text = $text -replace '(?m)^PORT=.*$', "PORT=$Porta"
  $text = $text -replace '(?m)^ADMIN_PASSWORD=.*$', "ADMIN_PASSWORD=$admin"
  $text = $text -replace '(?m)^HOST_SECRET=.*$', "HOST_SECRET=$host_"
  $text = $text -replace '(?m)^WHEP_URL=.*$', "WHEP_URL=http://${Ip}:8889/ps5/whep"
  Set-Content -Path $envFile -Value $text -Encoding UTF8
  Ok '.env criado com senhas aleatórias'
  Write-Host ''
  Write-Host '  ANOTE (e não compartilhe):' -ForegroundColor Yellow
  Write-Host "    Senha do painel do dono (/admin.html): $admin"
  Write-Host "    HOST_SECRET (vai no config.ps1 do PC do PS5): $host_"
  Write-Host '    Os dois também estão no arquivo .env desta pasta.'
}

Write-Host ''
Write-Host "Para ligar o site:  .\iniciar-site.ps1     (abre em http://localhost:$Porta)" -ForegroundColor White
Write-Host 'Pix: o padrão é o Pix de MENTIRA (PIX_PROVIDER=mock). Para cobrar de verdade, veja o README.md (Mercado Pago).' -ForegroundColor White
Write-Host 'Antes de abrir ao público: HTTPS, COOKIE_SECURE=true e o checklist do README.md.' -ForegroundColor White
