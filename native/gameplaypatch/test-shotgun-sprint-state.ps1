param(
    [string]$OutputPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot "tests\shotgun_sprint_state_test.c"
$header = Join-Path $PSScriptRoot "shotgun_sprint_state.h"
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $output = Join-Path $PSScriptRoot "dist\tests\shotgun_sprint_state_test.exe"
} else {
    $output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
}

foreach ($required in @($source, $header)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Missing shotgun sprint state test input: $required"
    }
}

$zig = Get-Command -Name "zig" -CommandType Application -ErrorAction Stop
$version = ([string](& $zig.Source version)).Trim()
if ($LASTEXITCODE -ne 0 -or $version -ne "0.15.2") {
    throw "Expected Zig 0.15.2, found '$version'."
}

$outputDirectory = Split-Path -Parent $output
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
& $zig.Source cc `
    -target x86_64-windows-gnu `
    -O2 `
    -Wall `
    -Wextra `
    -Werror `
    -o $output `
    $source
if ($LASTEXITCODE -ne 0) {
    throw "Shotgun sprint state test build failed with exit code $LASTEXITCODE."
}

& $output
if ($LASTEXITCODE -ne 0) {
    throw "Shotgun sprint state tests failed with exit code $LASTEXITCODE."
}

Write-Host "Verified shotgun sprint state: $output"
