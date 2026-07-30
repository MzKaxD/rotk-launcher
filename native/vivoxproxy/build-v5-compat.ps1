param(
    [string]$OutputPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot "vivoxsdk_x64_proxy.c"
$definition = Join-Path $PSScriptRoot "vivoxsdk_x64_v5_compat.def"
$protocol = Join-Path $PSScriptRoot "voice_hud_protocol.h"
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $output = Join-Path $PSScriptRoot "dist\vivoxsdk_x64_v5_compat.dll"
} else {
    $output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
}
$outputDirectory = Split-Path -Parent $output
$importLibrary = Join-Path $outputDirectory "vivoxsdk_x64_proxy.lib"

foreach ($required in @($source, $definition, $protocol)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Missing source file: $required"
    }
}

$zig = Get-Command -Name "zig" -CommandType Application -ErrorAction Stop
$version = ([string](& $zig.Source version)).Trim()
if ($LASTEXITCODE -ne 0 -or $version -ne "0.15.2") {
    throw "Expected Zig 0.15.2, found '$version'."
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
& $zig.Source cc `
    -target x86_64-windows-gnu `
    -shared `
    -O2 `
    -fno-ident `
    -Wall `
    -Wextra `
    -Werror `
    -DROTK_VIVOX_V5_COMPAT=1 `
    "-Wl,--dynamicbase" `
    "-Wl,--nxcompat" `
    "-Wl,--high-entropy-va" `
    "-Wl,--out-implib,$importLibrary" `
    -o $output `
    $source `
    $definition `
    -lwinhttp `
    -lshell32

if ($LASTEXITCODE -ne 0) {
    throw "Vivox 5 compatibility proxy build failed with exit code $LASTEXITCODE."
}
Remove-Item -LiteralPath $importLibrary -Force -ErrorAction SilentlyContinue

$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash
Write-Host "Built ROTK Vivox 5 compatibility proxy:"
Write-Host "  $output"
Write-Host "  SHA256 $hash"
