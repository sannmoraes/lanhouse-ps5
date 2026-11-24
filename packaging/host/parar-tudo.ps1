# Para só o que o iniciar-tudo.ps1 abriu (pelos números de processo guardados em run\pids.txt).
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $here 'run\pids.txt'
if (-not (Test-Path $pidFile)) { Write-Host 'Nada para parar.'; exit 0 }

function Parar-Arvore([int]$id) {
  # primeiro os filhos (FFmpeg, python...), depois a janela
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$id" -ErrorAction SilentlyContinue | ForEach-Object { Parar-Arvore $_.ProcessId }
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}

$n = 0
foreach ($l in Get-Content $pidFile) {
  if ($l -match '^\d+$') { Parar-Arvore ([int]$l); $n++ }
}
Remove-Item $pidFile -ErrorAction SilentlyContinue
Write-Host "Parado ($n janela(s) encerrada(s))." -ForegroundColor Green
