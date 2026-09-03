$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$venv = Join-Path $PSScriptRoot '.venv'
if (-not (Test-Path -LiteralPath $venv)) {
  python -m venv $venv
}

& (Join-Path $venv 'Scripts\python.exe') -m pip install --upgrade pip
& (Join-Path $venv 'Scripts\python.exe') -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')

$env:ASR_MODEL_NAME = if ($env:ASR_MODEL_NAME) { $env:ASR_MODEL_NAME } else { 'medium' }
$env:ASR_ENGINE = if ($env:ASR_ENGINE) { $env:ASR_ENGINE } else { 'paraformer' }
$env:ASR_MODEL_DIR = if ($env:ASR_MODEL_DIR) { $env:ASR_MODEL_DIR } else { (Join-Path $PSScriptRoot 'models') }
$env:ASR_DEVICE = if ($env:ASR_DEVICE) { $env:ASR_DEVICE } else { 'cuda' }
$env:ASR_COMPUTE_TYPE = if ($env:ASR_COMPUTE_TYPE) { $env:ASR_COMPUTE_TYPE } else { 'float16' }
$env:ASR_FUNASR_DEVICE = if ($env:ASR_FUNASR_DEVICE) { $env:ASR_FUNASR_DEVICE } else { 'cpu' }

# ctranslate2 不会自动把 pip 安装的 CUDA DLL 加入 Windows 搜索路径。
$cudaBins = @(
  (Join-Path $venv 'Lib\site-packages\nvidia\cublas\bin'),
  (Join-Path $venv 'Lib\site-packages\nvidia\cudnn\bin'),
  (Join-Path $venv 'Lib\site-packages\nvidia\cuda_nvrtc\bin')
)
$env:PATH = (($cudaBins | Where-Object { Test-Path -LiteralPath $_ }) -join ';') + ';' + $env:PATH
$torchBin = Join-Path $venv 'Lib\site-packages\torch\lib'
if (Test-Path -LiteralPath $torchBin) { $env:PATH = $torchBin + ';' + $env:PATH }

Write-Host "正在启动本地 ASR：引擎=$env:ASR_ENGINE，模型=$env:ASR_MODEL_NAME，设备=$env:ASR_DEVICE"
& (Join-Path $venv 'Scripts\python.exe') -m uvicorn app:app --host 127.0.0.1 --port 8765
