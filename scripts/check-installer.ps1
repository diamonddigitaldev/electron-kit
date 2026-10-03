# The asking installer, installed: CI runs the demo's NSIS installer silently,
# the way the updater and an administrator would, and reads back what it wrote
# to the registry after each install. Each step's options are the ones the
# installer's page would have set (builder/installer.js).
#
#   1. A fresh install, for one person: every file type, and the right-click
#      entry on files and folders, ticked as the page starts.
#   2. Installed again with txt only and no right-click entry: .md and the entry
#      are taken away.
#   3. Installed again as an update does it (--updated), with no options: the
#      choices kept from step 2, so nothing comes back.
#   4. Uninstalled: everything the installer added is gone.
#   5. Run as an administrator only (CI): installed for everyone, then again with
#      no options, which upgrades that copy and never adds one for one person;
#      then uninstalled.
#
# Usage: pwsh scripts/check-installer.ps1 -Setup demo/dist/electron-kit-Demo-0.0.0.exe

param([Parameter(Mandatory)][string]$Setup)

$ErrorActionPreference = "Stop"
$Name = "electron-kit Demo"
$Key = "electronkitDemo"
$Setup = (Resolve-Path $Setup).Path
$failures = 0

function Check([bool]$ok, [string]$what) {
    if ($ok) { Write-Host "ok   $what" } else { Write-Host "::error::$what"; $script:failures++ }
}

function Install([string[]]$options) {
    Write-Host "--- Install $($options -join ' ')"
    $process = Start-Process -FilePath $Setup -ArgumentList (@("/S") + $options) -Wait -PassThru
    Check ($process.ExitCode -eq 0) "the installer exits 0"
}

function UninstallFrom([string]$hive) {
    $entry = Get-ChildItem "${hive}:\Software\Microsoft\Windows\CurrentVersion\Uninstall" |
        Get-ItemProperty | Where-Object { $_.DisplayName -like "$Name*" } | Select-Object -First 1
    Check ($null -ne $entry) "$Name is in $hive's installed apps"
    if ($null -eq $entry) { return }
    $exe = ($entry.QuietUninstallString -split '"')[1]
    Write-Host "--- Uninstall $exe"
    $process = Start-Process -FilePath $exe -ArgumentList "/S" -Wait -PassThru
    Check ($process.ExitCode -eq 0) "the uninstaller exits 0"
    # The uninstaller copies itself to a temporary folder and runs from there.
    for ($i = 0; $i -lt 30 -and (Test-Path -LiteralPath $exe); $i++) { Start-Sleep -Seconds 1 }
}

function Value([string]$path, [string]$name) {
    $item = Get-ItemProperty -LiteralPath $path -ErrorAction SilentlyContinue
    if ($null -eq $item) { return $null }
    return $item.$name
}

function Has([string]$path, [string]$name) {
    $item = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
    return $null -ne $item -and $item.GetValueNames() -contains $name
}

function CheckState([string]$hive, [string[]]$types, [bool]$menu) {
    $classes = "${hive}:\Software\Classes"
    foreach ($ext in @("txt", "md")) {
        $want = $types -contains $ext
        $progId = "$Key.$ext"
        $command = Value "$classes\$progId\shell\open\command" "(default)"
        Check ($want -eq ($null -ne $command -and $command -like "*$Name.exe*")) "$hive .$ext opens with the app: $want"
        Check ($want -eq (Has "$classes\.$ext\OpenWithProgids" $progId)) "$hive .$ext lists the app in Open With: $want"
        Check ($want -eq ((Value "$hive`:\Software\Diamond Digital Development\$Key\Capabilities\FileAssociations" ".$ext") -eq $progId)) "$hive .$ext is in the app's Default apps entry: $want"
        if (-not $want) {
            Check ((Value "$classes\.$ext" "(default)") -ne $progId) "$hive .$ext's default isn't the app"
        }
    }
    $registered = (Value "${hive}:\Software\RegisteredApplications" $Name) -eq "Software\Diamond Digital Development\$Key\Capabilities"
    Check ($registered -eq ($types.Count -gt 0)) "$hive lists the app in Default apps: $($types.Count -gt 0)"
    foreach ($target in @("*", "Directory")) {
        $label = Value "$classes\$target\shell\$Key" "(default)"
        Check ($menu -eq ($label -eq "Open with $Name")) "$hive's right-click menu on $target has the entry: $menu"
        if ($menu) {
            Check ((Value "$classes\$target\shell\$Key\command" "(default)") -like "*$Name.exe`" `"%1`"") "$hive's entry on $target opens the file"
            Check ((Value "$classes\$target\shell\$Key" "MultiSelectModel") -eq "Player") "$hive's entry on $target shows for any number of files"
        }
    }
}

Install @()
CheckState "HKCU" @("txt", "md") $true

Install @("/FILETYPES=txt", "/NOCONTEXTMENU")
CheckState "HKCU" @("txt") $false

Install @("--updated")
CheckState "HKCU" @("txt") $false

UninstallFrom "HKCU"
CheckState "HKCU" @() $false
Check (-not (Test-Path -LiteralPath "HKCU:\Software\Diamond Digital Development\$Key")) "HKCU has nothing of the app's left under Diamond Digital Development"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($admin) {
    Install @("/allusers", "/FILETYPES=none")
    CheckState "HKLM" @() $true
    Install @()
    CheckState "HKLM" @() $true
    $perUser = Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall" | Get-ItemProperty | Where-Object { $_.DisplayName -like "$Name*" }
    Check ($null -eq $perUser) "installing again upgrades the copy for everyone, and adds none for one person"
    UninstallFrom "HKLM"
    CheckState "HKLM" @() $false
} else {
    Write-Host "--- Not an administrator: the install for everyone isn't checked."
}

if ($failures -gt 0) { Write-Host "::error::$failures checks failed."; exit 1 }
Write-Host "Every check passed."
