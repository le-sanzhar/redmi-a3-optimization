# Remove (or restore) the packages in debloat-list.txt for the current user. No root needed.
# "pm uninstall --user 0" keeps the APK on the system partition, so everything is reversible
# and comes back after a factory reset.
#
#   .\debloat.ps1                 # remove everything in the list
#   .\debloat.ps1 -Restore        # bring everything back
#   .\debloat.ps1 -Only <pkg>     # act on one package
param(
    [switch]$Restore,
    [string]$Only,
    [string]$List,
    [string]$Serial,
    [string]$Adb = 'adb'
)

# $PSScriptRoot is empty in param defaults on Windows PowerShell 5.1
if (-not $List) { $List = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'debloat-list.txt' }
$adbArgs = @(); if ($Serial) { $adbArgs = @('-s', $Serial) }
# resolve the executable first: a function named Adb would otherwise call itself
$adbExe = (Get-Command $Adb -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
function Adb { & $adbExe @adbArgs @args }

$pkgs = Get-Content $List | ForEach-Object { ($_ -replace '#.*$', '').Trim() } | Where-Object { $_ }
if ($Only) { $pkgs = @($Only) }

$installed = (Adb shell pm list packages) -join "`n"
foreach ($p in $pkgs) {
    if ($Restore) {
        $o = (Adb shell cmd package install-existing $p) -join ' '
    } elseif ($installed -match "package:$([regex]::Escape($p))(\r?\n|$)") {
        $o = (Adb shell pm uninstall -k --user 0 $p) -join ' '
    } else {
        $o = 'not installed, skipped'
    }
    "{0,-48} {1}" -f $p, $o
}
