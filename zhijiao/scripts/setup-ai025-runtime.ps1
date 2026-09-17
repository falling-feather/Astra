param(
  [string]$PythonVersion = "3.11"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $RepoRoot ".local\ai025-venv"
$Requirements = Join-Path $RepoRoot "packages\context-engine\worker\requirements-ai025.txt"

$Uv = Get-Command uv -ErrorAction SilentlyContinue
if ($null -ne $Uv) {
  & $Uv.Source venv $RuntimeDir --python $PythonVersion --allow-existing
  if ($LASTEXITCODE -ne 0) { throw "uv venv failed with exit code $LASTEXITCODE" }
  $RuntimePython = Join-Path $RuntimeDir "Scripts\python.exe"
  & $Uv.Source pip install --python $RuntimePython --requirement $Requirements
  if ($LASTEXITCODE -ne 0) { throw "uv pip install failed with exit code $LASTEXITCODE" }
} else {
  $PythonLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($null -eq $PythonLauncher) { throw "Neither uv nor the Windows Python launcher is available" }
  & $PythonLauncher.Source "-$PythonVersion" -m venv $RuntimeDir
  if ($LASTEXITCODE -ne 0) { throw "python -m venv failed with exit code $LASTEXITCODE" }
  $RuntimePython = Join-Path $RuntimeDir "Scripts\python.exe"
  & $RuntimePython -m pip install --requirement $Requirements
  if ($LASTEXITCODE -ne 0) { throw "pip install failed with exit code $LASTEXITCODE" }
}

Write-Output "AI-025 runtime ready: $RuntimePython"
Write-Output "The BAAI/bge-small-zh-v1.5 model is downloaded lazily. Set RONGGANG_AI025_MODEL_DIR to an ASCII path when the workspace path contains non-ASCII characters."
