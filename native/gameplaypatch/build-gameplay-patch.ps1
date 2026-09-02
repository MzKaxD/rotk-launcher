param(
    [string]$OutputPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot "dinput8_proxy.c"
$definition = Join-Path $PSScriptRoot "dinput8_proxy.def"
$state = Join-Path $PSScriptRoot "shotgun_sprint_state.h"
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $output = Join-Path $PSScriptRoot "dist\dinput8.dll"
} else {
    $output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
}

foreach ($required in @($source, $definition, $state)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Missing gameplay patch source: $required"
    }
}

$zig = Get-Command -Name "zig" -CommandType Application -ErrorAction Stop
$version = ([string](& $zig.Source version)).Trim()
if ($LASTEXITCODE -ne 0 -or $version -ne "0.15.2") {
    throw "Expected Zig 0.15.2, found '$version'."
}

function Build-DinputProxy([string]$Destination) {
    $directory = Split-Path -Parent $Destination
    $importLibrary = Join-Path $directory "dinput8_proxy.lib"
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $compilerArguments = @(
        "cc",
        "-target", "x86_64-windows-gnu",
        "-shared",
        "-O2",
        "-s",
        "-fno-ident",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-Wl,--dynamicbase",
        "-Wl,--nxcompat",
        "-Wl,--high-entropy-va",
        "-Wl,--out-implib,$importLibrary",
        "-o", $Destination,
        $source,
        $definition,
        "-luser32"
    )
    & $zig.Source @compilerArguments
    if ($LASTEXITCODE -ne 0) {
        throw "ROTK gameplay patch build failed with exit code $LASTEXITCODE."
    }
    Remove-Item -LiteralPath $importLibrary -Force -ErrorAction SilentlyContinue
}

function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

$outputDirectory = Split-Path -Parent $output
$verificationRoot = Join-Path $outputDirectory ".dinput8-repro-$PID"
$verificationOutput = Join-Path $verificationRoot "dinput8.dll"
try {
    Build-DinputProxy $output
    Build-DinputProxy $verificationOutput
    $firstHash = Get-Sha256 $output
    $secondHash = Get-Sha256 $verificationOutput
    if ($firstHash -cne $secondHash) {
        throw "The dinput8.dll build is not reproducible: $firstHash != $secondHash"
    }
    Set-Content -LiteralPath "$output.sha256" -Value "$firstHash *dinput8.dll" -Encoding ascii
} finally {
    if (Test-Path -LiteralPath $verificationRoot) {
        $resolvedVerification = [System.IO.Path]::GetFullPath($verificationRoot)
        $resolvedOutputDirectory = [System.IO.Path]::GetFullPath($outputDirectory).TrimEnd('\')
        if (-not $resolvedVerification.StartsWith(
            "$resolvedOutputDirectory\",
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
            throw "Unsafe gameplay patch verification path: $resolvedVerification"
        }
        Remove-Item -LiteralPath $resolvedVerification -Recurse -Force
    }
}

Write-Host "Built deterministic ROTK gameplay patch:"
Write-Host "  $output"
Write-Host "  SHA256 $firstHash"
