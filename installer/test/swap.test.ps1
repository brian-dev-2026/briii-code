# Tests for installer/staged-update.iss (the staged update swap). Needs Inno Setup 6.
# Run: powershell -NoProfile -File installer/test/swap.test.ps1
$ErrorActionPreference = 'Stop'
$failed = 0
function Check($name, [scriptblock]$test) {
	try { if (& $test) { "ok   $name" } else { $script:failed++; "FAIL $name" } }
	catch { $script:failed++; "FAIL $name - $($_.Exception.Message)" }
}

$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 not found' }
$root = Join-Path $env:TEMP "briii-swap-test-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
New-Item -ItemType Directory $root | Out-Null
$exe = Join-Path $root 'swap-test.exe'
& $iscc /Q "/O$root" (Join-Path $PSScriptRoot 'swap-test.iss') | Out-Null
if ($LASTEXITCODE) { throw "ISCC exit $LASTEXITCODE" }

# An installed app (old) with a staged update (new) in <app>\_.
function New-App([string]$name) {
	$app = Join-Path $root $name
	foreach ($v in @(@{ dir = $app; text = 'old' }, @{ dir = "$app\_"; text = 'new' })) {
		New-Item -ItemType Directory -Force "$($v.dir)\resources" | Out-Null
		[IO.File]::WriteAllText("$($v.dir)\resources\a.txt", $v.text)
		[IO.File]::WriteAllText("$($v.dir)\app.dll", $v.text)
	}
	return $app
}
function Invoke-Swap([string]$app, [int]$killAfter = 30, [int]$giveUp = 60) {
	$result = Join-Path $root "$([IO.Path]::GetFileName($app)).result"
	Start-Process $exe -Wait -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', "/app=`"$app`"", '/items="resources|app.dll"', "/killafter=$killAfter", "/giveup=$giveUp", "/result=`"$result`"" | Out-Null
	return (Get-Content $result -Raw -ErrorAction SilentlyContinue)
}
$readNew = { param($app) (Get-Content "$app\resources\a.txt" -Raw) -eq 'new' -and (Get-Content "$app\app.dll" -Raw) -eq 'new' }

try {
	$app = New-App 'plain'
	$r = Invoke-Swap $app
	Check 'with nothing in the way, the update is swapped in' { $r -eq 'ok' -and (& $readNew $app) -and -not (Test-Path "$app\_") }

	# Something outside the app keeps a file open for 6 s (a terminal or server shutting down).
	$app = New-App 'busy'
	$holder = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', "`$f = [IO.File]::Open('$app\resources\a.txt', 'Open', 'Read', 'None'); Start-Sleep 6; `$f.Close()"
	Start-Sleep 2
	$r = Invoke-Swap $app
	$holder.WaitForExit()
	Check 'a file in use for a few seconds delays the swap, then it succeeds' { $r -eq 'ok' -and (& $readNew $app) }

	# A program left running from the app folder (an orphaned ruff.exe or OpenConsole.exe).
	$app = New-App 'leftover'
	Copy-Item "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" "$app\resources\leftover.exe"
	$left = Start-Process "$app\resources\leftover.exe" -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', "`$f = [IO.File]::Open('$app\resources\a.txt', 'Open', 'Read', 'None'); Start-Sleep 600"
	Start-Sleep 2
	$r = Invoke-Swap $app -killAfter 4 -giveUp 40
	Check 'a program left running from the app folder is closed, then the swap succeeds' { $r -eq 'ok' -and (& $readNew $app) -and $left.HasExited }
	if (-not $left.HasExited) { $left.Kill() }

	# Something outside the app never lets go: give up, and leave the old version whole.
	$app = New-App 'stuck'
	$stuck = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', "`$f = [IO.File]::Open('$app\resources\a.txt', 'Open', 'Read', 'None'); Start-Sleep 600"
	Start-Sleep 2
	$r = Invoke-Swap $app -killAfter 2 -giveUp 8
	$stuck.Kill()
	$stuck.WaitForExit()
	Check 'a file that stays in use makes it give up, with the old version intact' { $r -eq 'failed' -and (Get-Content "$app\resources\a.txt" -Raw) -eq 'old' -and (Get-Content "$app\app.dll" -Raw) -eq 'old' }
} finally {
	Get-Process leftover -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
	Start-Sleep 1
	Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) { "$failed failed"; exit 1 }
'all passed'
