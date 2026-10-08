param(
  [string]$Name = "ARC Vault Harvester",
  [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python bulunamadı. Python 3.11+ kurulu olmalı."
}

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

# steam_api64.dll is required (Steam-mint model). Use a local copy if present,
# otherwise copy it from an installed ARC Raiders (Steam) build.
$SteamDll = Join-Path $Root "steam_api64.dll"
if (-not (Test-Path $SteamDll)) {
  $gameDlls = @(
    "C:\Program Files (x86)\Steam\steamapps\common\Arc Raiders\steam_api64.dll",
    "D:\SteamLibrary\steamapps\common\Arc Raiders\steam_api64.dll",
    "E:\SteamLibrary\steamapps\common\Arc Raiders\steam_api64.dll"
  )
  $found = $gameDlls | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($found) {
    Copy-Item $found $SteamDll
    Write-Host "steam_api64.dll kopyalandi: $found"
  } else {
    throw "steam_api64.dll bulunamadi. ARC Raiders (Steam) kurulumundaki steam_api64.dll'i bu klasore kopyalayin: $Root"
  }
}

python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --windowed `
  --icon .\arc_vault.ico `
  --add-data "arc_vault.ico;." `
  --add-binary "steam_api64.dll;." `
  --hidden-import win32timezone `
  --hidden-import pywintypes `
  --hidden-import pythoncom `
  --hidden-import win32cred `
  --hidden-import win32crypt `
  --hidden-import tkinter `
  --hidden-import tkinter.messagebox `
  --name $Name `
  .\arc_vault_harvester.py

python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --console `
  --icon .\arc_vault.ico `
  --add-data "arc_vault.ico;." `
  --add-binary "steam_api64.dll;." `
  --hidden-import win32timezone `
  --hidden-import pywintypes `
  --hidden-import pythoncom `
  --hidden-import win32cred `
  --hidden-import win32crypt `
  --hidden-import tkinter `
  --hidden-import tkinter.messagebox `
  --name "$Name CLI" `
  .\arc_vault_harvester.py

Write-Host ""
Write-Host "Build tamamlandı:"
Write-Host "  $Root\dist\$Name.exe"
Write-Host "  $Root\dist\$Name CLI.exe"

if (-not $SkipInstaller) {
  $isccCommand = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  $isccPath = if ($isccCommand) { $isccCommand.Source } else { $null }
  if (-not $isccPath) {
    $candidate = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
    if (Test-Path $candidate) {
      $isccPath = $candidate
    }
  }

  if ($isccPath) {
    & $isccPath .\installer.iss
    Write-Host "  $Root\installer\ARC-Vault-Harvester-Setup.exe"
  } else {
    Write-Host ""
    Write-Host "Inno Setup bulunamadı; installer atlandı."
    Write-Host "Installer üretmek için Inno Setup 6 kurup tekrar çalıştırın:"
    Write-Host "  winget install JRSoftware.InnoSetup"
  }
}

Write-Host ""
Write-Host "İlk kurulum örneği:"
Write-Host "  .\dist\$Name.exe configure --api-key <INTERNAL_API_KEY> --autostart"
Write-Host "  .\dist\$Name.exe"
