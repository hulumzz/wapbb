# ============================================================
# backup-neon.ps1 — Backup database Neon ke file SQL
# Jalankan: powershell -ExecutionPolicy Bypass -File .\scripts\backup-neon.ps1
# Kompatibel: PowerShell 5.1 dan PowerShell 7+
# ============================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Baca DATABASE_URL dari .env di root projek ---
$envFile = [System.IO.Path]::Combine($PSScriptRoot, '..', '.env')
$envFile = [System.IO.Path]::GetFullPath($envFile)

if (-not (Test-Path $envFile)) {
    Write-Error "File .env tidak ditemukan di: $envFile"
    exit 1
}

$databaseUrl = $null
foreach ($line in Get-Content $envFile) {
    if ($line -match '^DATABASE_URL=(.+)$') {
        $databaseUrl = $Matches[1].Trim()
        break
    }
}

if (-not $databaseUrl) {
    Write-Error "DATABASE_URL tidak ditemukan di file .env"
    exit 1
}

Write-Host "DATABASE_URL ditemukan: $($databaseUrl.Substring(0, [Math]::Min(50, $databaseUrl.Length)))..." -ForegroundColor Cyan

# --- Parse URL koneksi ---
$uri        = [System.Uri]$databaseUrl
$pgHost     = $uri.Host
$pgPort     = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
$pgDb       = $uri.AbsolutePath.TrimStart('/')
$userInfo   = $uri.UserInfo -split ':', 2
$pgUser     = [System.Uri]::UnescapeDataString($userInfo[0])
$pgPassword = [System.Uri]::UnescapeDataString($userInfo[1])

Write-Host "Host : $pgHost" -ForegroundColor Gray
Write-Host "Port : $pgPort" -ForegroundColor Gray
Write-Host "DB   : $pgDb"   -ForegroundColor Gray
Write-Host "User : $pgUser" -ForegroundColor Gray

# --- Cari pg_dump ---
$pgDump = $null
$pgDumpCmd = Get-Command 'pg_dump' -ErrorAction SilentlyContinue
if ($pgDumpCmd) {
    $pgDump = $pgDumpCmd.Source
}

if (-not $pgDump) {
    $candidates = @(
        'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe',
        'C:\Program Files\PostgreSQL\16\bin\pg_dump.exe',
        'C:\Program Files\PostgreSQL\15\bin\pg_dump.exe',
        'C:\Program Files\PostgreSQL\14\bin\pg_dump.exe'
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $pgDump = $c; break }
    }
}

if (-not $pgDump) {
    Write-Error @"
pg_dump tidak ditemukan di PATH atau di direktori default PostgreSQL.
Pastikan PostgreSQL sudah terinstall dan tambahkan bin/ ke PATH, atau
edit script ini dan isi variabel `$pgDump secara manual.
Contoh: `$pgDump = 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe'
"@
    exit 1
}

Write-Host "pg_dump : $pgDump" -ForegroundColor Gray

# --- Tentukan file output ---
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outputDir = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', 'backups'))
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}
$outputFile = [System.IO.Path]::Combine($outputDir, "neon_backup_$timestamp.sql")

Write-Host ""
Write-Host "Memulai backup dari Neon..." -ForegroundColor Yellow
Write-Host "Output: $outputFile"         -ForegroundColor Yellow

# --- Jalankan pg_dump ---
$env:PGPASSWORD = $pgPassword
try {
    & $pgDump `
        "--host=$pgHost" `
        "--port=$pgPort" `
        "--username=$pgUser" `
        "--dbname=$pgDb" `
        '--no-password' `
        '--format=plain' `
        '--no-owner' `
        '--no-acl' `
        '--verbose' `
        "--file=$outputFile"

    if ($LASTEXITCODE -ne 0) {
        Write-Error "pg_dump gagal dengan exit code: $LASTEXITCODE"
        exit $LASTEXITCODE
    }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

$sizeKb = [Math]::Round((Get-Item $outputFile).Length / 1KB, 1)
Write-Host ""
Write-Host "Backup selesai!" -ForegroundColor Green
Write-Host "File   : $outputFile" -ForegroundColor Green
Write-Host "Ukuran : $sizeKb KB"  -ForegroundColor Green
