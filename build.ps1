param(
    [switch]$Clean,      # Xoa ca build/ dist/ truoc khi build
    [switch]$NoPack,     # Khong UPX compress (nhanh hon, file lon hon)
    [switch]$Open        # Mo thu muc dist sau khi build xong
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $rootDir

$specFile  = "RichReviewTool.spec"
$exeName   = "RichReviewTool.exe"
$distPath  = Join-Path $rootDir "dist\$exeName"
$startTime = Get-Date

# ── Banner ────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   RichReviewTool – BUILD SCRIPT V1.0    ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Kiem tra PyInstaller ──────────────────────────────────
if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
    Write-Host "[!] PyInstaller chua cai. Dang cai..." -ForegroundColor Yellow
    pip install pyinstaller -q
}

# ── Xoa cache neu --Clean ─────────────────────────────────
if ($Clean) {
    Write-Host "[~] Xoa build/ va dist/ cu..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force "build"  -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "dist"   -ErrorAction SilentlyContinue
    Remove-Item -Force "*.pkg"           -ErrorAction SilentlyContinue
    Write-Host "[OK] Sach se xong" -ForegroundColor Green
}

# ── Build ─────────────────────────────────────────────────
Write-Host "[>>] Dang chay PyInstaller..." -ForegroundColor Yellow
Write-Host "     Spec: $specFile" -ForegroundColor Gray

$pyArgs = @($specFile, "--clean")
if ($NoPack) { $pyArgs += "--noupx" }

try {
    & pyinstaller @pyArgs
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller exit code: $LASTEXITCODE" }
} catch {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════╗" -ForegroundColor Red
    Write-Host "║   BUILD THAT BAI                     ║" -ForegroundColor Red
    Write-Host "╚══════════════════════════════════════╝" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# ── Ket qua ───────────────────────────────────────────────
$elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)

if (Test-Path $distPath) {
    $sizeMB = [math]::Round((Get-Item $distPath).Length / 1MB, 1)
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║   BUILD THANH CONG!                      ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host "   File  : $distPath" -ForegroundColor White
    Write-Host "   Size  : $sizeMB MB" -ForegroundColor White
    Write-Host "   Thoi gian build: ${elapsed}s" -ForegroundColor White
    Write-Host ""

    if ($Open) {
        Start-Process "explorer.exe" (Split-Path $distPath)
    }
} else {
    Write-Host "[LOI] Khong tim thay file exe sau khi build" -ForegroundColor Red
    exit 1
}
