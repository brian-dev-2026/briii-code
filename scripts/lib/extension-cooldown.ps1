# Extension cooldown (used by build.ps1): bundle the newest version of each extension that has
# been on Open VSX for a while and isn't a pre-release, so a bad or malicious release has time
# to be noticed and pulled before it ships in an installer.

function ConvertTo-UtcDate($Value) {
	if ($Value -is [datetime]) { return $Value.ToUniversalTime() }
	return [datetime]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture,
		[Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
}

# True when $Meta (an Open VSX version's metadata) is a release published at or before $Cutoff.
function Test-SettledVersion($Meta, [datetime]$Cutoff) {
	if (-not $Meta -or $Meta.preRelease) { return $false }
	return (ConvertTo-UtcDate $Meta.timestamp) -le $Cutoff.ToUniversalTime()
}

# The first settled entry of $Metas (newest first; $null entries are skipped), or $null.
function Select-SettledVersion($Metas, [datetime]$Cutoff) {
	foreach ($m in $Metas) { if (Test-SettledVersion $m $Cutoff) { return $m } }
	return $null
}

# Version names from an Open VSX /versions response, in its order (newest first), without $Exclude.
function Get-VersionCandidates($VersionsResponse, [string]$Exclude) {
	@($VersionsResponse.versions.PSObject.Properties | ForEach-Object Name | Where-Object { $_ -ne $Exclude })
}
