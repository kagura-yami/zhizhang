$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot
docker compose logs --tail 200 -f app
