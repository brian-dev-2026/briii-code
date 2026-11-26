# Tests for scripts/lib (extension cooldown, VSCodium lag). Run: powershell -NoProfile -File scripts/test/release-checks.test.ps1
$ErrorActionPreference = 'Stop'
$failed = 0
function Check($name, [scriptblock]$test) {
	try { if (& $test) { "ok   $name" } else { $script:failed++; "FAIL $name" } }
	catch { $script:failed++; "FAIL $name - $($_.Exception.Message)" }
}

. (Join-Path $PSScriptRoot '..\lib\extension-cooldown.ps1')
. (Join-Path $PSScriptRoot '..\lib\vscodium-lag.ps1')

$now = [datetime]::Parse('2026-11-26T12:00:00Z').ToUniversalTime()
$cutoff = $now.AddDays(-7)
function Meta($version, $days, $pre = $false) {
	[pscustomobject]@{ version = $version; preRelease = $pre; timestamp = $now.AddDays(-$days).ToString('o') }
}

# --- extension cooldown ---
Check 'a release older than the cooldown is settled' { Test-SettledVersion (Meta '1.0.0' 8) $cutoff }
Check 'a release newer than the cooldown is not' { -not (Test-SettledVersion (Meta '1.0.0' 2) $cutoff) }
Check 'a pre-release is never settled' { -not (Test-SettledVersion (Meta '1.0.0' 30 $true) $cutoff) }
Check 'Open VSX timestamps (with microseconds) parse' {
	Test-SettledVersion ([pscustomobject]@{ version = '1'; preRelease = $false; timestamp = '2026-11-01T16:21:39.652958Z' }) $cutoff
}
Check 'a timestamp ConvertFrom-Json already made a date works too' {
	Test-SettledVersion ([pscustomobject]@{ version = '1'; preRelease = $false; timestamp = $now.AddDays(-9) }) $cutoff
}
Check 'the newest settled version is picked, in list order' {
	(Select-SettledVersion @((Meta '3.0.0' 1), (Meta '2.1.0' 20 $true), (Meta '2.0.0' 10), (Meta '1.0.0' 40)) $cutoff).version -eq '2.0.0'
}
Check 'missing metadata (a version without this platform) is skipped' {
	(Select-SettledVersion @($null, (Meta '1.0.0' 40)) $cutoff).version -eq '1.0.0'
}
Check 'nothing settled gives null' { $null -eq (Select-SettledVersion @((Meta '2.0.0' 1), (Meta '1.0.0' 3 $true)) $cutoff) }
Check 'candidates come from the versions list in order, without the one already checked' {
	$list = '{"versions":{"3.0.0":"u","2.0.0":"u","1.0.0":"u"}}' | ConvertFrom-Json
	(Get-VersionCandidates $list '3.0.0') -join ',' -eq '2.0.0,1.0.0'
}

# --- VSCodium lag ---
$args1 = @{ VSCodiumVersion = '1.143.17232'; VSCodiumPublished = $now.AddDays(-29).ToString('o'); VSCodeVersion = '1.148.0'; Now = $now }
Check 'VSCodium 29 days old with a newer VS Code is behind' { (Get-VSCodiumLag @args1) -match '1\.143.*29 days.*1\.148' }
Check 'not behind while VSCodium is younger than the limit' { $null -eq (Get-VSCodiumLag @args1 -MaxDays 30) }
$args2 = $args1.Clone(); $args2.VSCodeVersion = '1.143.2'
Check 'not behind when VS Code has no newer minor version' { $null -eq (Get-VSCodiumLag @args2) }
$args3 = $args1.Clone(); $args3.VSCodeVersion = '1.1000.0'
Check 'minor versions compare as numbers' { $null -ne (Get-VSCodiumLag @args3) }

if ($failed) { "$failed failed"; exit 1 } else { 'all passed' }
