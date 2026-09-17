param(
  [string]$PythonVersion = "3.11"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $RepoRoot ".local\be007-venv"
$Requirements = Join-Path $RepoRoot "packages\media-processing\worker\requirements-be007.txt"

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

Write-Output "BE-007 runtime ready: $RuntimePython"
Write-Output "ASR model is downloaded lazily to .local\be007-models on first use; models are not committed."
