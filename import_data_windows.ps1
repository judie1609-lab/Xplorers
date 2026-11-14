$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$Csv = Join-Path $ProjectRoot 'table_Spectral-Images-1.csv'
if (-not (Test-Path $Csv)) { throw "CSV not found: $Csv. Put table_Spectral-Images-1.csv in the SPECTRA_phase1 folder." }
$Backend = Join-Path $ProjectRoot 'backend'
$Python = Join-Path $Backend '.venv\Scripts\python.exe'
if (-not (Test-Path $Python)) { throw 'Python environment not found. Run .\setup_windows.ps1 first.' }
Set-Location $Backend
& $Python scripts\ingest_csv.py $Csv
