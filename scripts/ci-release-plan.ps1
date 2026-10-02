<#
.SYNOPSIS
  Decides whether the release workflow should build, and with which VSCodium version and release id.
  Build when: pushed or run by hand; VSCodium has a release the last Briii release isn't built from;
  the last Briii release is 7+ days old (fresh bundled extensions); or there is no release yet.

.EXAMPLE
  .\scripts\ci-release-plan.ps1 -Trigger schedule -RunNumber 1
#>
[CmdletBinding()]
param(
	[Parameter(Mandatory)] [string]$Trigger,   # the GitHub event name
	[Parameter(Mandatory)] [int]$RunNumber,
	[string]$Repo = 'brian-dev-2026/briii-code',
	[int]$MaxAgeDays = 7
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ 'User-Agent' = 'briii-release-plan'; Accept = 'application/vnd.github+json' }
if ($env:GH_TOKEN) { $headers.Authorization = "Bearer $env:GH_TOKEN" }   # avoids the anonymous rate limit

$vscodium = (Invoke-RestMethod 'https://api.github.com/repos/VSCodium/vscodium/releases/latest' -Headers $headers).tag_name

$last = $null
try {
	$last = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers
} catch {
	if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) { $last = $null } else { throw }
}

$reason = $null
if ($Trigger -in 'push', 'workflow_dispatch') { $reason = "event $Trigger" }
elseif (-not $last) { $reason = 'no release yet' }
else {
	$lastVscodium = ($last.tag_name -replace '^v', '') -replace '-.*$', ''
	$ageDays = ((Get-Date).ToUniversalTime() - ([datetime]$last.published_at).ToUniversalTime()).TotalDays
	if ($lastVscodium -ne $vscodium) { $reason = "VSCodium $vscodium is new (last release built from $lastVscodium)" }
	elseif ($ageDays -ge $MaxAgeDays) { $reason = "last release is $([int]$ageDays) days old" }
}

# The run number is padded (.0013): GitHub lists releases by tag text, where .9 sorts after .12.
# The updater reads it as a number, so ids from before the padding still compare correctly.
$release = "$vscodium-$((Get-Date).ToUniversalTime().ToString('yyyyMMdd')).$($RunNumber.ToString('D4'))"
# A re-run of a workflow keeps its run number: if that release was already published, don't
# build it again (gh release create would fail on the existing tag).
try {
	Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/tags/v$release" -Headers $headers | Out-Null
	$reason = $null
	$last = [pscustomobject]@{ tag_name = "v$release" }
} catch {
	if (-not ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404)) { throw }
}
$build = [bool]$reason
if ($build) { Write-Host "Build: yes ($reason)" } else { Write-Host "Build: no (last release $($last.tag_name) is current)" }
Write-Host "VSCodium $vscodium, release $release"

$out = "build=$($build.ToString().ToLower())", "vscodium=$vscodium", "release=$release"
$out | ForEach-Object { Write-Output $_ }
# No BOM: PowerShell 5.1's -Encoding UTF8 would add one and break the first key.
if ($env:GITHUB_OUTPUT) { [IO.File]::AppendAllText($env:GITHUB_OUTPUT, ($out -join "`n") + "`n", (New-Object Text.UTF8Encoding $false)) }
