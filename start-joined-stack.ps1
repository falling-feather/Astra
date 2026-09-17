[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$AstraPort = 9001,
    [string]$VocationalRoot = 'D:\代码玩具测试\揭榜挂帅',
    [switch]$SkipVocationalInstall,
    [switch]$ReuseVocationalData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$astraRoot = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$vocationalRootResolved = [IO.Path]::GetFullPath($VocationalRoot)
$vocationalLauncher = Join-Path $vocationalRootResolved '启动融岗智训.ps1'
if (-not (Test-Path -LiteralPath $vocationalLauncher -PathType Leaf)) {
    throw "职业教育项目启动器不存在：$vocationalLauncher"
}

$arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $vocationalLauncher, '-NoBrowser')
if ($SkipVocationalInstall) { $arguments += '-SkipInstall' }
if (-not $ReuseVocationalData) { $arguments += '-FreshData' }
$deepSeekEnv = Join-Path $vocationalRootResolved '.env.local'
if (Test-Path -LiteralPath $deepSeekEnv -PathType Leaf) {
    $deepSeekLine = Get-Content -LiteralPath $deepSeekEnv | Where-Object { $_ -match '^DEEPSEEK_API_KEY=' } | Select-Object -First 1
    if ($deepSeekLine) {
        $deepSeekKey = $deepSeekLine.Substring($deepSeekLine.IndexOf('=') + 1).Trim()
        if ($deepSeekKey) {
            $env:ASTRA_AI_TUTOR_ENABLED = 'true'
            $env:ASTRA_AI_TUTOR_PROVIDER = 'deepseek'
            $env:ASTRA_AI_TUTOR_BASE_URL = 'https://api.deepseek.com'
            $env:ASTRA_AI_TUTOR_MODEL = 'deepseek-flash'
            $env:ASTRA_AI_TUTOR_API_KEY = $deepSeekKey
        }
    }
}
$vocationalProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $vocationalRootResolved -WindowStyle Hidden -PassThru
try {
    Write-Host "职业教育动态站正在启动：$vocationalRootResolved" -ForegroundColor Cyan
    Write-Host "职业教育入口预期为 http://127.0.0.1:4173/" -ForegroundColor Cyan
    & (Join-Path $astraRoot 'astra-local.ps1') -Port $AstraPort
}
finally {
    if ($vocationalProcess -and -not $vocationalProcess.HasExited) {
        Stop-Process -Id $vocationalProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
