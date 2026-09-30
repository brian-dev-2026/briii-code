<#
.SYNOPSIS
  Smoke-tests a built Briii Code installer: silent install into a temp folder, CLI and
  branding checks, extension installs (Open VSX + .vsix), GUI launch, silent uninstall.
  Uses a throwaway user-data and extensions folder, so your real settings are untouched.

.EXAMPLE
  .\scripts\verify.ps1                       # newest installer in out\
  .\scripts\verify.ps1 -Installer out\BriiiCode-Setup-x64-1.135.06055.exe
#>
[CmdletBinding()]
param(
	[string]$Installer,
	# Skip the in-app smoke tests and screenshots (CI: the hosted runner has no interactive desktop).
	[switch]$NoGui
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
$Brand = Get-Content (Join-Path $Root 'brand\brand.json') -Raw | ConvertFrom-Json
$OnlineExt = 'streetsidesoftware.code-spell-checker'   # must not be in defaults\extensions.txt
$VsixExt = @{ ns = 'EditorConfig'; name = 'EditorConfig' }

if (-not $Installer) {
	$Installer = Get-ChildItem (Join-Path $Root 'out') -Filter '*-Setup-x64-*.exe' |
		Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
	if (-not $Installer) { throw 'No installer in out\ - run scripts\build.ps1 first.' }
}
$Installer = (Resolve-Path $Installer).Path

$uninstallKey = "Software\Microsoft\Windows\CurrentVersion\Uninstall\{$($Brand.ids.win32x64AppId)}_is1"
foreach ($hive in 'HKCU:', 'HKLM:') {
	if (Test-Path "$hive\$uninstallKey") {
		throw "$($Brand.nameLong) is already installed. Uninstall it first - verify.ps1 installs and removes its own copy."
	}
}

$Work = Join-Path $env:TEMP "briii-verify-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$App = Join-Path $Work 'app'
$UserData = Join-Path $Work 'user-data'
$ExtDir = Join-Path $Work 'extensions'
New-Item -ItemType Directory -Force $Work, $UserData, $ExtDir | Out-Null
# Keep the app's updater away from the real release feed and the real update folder.
$env:BRIII_UPDATE_DIR = Join-Path $Work 'updates'
$env:BRIII_UPDATE_FEED = 'http://127.0.0.1:9/latest'

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class BriiiSnap {
	[StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
	[DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
	[DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
	[DllImport("user32.dll")] static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
	[DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
	[DllImport("user32.dll")] static extern bool SetProcessDPIAware();
	public static void Resize(IntPtr h, int w, int ht) { SetProcessDPIAware(); ShowWindow(h, 9); MoveWindow(h, 40, 40, w, ht, true); }
	public static void Save(IntPtr h, string path) {
		SetProcessDPIAware(); // otherwise GetWindowRect is scaled and the capture is cropped
		RECT r; GetWindowRect(h, out r);
		using (var bmp = new Bitmap(r.R - r.L, r.B - r.T)) {
			using (var g = Graphics.FromImage(bmp)) {
				IntPtr hdc = g.GetHdc();
				PrintWindow(h, hdc, 2); // PW_RENDERFULLCONTENT, needed for Chromium windows
				g.ReleaseHdc(hdc);
			}
			bmp.Save(path, ImageFormat.Png);
		}
	}
}
'@

$script:failures = 0
function Check($name, [scriptblock]$test) {
	try {
		$detail = & $test
		Write-Host "  PASS  $name $detail" -ForegroundColor Green
	} catch {
		$script:failures++
		Write-Host "  FAIL  $name - $($_.Exception.Message)" -ForegroundColor Red
	}
}
function Assert($cond, $msg) { if (-not $cond) { throw $msg } }

$exe = Join-Path $App "$($Brand.exeName).exe"
$cli = Join-Path $App "bin\$($Brand.applicationName).cmd"
function Invoke-Cli {
	$ErrorActionPreference = 'Continue'  # stderr from a native command must not throw in PS 5.1
	$out =& $cli --user-data-dir $UserData --extensions-dir $ExtDir @args 2>&1 | Out-String
	if ($LASTEXITCODE -ne 0) { throw "exit $LASTEXITCODE`n$out" }
	return $out
}

Write-Host "Verifying $Installer"
Write-Host "Work folder: $Work"

try {
	Check 'silent install' {
		$p = Start-Process $Installer -Wait -PassThru -ArgumentList @(
			'/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', '/NOSHELL=1',
			"/DIR=`"$App`"", '/TASKS=""'
		)
		Assert ($p.ExitCode -eq 0) "installer exit code $($p.ExitCode)"
		Assert (Test-Path $exe) "missing $exe"
		Assert (Test-Path $cli) "missing $cli"
	}

	Check 'CLI --version' {
		$v = (Invoke-Cli --version).Trim() -split "`r?`n"
		Assert ($Installer -match [regex]::Escape($v[0])) "version '$($v[0])' does not match installer name"
		"($($v[0]))"
	}

	Check 'branding in product.json' {
		$p = Get-Content (Join-Path $App 'resources\app\product.json') -Raw | ConvertFrom-Json
		Assert ($p.nameLong -eq $Brand.nameLong) "nameLong is '$($p.nameLong)'"
		Assert ($p.dataFolderName -eq $Brand.dataFolderName) "dataFolderName is '$($p.dataFolderName)'"
		Assert (-not $p.updateUrl) 'updateUrl still set (auto-update would install stock VSCodium)'
		Assert ($p.extensionsGallery.serviceUrl -like '*open-vsx.org*') 'gallery is not Open VSX'
	}

	Check 'exe metadata' {
		$info = (Get-Item $exe).VersionInfo
		Assert ($info.ProductName -eq $Brand.nameLong) "ProductName is '$($info.ProductName)'"
	}

	Check 'built-in Briii extensions (defaults, themes, deploy, defaults\extensions.txt)' {
		$bundled = Get-Content (Join-Path $Root 'defaults\extensions.txt') |
			ForEach-Object { ($_ -replace '#.*$', '').Trim() } | Where-Object { $_ } |
			ForEach-Object { ($_ -split '@')[0].ToLower() }
		foreach ($ext in @('briii-defaults', 'briii-theme', 'briii-deploy', 'briii-update') + $bundled) {
			Assert (Test-Path (Join-Path $App "resources\app\extensions\$ext\package.json")) "missing $ext"
		}
	}

	Check 'first-launch extensions are not bundled (licences), but listed for briii-update' {
		$ids = Get-Content (Join-Path $Root 'defaults\first-launch-extensions.txt') |
			ForEach-Object { (($_ -replace '#.*$', '').Trim() -split '@')[0].ToLower() } | Where-Object { $_ }
		$ext = Join-Path $App 'resources\app\extensions'
		$bundled = @($ids | Where-Object { Test-Path (Join-Path $ext $_) })
		Assert (-not $bundled) "bundled anyway: $($bundled -join ', ')"
		$listed = Get-Content (Join-Path $ext 'briii-update\first-launch.json') -Raw | ConvertFrom-Json
		Assert ((@($listed) -join ',') -eq ($ids -join ',')) "briii-update lists '$(@($listed) -join ',')'"
		Assert (-not (Test-Path (Join-Path $ext 'briii-update\test'))) 'unit tests were shipped'
		$p = Get-Content (Join-Path $App 'resources\app\product.json') -Raw | ConvertFrom-Json
		Assert ($p.briiiRelease -and $p.briiiUpdateRepo -eq $Brand.updateRepo) "briiiRelease '$($p.briiiRelease)', briiiUpdateRepo '$($p.briiiUpdateRepo)'"
		# Without this, installing them asks "Do you trust the publisher ...?" instead of being silent.
		$publishers = @($ids | ForEach-Object { ($_ -split '\.')[0] } | Sort-Object -Unique)
		$untrusted = @($publishers | Where-Object { @($p.trustedExtensionPublishers) -notcontains $_ })
		Assert (-not $untrusted) "publishers not in trustedExtensionPublishers: $($untrusted -join ', ')"
		"($($ids -join ', '); release $($p.briiiRelease))"
	}

	Check 'stylesheet checksum matches (no "corrupt installation" warning)' {
		$appDir = Join-Path $App 'resources\app'
		$product = Get-Content (Join-Path $appDir 'product.json') -Raw | ConvertFrom-Json
		foreach ($prop in $product.checksums.PSObject.Properties) {
			$file = Join-Path $appDir "out\$($prop.Name)"
			$bytes = [IO.File]::ReadAllBytes($file)
			$sha = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
			$actual = [Convert]::ToBase64String($sha).TrimEnd('=')
			Assert ($actual -eq $prop.Value) "checksum mismatch for $($prop.Name)"
		}
		$css = Get-Content (Join-Path $appDir 'out\vs\workbench\workbench.desktop.main.css') -Raw
		Assert ($css -match 'Briii Code - Apple-style UI') 'apple.css not appended'
	}

	Check 'apple.css only targets classes this VS Code has' {
		# Same test as rebrand.mjs: every class in apple.css selectors must still exist in the
		# stock stylesheet or code, or a VSCodium update has quietly broken part of the look.
		$appDir = Join-Path $App 'resources\app'
		$css = [IO.File]::ReadAllText((Join-Path $appDir 'out\vs\workbench\workbench.desktop.main.css'))
		$js = [IO.File]::ReadAllText((Join-Path $appDir 'out\vs\workbench\workbench.desktop.main.js'))
		$cut = $css.IndexOf('Briii Code - Apple-style UI')
		$cut = $css.LastIndexOf('/*', $cut)
		$stock, $ui = $css.Substring(0, $cut), $css.Substring($cut)
		$selectors = [regex]::Replace([regex]::Replace($ui, '/\*[\s\S]*?\*/', ''), '\{[^{}]*\}', '{}')
		$classes = [regex]::Matches($selectors, '\.[a-zA-Z_-][\w-]*') | ForEach-Object { $_.Value.Substring(1) } | Sort-Object -Unique
		$stale = @($classes | Where-Object { -not $stock.Contains(".$_") -and -not $js.Contains($_) })
		Assert (-not $stale) "not found in this VS Code: $($stale -join ', ')"
		"($(@($classes).Count) classes)"
	}

	Check 'Briii artwork installed (icon, title bar, watermark, exe)' {
		$appDir = Join-Path $App 'resources\app'
		$same = { param($a, $b) (Get-FileHash $a).Hash -eq (Get-FileHash $b).Hash }
		Assert (& $same (Join-Path $appDir 'resources\win32\code.ico') (Join-Path $Root 'brand\icons\app.ico')) 'code.ico is not brand\icons\app.ico'
		Assert (& $same (Join-Path $appDir 'out\media\code-icon.svg') (Join-Path $Root 'brand\icons\app-icon.svg')) 'title-bar icon is not brand\icons\app-icon.svg'
		$mark = Get-Content (Join-Path $appDir 'out\media\letterpress-dark.svg') -Raw
		Assert ($mark -match 'M40 26 V102') 'watermark is not the Briii B'
		# The icon Windows shows for the exe: the new tile is dark ink, the old placeholder was indigo.
		$bmp = [System.Drawing.Icon]::ExtractAssociatedIcon($exe).ToBitmap()
		$bmp.Save((Join-Path $Root 'out\screenshot-exe-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
		$px = $bmp.GetPixel([int]($bmp.Width / 2), 3)
		Assert ($px.R -lt 70 -and $px.G -lt 80 -and $px.B -lt 110 -and $px.A -gt 200) "exe icon top edge is rgb($($px.R),$($px.G),$($px.B)) - still the old icon?"
		"(exe icon -> out\screenshot-exe-icon.png)"
	}

	Check 'no "VSCodium" left in UI strings' {
		$appDir = Join-Path $App 'resources\app'
		$files = @(Join-Path $appDir 'out\nls.messages.json') +
			@(Get-ChildItem (Join-Path $appDir 'extensions') -Filter package.nls.json -Recurse -Depth 1 | ForEach-Object FullName)
		$hits = $files | Where-Object { (Get-Content $_ -Raw) -cmatch '(?<![/\w.-])VSCodium(?![\w/-])' }
		Assert (-not $hits) "still in: $($hits -join ', ')"
	}

	Check "install from Open VSX ($OnlineExt)" {
		Invoke-Cli --install-extension $OnlineExt --force | Out-Null
		$list = Invoke-Cli --list-extensions
		Assert ($list -match [regex]::Escape($OnlineExt)) "not listed: $list"
	}

	Check "install from .vsix ($($VsixExt.ns).$($VsixExt.name))" {
		$meta = Invoke-RestMethod "https://open-vsx.org/api/$($VsixExt.ns)/$($VsixExt.name)/latest"
		$vsix = Join-Path $Work 'test.vsix'
		Invoke-WebRequest $meta.files.download -OutFile $vsix -UseBasicParsing
		Invoke-Cli --install-extension $vsix --force | Out-Null
		$list = Invoke-Cli --list-extensions
		Assert ($list -match "$($VsixExt.ns)\.$($VsixExt.name)") "not listed: $list"
	}

	# When run from a VS Code terminal these leak in and make Electron start as plain Node.
	$leaked = @(Get-ChildItem env: | Where-Object { $_.Name -eq 'ELECTRON_RUN_AS_NODE' -or $_.Name -like 'VSCODE_*' } |
		Select-Object -ExpandProperty Name)
	foreach ($name in $leaked) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }

	if (-not $NoGui) {
	# In-app smoke tests (scripts\smoke): terminals, tasks, debugger, git, TypeScript, Prettier,
	# search, watcher, webviews, Integrated Browser, Claude Code - run inside the installed app.
	$SmokeData = Join-Path $Work 'smoke-data'
	$SmokeWs = Join-Path $Work 'smoke-ws'
	$SmokeOut = Join-Path $Work 'smoke-results.json'
	$smokeRan = $false
	Check 'in-app smoke tests ran' {
		New-Item -ItemType Directory -Force (Join-Path $SmokeData 'User'), $SmokeWs | Out-Null
		$utf8 = New-Object Text.UTF8Encoding $false
		# No theme or formatter here: the smoke tests check the shipped defaults.
		$json = @{
			'security.workspace.trust.enabled' = $false
			'extensions.autoUpdate' = $false
			'extensions.autoCheckUpdates' = $false
		} | ConvertTo-Json
		[IO.File]::WriteAllText((Join-Path $SmokeData 'User\settings.json'), $json, $utf8)
		$fixtures = @{
			'dbg.js' = "const fs = require('fs');`nlet x = 41;`nx++;`nfs.writeFileSync(process.argv[2], String(x));`n"
			'bad.ts' = "const n: number = 'not a number';`nexport { n };`n"
			'fmt.js' = "const a={b:1,c:[1,2,3]}`n"
			'needle.txt' = "briii-needle`n"
		}
		foreach ($f in $fixtures.Keys) { [IO.File]::WriteAllText((Join-Path $SmokeWs $f), $fixtures[$f], $utf8) }
		$ErrorActionPreference = 'Continue'
		git -C $SmokeWs init -q 2>&1 | Out-Null
		git -C $SmokeWs add -A 2>&1 | Out-Null
		git -C $SmokeWs -c user.name=briii -c user.email=smoke@briii.invalid commit -qm init 2>&1 | Out-Null
		$ErrorActionPreference = 'Stop'

		$env:BRIII_SMOKE_OUT = $SmokeOut
		$env:BRIII_SMOKE_EXTS = (Get-Content (Join-Path $Root 'defaults\extensions.txt') |
			ForEach-Object { (($_ -replace '#.*$', '').Trim() -split '@')[0] } | Where-Object { $_ }) -join ','
		$smoke = Join-Path $PSScriptRoot 'smoke'
		$p = Start-Process $exe -PassThru -ArgumentList @(
			"--user-data-dir=`"$SmokeData`"", "--extensions-dir=`"$ExtDir`"",
			"--extensionDevelopmentPath=`"$smoke`"", "--extensionTestsPath=`"$(Join-Path $smoke 'index.js')`"",
			'--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--new-window', "`"$SmokeWs`""
		)
		if (-not $p.WaitForExit(900000)) {
			Get-Process -Name $Brand.exeName -ErrorAction SilentlyContinue |
				Where-Object { $_.Path -like "$App*" } | Stop-Process -Force -ErrorAction SilentlyContinue
			throw 'smoke tests did not finish within 15 minutes'
		}
		Remove-Item env:BRIII_SMOKE_OUT, env:BRIII_SMOKE_EXTS
		Assert (Test-Path $SmokeOut) "no report written (app exit code $($p.ExitCode))"
		$script:smokeRan = $true
		Start-Sleep -Seconds 2
	}
	if ($smokeRan) {
		foreach ($r in (Get-Content $SmokeOut -Raw | ConvertFrom-Json)) {
			Check "app: $($r.name)" {
				Assert $r.ok $r.detail
				if ($r.detail) { "($($r.detail))" }
			}
		}
		Check 'app: no extension activation errors in the log' {
			$log = Get-ChildItem (Join-Path $SmokeData 'logs') -Recurse -Filter 'exthost.log' -ErrorAction SilentlyContinue
			Assert $log 'no exthost.log found'
			$errors = $log | Select-String -Pattern 'Activating extension .* failed|\[error\].*activat' |
				ForEach-Object { $_.Line.Trim() } | Select-Object -Unique -First 5
			Assert (-not $errors) ($errors -join "`n")
		}
	}

	foreach ($theme in 'Briii Dark', 'Briii Light') {
		Check "GUI launches in $theme (screenshot)" {
			$settingsDir = Join-Path $UserData 'User'
			New-Item -ItemType Directory -Force $settingsDir | Out-Null
			$json = @{
				'workbench.colorTheme' = $theme
				'window.autoDetectColorScheme' = $false
				'security.workspace.trust.enabled' = $false
			} | ConvertTo-Json
			[IO.File]::WriteAllText((Join-Path $settingsDir 'settings.json'), $json, (New-Object Text.UTF8Encoding $false))

			# Dark: folder only, so the empty-editor watermark shows. Light: folder plus a file.
			$open = @("`"$Root`"")
			if ($theme -eq 'Briii Light') { $open += "`"$(Join-Path $Root 'scripts\rebrand.mjs')`"" }
			Start-Process $exe -ArgumentList (@(
				"--user-data-dir=`"$UserData`"", "--extensions-dir=`"$ExtDir`"", '--new-window', '--skip-welcome'
			) + $open)
			$proc = $null
			for ($i = 0; $i -lt 60 -and -not $proc; $i++) {
				Start-Sleep -Milliseconds 500
				$proc = Get-Process -Name $Brand.exeName -ErrorAction SilentlyContinue |
					Where-Object { $_.Path -like "$App*" -and $_.MainWindowTitle -like "*$($Brand.nameShort)*" } |
					Select-Object -First 1
			}
			Assert $proc 'no window titled Briii Code within 30s'
			[BriiiSnap]::Resize($proc.MainWindowHandle, 1400, 860)
			Start-Sleep -Seconds 8   # let extensions, theme and fonts settle
			$png = Join-Path $Root ("out\screenshot-" + ($theme -replace '^Briii ', '').ToLower() + '.png')
			[BriiiSnap]::Save($proc.MainWindowHandle, $png)
			if ($theme -eq 'Briii Dark') {
				# 3x close-up of the title-bar logo.
				$shot = [System.Drawing.Image]::FromFile($png)
				$crop = New-Object System.Drawing.Bitmap 1080, 150
				$g = [System.Drawing.Graphics]::FromImage($crop)
				$g.InterpolationMode = 'NearestNeighbor'
				$g.DrawImage($shot, (New-Object System.Drawing.Rectangle 0, 0, 1080, 150), (New-Object System.Drawing.Rectangle 0, 0, 360, 50), 'Pixel')
				$g.Dispose(); $shot.Dispose()
				$crop.Save((Join-Path $Root 'out\screenshot-titlebar.png'), [System.Drawing.Imaging.ImageFormat]::Png)
				$crop.Dispose()
			}
			$title = $proc.MainWindowTitle
			Get-Process -Name $Brand.exeName -ErrorAction SilentlyContinue |
				Where-Object { $_.Path -like "$App*" } | Stop-Process -Force -ErrorAction SilentlyContinue
			Start-Sleep -Seconds 2
			"('$title' -> $png)"
		}
	}
	} # -not $NoGui
} finally {
	Remove-Item env:BRIII_UPDATE_DIR, env:BRIII_UPDATE_FEED -ErrorAction SilentlyContinue
	Get-Process -Name $Brand.exeName -ErrorAction SilentlyContinue |
		Where-Object { $_.Path -like "$App*" } | Stop-Process -Force -ErrorAction SilentlyContinue
	Start-Sleep -Seconds 2

	$uninstaller = Join-Path $App 'unins000.exe'
	if (Test-Path $uninstaller) {
		Check 'silent uninstall' {
			$p = Start-Process $uninstaller -Wait -PassThru -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'
			Assert ($p.ExitCode -eq 0) "uninstaller exit code $($p.ExitCode)"
			# The uninstaller finishes deleting itself from a temp copy; give it a moment.
			for ($i = 0; $i -lt 20 -and (Test-Path $exe); $i++) { Start-Sleep -Milliseconds 500 }
			Assert (-not (Test-Path $exe)) 'app files still present'
			Assert (-not (Test-Path "HKCU:\$uninstallKey")) 'uninstall entry still registered'
		}
	}
	Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
if ($script:failures) {
	Write-Host "$script:failures check(s) failed." -ForegroundColor Red
	exit 1
}
Write-Host 'All checks passed.' -ForegroundColor Green
