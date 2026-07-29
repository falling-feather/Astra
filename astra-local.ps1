[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 9001,

    [string]$DataDirectory = "",

    [switch]$BootstrapAdmin,

    [switch]$InitializeDemoData,

    [switch]$SkipDependencyInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendRoot = Join-Path $RepoRoot "backend"
$VirtualEnvironment = Join-Path $RepoRoot ".venv"
$VirtualPython = Join-Path $VirtualEnvironment "Scripts\python.exe"
$RequirementsLock = Join-Path $BackendRoot "requirements.lock"
$RequirementsMarker = Join-Path $VirtualEnvironment ".astra-requirements.sha256"

if ($BootstrapAdmin -and $InitializeDemoData) {
    throw "Use either -BootstrapAdmin or -InitializeDemoData, not both."
}

function Test-CommandPython {
    param([string]$Command, [string[]]$PrefixArguments)
    try {
        $version = & $Command @PrefixArguments -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        $parts = ([string]$version).Trim().Split(".")
        return $parts.Count -eq 2 -and [int]$parts[0] -eq 3 -and [int]$parts[1] -ge 12
    } catch {
        return $false
    }
}

function Resolve-PythonLauncher {
    if (Get-Command "py" -ErrorAction SilentlyContinue) {
        $candidates = @("-3.12")
        try {
            $launcherRows = & py -0p 2>$null
            foreach ($row in $launcherRows) {
                if ([string]$row -match "(-V:\S*3\.12\S*)") {
                    $candidates += $Matches[1]
                }
            }
        } catch {}
        foreach ($candidate in ($candidates | Select-Object -Unique)) {
            if (Test-CommandPython -Command "py" -PrefixArguments @($candidate)) {
                return [pscustomobject]@{ Command = "py"; Arguments = @($candidate) }
            }
        }
    }
    foreach ($command in @("python", "python3")) {
        if ((Get-Command $command -ErrorAction SilentlyContinue) -and
            (Test-CommandPython -Command $command -PrefixArguments @())) {
            return [pscustomobject]@{ Command = $command; Arguments = @() }
        }
    }
    throw "Python 3.12+ is required. Install it, then run this script again."
}

function Test-LocalPort {
    param([int]$TargetPort)
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync("127.0.0.1", $TargetPort)
        return $task.Wait(350) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-ExistingAstra {
    param([int]$TargetPort, [string]$ExpectedInstanceId)
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$TargetPort/api/health" -TimeoutSec 2
        if ($health.service -ne "astra-backend" -or
            $health.status -notin @("ok", "degraded") -or
            $health.environment -ne "development") {
            return $false
        }
        $landing = Invoke-WebRequest -Uri "http://127.0.0.1:$TargetPort/" -TimeoutSec 2 -UseBasicParsing
        return ($landing.StatusCode -eq 200 -and
            $landing.Headers["X-Astra-Local-Preview"] -eq "1" -and
            $landing.Headers["X-Astra-Local-Instance"] -eq $ExpectedInstanceId -and
            $landing.Content -match "<title>[^<]*Astra")
    } catch {
        return $false
    }
}

function Get-AstraLocalInstanceId {
    param([string]$ResolvedDataDirectory)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $identityBytes = [Text.Encoding]::UTF8.GetBytes($ResolvedDataDirectory.ToUpperInvariant())
        return ([BitConverter]::ToString($hasher.ComputeHash($identityBytes))).Replace("-", "").ToLowerInvariant()
    } finally {
        $hasher.Dispose()
    }
}

function Assert-LocalDataDirectory {
    param([string]$ResolvedDataDirectory)
    if ($ResolvedDataDirectory.StartsWith("\\")) {
        throw "-InitializeDemoData requires a local data directory; UNC paths are rejected before side effects."
    }
    $root = [IO.Path]::GetPathRoot($ResolvedDataDirectory)
    if (-not $root -or $root.StartsWith("\\")) {
        throw "-InitializeDemoData requires a local filesystem data directory."
    }
    if ($root -match "^[A-Za-z]:\\$") {
        $drive = Get-PSDrive -Name $root.Substring(0, 1) -PSProvider FileSystem -ErrorAction SilentlyContinue
        if ($drive -and $drive.DisplayRoot -and ([string]$drive.DisplayRoot).StartsWith("\\")) {
            throw "-InitializeDemoData rejects mapped network drives; use a local data directory."
        }
    }
}

function Invoke-AstraLocalPreview {
    if (-not $DataDirectory) {
        $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
        if (-not $localAppData) { $localAppData = $env:TEMP }
        $DataDirectory = Join-Path $localAppData "Astra\local-preview"
    }
    $DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
    $dataDirectoryRoot = [IO.Path]::GetPathRoot($DataDirectory)
    if ($DataDirectory.Length -gt $dataDirectoryRoot.Length) {
        $DataDirectory = $DataDirectory.TrimEnd(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar
        )
    }
    if ($InitializeDemoData) {
        Assert-LocalDataDirectory -ResolvedDataDirectory $DataDirectory
    }
    $instanceId = Get-AstraLocalInstanceId -ResolvedDataDirectory $DataDirectory
    $instanceMutex = [Threading.Mutex]::new($false, "Local\AstraLocalPreviewData-$($instanceId.Substring(0, 32))")
    $mutexOwned = $false
    try {
        try {
            $mutexOwned = $instanceMutex.WaitOne(0)
        } catch [Threading.AbandonedMutexException] {
            $mutexOwned = $true
        }
        if (-not $mutexOwned) {
            if (Test-ExistingAstra -TargetPort $Port -ExpectedInstanceId $instanceId) {
                if ($BootstrapAdmin) {
                    throw "Astra is already running. Stop it with Ctrl+C, then re-run with -BootstrapAdmin."
                }
                if ($InitializeDemoData) {
                    throw "Astra is already running. Stop it with Ctrl+C, then re-run with -InitializeDemoData (the requested initialization switch)."
                }
                Write-Host "Astra is already running at http://127.0.0.1:$Port/" -ForegroundColor Green
                return
            }
            throw "Another Astra local-preview startup for port $Port is already in progress."
        }

    if (Test-LocalPort -TargetPort $Port) {
    if (Test-ExistingAstra -TargetPort $Port -ExpectedInstanceId $instanceId) {
        if ($BootstrapAdmin) {
            throw "Astra is already running. Stop it with Ctrl+C, then re-run with -BootstrapAdmin."
        }
        if ($InitializeDemoData) {
            throw "Astra is already running. Stop it with Ctrl+C, then re-run with -InitializeDemoData (the requested initialization switch)."
        }
        Write-Host "Astra is already running at http://127.0.0.1:$Port/" -ForegroundColor Green
        return
    }
    throw "Port $Port is already occupied by another process."
}

New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null

if (-not (Test-Path -LiteralPath $VirtualPython -PathType Leaf)) {
    $launcher = Resolve-PythonLauncher
    Write-Host "Creating isolated Python environment..." -ForegroundColor Cyan
    & $launcher.Command @($launcher.Arguments) -m venv $VirtualEnvironment
    if ($LASTEXITCODE -ne 0) { throw "Failed to create .venv" }
} elseif (-not (Test-CommandPython -Command $VirtualPython -PrefixArguments @())) {
    throw "The existing .venv does not use Python 3.12+. Move it aside or recreate it with Python 3.12+, then run this script again."
}

$lockHash = (Get-FileHash -LiteralPath $RequirementsLock -Algorithm SHA256).Hash.ToLowerInvariant()
$installedHash = if (Test-Path -LiteralPath $RequirementsMarker) {
    (Get-Content -LiteralPath $RequirementsMarker -Raw).Trim()
} else { "" }
if ($installedHash -ne $lockHash) {
    if ($SkipDependencyInstall) {
        throw "Locked dependencies are not installed. Re-run without -SkipDependencyInstall."
    }
    Write-Host "Installing hash-locked backend dependencies..." -ForegroundColor Cyan
    & $VirtualPython -m pip install --disable-pip-version-check --require-hashes -r $RequirementsLock
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed" }
    [IO.File]::WriteAllText($RequirementsMarker, "$lockHash`n", [Text.UTF8Encoding]::new($false))
}

$databasePath = Join-Path $DataDirectory "astra-local.sqlite3"
$databaseUrlPath = $databasePath.Replace("\", "/")
$saltPath = Join-Path $DataDirectory ".audit-salt"
if (-not (Test-Path -LiteralPath $saltPath -PathType Leaf)) {
    $saltBytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($saltBytes) } finally { $generator.Dispose() }
    [IO.File]::WriteAllText($saltPath, [Convert]::ToBase64String($saltBytes), [Text.UTF8Encoding]::new($false))
}

$env:ASTRA_ENVIRONMENT = "development"
$env:ASTRA_API_PREFIX = "/api"
$env:ASTRA_LOCAL_PREVIEW_INSTANCE_ID = $instanceId
$env:ASTRA_DATABASE_URL = "sqlite+pysqlite:///$databaseUrlPath"
$env:ASTRA_AUTO_CREATE_TABLES = "true"
$env:ASTRA_CORS_ORIGINS = "http://127.0.0.1:$Port"
$env:ASTRA_AUDIT_IP_HASH_SALT = (Get-Content -LiteralPath $saltPath -Raw).Trim()
$env:ASTRA_AUDIT_TRUST_FORWARDED_FOR = "false"
$env:ASTRA_AUDIT_TRUSTED_PROXY_HOSTS = ""
$env:ASTRA_AUDIT_ANCHOR_ENABLED = "false"
$env:ASTRA_EXTERNAL_ISSUE_SYNC_ENABLED = "false"
$env:ASTRA_ALERT_DELIVERY_ENABLED = "false"
$env:ASTRA_CONTENT_SCRIPT_ALLOWED_HOSTS = ""
$env:ASTRA_PASSWORD_RESET_RETURN_TOKEN_FOR_DEV = "true"
$env:ASTRA_ADMIN_BOOTSTRAP_ENABLED = "false"
$env:ASTRA_ADMIN_BOOTSTRAP_TOKEN = ""
$env:ASTRA_BACKGROUND_TASK_WORKER_ENABLED = "false"
$env:ASTRA_BACKGROUND_TASK_WORKER_CONTENT_SCAN_ENABLED = "false"
$env:ASTRA_BACKGROUND_TASK_WORKER_AUDIT_ANCHOR_ENABLED = "false"
$env:ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_ENABLED = "false"
$env:ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_RUN_ON_START = "false"
$env:ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_ENABLED = "false"
$env:ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_RUN_ON_START = "false"

Push-Location $BackendRoot
try {
    Write-Host "Applying database migrations..." -ForegroundColor Cyan
    & $VirtualPython -m alembic -c alembic.ini upgrade head
    if ($LASTEXITCODE -ne 0) { throw "Database migration failed" }

    if ($BootstrapAdmin) {
        $username = (Read-Host "Initial administrator username").Trim()
        $displayName = (Read-Host "Administrator display name").Trim()
        $securePassword = Read-Host "Administrator password" -AsSecureString
        [IntPtr]$passwordPointer = [IntPtr]::Zero
        $plainPassword = $null
        try {
            $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
            $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
            $payload = @{
                username = $username
                password = $plainPassword
                display_name = $displayName
            } | ConvertTo-Json -Compress
            $env:ASTRA_ADMIN_BOOTSTRAP_ENABLED = "true"
            $previousOutputEncoding = $OutputEncoding
            try {
                $OutputEncoding = [Text.UTF8Encoding]::new($false)
                $payload | & $VirtualPython -X utf8 -m scripts.local_preview_bootstrap_admin --confirm-local-preview
                if ($LASTEXITCODE -ne 0) { throw "Administrator bootstrap failed" }
            } finally {
                $OutputEncoding = $previousOutputEncoding
            }
        } finally {
            $env:ASTRA_ADMIN_BOOTSTRAP_ENABLED = "false"
            if ($passwordPointer -ne [IntPtr]::Zero) {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
            }
            $plainPassword = $null
        }
    }

    if ($InitializeDemoData) {
        Write-Host "Initializing the local synthetic demo through the authoritative API..." -ForegroundColor Cyan
        $env:ASTRA_ADMIN_BOOTSTRAP_ENABLED = "true"
        try {
            & $VirtualPython -X utf8 -m scripts.initialize_demo_data --confirm-local-preview
            if ($LASTEXITCODE -ne 0) { throw "Demo data initialization failed" }
        } finally {
            $env:ASTRA_ADMIN_BOOTSTRAP_ENABLED = "false"
        }
    }

    Write-Host ""
    Write-Host "Astra local preview: http://127.0.0.1:$Port/" -ForegroundColor Green
    Write-Host "Data directory: $DataDirectory"
    Write-Host "Press Ctrl+C to stop the website."
    & $VirtualPython -m uvicorn app.local_preview:app --host 127.0.0.1 --port $Port
    if ($LASTEXITCODE -ne 0) { throw "Astra local preview stopped unexpectedly" }
} finally {
    Pop-Location
}
    } finally {
        if ($mutexOwned) {
            try { $instanceMutex.ReleaseMutex() } catch {}
        }
        $instanceMutex.Dispose()
    }
}

Invoke-AstraLocalPreview
