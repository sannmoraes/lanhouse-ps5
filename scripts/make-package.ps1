# Monta os dois pacotes em dist\:
#   lanhouse-ps5-host.zip  (PC do PS5)      lanhouse-ps5-site.zip  (servidor do site)
# Uso (na pasta do projeto):  powershell -File scripts\make-package.ps1
# Não entram: .env, bancos de dados, node_modules, .venv, mediamtx.exe, caches, chaves. Os .ps1 e .txt vão em UTF-8 com BOM
# (o PowerShell 5.1 do Windows precisa disso para ler os acentos).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

# garante que public/ esteja atualizado
& node scripts/build.js | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'node scripts/build.js falhou' }

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function New-Pacote($nome, $pasta, $arquivos) {
  # $arquivos: lista de @{ De = 'caminho relativo ao projeto'; Para = 'caminho dentro do pacote' }
  $zipPath = Join-Path $dist "$nome.zip"
  if (Test-Path $zipPath) { Remove-Item $zipPath }
  $zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
  $utf8Bom = New-Object System.Text.UTF8Encoding($true)
  try {
    foreach ($a in $arquivos) {
      $src = Join-Path $root $a.De
      if (-not (Test-Path $src -PathType Leaf)) { throw "Arquivo faltando: $($a.De)" }
      $entryName = ("$pasta/" + $a.Para).Replace('\', '/')
      $entry = $zip.CreateEntry($entryName, 'Optimal')
      $out = $entry.Open()
      try {
        if ($src -match '\.(ps1|txt)$') {
          $txt = [System.IO.File]::ReadAllText($src, [System.Text.Encoding]::UTF8)
          $txt = $txt -replace "(?<!`r)`n", "`r`n"   # fim de linha do Windows
          $bytes = $utf8Bom.GetPreamble() + $utf8Bom.GetBytes($txt)
          $out.Write($bytes, 0, $bytes.Length)
        } else {
          $bytes = [System.IO.File]::ReadAllBytes($src)
          $out.Write($bytes, 0, $bytes.Length)
        }
      } finally { $out.Dispose() }
    }
  } finally { $zip.Dispose() }
  return $zipPath
}

function Lista-Pasta($dirRelativo, $destino, $filtro) {
  Get-ChildItem (Join-Path $root $dirRelativo) -Recurse -File | Where-Object { & $filtro $_ } | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1)
    @{ De = $rel; Para = ($destino + '/' + $rel.Substring($dirRelativo.Length + 1)).TrimStart('/') }
  }
}

# ---------- host ----------
$host_ = @()
$agente = 'agent.py', 'padmap.py', 'videowatch.py', 'audio_loopback.py', 'audiopacer.py', 'start-agent.ps1', 'start-video.ps1', 'start-mediamtx.ps1', 'mediamtx.yml', 'requirements.txt'
foreach ($f in $agente) { $host_ += @{ De = "host-agent\$f"; Para = $f } }
foreach ($f in 'instalar.ps1', 'diagnostico.ps1', 'iniciar-tudo.ps1', 'parar-tudo.ps1', 'config.exemplo.ps1', 'LEIA-ME.txt') { $host_ += @{ De = "packaging\host\$f"; Para = $f } }
$host_ += @{ De = 'docs\INSTALACAO-NO-PS5.md'; Para = 'docs/INSTALACAO-NO-PS5.md' }
$host_ += @{ De = 'docs\TESTE-LOCAL.md'; Para = 'docs/TESTE-LOCAL.md' }
$zipHost = New-Pacote 'lanhouse-ps5-host' 'lanhouse-ps5-host' $host_

# ---------- site ----------
$site = @()
$site += Lista-Pasta 'server' 'server' { param($f) $f.Extension -eq '.js' }
$site += Lista-Pasta 'public' 'public' { param($f) $true }
foreach ($f in 'package.json', 'package-lock.json', '.env.example', 'README.md', 'LICENSE', 'NOTICE') { $site += @{ De = $f; Para = $f } }
foreach ($f in 'instalar-site.ps1', 'iniciar-site.ps1', 'LEIA-ME.txt') { $site += @{ De = "packaging\site\$f"; Para = $f } }
foreach ($f in 'ARQUITETURA.md', 'INSTALACAO-NO-PS5.md', 'TESTE-LOCAL.md') { $site += @{ De = "docs\$f"; Para = "docs/$f" } }
$zipSite = New-Pacote 'lanhouse-ps5-site' 'lanhouse-ps5-site' $site

# ---------- conferência de segurança ----------
$proibidos = '\.env$', '\.db', '\.key$', '\.crt$', 'node_modules', '\.venv', 'mediamtx\.exe', '__pycache__', 'agent\.log', 'config\.ps1$'
foreach ($z in $zipHost, $zipSite) {
  $zf = [System.IO.Compression.ZipFile]::OpenRead($z)
  try {
    foreach ($e in $zf.Entries) {
      foreach ($p in $proibidos) { if ($e.FullName -match $p -and $e.FullName -notmatch '\.env\.example$') { throw "Arquivo proibido no pacote $z : $($e.FullName)" } }
    }
    $n = $zf.Entries.Count
  } finally { $zf.Dispose() }
  Write-Host ("{0}  ({1} arquivos, {2:N0} KB)" -f (Split-Path $z -Leaf), $n, ((Get-Item $z).Length / 1KB))
}

# hashes para conferir depois de copiar para outro PC
$lines = foreach ($z in $zipHost, $zipSite) { "{0}  {1}" -f (Get-FileHash -Algorithm SHA256 $z).Hash.ToLower(), (Split-Path $z -Leaf) }
Set-Content -Path (Join-Path $dist 'SHA256SUMS.txt') -Value $lines -Encoding ASCII
Write-Host ''
Write-Host "Pacotes em $dist" -ForegroundColor Green
$lines | ForEach-Object { Write-Host "  $_" }
