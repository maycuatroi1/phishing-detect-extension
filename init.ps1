$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Write-Step($message) {
    Write-Host "[init] $message"
}

function Stop-WithError($message) {
    Write-Host "[init] ERROR: $message"
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-WithError "node not found on PATH (need Node >= 22.12)"
}
Write-Step "node $(node --version)"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Stop-WithError "pnpm not found on PATH (need pnpm 11, try: corepack enable)"
}
Write-Step "pnpm $(pnpm --version)"

if (Test-Path .env) {
    Write-Step ".env already exists, leaving it alone"
} else {
    Copy-Item .env.example .env
    Write-Step "created .env from .env.example"
}

Write-Step "installing dependencies"
pnpm install
if ($LASTEXITCODE -ne 0) { Stop-WithError "pnpm install failed" }

Write-Step "building once so dist/ exists and the secret post-check runs"
pnpm --filter extension build
if ($LASTEXITCODE -ne 0) { Stop-WithError "build failed" }

Write-Step "done. Load unpacked from $root\dist in chrome://extensions"
