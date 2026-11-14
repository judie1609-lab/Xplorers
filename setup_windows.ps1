$ErrorActionPreference = 'Stop'
Write-Host 'SPECTRA - Windows setup (no Docker required)' -ForegroundColor Cyan
Set-Location (Join-Path $PSScriptRoot 'backend')
if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  throw 'Python launcher (py) was not found. Install Python 3.12 from python.org and enable Add Python to PATH.'
}
py -3.12 -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
Write-Host ''
Write-Host 'Setup complete. Next: run .\import_data_windows.ps1 from the project root.' -ForegroundColor Green
