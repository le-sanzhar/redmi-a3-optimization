# Print a markdown table comparing benchmark runs; Delta = last run vs first run.
#   .\compare.ps1 stock after-dexopt after-debloat
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Labels,
    [string]$ResultsDir
)
# $PSScriptRoot is empty in param defaults on Windows PowerShell 5.1
if (-not $ResultsDir) { $ResultsDir = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'results' }

$runs = foreach ($l in $Labels) {
    $f = Join-Path $ResultsDir "$l\summary.json"
    if (-not (Test-Path $f)) { $f = Join-Path $ResultsDir "$l.json" }
    Get-Content $f -Raw | ConvertFrom-Json
}

# paths use '/' because package names contain dots
function Get-Path($obj, [string]$path) {
    foreach ($p in $path -split '/') { if ($null -eq $obj) { return $null }; $obj = $obj.$p }
    return $obj
}

$metrics = @(
    @('Boot, s', 'boot_seconds'),
    @('Idle RAM available, MB', 'MemAvailable_mb'),
    @('Idle swap used, MB', 'swap_used_mb'),
    @('Idle CPU, %', 'cpu_total_pct'),
    @('Processes', 'processes'),
    @('Running services', 'running_services'),
    @('Packages', 'packages_total'),
    @('Jank, Settings scroll, %', 'jank/settings_scroll/janky_pct'),
    @('Settings scroll p90 frame, ms', 'jank/settings_scroll/p90_ms'),
    @('Jank, launcher swipe, %', 'jank/launcher_swipe/janky_pct'),
    @('Camera to viewfinder, first, ms', 'camera_viewfinder/first_ms'),
    @('Camera to viewfinder, median, ms', 'camera_viewfinder/median_ms')
)
foreach ($p in $runs[0].cold_start.PSObject.Properties.Name) {
    $metrics += , @("$p, first, ms", "cold_start/$p/first_ms")
    $metrics += , @("$p, median, ms", "cold_start/$p/median_ms")
}

$lines = @()
$lines += '| Metric | ' + ($Labels -join ' | ') + ' | Delta |'
$lines += ('|---' * ($Labels.Count + 2)) + '|'
foreach ($m in $metrics) {
    $vals = foreach ($r in $runs) { Get-Path $r $m[1] }
    $first = $vals[0]; $last = $vals[-1]
    $delta = ''
    if ($null -ne $first -and $null -ne $last -and [double]$first -ne 0) {
        $delta = '{0:+0;-0;0}%' -f ((([double]$last - [double]$first) / [double]$first) * 100)
    }
    $lines += '| ' + $m[0] + ' | ' + (($vals | ForEach-Object { if ($null -eq $_) { '-' } else { $_ } }) -join ' | ') + " | $delta |"
}
$lines -join "`n"
