# Liga o MediaMTX com a configuracao deste projeto. Coloque o mediamtx.exe nesta pasta (ou no PATH).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $here 'mediamtx.exe'
if (-not (Test-Path $exe)) { $cmd = Get-Command mediamtx -ErrorAction SilentlyContinue; if ($cmd) { $exe = $cmd.Source } else { throw 'mediamtx.exe nao encontrado. Veja docs/INSTALACAO-NO-PS5.md (passo MediaMTX).' } }
& $exe (Join-Path $here 'mediamtx.yml')
