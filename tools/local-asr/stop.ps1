$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like '*uvicorn app:app*' -and $_.CommandLine -like '*8765*'
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host '本地 ASR 服务已停止。'
