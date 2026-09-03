#requires -Version 5.1
<#
知账生产 website 发布脚本
- rsync-like 同步 website/ 到生产
- 重启 backend 让它重新挂载 volume
#>

$ErrorActionPreference = 'Stop'
$env:PATH = "C:\Apps\Scoop\apps\git\current\usr\bin;$env:PATH"

$ProdServer   = '124.221.153.66'
$ProdUser     = 'kagurayami'
$ProdSshKey   = "$env:USERPROFILE\.ssh\zhizhang_prod"
$ProjectRoot  = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Website      = Join-Path $ProjectRoot 'website'
$RemoteDir    = '/opt/zhizhang/website'

Write-Host "=== 1. 同步 website 到生产 ===" -ForegroundColor Cyan
ssh -i $ProdSshKey "$ProdUser@$ProdServer" "mkdir -p $RemoteDir/assets"

# 同步 HTML/CSS/JS（不传 README）
Get-ChildItem $Website -File | Where-Object { $_.Name -ne 'README.md' } | ForEach-Object {
    scp -i $ProdSshKey $_.FullName "${ProdUser}@${ProdServer}:${RemoteDir}/"
}

# 同步 assets
scp -i $ProdSshKey -r (Join-Path $Website 'assets') "${ProdUser}@${ProdServer}:${RemoteDir}/"

# 同步 styles.css / script.js（scp -r 不会覆盖顶层文件？用 rsync 太复杂，用 scp 显式覆盖）
foreach ($f in @('styles.css', 'script.js')) {
    scp -i $ProdSshKey (Join-Path $Website $f) "${ProdUser}@${ProdServer}:${RemoteDir}/"
}

Write-Host "synced" -ForegroundColor Green

Write-Host "`n=== 2. 重启 backend 容器 ===" -ForegroundColor Cyan
ssh -i $ProdSshKey "$ProdUser@$ProdServer" "bash -c 'cd /opt/zhizhang && docker compose up -d --force-recreate backend 2>&1'"

Write-Host "`n=== 3. 等待 backend healthy ===" -ForegroundColor Cyan
$ready = $false
for ($i = 1; $i -le 30; $i++) {
    $status = ssh -i $ProdSshKey "$ProdUser@$ProdServer" "docker inspect --format='{{.State.Health.Status}}' zhizhang-backend 2>/dev/null"
    if ($status -eq 'healthy') {
        Write-Host "backend healthy (after ${i}s)" -ForegroundColor Green
        $ready = $true
        break
    }
    Start-Sleep -s 1
}
if (-not $ready) { Write-Host "WARN: backend not healthy after 30s" -ForegroundColor Yellow }

Write-Host "`n=== 完成 ===" -ForegroundColor Green
Write-Host "website 公开链接: https://zhizhang.kagurayami.top/"
Write-Host "(注：等你在云控制台加 IPv4 规则放行 443 端口后，外部才能访问)"
