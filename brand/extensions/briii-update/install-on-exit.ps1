# Installs a downloaded Briii Code update once the app has closed. Started detached and hidden by
# the briii-update extension when Briii Code shuts down (or by "Install Update Now" with -Relaunch).
param(
	[string]$Installer,
	[string]$AppDir,
	[string]$StateDir,
	[string]$Id,
	[string]$ExeName = 'Briii Code',
	[switch]$Relaunch,
	[int]$WaitSeconds = 0,   # 0: 30 minutes, or 60 s with -Relaunch (Install Now whose quit was cancelled)
	[switch]$DotSourceOnly
)

# Several windows closing each start a helper; only one proceeds. The lock is an open, unshared
# handle: taking it is atomic, and it is released when the helper ends, however it ends.
# Returns the handle (keep it until done) or $null when another helper holds it.
function Enter-HelperLock([string]$StateDir) {
	try {
		return [IO.File]::Open((Join-Path $StateDir 'helper.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
	} catch {
		return $null
	}
}

# True while Windows is shutting down or signing out: an installer killed halfway would leave
# Briii Code unable to start, so the update waits for the next close.
function Test-SessionEnding {
	if (-not ('BriiiUpdate.Native' -as [type])) {
		Add-Type -Namespace BriiiUpdate -Name Native -MemberDefinition '[DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);'
	}
	return [BriiiUpdate.Native]::GetSystemMetrics(0x2000) -ne 0   # SM_SHUTTINGDOWN
}

function Write-HelperLog([string]$StateDir, [string]$Line) {
	Add-Content (Join-Path $StateDir 'install.log') "$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')) $Line"
}

# True when a process from the app folder runs. A process whose path can't be read (an elevated
# instance, seen from a normal user) counts too: waiting is safer than installing under it.
function Test-AppRunning([string]$AppDir, [object[]]$Processes) {
	$prefix = $AppDir.TrimEnd('\') + '\'
	return @($Processes | Where-Object { -not $_.Path -or $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
}

# Logs the result and updates state.json (no BOM, the extension reads it with JSON.parse).
function Complete-Install([string]$StateDir, [string]$Id, [int]$ExitCode) {
	Write-HelperLog $StateDir "$Id exit=$ExitCode"
	$file = Join-Path $StateDir 'state.json'
	$state = if (Test-Path $file) { Get-Content $file -Raw | ConvertFrom-Json } else { [pscustomobject]@{ pending = $null; failures = 0; lastCheck = 0 } }
	if ($ExitCode -eq 0) {
		$state.pending = $null
		$state.failures = 0
	} else {
		$state.failures = [int]$state.failures + 1
	}
	[IO.File]::WriteAllText($file, ($state | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
}

if ($DotSourceOnly) { return }

$lock = Enter-HelperLock $StateDir
if (-not $lock) { exit 0 }
try {
	# Inherited from the extension host: they would make Briii Code start as plain Node.
	foreach ($n in @(Get-ChildItem env: | Where-Object { $_.Name -eq 'ELECTRON_RUN_AS_NODE' -or $_.Name -like 'VSCODE_*' } | ForEach-Object Name)) {
		[Environment]::SetEnvironmentVariable($n, $null, 'Process')
	}
	if (-not $WaitSeconds) { $WaitSeconds = if ($Relaunch) { 60 } else { 1800 } }
	$deadline = (Get-Date).AddSeconds($WaitSeconds)
	$isRunning = { Test-AppRunning -AppDir $AppDir -Processes @(Get-Process -Name $ExeName -ErrorAction SilentlyContinue) }
	# Wait until the app has been closed for 3 s in a row, so a quick reopen isn't caught mid-install.
	$quiet = 0
	while ($quiet -lt 3 -and (Get-Date) -lt $deadline) {
		if (& $isRunning) { $quiet = 0 } else { $quiet++ }
		Start-Sleep -Seconds 1
	}
	if (& $isRunning) {
		Write-HelperLog $StateDir "$Id skipped: Briii Code still running after $WaitSeconds s"
		exit 1
	}
	if (Test-SessionEnding) {
		Write-HelperLog $StateDir "$Id skipped: Windows is shutting down"
		exit 0
	}

	$code = -1
	try {
		$p = Start-Process $Installer -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-' -Wait -PassThru
		$code = $p.ExitCode
	} catch {
		Write-HelperLog $StateDir "$Id could not start the installer: $($_.Exception.Message)"
	}
	Complete-Install $StateDir $Id $code
	if ($code -eq 0) { Remove-Item $Installer -Force -ErrorAction SilentlyContinue }
	if ($Relaunch) { Start-Process (Join-Path $AppDir "$ExeName.exe") }
} finally {
	$lock.Dispose()
}
