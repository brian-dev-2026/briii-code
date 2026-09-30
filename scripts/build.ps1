<#
.SYNOPSIS
  Builds the Briii Code Windows installer from an official VSCodium release.

.EXAMPLE
  .\scripts\build.ps1                     # latest VSCodium release
  .\scripts\build.ps1 -Version 1.135.06055  # a specific release
#>
[CmdletBinding()]
param(
	[string]$Version = 'latest'
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

function Invoke-Native {
	param([string]$File, [string[]]$Arguments)
	& $File @Arguments
	if ($LASTEXITCODE -ne 0) { throw "$(Split-Path -Leaf $File) failed with exit code $LASTEXITCODE" }
}

function Get-Download($Url, $Dest) {
	if (Test-Path $Dest) { return }
	$tmp = "$Dest.part"
	Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
	Move-Item $tmp $Dest -Force
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
Step "Using VSCodium $Version"

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
Invoke-Native node @((Join-Path $PSScriptRoot 'rebrand.mjs'), $Stage, (Join-Path $Root 'brand\brand.json'), (Join-Path $Root 'defaults'))

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
foreach ($entry in $ids) {
	$id, $extVersion = $entry -split '@', 2
	if (-not $extVersion) { $extVersion = 'latest' }
	$ns, $name = $id -split '\.', 2
	if (-not $name) { throw "Bad extension id '$entry' in extensions.txt (expected publisher.name)" }

	Step "Bundling extension $id@$extVersion"
	try {
		$meta = Invoke-RestMethod "https://open-vsx.org/api/$ns/$name/win32-x64/$extVersion"
	} catch {
		try {
			$meta = Invoke-RestMethod "https://open-vsx.org/api/$ns/$name/$extVersion"
		} catch {
			throw "Extension '$entry' not found on Open VSX (https://open-vsx.org/extension/$ns/$name)"
		}
	}
	$vsixUrl = $meta.files.download
	$vsix = Join-Path $Cache ("extensions\" + [IO.Path]::GetFileName(([uri]$vsixUrl).AbsolutePath))
	Get-Download $vsixUrl $vsix

	$tmp = Join-Path $Cache "extensions\unpack-$ns.$name"
	if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
	New-Item -ItemType Directory $tmp | Out-Null
	Invoke-Native $Tar @('-xf', $vsix, '-C', $tmp)
	$dest = Join-Path $Stage "resources\app\extensions\$($ns.ToLower()).$($name.ToLower())"
	Move-Item (Join-Path $tmp 'extension') $dest
	Remove-Item $tmp -Recurse -Force
}

# --- installer -----------------------------------------------------------------------
Step 'Building installer (this takes a few minutes)'
$outBase = "$($Brand.exeName -replace '\s', '')-Setup-x64-$Version"
$brandIss = Join-Path $Cache 'brand.iss'
@"
#define AppName "$($Brand.nameLong)"
#define AppVersion "$Version"
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
"@ | Set-Content $brandIss -Encoding UTF8

Invoke-Native $Iscc @('/Q', "/DBrandInclude=$brandIss", (Join-Path $Root 'installer\setup.iss'))

$installer = Join-Path $OutDir "$outBase.exe"
$sizeMb = [math]::Round((Get-Item $installer).Length / 1MB)
Write-Host ''
Write-Host "Built $installer ($sizeMb MB)" -ForegroundColor Green
