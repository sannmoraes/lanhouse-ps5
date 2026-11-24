# Liga o agente que repassa os botoes dos jogadores ao controle virtual.
# Exemplo:  .\start-agent.ps1 -Server wss://seusite.com.br -Secret SEU_HOST_SECRET
param(
  [string]$Server = 'ws://localhost:3000',
  [string]$Secret = '',   # vazio = usa a variavel de ambiente HOST_SECRET (o iniciar-tudo.ps1 faz assim, sem expor o segredo na linha de comando)
  [switch]$DryRun,        # nao usa o controle virtual: so imprime (teste sem driver)
  [switch]$NoVideoCheck,  # avisa "pronto" sem checar o video (teste do controle)
  [switch]$InvertY        # se nos analogicos cima/baixo estiverem ao contrario
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $here '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { throw 'Falta o ambiente Python. Rode antes:  python -m venv .venv ; .\.venv\Scripts\pip install -r requirements.txt' }

$agentArgs = @('-u', (Join-Path $here 'agent.py'), '--server', $Server)
if ($Secret) { $agentArgs += @('--secret', $Secret) }
if ($DryRun) { $agentArgs += '--dry-run' }
if ($NoVideoCheck) { $agentArgs += '--no-video-check' }
if ($InvertY) { $agentArgs += '--invert-y' }
& $py @agentArgs
