// Starts install-on-exit.ps1 so that it outlives Briii Code.
//
// On Windows the extension host runs inside a job object that kills its child processes when it
// exits, even ones spawned with `detached: true`. A process created through WMI
// (Win32_Process.Create) belongs to the WMI service instead, so it survives, and it also starts
// with a clean user environment (no ELECTRON_RUN_AS_NODE / VSCODE_* from the extension host).
'use strict';

const cp = require('child_process');

const quote = value => {
	if (String(value).includes('"')) {
		throw new Error(`cannot quote ${value}`);
	}
	return `"${value}"`;
};

/** The helper's command line. Every value is quoted; Windows paths never contain a double quote. */
function helperCommandLine({ script, installer, appDir, stateDir, id, exeName, relaunch }) {
	const parts = ['powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass',
		`-File ${quote(script)}`, `-Installer ${quote(installer)}`, `-AppDir ${quote(appDir)}`,
		`-StateDir ${quote(stateDir)}`, `-Id ${quote(id)}`];
	if (exeName) {
		parts.push(`-ExeName ${quote(exeName)}`);
	}
	if (relaunch) {
		parts.push('-Relaunch');
	}
	return parts.join(' ');
}

/**
 * Creates the process through WMI with a hidden window. Synchronous (about a second), because it
 * runs from deactivate(), where the extension host may exit as soon as the call returns.
 * @returns {boolean} true when WMI reports success
 */
function startDetached(commandLine) {
	const create = '$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }; ' +
		'$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:BRIII_HELPER_CMD; ProcessStartupInformation = $si }; ' +
		'exit $r.ReturnValue';
	const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', create], {
		env: { ...process.env, BRIII_HELPER_CMD: commandLine },
		windowsHide: true,
		timeout: 15000,
	});
	return r.status === 0;
}

module.exports = { helperCommandLine, startDetached };
