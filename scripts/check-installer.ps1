# The asking installer, installed: CI runs the demo's NSIS installer silently,
# the way the updater and an administrator would, and reads back what it wrote
# to the registry, and the shortcuts it made, after each install. Each step's
# options are the ones the installer's pages would have set
# (builder/installer.js).
#
#   1. A fresh install, for one person: every file type, the right-click entry
#      on files and folders, and both shortcuts, ticked as the pages start.
#   2. Installed again with txt only, no right-click entry and no shortcuts:
#      .md, .json, .csv, the entry and both shortcuts are taken away.
#   3. Installed again as an update does it (--updated), with no options: the
#      choices kept from step 2, so nothing comes back.
#   4. Installed again with no Start menu shortcut and --force-run: the app
#      starts all the same, from its own exe.
#   5. The kept shortcut choices removed from the registry, then installed
#      again: both shortcuts are made, as on a fresh install.
#   6. Uninstalled: everything the installer added is gone, the shortcuts and
#      the updater's cache too (electron-builder's install copies itself there).
#   7. Run as an administrator only (CI): installed for everyone, then again
#      without shortcuts, then with no options, which upgrades that copy and
#      never adds one for one person; then the shortcut choices removed and
#      installed again; then uninstalled. Its shortcuts are the common
#      Desktop's and Start menu's.
#
# Usage: pwsh scripts/check-installer.ps1 -Setup demo/dist/electron-kit-Demo-0.0.0.exe

param([Parameter(Mandatory)][string]$Setup)

$ErrorActionPreference = "Stop"
$Name = "electron-kit Demo"
$Key = "electronkitDemo"
$Cache = Join-Path $env:LOCALAPPDATA "electron-kit-demo-updater"
$Types = @("txt", "md", "json", "csv")
# Each scope's Desktop and Start menu; the shortcut goes in the house's folder (builder/base.json's menuCategory).
$Folders = @{
    HKCU = @{ Desktop = [Environment]::GetFolderPath("Desktop"); Programs = [Environment]::GetFolderPath("Programs") }
    HKLM = @{ Desktop = [Environment]::GetFolderPath("CommonDesktopDirectory"); Programs = [Environment]::GetFolderPath("CommonPrograms") }
}
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

function Entry([string]$hive) {
    return Get-ChildItem "${hive}:\Software\Microsoft\Windows\CurrentVersion\Uninstall" |
        Where-Object { (Get-ItemProperty -LiteralPath $_.PSPath).DisplayName -like "$Name*" } | Select-Object -First 1
}

function UninstallFrom([string]$hive) {
    $entry = Entry $hive
    Check ($null -ne $entry) "$Name is in $hive's installed apps"
    if ($null -eq $entry) { return }
    $exe = ((Get-ItemProperty -LiteralPath $entry.PSPath).QuietUninstallString -split '"')[1]
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

# The install's own key (electron-builder's INSTALL_REGISTRY_KEY), named like its entry in installed apps.
function InstallKey([string]$hive) {
    $entry = Entry $hive
    if ($null -eq $entry) { return $null }
    return "${hive}:\Software\$($entry.PSChildName)"
}

function CheckState([string]$hive, [string[]]$types, [bool]$menu) {
    $classes = "${hive}:\Software\Classes"
    foreach ($ext in $Types) {
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

function CheckShortcuts([string]$hive, [bool]$desktop, [bool]$startMenu) {
    $desktopLink = Join-Path $Folders[$hive].Desktop "$Name.lnk"
    $startMenuLink = Join-Path $Folders[$hive].Programs "Diamond Digital Development\$Name.lnk"
    Check ($desktop -eq (Test-Path -LiteralPath $desktopLink)) "$hive's desktop shortcut is there: $desktop"
    Check ($startMenu -eq (Test-Path -LiteralPath $startMenuLink)) "$hive's Start menu shortcut is there: $startMenu"
    $key = InstallKey $hive
    if ($null -ne $key) {
        Check ((Value $key "KitDesktopShortcut") -eq $(if ($desktop) { "1" } else { "0" })) "$hive keeps the desktop shortcut's choice"
        Check ((Value $key "KitStartMenuShortcut") -eq $(if ($startMenu) { "1" } else { "0" })) "$hive keeps the Start menu shortcut's choice"
    }
}

# As if the install had never asked: its next install starts with both boxes ticked.
function ForgetShortcuts([string]$hive) {
    Write-Host "--- The kept shortcut choices removed"
    Remove-ItemProperty -LiteralPath (InstallKey $hive) -Name "KitDesktopShortcut", "KitStartMenuShortcut"
}

Install @()
CheckState "HKCU" $Types $true
CheckShortcuts "HKCU" $true $true
Check (Test-Path -LiteralPath $Cache) "the updater's cache is at $Cache"

Install @("/FILETYPES=txt", "/NOCONTEXTMENU", "/NODESKTOPSHORTCUT", "/NOSTARTMENUSHORTCUT")
CheckState "HKCU" @("txt") $false
CheckShortcuts "HKCU" $false $false

Install @("--updated")
CheckState "HKCU" @("txt") $false
CheckShortcuts "HKCU" $false $false
Check (Test-Path -LiteralPath $Cache) "an update keeps the updater's cache"

# The finish page's Run starts the app the same way; --force-run is its silent form.
Install @("/NOSTARTMENUSHORTCUT", "--force-run")
$started = $null
for ($i = 0; $i -lt 30 -and $null -eq $started; $i++) {
    Start-Sleep -Seconds 1
    $started = Get-Process -Name $Name -ErrorAction SilentlyContinue
}
Check ($null -ne $started) "--force-run starts the app without a Start menu shortcut"
$started | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
CheckShortcuts "HKCU" $false $false

ForgetShortcuts "HKCU"
Install @()
CheckState "HKCU" @("txt") $false
CheckShortcuts "HKCU" $true $true

UninstallFrom "HKCU"
CheckState "HKCU" @() $false
CheckShortcuts "HKCU" $false $false
Check (-not (Test-Path -LiteralPath "HKCU:\Software\Diamond Digital Development\$Key")) "HKCU has nothing of the app's left under Diamond Digital Development"
Check (-not (Test-Path -LiteralPath $Cache)) "uninstalling takes the updater's cache away"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($admin) {
    Install @("/allusers", "/FILETYPES=none")
    CheckState "HKLM" @() $true
    CheckShortcuts "HKLM" $true $true
    CheckShortcuts "HKCU" $false $false
    Install @("/NODESKTOPSHORTCUT", "/NOSTARTMENUSHORTCUT")
    CheckShortcuts "HKLM" $false $false
    Install @()
    CheckState "HKLM" @() $true
    CheckShortcuts "HKLM" $false $false
    Check ($null -eq (Entry "HKCU")) "installing again upgrades the copy for everyone, and adds none for one person"
    ForgetShortcuts "HKLM"
    Install @()
    CheckShortcuts "HKLM" $true $true
    UninstallFrom "HKLM"
    CheckState "HKLM" @() $false
    CheckShortcuts "HKLM" $false $false
    Check (-not (Test-Path -LiteralPath $Cache)) "uninstalling for everyone takes the updater's cache away too"
} else {
    Write-Host "--- Not an administrator: the install for everyone isn't checked."
}

if ($failures -gt 0) { Write-Host "::error::$failures checks failed."; exit 1 }
Write-Host "Every check passed."
