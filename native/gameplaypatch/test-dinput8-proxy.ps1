param(
    [string]$DllPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($DllPath)) {
    $proxy = Join-Path $PSScriptRoot "dist\dinput8.dll"
    & (Join-Path $PSScriptRoot "build-gameplay-patch.ps1") -OutputPath $proxy
} else {
    $proxy = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DllPath)
}
$source = Join-Path $PSScriptRoot "tests\dinput8_proxy_smoke.c"
$output = Join-Path $PSScriptRoot "dist\tests\dinput8_proxy_smoke.exe"

foreach ($required in @($proxy, $source)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Missing dinput8 proxy smoke input: $required"
    }
}

$zig = Get-Command -Name "zig" -CommandType Application -ErrorAction Stop
$version = ([string](& $zig.Source version)).Trim()
if ($LASTEXITCODE -ne 0 -or $version -ne "0.15.2") {
    throw "Expected Zig 0.15.2, found '$version'."
}

New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
$compilerArguments = @(
    "cc",
    "-target", "x86_64-windows-gnu",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-o", $output,
    $source
)
& $zig.Source @compilerArguments
if ($LASTEXITCODE -ne 0) {
    throw "dinput8 proxy smoke build failed with exit code $LASTEXITCODE."
}

& $output ([System.IO.Path]::GetFullPath($proxy))
if ($LASTEXITCODE -ne 0) {
    throw "dinput8 proxy smoke failed with exit code $LASTEXITCODE."
}

Write-Host "Verified dinput8 proxy forwarding: $proxy"
