#requires -Version 5.1
<#
知账生产 APK 发布脚本
- 本地构建 Release APK
- scp 上传到生产服务器
- 触发 mobile 部署（让 Caddy 看到新 APK）
- 输出 APK 公开链接
#>

$ErrorActionPreference = 'Stop'
$env:PATH = "C:\Apps\Scoop\apps\git\current\usr\bin;$env:PATH"

# 配置
$ProdServer     = '124.221.153.66'
$ProdUser       = 'kagurayami'
$ProdSshKey     = "$env:USERPROFILE\.ssh\zhizhang_prod"
$ProjectRoot    = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ApkLocal       = Join-Path $ProjectRoot 'mobile\android\app\build\outputs\apk\release\app-release.apk'
$ApkRemoteDir   = '/opt/zhizhang/mobile/android/app/build/outputs/apk/release'
$ApkRemote      = "$ApkRemoteDir/app-release.apk"
$PublicUrl      = 'https://zhizhang.kagurayami.top/apk/app-release.apk'

# 1. 构建
Write-Host "=== 1. 构建 Release APK ===" -ForegroundColor Cyan
Set-Location (Join-Path $ProjectRoot 'mobile')
# 同步 src/main 和 src/test（按你之前的红线）
Copy-Item -Path 'android\app\src\main' -Destination 'android\app\src\main' -Recurse -Force
Copy-Item -Path 'android\app\src\test' -Destination 'android\app\src\test' -Recurse -Force

& npm run build:android:release 2>&1 | Select-Object -Last 20
if ($LASTEXITCODE -ne 0) { throw "APK build failed" }
if (-not (Test-Path $ApkLocal)) { throw "APK not found at $ApkLocal" }

$size = [math]::Round((Get-Item $ApkLocal).Length / 1MB, 2)
Write-Host "APK built: $size MB" -ForegroundColor Green

# 2. scp 上传
Write-Host "`n=== 2. 上传到生产服务器 ===" -ForegroundColor Cyan
ssh -i $ProdSshKey "$ProdUser@$ProdServer" "mkdir -p $ApkRemoteDir"
scp -i $ProdSshKey $ApkLocal "${ProdUser}@${ProdServer}:${ApkRemote}"
if ($LASTEXITCODE -ne 0) { throw "scp failed" }
Write-Host "uploaded: $ApkRemote" -ForegroundColor Green

# 3. 触发 mobile 部署（让 Caddy 看到新文件）
Write-Host "`n=== 3. 触发 mobile 部署 ===" -ForegroundColor Cyan
ssh -i $ProdSshKey "$ProdUser@$ProdServer" "bash /opt/zhizhang/deploy/deploy.sh mobile"
if ($LASTEXITCODE -ne 0) { throw "deploy failed" }

# 4. 输出结果
Write-Host "`n=== 完成 ===" -ForegroundColor Green
Write-Host "公开链接: $PublicUrl"
Write-Host "本地路径: $ApkLocal"
Write-Host "服务器路径: $ApkRemote"
