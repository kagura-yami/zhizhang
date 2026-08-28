$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath '.env')) {
    throw 'Missing .env. Copy .env.example and configure it first.'
}

docker compose up -d --build
docker compose ps
