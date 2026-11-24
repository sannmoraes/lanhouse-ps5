# Liga o site. Deixe esta janela aberta; Ctrl+C para parar.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
if (-not (Test-Path (Join-Path $here '.env'))) { throw 'Falta o .env. Rode .\instalar-site.ps1 primeiro.' }
if (-not (Test-Path (Join-Path $here 'node_modules\ws'))) { throw 'Falta a dependência. Rode .\instalar-site.ps1 primeiro.' }
node server/index.js
