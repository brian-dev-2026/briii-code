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
} finally {
	Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) { "$failed failed"; exit 1 }
'all passed'
