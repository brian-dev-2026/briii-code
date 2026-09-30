# Tests for install-on-exit.ps1. Run: powershell -NoProfile -File brand/extensions/briii-update/test/helper.test.ps1
$ErrorActionPreference = 'Stop'
$failed = 0
function Check($name, [scriptblock]$test) {
	try { if (& $test) { "ok   $name" } else { $script:failed++; "FAIL $name" } }
	catch { $script:failed++; "FAIL $name - $($_.Exception.Message)" }
}

. (Join-Path $PSScriptRoot '..\install-on-exit.ps1') -DotSourceOnly

$dir = Join-Path $env:TEMP "briii-helper-test-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
New-Item -ItemType Directory $dir | Out-Null
try {
	$lock = Enter-HelperLock -StateDir $dir
	Check 'the first helper gets the lock' { $null -ne $lock }
	Check 'a second helper does not while the first holds it' { $null -eq (Enter-HelperLock -StateDir $dir) }
	$lock.Dispose()
	Check 'a lock file left by a helper that ended is taken over' { $l = Enter-HelperLock -StateDir $dir; $ok = $null -ne $l; if ($l) { $l.Dispose() }; $ok }
	Check 'no install is attempted while Windows is not shutting down' { (Test-SessionEnding) -eq $false }

	Set-Content (Join-Path $dir 'state.json') '{"pending":{"id":"1.0.0-20260101.1","path":"x","sha256":"y"},"failures":1,"lastCheck":5}'
	Complete-Install -StateDir $dir -Id '1.0.0-20260101.1' -ExitCode 0
	$s = Get-Content (Join-Path $dir 'state.json') -Raw | ConvertFrom-Json
	Check 'a successful install clears pending and failures' { ($null -eq $s.pending) -and $s.failures -eq 0 -and $s.lastCheck -eq 5 }

	Set-Content (Join-Path $dir 'state.json') '{"pending":{"id":"1.0.0-20260101.1","path":"x","sha256":"y"},"failures":1,"lastCheck":5}'
	Complete-Install -StateDir $dir -Id '1.0.0-20260101.1' -ExitCode 2
	$s = Get-Content (Join-Path $dir 'state.json') -Raw | ConvertFrom-Json
	Check 'a failed install keeps pending and counts the failure' { $s.pending.id -eq '1.0.0-20260101.1' -and $s.failures -eq 2 }
	Check 'the state file has no BOM' { [IO.File]::ReadAllBytes((Join-Path $dir 'state.json'))[0] -eq [byte][char]'{' }
	Check 'every result is logged' { @(Get-Content (Join-Path $dir 'install.log')).Count -eq 2 -and (Get-Content (Join-Path $dir 'install.log'))[1] -match 'exit=2$' }

	Remove-Item (Join-Path $dir 'state.json')
	Complete-Install -StateDir $dir -Id '1.0.0-20260101.1' -ExitCode 2
	$s = Get-Content (Join-Path $dir 'state.json') -Raw | ConvertFrom-Json
	Check 'a missing state file is recreated with the failure counted' { ($null -eq $s.pending) -and $s.failures -eq 1 }

	$app = 'C:\Users\me\AppData\Local\Programs\Briii Code'
	Check 'the app counts as running when an exe from its folder runs' { Test-AppRunning -AppDir $app -Processes @([pscustomobject]@{ Path = "$app\Briii Code.exe" }) }
	Check 'the same app installed elsewhere does not count' { -not (Test-AppRunning -AppDir $app -Processes @([pscustomobject]@{ Path = 'D:\Other\Briii Code\Briii Code.exe' })) }
	Check 'an instance whose path is hidden (elevated) counts as running' { Test-AppRunning -AppDir $app -Processes @([pscustomobject]@{ Path = $null }) }

	# Install Now whose quit was cancelled: the -Relaunch helper gives up instead of waiting 30 minutes.
	$ps = (Get-Process -Id $PID).Path
	$sw = [Diagnostics.Stopwatch]::StartNew()
	& powershell -NoProfile -File (Join-Path $PSScriptRoot '..\install-on-exit.ps1') -Installer (Join-Path $dir 'none.exe') -AppDir (Split-Path $ps) -ExeName ([IO.Path]::GetFileNameWithoutExtension($ps)) -StateDir $dir -Id '1.0.0-20260101.1' -Relaunch -WaitSeconds 3
	$sw.Stop()
	Check 'a helper whose app stays open gives up after its wait' { $sw.Elapsed.TotalSeconds -lt 30 -and (Get-Content (Join-Path $dir 'install.log') -Raw) -match 'skipped: Briii Code still running' }
	Check 'giving up is not counted as a failed install' { (Get-Content (Join-Path $dir 'state.json') -Raw | ConvertFrom-Json).failures -eq 1 }} finally {
	Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) { "$failed failed"; exit 1 }
'all passed'
