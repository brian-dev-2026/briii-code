<#
.SYNOPSIS
  Builds the Briii Code Windows installer from an official VSCodium release.

.EXAMPLE
  .\scripts\build.ps1                     # latest VSCodium release
  .\scripts\build.ps1 -Version 1.135.06055  # a specific release
  .\scripts\build.ps1 -CooldownDays 0       # bundle the newest extension versions, however fresh
#>
[CmdletBinding()]
param(
	[string]$Version = 'latest',
	# Release id shown to the updater, e.g. 1.135.06055-20261001.14 (CI). Local builds: <version>-local.
	[string]$Release,
	# Bundle the newest extension release at least this old (lib/extension-cooldown.ps1).
	# Entries pinned as publisher.name@version in extensions.txt are used as written.
	[int]$CooldownDays = 7
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is ~10x faster without the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
$Cache = Join-Path $Root '.cache'
$OutDir = Join-Path $Root 'out'
$Brand = Get-Content (Join-Path $Root 'brand\brand.json') -Raw | ConvertFrom-Json
$Icons = Join-Path $Root 'brand\icons'
$RceditVersion = 'v2.0.0'

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
. (Join-Path $PSScriptRoot 'lib\extension-cooldown.ps1')

function Invoke-Native {
	param([string]$File, [string[]]$Arguments)
	& $File @Arguments
	if ($LASTEXITCODE -ne 0) { throw "$(Split-Path -Leaf $File) failed with exit code $LASTEXITCODE" }
}

# Downloads with Windows' curl.exe, which is much faster than Invoke-WebRequest in PowerShell 5.1.
$Curl = Join-Path $env:SystemRoot 'System32\curl.exe'

function Get-Download($Url, $Dest) {
	if (Test-Path $Dest) { return }
	$tmp = "$Dest.part"
	Invoke-Native $Curl @('-fsSL', '--retry', '3', '-o', $tmp, $Url)
	Move-Item $tmp $Dest -Force
}

# Downloads several files in parallel. $Jobs: @{ url; dest } items; existing files are skipped.
# Returns a hashtable dest -> curl exit code (0 = downloaded). Failed downloads leave no file.
function Get-Downloads($Jobs) {
	$ErrorActionPreference = 'Continue'  # curl's stderr (e.g. a 404) must not throw in PS 5.1
	$status = @{}
	$todo = @($Jobs | Where-Object { -not (Test-Path $_.dest) })
	foreach ($j in $Jobs) { $status[$j.dest] = 0 }
	if (-not $todo) { return $status }
	# In a curl config file a backslash escapes the next character, so use forward slashes.
	$fwd = { param($p) $p -replace '\\', '/' }
	$cfg = Join-Path $Cache 'curl-batch.txt'
	$lines = foreach ($j in $todo) { "url = `"$($j.url)`""; "output = `"$(& $fwd "$($j.dest).part")`"" }
	[IO.File]::WriteAllLines($cfg, [string[]]$lines)
	$byPart = @{}
	foreach ($j in $todo) { $byPart[(& $fwd "$($j.dest).part")] = $j.dest }
	$report = & $Curl --parallel --parallel-max 8 -fsSL --retry 3 -w '%{exitcode}|%{filename_effective}\n' -K $cfg 2>$null
	foreach ($line in $report) {
		$code, $part = $line -split '\|', 2
		$dest = $byPart[$part]
		if (-not $dest) { continue }
		$status[$dest] = [int]$code
		if ([int]$code -eq 0) { Move-Item "$dest.part" $dest -Force }
		elseif (Test-Path "$dest.part") { Remove-Item "$dest.part" -Force }
	}
	foreach ($j in $todo) { if (-not (Test-Path $j.dest) -and $status[$j.dest] -eq 0) { $status[$j.dest] = -1 } }
	return $status
}

function Find-Iscc {
	$candidates = @(
		"$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
		"${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
		"$env:ProgramFiles\Inno Setup 6\ISCC.exe"
	)
	$found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
	if (-not $found) {
		throw 'Inno Setup 6 not found. Install it with: winget install --id JRSoftware.InnoSetup -e --scope user'
	}
	return $found
}

# --- prerequisites -------------------------------------------------------------
Step 'Checking tools'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required (https://nodejs.org).' }
$Tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $Tar)) { throw "tar.exe not found at $Tar (ships with Windows 10 1803+)." }
$Iscc = Find-Iscc
New-Item -ItemType Directory -Force (Join-Path $Cache 'tools'), (Join-Path $Cache 'downloads'), (Join-Path $Cache 'extensions'), $OutDir | Out-Null

$Rcedit = Join-Path $Cache 'tools\rcedit-x64.exe'
Get-Download "https://github.com/electron/rcedit/releases/download/$RceditVersion/rcedit-x64.exe" $Rcedit

if (-not (Test-Path (Join-Path $Icons 'app.ico'))) {
	throw 'brand\icons\app.ico is missing - run "npm install; npm run icons" to generate the icons.'
}

# --- download VSCodium -----------------------------------------------------------
if ($Version -eq 'latest') {
	Step 'Looking up latest VSCodium release'
	$Version = (Invoke-RestMethod 'https://api.github.com/repos/VSCodium/vscodium/releases/latest').tag_name
}
if (-not $Release) { $Release = "$Version-local" }
Step "Using VSCodium $Version (release $Release)"

$zipName = "VSCodium-win32-x64-$Version.zip"
$zip = Join-Path $Cache "downloads\$zipName"
$base = "https://github.com/VSCodium/vscodium/releases/download/$Version"
Get-Download "$base/$zipName" $zip
Get-Download "$base/$zipName.sha256" "$zip.sha256"

$expected = ((Get-Content "$zip.sha256" -Raw).Trim() -split '\s+')[0].ToLower()
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($expected -ne $actual) {
	Remove-Item $zip, "$zip.sha256" -Force
	throw "Checksum mismatch for $zipName (expected $expected, got $actual). The corrupt download was deleted; run again."
}

# --- stage and rebrand -------------------------------------------------------------
$Stage = Join-Path $Cache "stage\$Version"
Step "Extracting to $Stage"
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force $Stage | Out-Null
Invoke-Native $Tar @('-xf', $zip, '-C', $Stage)

Step 'Rebranding'
Invoke-Native node @((Join-Path $PSScriptRoot 'rebrand.mjs'), $Stage, (Join-Path $Root 'brand\brand.json'), (Join-Path $Root 'defaults'), $Release)

$win32Res = Join-Path $Stage 'resources\app\resources\win32'
Copy-Item (Join-Path $Icons 'app.ico') (Join-Path $win32Res 'code.ico') -Force
foreach ($size in '150x150', '70x70') {
	$png = Join-Path $Icons "app_$size.png"
	if (Test-Path $png) { Copy-Item $png (Join-Path $win32Res "code_$size.png") -Force }
}

$exe = Join-Path $Stage "$($Brand.exeName).exe"
$numericVersion = ($Version -split '\.' | Select-Object -First 3) -join '.'
Invoke-Native $Rcedit @(
	$exe,
	'--set-icon', (Join-Path $Icons 'app.ico'),
	'--set-file-version', $numericVersion,
	'--set-product-version', $numericVersion,
	'--set-version-string', 'ProductName', $Brand.nameLong,
	'--set-version-string', 'FileDescription', $Brand.nameLong,
	'--set-version-string', 'CompanyName', $Brand.publisher,
	'--set-version-string', 'InternalName', $Brand.exeName,
	'--set-version-string', 'OriginalFilename', "$($Brand.exeName).exe",
	'--set-version-string', 'LegalCopyright', "$($Brand.publisher). Based on VSCodium (MIT)."
)

# --- bundled extensions ------------------------------------------------------------
$extList = Join-Path $Root 'defaults\extensions.txt'
$ids = @()
if (Test-Path $extList) {
	$ids = Get-Content $extList | ForEach-Object { ($_ -replace '#.*$', '').Trim() } | Where-Object { $_ }
}
$exts = foreach ($entry in $ids) {
	$id, $extVersion = $entry -split '@', 2
	if (-not $extVersion) { $extVersion = 'latest' }
	$ns, $name = $id -split '\.', 2
	if (-not $name) { throw "Bad extension id '$entry' in extensions.txt (expected publisher.name)" }
	@{ entry = $entry; id = $id; ns = $ns; name = $name; version = $extVersion }
}
$dupes = @($exts | Group-Object { $_.id.ToLower() } | Where-Object Count -gt 1 | ForEach-Object Name)
if ($dupes) { throw "Listed more than once in extensions.txt: $($dupes -join ', ')" }

# Look up every extension at once: the Windows x64 build if there is one, else the universal one.
$metaDir = Join-Path $Cache 'extensions\meta'
if (Test-Path $metaDir) { Remove-Item $metaDir -Recurse -Force }   # 'latest' must be looked up fresh
New-Item -ItemType Directory $metaDir | Out-Null
if ($exts) {
	Step "Looking up $(@($exts).Count) extensions on Open VSX"
	$metaJobs = foreach ($e in $exts) {
		$e.metaTarget = Join-Path $metaDir "$($e.id).win32-x64.json"
		$e.metaAny = Join-Path $metaDir "$($e.id).json"
		@{ url = "https://open-vsx.org/api/$($e.ns)/$($e.name)/win32-x64/$($e.version)"; dest = $e.metaTarget }
		@{ url = "https://open-vsx.org/api/$($e.ns)/$($e.name)/$($e.version)"; dest = $e.metaAny }
	}
	$metaStatus = Get-Downloads $metaJobs
	foreach ($e in $exts) {
		$file = @($e.metaTarget, $e.metaAny) | Where-Object { Test-Path $_ } | Select-Object -First 1
		if (-not $file) {
			$codes = "curl exit $($metaStatus[$e.metaTarget])/$($metaStatus[$e.metaAny]); 22 = not found, other codes = network error"
			throw "Extension '$($e.entry)' could not be looked up on Open VSX ($codes). See https://open-vsx.org/extension/$($e.ns)/$($e.name)"
		}
		$e.meta = [IO.File]::ReadAllText($file) | ConvertFrom-Json
	}

	# Cooldown: an unpinned extension whose newest version is fresh or a pre-release gets its
	# newest older release that is settled. Older versions are looked up 8 at a time.
	$cutoff = (Get-Date).ToUniversalTime().AddDays(-$CooldownDays)
	$fresh = @($exts | Where-Object { $_.version -eq 'latest' -and -not (Test-SettledVersion $_.meta $cutoff) })
	if ($CooldownDays -gt 0 -and $fresh) {
		Step "Finding settled versions ($CooldownDays+ days old, no pre-releases) of $($fresh.Count) extension(s)"
		$null = Get-Downloads ($fresh | ForEach-Object {
			$_.versionsFile = Join-Path $metaDir "$($_.id).versions.json"
			@{ url = "https://open-vsx.org/api/$($_.ns)/$($_.name)/versions?size=50"; dest = $_.versionsFile }
		})
		foreach ($e in $fresh) {
			if (-not (Test-Path $e.versionsFile)) { throw "Could not list the versions of $($e.id) on Open VSX. Run again to retry." }
			$e.candidates = Get-VersionCandidates ([IO.File]::ReadAllText($e.versionsFile) | ConvertFrom-Json) $e.meta.version
			$e.picked = $null
		}
		$metaFile = { param($e, $v, $platform) Join-Path $metaDir "$($e.id)@$v$platform.json" }
		for ($skip = 0; ; $skip += 8) {
			$open = @($fresh | Where-Object { -not $_.picked -and $_.candidates.Count -gt $skip })
			if (-not $open) { break }
			$null = Get-Downloads $(foreach ($e in $open) {
				foreach ($v in ($e.candidates | Select-Object -Skip $skip -First 8)) {
					@{ url = "https://open-vsx.org/api/$($e.ns)/$($e.name)/win32-x64/$v"; dest = & $metaFile $e $v '.win32-x64' }
					@{ url = "https://open-vsx.org/api/$($e.ns)/$($e.name)/$v"; dest = & $metaFile $e $v '' }
				}
			})
			foreach ($e in $open) {
				$metas = foreach ($v in ($e.candidates | Select-Object -Skip $skip -First 8)) {
					$f = @((& $metaFile $e $v '.win32-x64'), (& $metaFile $e $v '')) | Where-Object { Test-Path $_ } | Select-Object -First 1
					if ($f) { [IO.File]::ReadAllText($f) | ConvertFrom-Json }
				}
				$e.picked = Select-SettledVersion $metas $cutoff
			}
		}
		foreach ($e in $fresh) {
			if (-not $e.picked) {
				throw "No release of $($e.id) among its newest 50 versions is $CooldownDays+ days old. Pin one in defaults\extensions.txt ($($e.id)@<version>) or build with -CooldownDays 0."
			}
			$why = if ($e.meta.preRelease) { 'a pre-release' } else { "$([int][math]::Floor(((Get-Date).ToUniversalTime() - (ConvertTo-UtcDate $e.meta.timestamp)).TotalDays)) days old" }
			Write-Host "    $($e.id): $($e.meta.version) is $why; bundling $($e.picked.version)"
			$e.meta = $e.picked
		}
	}

	foreach ($e in $exts) {
		$e.url = $e.meta.files.download
		$e.shaUrl = $e.meta.files.sha256
		$e.vsix = Join-Path $Cache ("extensions\" + [IO.Path]::GetFileName(([uri]$e.url).AbsolutePath))
	}

	$missing = @($exts | Where-Object { -not (Test-Path $_.vsix) })
	if ($missing) {
		Step "Downloading $($missing.Count) extension(s): $(($missing | ForEach-Object { $_.id }) -join ', ')"
		$vsixStatus = Get-Downloads ($missing | ForEach-Object { @{ url = $_.url; dest = $_.vsix } })
		$failed = @($missing | Where-Object { -not (Test-Path $_.vsix) } | ForEach-Object { "$($_.id) (curl exit $($vsixStatus[$_.vsix]))" })
		if ($failed) { throw "Download failed: $($failed -join ', '). Run again to retry." }
	}

	# Check every .vsix (cached ones too) against the SHA-256 Open VSX publishes for it.
	$shaJobs = foreach ($e in $exts) {
		$e.shaFile = Join-Path $metaDir "$($e.id).sha256"
		if ($e.shaUrl) { @{ url = $e.shaUrl; dest = $e.shaFile } }
	}
	if ($shaJobs) { $null = Get-Downloads $shaJobs }
	foreach ($e in $exts) {
		if (-not $e.shaUrl) { Write-Warning "Open VSX publishes no SHA-256 for $($e.id); bundled unchecked"; continue }
		if (-not (Test-Path $e.shaFile)) { throw "Could not download the SHA-256 of $($e.id) from Open VSX. Run again to retry." }
		$expected = ([IO.File]::ReadAllText($e.shaFile).Trim() -split '\s+')[0].ToLower()
		$actual = (Get-FileHash $e.vsix -Algorithm SHA256).Hash.ToLower()
		if ($expected -ne $actual) {
			Remove-Item $e.vsix -Force
			throw "Checksum mismatch for $([IO.Path]::GetFileName($e.vsix)) (expected $expected, got $actual). The file was deleted; run again."
		}
	}

	# Old versions pile up (Claude Code alone is >100 MB per release); keep only what this build uses.
	$keep = @($exts | ForEach-Object { $_.vsix })
	Get-ChildItem (Join-Path $Cache 'extensions') -Filter '*.vsix' |
		Where-Object { $keep -notcontains $_.FullName } | Remove-Item -Force
}

foreach ($e in $exts) {
	$ns, $name = $e.ns, $e.name
	$vsix = $e.vsix
	Step "Bundling extension $($e.id) ($([IO.Path]::GetFileNameWithoutExtension($vsix)))"

	$tmp = Join-Path $Cache "extensions\unpack-$ns.$name"
	if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
	New-Item -ItemType Directory $tmp | Out-Null
	Invoke-Native $Tar @('-xf', $vsix, '-C', $tmp)
	$dest = Join-Path $Stage "resources\app\extensions\$($ns.ToLower()).$($name.ToLower())"
	Move-Item (Join-Path $tmp 'extension') $dest
	Remove-Item $tmp -Recurse -Force
}

# Fixes for bundled extensions that look for files VS Code has since moved.
# Todo Tree only registers its commands when it finds ripgrep, and it only knows the old paths.
$extPatches = @(
	@{ file = 'gruntfuggly.todo-tree\dist\extension.js'
	   find = '"node_modules.asar.unpacked/@vscode/ripgrep/bin/"'
	   replace = '"node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/win32-x64/"' }
	# Project Manager opens a "What's New" tab on first launch and has no setting for it.
	# Its "Project Manager: What's New" command still works.
	@{ file = 'alefragnani.project-manager\dist\extension.js'
	   find = 't.showPageInActivation(),'
	   replace = '' }
)
foreach ($p in $extPatches) {
	$path = Join-Path $Stage "resources\app\extensions\$($p.file)"
	if (-not (Test-Path $path)) { continue }
	$text = [IO.File]::ReadAllText($path)
	if ($text.Contains($p.find)) {
		[IO.File]::WriteAllText($path, $text.Replace($p.find, $p.replace), (New-Object Text.UTF8Encoding $false))
	} else {
		Write-Warning "Extension patch no longer matches: $($p.file)"
	}
}

# --- installer -----------------------------------------------------------------------
Step 'Building installer (this takes a few minutes)'
$outBase = "$($Brand.exeName -replace '\s', '')-Setup-x64-$Release"
$brandIss = Join-Path $Cache 'brand.iss'
@"
#define AppName "$($Brand.nameLong)"
#define AppVersion "$Release"
#define AppPublisher "$($Brand.publisher)"
#define AppId "{{$($Brand.ids.win32x64AppId)}"
#define AppMutex "$($Brand.win32MutexName)"
#define AppUserModelId "$($Brand.win32AppUserModelId)"
#define AppCli "$($Brand.applicationName)"
#define ExeName "$($Brand.exeName)"
#define RegName "$($Brand.win32RegValueName)"
#define UrlProtocol "$($Brand.urlProtocol)"
#define IconFile "$(Join-Path $Icons 'app.ico')"
#define SourceDir "$Stage"
#define OutputDir "$OutDir"
#define OutputBaseFilename "$outBase"
#define TopLevelItems "$((Get-ChildItem -LiteralPath $Stage -Force | ForEach-Object Name) -join '|')"
"@ | Set-Content $brandIss -Encoding UTF8

Invoke-Native $Iscc @('/Q', "/DBrandInclude=$brandIss", (Join-Path $Root 'installer\setup.iss'))

$installer = Join-Path $OutDir "$outBase.exe"
$sizeMb = [math]::Round((Get-Item $installer).Length / 1MB)
Write-Host ''
Write-Host "Built $installer ($sizeMb MB, release $Release)" -ForegroundColor Green
