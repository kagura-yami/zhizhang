#requires -Version 5.1
<#
知账数据库迁移：本地 docker postgres → 生产服务器 postgres
- 本地 pg_dump 导出
- scp 到生产
- 灌入生产 postgres 容器
#>

$ErrorActionPreference = 'Stop'
$env:PATH = "C:\Apps\Scoop\apps\git\current\usr\bin;$env:PATH"

$ProdServer  = '124.221.153.66'
$ProdUser    = 'kagurayami'
$ProdSshKey  = "$env:USERPROFILE\.ssh\zhizhang_prod"
$DumpFile    = Join-Path $env:TEMP "zhizhang-migration-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql"
$LocalPg     = 'zhizhang-postgres'  # 本地 docker postgres 容器名

# 0. 加载本地 .env 拿 DB 凭据（不输出）
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'backend\.env'
$envLines = Get-Content $envFile
$pgUser = ($envLines | Select-String '^POSTGRES_USER=').ToString().Split('=', 2)[1]
$pgPass = ($envLines | Select-String '^POSTGRES_PASSWORD=').ToString().Split('=', 2)[1]
$pgDb   = ($envLines | Select-String '^POSTGRES_DB=').ToString().Split('=', 2)[1]
Write-Host "DB: $pgDb (user=$pgUser, password=***hidden***)"

# 1. 本地导出
Write-Host "`n=== 1. 本地 pg_dump 导出 ===" -ForegroundColor Cyan
docker exec -e PGPASSWORD="$pgPass" $LocalPg pg_dump -U $pgUser -d $pgDb --no-owner --clean --if-exists > $DumpFile 2>&1
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
$dumpSize = [math]::Round((Get-Item $DumpFile).Length / 1MB, 2)
Write-Host "dump: $DumpFile ($dumpSize MB)" -ForegroundColor Green

# 2. scp 到生产
Write-Host "`n=== 2. 传送到生产 ===" -ForegroundColor Cyan
$remoteDump = "/tmp/zhizhang-migration.sql"
scp -i $ProdSshKey $DumpFile "${ProdUser}@${ProdServer}:${remoteDump}"
if ($LASTEXITCODE -ne 0) { throw "scp failed" }
Write-Host "uploaded: ${remoteDump}" -ForegroundColor Green

# 3. 在生产灌入
Write-Host "`n=== 3. 生产灌入（会清空现有 schema） ===" -ForegroundColor Cyan
ssh -i $ProdSshKey $ProdUser@$ProdServer @"
bash -c '
set -e
# 读生产 .env 拿 DB 凭据
PROD_ENV=/opt/zhizhang/backend/.env.production
PROD_USER=\$(grep ^POSTGRES_USER= \$PROD_ENV | cut -d= -f2)
PROD_PASS=\$(grep ^POSTGRES_PASSWORD= \$PROD_ENV | cut -d= -f2)
PROD_DB=\$(grep ^POSTGRES_DB= \$PROD_ENV | cut -d= -f2)

# 停 backend（避免迁移时数据写入冲突）
echo "  stopping backend..."
docker stop zhizhang-backend

# 灌库
echo "  importing /tmp/zhizhang-migration.sql (~\$(du -h /tmp/zhizhang-migration.sql | cut -f1))..."
docker exec -e PGPASSWORD=\$PROD_PASS -i zhizhang-postgres psql -U \$PROD_USER -d \$PROD_DB -c \"SELECT 1\" > /dev/null
cat /tmp/zhizhang-migration.sql | docker exec -i -e PGPASSWORD=\$PROD_PASS zhizhang-postgres psql -U \$PROD_USER -d \$PROD_DB --set ON_ERROR_STOP=on 2>&1 | tail -20
echo \"  import done\"

# 启 backend
echo \"  starting backend...\"
docker start zhizhang-backend
echo \"  waiting backend healthy...\"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    sleep 2
    if docker inspect --format='{{.State.Health.Status}}' zhizhang-backend 2>/dev/null | grep -q healthy; then
        echo \"  backend healthy after \${i}*2s\"
        break
    fi
done

# 验证数据
echo \"  verifying data...\"
docker exec -e PGPASSWORD=\$PROD_PASS zhizhang-postgres psql -U \$PROD_USER -d \$PROD_DB -c '\dt' | head -30
docker exec -e PGPASSWORD=\$PROD_PASS zhizhang-postgres psql -U \$PROD_USER -d \$PROD_DB -c \"SELECT COUNT(*) FROM \\\"User\\\"\" 2>/dev/null || echo '(User table not found, try other tables)'

# 清理
rm /tmp/zhizhang-migration.sql
'
"
if ($LASTEXITCODE -ne 0) { throw "remote import failed" }

# 4. 清理本地 dump
Remove-Item $DumpFile -Force -ErrorAction SilentlyContinue

Write-Host "`n=== 迁移完成 ===" -ForegroundColor Green
