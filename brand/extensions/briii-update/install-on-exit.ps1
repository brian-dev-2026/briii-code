# Installs a downloaded Briii Code update once the app has closed. Started detached and hidden by
# the briii-update extension when Briii Code shuts down (or by "Install Update Now" with -Relaunch).
param(
	[string]$Installer,
	[string]$AppDir,
	[string]$StateDir,
	[string]$Id,
	[switch]$Relaunch,
	[switch]$DotSourceOnly
)

# Several windows closing each start a helper; only the first one proceeds.
function Enter-HelperLock([string]$StateDir) {
	$lock = Join-Path $StateDir 'helper.lock'
	if ((Test-Path $lock) -and (Get-Item $lock).LastWriteTime -gt (Get-Date).AddMinutes(-35)) { return $false }
	[IO.File]::WriteAllText($lock, "$PID")
	return $true
}

# Logs the result and updates state.json (no BOM, the extension reads it with JSON.parse).
function Complete-Install([string]$StateDir, [string]$Id, [int]$ExitCode) {
	Add-Content (Join-Path $StateDir 'install.log') "$((Get-Date).ToString('s')) $Id exit=$ExitCode"
	$file = Join-Path $StateDir 'state.json'
	$state = Get-Content $file -Raw | ConvertFrom-Json
	if ($ExitCode -eq 0) {
		$state.pending = $null
		$state.failures = 0
	} else {
		$state.failures = [int]$state.failures + 1
	}
	[IO.File]::WriteAllText($file, ($state | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
}

if ($DotSourceOnly) { return }

if (-not (Enter-HelperLock $StateDir)) { exit 0 }
try {
	# Inherited from the extension host: they would make Briii Code start as plain Node.
	foreach ($n in @(Get-ChildItem env: | Where-Object { $_.Name -eq 'ELECTRON_RUN_AS_NODE' -or $_.Name -like 'VSCODE_*' } | ForEach-Object Name)) {
		[Environment]::SetEnvironmentVariable($n, $null, 'Process')
	}
	$deadline = (Get-Date).AddMinutes(30)
	$prefix = $AppDir.TrimEnd('\') + '\'
	do {
		$running = @(Get-Process -Name 'Briii Code' -ErrorAction SilentlyContinue |
			Where-Object { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
		if (-not $running) { break }
		Start-Sleep -Seconds 2
	} while ((Get-Date) -lt $deadline)
	if ($running) {
		Add-Content (Join-Path $StateDir 'install.log') "$((Get-Date).ToString('s')) $Id skipped: Briii Code still running after 30 minutes"
		exit 1
	}

	$code = -1
	try {
		$p = Start-Process $Installer -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-' -Wait -PassThru
		$code = $p.ExitCode
	} catch {
		Add-Content (Join-Path $StateDir 'install.log') "$((Get-Date).ToString('s')) $Id could not start the installer: $($_.Exception.Message)"
	}
	Complete-Install $StateDir $Id $code
	if ($code -eq 0) { Remove-Item $Installer -Force -ErrorAction SilentlyContinue }
	if ($Relaunch) { Start-Process (Join-Path $AppDir 'Briii Code.exe') }
} finally {
	Remove-Item (Join-Path $StateDir 'helper.lock') -Force -ErrorAction SilentlyContinue
}
