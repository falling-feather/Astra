[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 9001,

    [string]$DataDirectory = "",

    [switch]$BootstrapAdmin,

    [switch]$InitializeDemoData,

    [switch]$SkipDependencyInstall,

    [string]$PythonExecutable = "",

    [string]$VirtualEnvironmentPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$BackendRoot = Join-Path $RepoRoot "backend"
$DefaultVirtualEnvironment = Join-Path $RepoRoot ".venv"
$RequirementsLock = Join-Path $BackendRoot "requirements.lock"
$PythonExecutableSpecified = $PSBoundParameters.ContainsKey("PythonExecutable")
$VirtualEnvironmentPathSpecified = $PSBoundParameters.ContainsKey("VirtualEnvironmentPath")

if ($PythonExecutableSpecified -and $VirtualEnvironmentPathSpecified) {
    throw "-PythonExecutable and -VirtualEnvironmentPath are mutually exclusive."
}
if ($PythonExecutableSpecified -and [string]::IsNullOrWhiteSpace($PythonExecutable)) {
    throw "-PythonExecutable must name an executable application."
}
if ($VirtualEnvironmentPathSpecified -and [string]::IsNullOrWhiteSpace($VirtualEnvironmentPath)) {
    throw "-VirtualEnvironmentPath must name a filesystem directory."
}
if ($PythonExecutableSpecified -and -not $SkipDependencyInstall) {
    throw "-PythonExecutable is caller-managed and requires -SkipDependencyInstall."
}

if ($BootstrapAdmin -and $InitializeDemoData) {
    throw "Use either -BootstrapAdmin or -InitializeDemoData, not both."
}

function Assert-StandardWindowsPathNamespace {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $namespaceProbe = $PathValue.Replace("/", "\")
    foreach ($devicePrefix in @("\\?\", "\\.\", "\??\", "\\??\")) {
        if ($namespaceProbe.StartsWith($devicePrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "$Description must not use a Windows device namespace."
        }
    }
}

function Resolve-AstraFileSystemPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    Assert-StandardWindowsPathNamespace -PathValue $PathValue -Description $Description
    try {
        if ([IO.Path]::IsPathRooted($PathValue)) {
            $resolvedPath = [IO.Path]::GetFullPath($PathValue)
        } else {
            $location = Get-Location
            if ($location.Provider.Name -ne "FileSystem") {
                throw "The current PowerShell location is not a filesystem location."
            }
            $resolvedPath = [IO.Path]::GetFullPath((Join-Path $location.ProviderPath $PathValue))
        }
    } catch {
        throw "$Description could not be normalized as a filesystem path: $PathValue"
    }
    Assert-StandardWindowsPathNamespace -PathValue $resolvedPath -Description $Description

    $root = [IO.Path]::GetPathRoot($resolvedPath)
    if ($resolvedPath.Length -gt $root.Length) {
        $resolvedPath = $resolvedPath.TrimEnd(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar
        )
    }
    return $resolvedPath
}

function Assert-NoReparsePointInPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ResolvedPath,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    Assert-StandardWindowsPathNamespace -PathValue $ResolvedPath -Description $Description
    $pathRoot = [IO.Path]::GetPathRoot($ResolvedPath)
    if ([string]::IsNullOrWhiteSpace($pathRoot)) {
        throw "$Description must be an absolute filesystem path."
    }
    try {
        $rootItem = Get-Item -Force -LiteralPath $pathRoot -ErrorAction Stop
    } catch {
        throw "$Description filesystem root could not be inspected safely: $pathRoot"
    }
    if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Description must not traverse a junction, symbolic link, or volume mount: $pathRoot"
    }
    if (-not $rootItem.PSIsContainer) {
        throw "$Description filesystem root is not a directory: $pathRoot"
    }

    $relativePath = $ResolvedPath.Substring($pathRoot.Length)
    $components = @(
        $relativePath.Split(
            [char[]]@(
                [IO.Path]::DirectorySeparatorChar,
                [IO.Path]::AltDirectorySeparatorChar
            ),
            [StringSplitOptions]::RemoveEmptyEntries
        )
    )
    $cursor = $pathRoot
    for ($index = 0; $index -lt $components.Count; $index += 1) {
        $component = $components[$index]
        try {
            $matches = @(
                Get-ChildItem -Force -LiteralPath $cursor -ErrorAction Stop |
                    Where-Object {
                        $_.Name.Equals(
                            $component,
                            [StringComparison]::OrdinalIgnoreCase
                        )
                    }
            )
        } catch {
            throw "$Description could not enumerate an existing parent safely: $cursor"
        }
        if ($matches.Count -eq 0) {
            return
        }
        if ($matches.Count -ne 1) {
            throw "$Description resolves ambiguously below: $cursor"
        }
        $item = $matches[0]
        $candidate = Join-Path $cursor $component
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "$Description must not traverse a junction, symbolic link, or volume mount: $candidate"
        }
        if ($index -lt ($components.Count - 1) -and -not $item.PSIsContainer) {
            throw "$Description traverses a non-directory filesystem item: $candidate"
        }
        $cursor = $candidate
    }
}

function Resolve-ExecutableApplication {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandOrPath,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $looksLikePath = [IO.Path]::IsPathRooted($CommandOrPath) -or
        $CommandOrPath.Contains("\") -or
        $CommandOrPath.Contains("/") -or
        $CommandOrPath.StartsWith(".")
    try {
        if ($looksLikePath) {
            $candidatePath = Resolve-AstraFileSystemPath -PathValue $CommandOrPath -Description $Description
            if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
                throw "$Description does not exist: $candidatePath"
            }
            $escapedPath = [Management.Automation.WildcardPattern]::Escape($candidatePath)
            $application = Get-Command -Name $escapedPath -CommandType Application -ErrorAction Stop |
                Select-Object -First 1
        } else {
            if ($CommandOrPath.IndexOfAny([char[]]"*?[]") -ge 0) {
                throw "$Description must not contain wildcard characters."
            }
            $application = Get-Command -Name $CommandOrPath -CommandType Application -ErrorAction Stop |
                Select-Object -First 1
        }
    } catch {
        throw "$Description must resolve to an executable application: $CommandOrPath"
    }

    if (-not $application -or $application.CommandType -ne [Management.Automation.CommandTypes]::Application) {
        throw "$Description must resolve to an executable application: $CommandOrPath"
    }
    $resolvedApplication = Resolve-AstraFileSystemPath -PathValue $application.Path -Description $Description
    if (-not (Test-Path -LiteralPath $resolvedApplication -PathType Leaf)) {
        throw "$Description does not exist: $resolvedApplication"
    }
    return $resolvedApplication
}

function Assert-ExternalVirtualEnvironmentPath {
    param([string]$ResolvedVirtualEnvironment)

    Assert-NoReparsePointInPath `
        -ResolvedPath $RepoRoot `
        -Description "Repository path"
    Assert-NoReparsePointInPath `
        -ResolvedPath $ResolvedVirtualEnvironment `
        -Description "-VirtualEnvironmentPath"

    $pathRoot = [IO.Path]::GetPathRoot($ResolvedVirtualEnvironment)
    if ($ResolvedVirtualEnvironment.Equals($pathRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "-VirtualEnvironmentPath must be a dedicated directory, not a filesystem root."
    }
    $repoPrefix = $RepoRoot + [IO.Path]::DirectorySeparatorChar
    if ($ResolvedVirtualEnvironment.Equals($RepoRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $ResolvedVirtualEnvironment.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "-VirtualEnvironmentPath must be outside the repository."
    }
    if ((Test-Path -LiteralPath $ResolvedVirtualEnvironment) -and
        -not (Test-Path -LiteralPath $ResolvedVirtualEnvironment -PathType Container)) {
        throw "-VirtualEnvironmentPath must name a filesystem directory."
    }
}

function Assert-ExternalManagedRuntimePaths {
    param(
        [string]$VirtualEnvironment,
        [string]$VirtualPython,
        [string]$RequirementsMarker
    )

    Assert-ExternalVirtualEnvironmentPath -ResolvedVirtualEnvironment $VirtualEnvironment
    Assert-NoReparsePointInPath `
        -ResolvedPath $VirtualPython `
        -Description "External virtual environment Python"
    Assert-NoReparsePointInPath `
        -ResolvedPath $RequirementsMarker `
        -Description "External virtual environment requirements marker"
    Assert-NoReparsePointInPath `
        -ResolvedPath (Join-Path $VirtualEnvironment "Lib\site-packages") `
        -Description "External virtual environment site-packages"
}

function Assert-PythonRuntimePrefix {
    param(
        [string]$RuntimePython,
        [string]$ExpectedVirtualEnvironment
    )

    $prefixRows = @(& $RuntimePython -I -c "import base64, os, sys; print(base64.b64encode(os.path.abspath(sys.prefix).encode('utf-8')).decode('ascii'))" 2>$null)
    if ($LASTEXITCODE -ne 0 -or $prefixRows.Count -ne 1 -or
        [string]::IsNullOrWhiteSpace([string]$prefixRows[0])) {
        throw "External virtual environment Python did not report one valid sys.prefix."
    }
    try {
        $prefixBytes = [Convert]::FromBase64String(([string]$prefixRows[0]).Trim())
        $prefixValue = [Text.UTF8Encoding]::new($false, $true).GetString($prefixBytes)
    } catch {
        throw "External virtual environment Python reported an invalid UTF-8 sys.prefix."
    }
    if (-not [IO.Path]::IsPathRooted($prefixValue)) {
        throw "External virtual environment Python reported a non-absolute sys.prefix."
    }
    $resolvedPrefix = Resolve-AstraFileSystemPath `
        -PathValue $prefixValue `
        -Description "External virtual environment sys.prefix"
    Assert-NoReparsePointInPath `
        -ResolvedPath $resolvedPrefix `
        -Description "External virtual environment sys.prefix"
    if (-not $resolvedPrefix.Equals(
        $ExpectedVirtualEnvironment,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "External virtual environment Python sys.prefix does not match -VirtualEnvironmentPath."
    }
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
    $pyLauncher = $null
    try {
        $pyLauncher = Resolve-ExecutableApplication -CommandOrPath "py" -Description "Python launcher"
    } catch {}
    if ($pyLauncher) {
        $candidates = @("-3.12")
        try {
            $launcherRows = & $pyLauncher -0p 2>$null
            foreach ($row in $launcherRows) {
                if ([string]$row -match "(-V:\S+)") {
                    $candidates += $Matches[1]
                }
            }
        } catch {}
        foreach ($candidate in ($candidates | Select-Object -Unique)) {
            if (Test-CommandPython -Command $pyLauncher -PrefixArguments @($candidate)) {
                return [pscustomobject]@{ Command = $pyLauncher; Arguments = @($candidate) }
            }
        }
    }
    foreach ($command in @("python", "python3")) {
        try {
            $application = Resolve-ExecutableApplication -CommandOrPath $command -Description "Python launcher"
            if (Test-CommandPython -Command $application -PrefixArguments @()) {
                return [pscustomobject]@{ Command = $application; Arguments = @() }
            }
        } catch {}
    }
    throw "Python 3.12+ is required. Install it, then run this script again."
}

function Resolve-ExplicitPythonRuntime {
    param([string]$RequestedPython)

    $runtime = Resolve-ExecutableApplication `
        -CommandOrPath $RequestedPython `
        -Description "-PythonExecutable"
    if (-not (Test-CommandPython -Command $runtime -PrefixArguments @())) {
        throw "-PythonExecutable must be Python 3.12+."
    }
    return $runtime
}

function Invoke-ExplicitPythonDependencyValidation {
    param([string]$RuntimePython)

    Write-Host "Validating caller-managed Python dependencies without changes..." -ForegroundColor Cyan
    & $RuntimePython -m pip --isolated --disable-pip-version-check --no-cache-dir install --dry-run --no-index --require-hashes -r $RequirementsLock
    if ($LASTEXITCODE -ne 0) {
        throw "Caller-managed Python failed the locked dependency dry-run validation."
    }
    & $RuntimePython -m pip --isolated check
    if ($LASTEXITCODE -ne 0) {
        throw "Caller-managed Python failed pip check."
    }
}

function Get-AstraFileSha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue
    )

    $stream = [IO.File]::OpenRead($PathValue)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $hasher.ComputeHash($stream)
        return ([BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
    } finally {
        $hasher.Dispose()
        $stream.Dispose()
    }
}

function Initialize-ManagedPythonRuntime {
    param(
        [string]$VirtualEnvironment,
        [string]$VirtualPython,
        [string]$RequirementsMarker,
        [switch]$ExternalVirtualEnvironment
    )

    if ($ExternalVirtualEnvironment) {
        Assert-ExternalManagedRuntimePaths `
            -VirtualEnvironment $VirtualEnvironment `
            -VirtualPython $VirtualPython `
            -RequirementsMarker $RequirementsMarker
    }

    if (-not (Test-Path -LiteralPath $VirtualPython -PathType Leaf)) {
        $launcher = Resolve-PythonLauncher
        Write-Host "Creating isolated Python environment..." -ForegroundColor Cyan
        & $launcher.Command @($launcher.Arguments) -m venv $VirtualEnvironment | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "Failed to create the Python virtual environment." }
    }

    if ($ExternalVirtualEnvironment) {
        Assert-ExternalManagedRuntimePaths `
            -VirtualEnvironment $VirtualEnvironment `
            -VirtualPython $VirtualPython `
            -RequirementsMarker $RequirementsMarker
    }

    $RuntimePython = Resolve-ExecutableApplication `
        -CommandOrPath $VirtualPython `
        -Description "Virtual environment Python"
    if (-not (Test-CommandPython -Command $RuntimePython -PrefixArguments @())) {
        throw "The selected virtual environment does not use Python 3.12+. Move it aside or recreate it with Python 3.12+, then run this script again."
    }

    if ($ExternalVirtualEnvironment) {
        Assert-ExternalManagedRuntimePaths `
            -VirtualEnvironment $VirtualEnvironment `
            -VirtualPython $RuntimePython `
            -RequirementsMarker $RequirementsMarker
        Assert-PythonRuntimePrefix `
            -RuntimePython $RuntimePython `
            -ExpectedVirtualEnvironment $VirtualEnvironment
    }

    $lockHash = Get-AstraFileSha256 -PathValue $RequirementsLock
    $installedHash = if (Test-Path -LiteralPath $RequirementsMarker -PathType Leaf) {
        (Get-Content -LiteralPath $RequirementsMarker -Raw).Trim()
    } else { "" }
    if ($installedHash -ne $lockHash) {
        if ($SkipDependencyInstall) {
            throw "Locked dependencies are not installed. Re-run without -SkipDependencyInstall."
        }
        if ($ExternalVirtualEnvironment) {
            Assert-ExternalManagedRuntimePaths `
                -VirtualEnvironment $VirtualEnvironment `
                -VirtualPython $RuntimePython `
                -RequirementsMarker $RequirementsMarker
        }
        Write-Host "Installing hash-locked backend dependencies..." -ForegroundColor Cyan
        & $RuntimePython -m pip install --disable-pip-version-check --require-hashes -r $RequirementsLock | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed" }
        if ($ExternalVirtualEnvironment) {
            Assert-ExternalManagedRuntimePaths `
                -VirtualEnvironment $VirtualEnvironment `
                -VirtualPython $RuntimePython `
                -RequirementsMarker $RequirementsMarker
        }
        [IO.File]::WriteAllText($RequirementsMarker, "$lockHash`n", [Text.UTF8Encoding]::new($false))
    }

    return $RuntimePython
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
    $RuntimePython = $null
    $ManagedVirtualEnvironment = $DefaultVirtualEnvironment
    $ManagedVirtualPython = Join-Path $ManagedVirtualEnvironment "Scripts\python.exe"
    $ManagedRequirementsMarker = Join-Path $ManagedVirtualEnvironment ".astra-requirements.sha256"

    if ($PythonExecutableSpecified) {
        $RuntimePython = Resolve-ExplicitPythonRuntime -RequestedPython $PythonExecutable
        Invoke-ExplicitPythonDependencyValidation -RuntimePython $RuntimePython
    } elseif ($VirtualEnvironmentPathSpecified) {
        $ManagedVirtualEnvironment = Resolve-AstraFileSystemPath `
            -PathValue $VirtualEnvironmentPath `
            -Description "-VirtualEnvironmentPath"
        Assert-ExternalVirtualEnvironmentPath -ResolvedVirtualEnvironment $ManagedVirtualEnvironment
        $ManagedVirtualPython = Join-Path $ManagedVirtualEnvironment "Scripts\python.exe"
        $ManagedRequirementsMarker = Join-Path $ManagedVirtualEnvironment ".astra-requirements.sha256"
        $RuntimePython = Initialize-ManagedPythonRuntime `
            -VirtualEnvironment $ManagedVirtualEnvironment `
            -VirtualPython $ManagedVirtualPython `
            -RequirementsMarker $ManagedRequirementsMarker `
            -ExternalVirtualEnvironment
    }

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

if (-not $RuntimePython) {
    $RuntimePython = Initialize-ManagedPythonRuntime `
        -VirtualEnvironment $ManagedVirtualEnvironment `
        -VirtualPython $ManagedVirtualPython `
        -RequirementsMarker $ManagedRequirementsMarker
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
$env:ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP = "false"
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
            $env:ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP = "false"
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
    & $RuntimePython -m alembic -c alembic.ini upgrade head
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
        $env:ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP = "true"
            $previousOutputEncoding = $OutputEncoding
            try {
                $OutputEncoding = [Text.UTF8Encoding]::new($false)
                $payload | & $RuntimePython -X utf8 -m scripts.local_preview_bootstrap_admin --confirm-local-preview
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
            & $RuntimePython -X utf8 -m scripts.initialize_demo_data --confirm-local-preview
            if ($LASTEXITCODE -ne 0) { throw "Demo data initialization failed" }
        } finally {
            $env:ASTRA_ADMIN_BOOTSTRAP_ENABLED = "false"
        }
    }

    Write-Host ""
    Write-Host "Astra local preview: http://127.0.0.1:$Port/" -ForegroundColor Green
    Write-Host "Data directory: $DataDirectory"
    Write-Host "Press Ctrl+C to stop the website."
    & $RuntimePython -m uvicorn app.local_preview:app --host 127.0.0.1 --port $Port
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
