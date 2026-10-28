# Methodology log

Every change to the method, in order, including the mistakes. A benchmark is only as good as the list of things that went wrong while building it.

| # | What happened | Cause | Decision |
|---|---|---|---|
| 1 | First baseline: camera cold start 266 ms (median), first run 14.8 s. Subjectively the camera was the slowest app | Camera had no permissions. Every launch opened the system `GrantPermissionsActivity` on top, and `am start -W` timed the dialog. Runs 2–5 were the dialog only | Granted permissions and went through first-run onboarding in every tested app before measuring |
| 2 | Even with permissions, `am start -W` says 1.6 s for the camera while the viewfinder shows up later | `TotalTime` ends at the first drawn frame of the window, not when the app is usable | New camera metric: from `ActivityTaskManager: START u0 … com.android.camera` to `CAM_PerformanceManager … startPreview2firstFrame` in logcat |
| 3 | A trial camera run (1.96 s to viewfinder) came after the camera had already been opened | Warm caches. Not comparable | Discarded. Every app now reports two numbers: **first open after reboot** and **median of repeated launches** |
| 4 | YouTube: no `TotalTime` | Component `…/.app.honeycomb.Shell$HomeActivity`; the device shell expanded `$HomeActivity` to an empty string, so a non-existent activity was started | Component name in single quotes |
| 5 | Two baseline runs crashed at "phone is still locked" | Wake-up and PIN entry were sent as separate `adb shell` calls; after 5 min idle the lock screen dozed off in between. The fix had only been tested from a 20-second sleep | Wake, swipe and PIN in one shell call; fall back to waiting for a manual unlock instead of failing |
| 6 | A third run failed the same way after reboot | Right after boot the phone is so busy (load ~12) that the PIN pad isn't ready in time | Removed the PIN for the duration of the experiment (`locksettings clear`) and dismiss the keyguard instead. In the published script, `-Pin` removes and restores it automatically |
| 7 | Baseline with PIN vs without PIN: idle swap 31 vs 894 MB, processes 661 vs 808, services 26 vs 71, idle CPU 5% vs 21%. With PIN, Settings got slower on every launch (3.2 → 7.9 s) | **Direct Boot**: with a PIN, user storage stays encrypted after reboot until the first unlock, so apps can't start. The "idle" phase measured a half-asleep phone, and the launches ran into the storm of apps waking up right after unlock | The PIN run is excluded from comparisons (kept as `results/stock-with-pin.json`). Stock = two runs without PIN |
| 8 | Reproducibility, stock run 1 vs run 2 | | Medians ±3% (±5% for camera and jank), idle ±7%, first-open-after-boot up to ±16%. Changes below that are treated as noise |
| 9 | Context correction: the phone is a year old, not new | "Laggy out of the box" meant "laggy since purchase" | Forecast unchanged (it was written before). Idea for later: measure after a few days of normal use without reboot |
| 10 | Compile status before optimizing (`dumpsys package dexopt`) | Settings, MIUI camera, YouTube: `status=verify` (not compiled). Launcher: `reason=boot-after-mainline-update` | Expected the dexopt step to help these three only |
| 11 | Step A: `cmd package bg-dexopt-job` (508 s). Settings and YouTube → `speed-profile`; camera stayed `verify` (no usage profile yet), so it was force-compiled with `-m speed` | | |
| 12 | After dexopt: YouTube −53%, Settings −11%, **camera +15% slower** | Full `speed` compile produces much bigger code; on 3 GB RAM and slow eMMC, loading it costs more than it saves. This is why Android compiles only hot code from profiles by default | Camera rolled back with `cmd package compile --reset` |
| 13 | Step C (animations 0.5x) dropped | Animations were already at 0.5x before the first baseline | Not part of the comparison |
| 14 | Step B: 35 packages removed with `pm uninstall -k --user 0`, all `Success`. Smoke test: launcher, Phone, SMS, keyboard, camera OK. Rollback tested on one package | | |
| 15 | The after-debloat run was restarted | The phone was touched during the idle phase | Stopped and re-ran from reboot |
