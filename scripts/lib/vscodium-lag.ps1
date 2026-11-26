# VSCodium lag check (used by ci-release-plan.ps1). Briii is built from VSCodium's releases, so
# VS Code's fixes, security fixes included, only arrive once VSCodium ships them.

# A message when VSCodium's latest release is more than $MaxDays old and VS Code has a newer
# minor version; $null otherwise.
function Get-VSCodiumLag([string]$VSCodiumVersion, $VSCodiumPublished, [string]$VSCodeVersion,
		[datetime]$Now = (Get-Date), [int]$MaxDays = 21) {
	$minor = { param($v) $p = $v -split '\.'; [int]$p[0] * 100000 + [int]$p[1] }
	if ((& $minor $VSCodeVersion) -le (& $minor $VSCodiumVersion)) { return $null }
	$published = if ($VSCodiumPublished -is [datetime]) { $VSCodiumPublished.ToUniversalTime() } else {
		[datetime]::Parse($VSCodiumPublished, [Globalization.CultureInfo]::InvariantCulture,
			[Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
	}
	$days = [int][math]::Floor(($Now.ToUniversalTime() - $published).TotalDays)
	if ($days -le $MaxDays) { return $null }
	"VSCodium's latest release ($VSCodiumVersion) is $days days old and VS Code is at $VSCodeVersion, so Briii Code is missing VS Code's newer fixes, security fixes included. Briii builds pick up the next VSCodium release automatically."
}
