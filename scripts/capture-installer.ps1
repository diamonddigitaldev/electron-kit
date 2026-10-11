# The asking installer's pages, as pictures: runs the demo's installer with its
# pages showing, steps through them as a person clicking Next would, and saves
# a PNG of every page; then the same for its uninstaller. Nothing is chosen on
# a page: each shows what it starts with. What the choices do is
# check-installer.ps1's.
#
# Each page is saved as NN-<its title>.png (the uninstaller's as
# NN-uninstall-<its title>.png), taken with PrintWindow, so the window doesn't
# need to be in front. Next is clicked with the message its button sends
# (WM_COMMAND, control 1), and the finish page's "Run" box is unticked first, so
# the app isn't started. A page that goes by on its own (Installing) is saved
# only if it waits for Next.
#
# Windows CI runs it after check-installer.ps1 and keeps the PNGs as a workflow
# artifact for 3 days; a session that changes a page runs it and looks at each.
# It expects the demo not to be installed.
#
# Usage: pwsh scripts/capture-installer.ps1 -Setup demo/dist/electron-kit-Demo-0.0.0.exe [-Out installer-pages]

param([Parameter(Mandatory)][string]$Setup, [string]$Out = "installer-pages")

$ErrorActionPreference = "Stop"
$Name = "electron-kit Demo"
$Setup = (Resolve-Path $Setup).Path
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path $Out).Path
Get-ChildItem -LiteralPath $Out -Filter *.png | Remove-Item

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public static class Wizard {
    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr dialog, int id);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }

    const uint WM_COMMAND = 0x0111, BM_GETCHECK = 0x00F0, BM_SETCHECK = 0x00F1;

    public static void DpiAware() { SetProcessDPIAware(); }

    static string ClassOf(IntPtr hwnd) { var s = new StringBuilder(256); GetClassName(hwnd, s, s.Capacity); return s.ToString(); }

    public static string Text(IntPtr hwnd) {
        if (hwnd == IntPtr.Zero) return "";
        var s = new StringBuilder(1024); GetWindowText(hwnd, s, s.Capacity); return s.ToString();
    }

    /** The wizard's window: a visible dialog whose title starts with the app's name. */
    public static IntPtr Find(string titleStart) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, _) => {
            if (IsWindowVisible(hwnd) && ClassOf(hwnd) == "#32770" && Text(hwnd).StartsWith(titleStart)) { found = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    /** The page on show: the dialog inside the wizard's window. */
    public static IntPtr Page(IntPtr wizard) { return FindWindowEx(wizard, IntPtr.Zero, "#32770", null); }

    public static void Click(IntPtr wizard, int id) { PostMessage(wizard, WM_COMMAND, (IntPtr)id, GetDlgItem(wizard, id)); }

    public static bool Checked(IntPtr box) { return SendMessage(box, BM_GETCHECK, IntPtr.Zero, IntPtr.Zero) == (IntPtr)1; }

    public static void Untick(IntPtr box) { SendMessage(box, BM_SETCHECK, IntPtr.Zero, IntPtr.Zero); }

    public static void Save(IntPtr hwnd, string file) {
        RECT r; GetWindowRect(hwnd, out r);
        using (var bitmap = new Bitmap(r.Right - r.Left, r.Bottom - r.Top)) {
            using (var g = Graphics.FromImage(bitmap)) {
                IntPtr hdc = g.GetHdc();
                // PW_RENDERFULLCONTENT: the window as drawn, even behind others.
                PrintWindow(hwnd, hdc, 2);
                g.ReleaseHdc(hdc);
            }
            bitmap.Save(file, ImageFormat.Png);
        }
    }
}
"@
[Wizard]::DpiAware()

$script:count = 0

function WaitFor([scriptblock]$test, [int]$seconds, [string]$what) {
    $until = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $until) {
        $value = & $test
        if ($value) { return $value }
        Start-Sleep -Milliseconds 200
    }
    throw "Timed out waiting for $what."
}

function Slug([string]$text) {
    return (($text.ToLowerInvariant() -replace "&", "" -replace "[^a-z0-9]+", "-").Trim("-"))
}

# A page's title: the header's on most pages, the page's own large title on the welcome and finish pages.
function TitleOf([IntPtr]$wizard, [IntPtr]$page) {
    # Those two hide the header (control 1037) and show their own title (1201).
    $header = [Wizard]::GetDlgItem($wizard, 1037)
    if ([Wizard]::IsWindowVisible($header)) { return [Wizard]::Text($header) }
    return [Wizard]::Text([Wizard]::GetDlgItem($page, 1201))
}

function Capture([string]$titleStart, [string]$prefix) {
    $wizard = WaitFor { $w = [Wizard]::Find($titleStart); if ($w -ne [IntPtr]::Zero) { $w } } 60 "the window `"$titleStart`""
    $last = [IntPtr]::Zero
    while ([Wizard]::IsWindow($wizard)) {
        $page = [Wizard]::Page($wizard)
        if ($page -eq [IntPtr]::Zero -or $page -eq $last) { Start-Sleep -Milliseconds 200; continue }
        $next = [Wizard]::GetDlgItem($wizard, 1)
        # Wait for Next, unless the page moves on by itself first (Installing).
        $until = (Get-Date).AddSeconds(180)
        while ((Get-Date) -lt $until -and [Wizard]::IsWindow($wizard) -and [Wizard]::Page($wizard) -eq $page -and -not [Wizard]::IsWindowEnabled($next)) {
            Start-Sleep -Milliseconds 200
        }
        if (-not [Wizard]::IsWindow($wizard)) { break }
        if ([Wizard]::Page($wizard) -ne $page) { continue }
        Start-Sleep -Milliseconds 600
        $last = $page
        $title = TitleOf $wizard $page
        $script:count++
        $file = Join-Path $Out ("{0:D2}-{1}{2}.png" -f $script:count, $prefix, (Slug $title))
        [Wizard]::Save($wizard, $file)
        Write-Host "saved $(Split-Path $file -Leaf)  ($title)"
        $button = [Wizard]::Text($next)
        if ($button -match "Finish") {
            $run = [Wizard]::GetDlgItem($page, 1203)
            if ($run -ne [IntPtr]::Zero -and [Wizard]::Checked($run)) { [Wizard]::Untick($run) }
        }
        [Wizard]::Click($wizard, 1)
    }
}

Write-Host "--- The installer"
$process = Start-Process -FilePath $Setup -PassThru
Capture "$Name Setup" ""
$process.WaitForExit(60000) | Out-Null

$entry = Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall" |
    Get-ItemProperty | Where-Object { $_.DisplayName -like "$Name*" } | Select-Object -First 1
if ($null -eq $entry) { throw "$Name isn't installed after its installer finished." }
$uninstaller = ($entry.UninstallString -split '"')[1]

Write-Host "--- The uninstaller"
# It copies itself to a temporary folder and runs from there, so its window is found by its title.
Start-Process -FilePath $uninstaller | Out-Null
Capture "$Name Uninstall" "uninstall-"
for ($i = 0; $i -lt 30 -and (Test-Path -LiteralPath $uninstaller); $i++) { Start-Sleep -Seconds 1 }

Write-Host "$script:count pages saved in $Out"
