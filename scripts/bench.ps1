# Benchmark an Android phone over ADB: cold starts, camera-to-viewfinder, scroll jank,
# idle RAM / swap / CPU, boot time. Writes <OutDir>\<Label>\summary.json plus raw dumps.
#
#   .\bench.ps1 -Label stock -Reboot                 # phone without a lock-screen PIN
#   .\bench.ps1 -Label stock -Reboot -Pin 1234       # PIN is removed for the run and restored afterwards
#
# Run the same command before and after each change, then compare with compare.ps1.
param(
    [Parameter(Mandatory = $true)][string]$Label,
    [switch]$Reboot,
    [string]$Pin,
    [string]$Serial,
    [string]$Adb = 'adb',
    [string]$OutDir,
    [int]$IdleSeconds = 300,
    [int]$Runs = 5,
    [int]$Swipes = 20
)

$ErrorActionPreference = 'Stop'
# $PSScriptRoot is empty in param defaults on Windows PowerShell 5.1
if (-not $OutDir) { $OutDir = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'results' }
$adbArgs = @(); if ($Serial) { $adbArgs = @('-s', $Serial) }
$out = Join-Path $OutDir $Label
$raw = Join-Path $out 'raw'
New-Item -ItemType Directory -Force $raw | Out-Null

# resolve the executable first: a function named Adb would otherwise call itself
$adbExe = (Get-Command $Adb -CommandType Application | Select-Object -First 1).Source
function Adb { & $adbExe @adbArgs @args }
function Sh([string]$cmd) { (Adb shell $cmd) -join "`n" }
function Save([string]$name, [string]$text) { Set-Content -Path (Join-Path $raw $name) -Value $text -Encoding utf8 }
function Log([string]$msg) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) }
function Median([double[]]$xs) {
    $s = $xs | Sort-Object
    if ($s.Count -eq 0) { return $null }
    if ($s.Count % 2) { return $s[[int][math]::Floor($s.Count / 2)] }
    return ($s[$s.Count / 2 - 1] + $s[$s.Count / 2]) / 2
}
function FirstAndMedian([double[]]$times) {
    # run 1 = first open after reboot (cold caches); runs 2..N = repeated cold starts
    $rest = @(); if ($times.Count -gt 1) { $rest = $times[1..($times.Count - 1)] }
    $first = $null; if ($times.Count) { $first = $times[0] }
    return [ordered]@{ first_ms = $first; median_ms = (Median $rest); runs = $times }
}
function Unlock {
    # Without a PIN the keyguard can be dismissed. Wake and dismiss in ONE shell call:
    # the MIUI lockscreen dozes off again within ~1 s between separate adb calls.
    for ($try = 0; $try -lt 3; $try++) {
        if ((Sh 'input keyevent KEYCODE_WAKEUP; sleep 1; wm dismiss-keyguard; sleep 2; dumpsys window | grep isKeyguardShowing') -notmatch 'isKeyguardShowing=true') { break }
    }
    if ((Sh 'dumpsys window | grep isKeyguardShowing') -match 'isKeyguardShowing=true') {
        Log 'Could not unlock automatically - unlock the phone by hand (waiting up to 5 min)'
        [console]::Beep(880, 400)
        $sw = [Diagnostics.Stopwatch]::StartNew()
        while ((Sh 'dumpsys window | grep isKeyguardShowing') -match 'isKeyguardShowing=true') {
            if ($sw.Elapsed.TotalMinutes -gt 5) { throw 'Phone is still locked' }
            Start-Sleep 2
        }
        Start-Sleep 3
    }
    Sh 'input keyevent HOME' | Out-Null
    Start-Sleep 1
}
function LogcatTime([string]$line) {
    if ($line -match '^\d\d-\d\d (\d\d:\d\d:\d\d\.\d{3})') { return [TimeSpan]::Parse($Matches[1]) }
    return $null
}
function LauncherActivity([string]$pkg) {
    ((Sh "cmd package resolve-activity --brief -c android.intent.category.LAUNCHER $pkg") -split "`n")[-1].Trim()
}

if ($Pin) {
    # With a PIN, user storage stays encrypted after reboot until the first unlock (Direct Boot),
    # so apps don't start and idle metrics look unrealistically good. Remove it for the run.
    # NOTE: Android deletes enrolled fingerprints / face unlock when the PIN is removed.
    Log 'Removing lock-screen PIN for the duration of the run'
    $o = Sh "locksettings clear --old $Pin"
    if ($o -notmatch 'cleared') { throw "Could not remove PIN: $o" }
}

try {
    $r = [ordered]@{ label = $Label; timestamp = (Get-Date -Format s) }

    # --- boot ---
    if ($Reboot) {
        Log 'Rebooting...'
        Adb reboot
        $sw = [Diagnostics.Stopwatch]::StartNew()
        Adb wait-for-device
        while ((Sh 'getprop sys.boot_completed').Trim() -ne '1') { Start-Sleep -Milliseconds 500 }
        $r.boot_seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
        Log "Boot completed in $($r.boot_seconds) s, idling $IdleSeconds s - don't touch the phone"
        Start-Sleep $IdleSeconds
    }

    # --- device ---
    $r.model = (Sh 'getprop ro.product.model').Trim()
    $r.device = (Sh 'getprop ro.product.device').Trim()
    $r.android = (Sh 'getprop ro.build.version.release').Trim()
    $r.rom = (Sh 'getprop ro.build.version.incremental').Trim()
    $batt = Sh 'dumpsys battery'
    if ($batt -match 'level: (\d+)') { $r.battery_level = [int]$Matches[1] }
    if ($batt -match 'temperature: (\d+)') { $r.battery_temp_c = [int]$Matches[1] / 10 }

    # --- packages ---
    $r.packages_total = ((Sh 'pm list packages') -split "`n" | Where-Object { $_ }).Count
    $r.packages_disabled = ((Sh 'pm list packages -d') -split "`n" | Where-Object { $_ }).Count
    Save 'packages.txt' (Sh 'pm list packages -f')

    # --- idle memory ---
    $mem = Sh 'cat /proc/meminfo'
    Save 'meminfo.txt' $mem
    foreach ($k in 'MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree') {
        if ($mem -match "$k\:\s+(\d+)") { $r["${k}_mb"] = [math]::Round([double]$Matches[1] / 1024) }
    }
    $r.swap_used_mb = $r.SwapTotal_mb - $r.SwapFree_mb
    Save 'dumpsys_meminfo.txt' (Sh 'dumpsys meminfo')

    # --- idle processes & CPU ---
    $r.processes = ((Sh 'ps -A') -split "`n").Count - 1
    $r.running_services = ([regex]::Matches((Sh 'dumpsys activity services'), '\* ServiceRecord')).Count
    $cpu = Sh 'dumpsys cpuinfo'
    Save 'cpuinfo.txt' $cpu
    if ($cpu -match 'Load: ([\d.]+) / ([\d.]+) / ([\d.]+)') { $r.load_1m = [double]$Matches[1]; $r.load_5m = [double]$Matches[2] }
    if ($cpu -match '([\d.]+)% TOTAL') { $r.cpu_total_pct = [double]$Matches[1] }

    # --- cold starts (am start -W: time to first drawn frame) ---
    Unlock
    $apps = @('com.android.settings', 'com.android.chrome', 'com.android.vending', 'com.google.android.dialer',
        'com.google.android.apps.messaging', 'com.google.android.youtube')
    $installed = Sh 'pm list packages'
    $cold = [ordered]@{}
    foreach ($pkg in $apps) {
        if ($installed -notmatch "package:$([regex]::Escape($pkg))(\n|$)") { continue }
        $comp = LauncherActivity $pkg
        if ($comp -notmatch '/') { continue }
        $times = @()
        for ($i = 0; $i -lt $Runs; $i++) {
            # single quotes: activity names like Shell$HomeActivity must not be expanded by the device shell
            $o = Sh "am start -W -S -n '$comp'"
            if ($o -match 'TotalTime: (\d+)') { $times += [double]$Matches[1] }
            Start-Sleep 2
            Sh 'input keyevent HOME' | Out-Null
            Start-Sleep 2
        }
        $cold[$pkg] = FirstAndMedian $times
        Log ("cold start {0}: first {1} ms, median {2} ms" -f $pkg, $cold[$pkg].first_ms, $cold[$pkg].median_ms)
    }
    $r.cold_start = $cold

    # --- camera: launch -> first viewfinder frame (MIUI camera logs startPreview2firstFrame) ---
    # The window appears long before the viewfinder, so am start -W under-reports the camera.
    if ($installed -match "package:com\.android\.camera(\n|$)") {
        $camTimes = @()
        for ($i = 0; $i -lt $Runs; $i++) {
            Sh 'am force-stop com.android.camera' | Out-Null
            Start-Sleep 2
            Adb logcat -c
            Sh 'am start -n com.android.camera/.Camera' | Out-Null
            Start-Sleep 10
            $t0 = $null; $t1 = $null
            foreach ($l in ((Adb logcat -v threadtime -d) -split "`n")) {
                if (-not $t0 -and $l -match 'START u0 .*cmp=com\.android\.camera/') { $t0 = LogcatTime $l }
                if ($t0 -and -not $t1 -and $l -match 'startPreview2firstFrame') { $t1 = LogcatTime $l }
            }
            if ($t0 -and $t1) { $camTimes += [math]::Round(($t1 - $t0).TotalMilliseconds) }
            Sh 'input keyevent HOME' | Out-Null
            Start-Sleep 2
        }
        Sh 'am force-stop com.android.camera' | Out-Null
        $r.camera_viewfinder = FirstAndMedian $camTimes
        Log ("camera viewfinder: first {0} ms, median {1} ms" -f $r.camera_viewfinder.first_ms, $r.camera_viewfinder.median_ms)
    }

    # --- jank: scripted swipes, then dumpsys gfxinfo ---
    $m = [regex]::Matches((Sh 'wm size'), '(\d+)x(\d+)')
    $w = [int]$m[$m.Count - 1].Groups[1].Value; $h = [int]$m[$m.Count - 1].Groups[2].Value
    function JankTest([string]$pkg, [string]$launch, [string]$dir) {
        if ($launch) { Sh "am start -W -S -n '$launch'" | Out-Null } else { Sh 'input keyevent HOME' | Out-Null }
        Start-Sleep 3
        Sh "dumpsys gfxinfo $pkg reset" | Out-Null
        for ($i = 0; $i -lt $Swipes; $i++) {
            if ($dir -eq 'v') {
                $a, $b = if ($i % 2) { 0.3, 0.75 } else { 0.75, 0.3 }
                Sh "input swipe $($w/2) $([int]($h*$a)) $($w/2) $([int]($h*$b)) 150" | Out-Null
            } else {
                $a, $b = if ($i % 2) { 0.15, 0.85 } else { 0.85, 0.15 }
                Sh "input swipe $([int]($w*$a)) $($h/2) $([int]($w*$b)) $($h/2) 150" | Out-Null
            }
            Start-Sleep -Milliseconds 400
        }
        $g = Sh "dumpsys gfxinfo $pkg"
        Save "gfxinfo_$pkg.txt" $g
        $res = [ordered]@{}
        if ($g -match 'Total frames rendered: (\d+)') { $res.frames = [int]$Matches[1] }
        if ($g -match 'Janky frames: (\d+) \(([\d.]+)%\)') { $res.janky = [int]$Matches[1]; $res.janky_pct = [double]$Matches[2] }
        foreach ($p in '50', '90', '95', '99') { if ($g -match "$($p)th percentile: (\d+)ms") { $res["p$p`_ms"] = [int]$Matches[1] } }
        Sh 'input keyevent HOME' | Out-Null
        return $res
    }
    $homeComp = ((Sh 'cmd package resolve-activity --brief -c android.intent.category.HOME -a android.intent.action.MAIN') -split "`n")[-1].Trim()
    $r.jank = [ordered]@{
        settings_scroll = (JankTest 'com.android.settings' (LauncherActivity 'com.android.settings') 'v')
        launcher_swipe  = (JankTest ($homeComp -split '/')[0] '' 'h')
    }
    Log ("jank: settings {0}% / launcher {1}%" -f $r.jank.settings_scroll.janky_pct, $r.jank.launcher_swipe.janky_pct)

    $r | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $out 'summary.json') -Encoding utf8
    Log "Saved $out\summary.json"
}
finally {
    if ($Pin) {
        Log 'Restoring lock-screen PIN'
        Sh "locksettings set-pin $Pin" | Out-Null
        if ((Sh "locksettings verify --old $Pin") -notmatch 'verified') { Write-Warning 'PIN was NOT restored - set it again in Settings' }
    }
}
