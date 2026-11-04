# ============================================================
# restore-local.ps1 — Restore backup SQL ke PostgreSQL target
# Jalankan: powershell -ExecutionPolicy Bypass -File .\scripts\restore-local.ps1
#
# Opsional — override via parameter:
#   .\restore-local.ps1 -BackupFile .\backups\neon_backup_xxx.sql
#   .\restore-local.ps1 -TargetUrl "postgresql://user:pass@host:5432/dbname"
# Kompatibel: PowerShell 5.1 dan PowerShell 7+
# ============================================================

param(
    [string]$BackupFile = '',
    [string]$TargetUrl  = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Jika TargetUrl tidak diisi, baca dari .env ---
if (-not $TargetUrl) {
    $envFile = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', '.env'))

    if (-not (Test-Path $envFile)) {
        Write-Error "File .env tidak ditemukan di: $envFile"
        exit 1
    }

    foreach ($line in Get-Content $envFile) {
        # Prioritaskan DIRECT_DATABASE_URL jika ada (untuk Prisma Postgres)
        if ($line -match '^DIRECT_DATABASE_URL=(.+)$') {
            $TargetUrl = $Matches[1].Trim()
            break
        }
    }

    if (-not $TargetUrl) {
        foreach ($line in Get-Content $envFile) {
            if ($line -match '^DATABASE_URL=(.+)$') {
                $TargetUrl = $Matches[1].Trim()
                break
            }
        }
    }

    if (-not $TargetUrl) {
        Write-Error "DATABASE_URL tidak ditemukan di file .env"
        exit 1
    }
}

Write-Host "Target URL: $($TargetUrl.Substring(0, [Math]::Min(50, $TargetUrl.Length)))..." -ForegroundColor Cyan

# --- Parse URL ---
$uri        = [System.Uri]$TargetUrl
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

# --- Validasi: peringatkan jika bukan lokal/Prisma ---
$localHosts = @('localhost', '127.0.0.1', '::1')
if ($pgHost -notin $localHosts) {
    Write-Host ""
    Write-Warning "Host '$pgHost' adalah database remote."
    $confirm = Read-Host "Lanjutkan restore ke host ini? (ketik 'ya' untuk lanjut)"
    if ($confirm -ne 'ya') {
        Write-Host "Dibatalkan." -ForegroundColor Red
        exit 0
    }
}

# --- Pilih file backup jika tidak diisi ---
if (-not $BackupFile) {
    $backupDir = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', 'backups'))

    if (-not (Test-Path $backupDir)) {
        Write-Error "Direktori backups/ tidak ditemukan. Jalankan backup-neon.ps1 terlebih dahulu."
        exit 1
    }

    $files = @(Get-ChildItem $backupDir -Filter '*.sql' | Sort-Object LastWriteTime -Descending)
    if ($files.Count -eq 0) {
        Write-Error "Tidak ada file backup (.sql) di direktori backups/."
        exit 1
    }

    Write-Host ""
    Write-Host "File backup tersedia:" -ForegroundColor Yellow
    for ($i = 0; $i -lt $files.Count; $i++) {
        $sizeKb = [Math]::Round($files[$i].Length / 1KB, 1)
        Write-Host "  [$($i+1)] $($files[$i].Name) ($sizeKb KB)" -ForegroundColor White
    }

    $choice = Read-Host "Pilih nomor file (default: 1 = terbaru)"
    if (-not $choice) { $choice = '1' }
    $idx = [int]$choice - 1

    if ($idx -lt 0 -or $idx -ge $files.Count) {
        Write-Error "Pilihan tidak valid."
        exit 1
    }

    $BackupFile = $files[$idx].FullName
}

$BackupFile = [System.IO.Path]::GetFullPath($BackupFile)
if (-not (Test-Path $BackupFile)) {
    Write-Error "File backup tidak ditemukan: $BackupFile"
    exit 1
}

$sizeKb = [Math]::Round((Get-Item $BackupFile).Length / 1KB, 1)
Write-Host ""
Write-Host "File backup : $BackupFile ($sizeKb KB)" -ForegroundColor Cyan

# --- Cari psql ---
$psql = $null
$psqlCmd = Get-Command 'psql' -ErrorAction SilentlyContinue
if ($psqlCmd) {
    $psql = $psqlCmd.Source
}

if (-not $psql) {
    $candidates = @(
        'C:\Program Files\PostgreSQL\17\bin\psql.exe',
        'C:\Program Files\PostgreSQL\16\bin\psql.exe',
        'C:\Program Files\PostgreSQL\15\bin\psql.exe',
        'C:\Program Files\PostgreSQL\14\bin\psql.exe'
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $psql = $c; break }
    }
}

if (-not $psql) {
    Write-Error @"
psql tidak ditemukan di PATH atau di direktori default PostgreSQL.
Pastikan PostgreSQL sudah terinstall, atau edit script ini dan isi
variabel `$psql secara manual.
Contoh: `$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
"@
    exit 1
}

Write-Host "psql : $psql" -ForegroundColor Gray

# --- Konfirmasi sebelum restore ---
Write-Host ""
Write-Host "PERINGATAN: Restore akan menimpa/menambah data di database '$pgDb' pada host '$pgHost'." -ForegroundColor Red
$confirm = Read-Host "Ketik nama database ('$pgDb') untuk konfirmasi"
if ($confirm -ne $pgDb) {
    Write-Host "Dibatalkan — nama database tidak cocok." -ForegroundColor Red
    exit 0
}

# --- Jalankan psql restore ---
Write-Host ""
Write-Host "Memulai restore..." -ForegroundColor Yellow

$env:PGPASSWORD = $pgPassword
try {
    & $psql `
        "--host=$pgHost" `
        "--port=$pgPort" `
        "--username=$pgUser" `
        "--dbname=$pgDb" `
        '--no-password' `
        '--echo-errors' `
        "--file=$BackupFile"

    if ($LASTEXITCODE -ne 0) {
        Write-Error "psql gagal dengan exit code: $LASTEXITCODE"
        exit $LASTEXITCODE
    }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Restore selesai!" -ForegroundColor Green
Write-Host "Verifikasi data di DBeaver, lalu jalankan: npm run db:migrate" -ForegroundColor Green
