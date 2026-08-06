$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$popplerVersion = '24.08.0-0'
$popplerZip = Join-Path $env:RUNNER_TEMP 'poppler.zip'
$popplerRoot = Join-Path $env:RUNNER_TEMP 'poppler'

Write-Host 'Downloading Poppler...'
Invoke-WebRequest "https://github.com/oschwartz10612/poppler-windows/releases/download/v$popplerVersion/Release-$popplerVersion.zip" -OutFile $popplerZip
Expand-Archive $popplerZip -DestinationPath $popplerRoot -Force

$pdftocairo = Get-ChildItem -Path $popplerRoot -Recurse -Filter pdftocairo.exe | Select-Object -First 1
if (-not $pdftocairo) {
	throw "pdftocairo.exe not found under $popplerRoot"
}

$rsvgDir = Join-Path $env:RUNNER_TEMP 'rsvg'
New-Item -ItemType Directory -Force -Path $rsvgDir | Out-Null
$rsvgConvert = Join-Path $rsvgDir 'rsvg-convert.exe'

Write-Host 'Downloading rsvg-convert...'
Invoke-WebRequest 'https://github.com/miyako/console-rsvg-convert/releases/download/1.0.windows-msvc-static/rsvg-convert.exe' -OutFile $rsvgConvert

$ghostscriptTag = 'gs10071'
$ghostscriptInstaller = Join-Path $env:RUNNER_TEMP 'ghostscript-installer.exe'
$ghostscriptRoot = Join-Path $env:RUNNER_TEMP 'ghostscript'
$ghostscriptUrl = "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/$ghostscriptTag/gs10071w64.exe"

Write-Host 'Downloading Ghostscript...'
Invoke-WebRequest $ghostscriptUrl -OutFile $ghostscriptInstaller
New-Item -ItemType Directory -Force -Path $ghostscriptRoot | Out-Null

Write-Host 'Extracting Ghostscript...'
& 7z x $ghostscriptInstaller "-o$ghostscriptRoot" -y | Out-Host
if ($LASTEXITCODE -ne 0) {
	throw "7z failed to extract Ghostscript installer with exit code $LASTEXITCODE"
}

$gs = Get-ChildItem -Path $ghostscriptRoot -Recurse -Filter gswin64c.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $gs) {
	throw 'gswin64c.exe not found after Ghostscript extraction'
}

$qpdfVersion = '12.3.2'
$qpdfZip = Join-Path $env:RUNNER_TEMP 'qpdf.zip'
$qpdfRoot = Join-Path $env:RUNNER_TEMP 'qpdf'
$qpdfUrl = "https://github.com/qpdf/qpdf/releases/download/v$qpdfVersion/qpdf-$qpdfVersion-msvc64.zip"
$qpdfSha256 = '8941870a604e7c87ed24566b038d46c24ce76616254d2383c578f60c0677f202'

Write-Host 'Downloading qpdf...'
Invoke-WebRequest $qpdfUrl -OutFile $qpdfZip
$actualSha256 = (Get-FileHash $qpdfZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $qpdfSha256) {
	throw "qpdf SHA-256 mismatch: expected $qpdfSha256, got $actualSha256"
}

New-Item -ItemType Directory -Force -Path $qpdfRoot | Out-Null
Expand-Archive $qpdfZip -DestinationPath $qpdfRoot -Force

$qpdf = Get-ChildItem -Path $qpdfRoot -Recurse -Filter qpdf.exe | Select-Object -First 1
if (-not $qpdf) {
	throw 'qpdf.exe not found after extraction'
}

if (-not (Test-Path $pdftocairo.FullName)) { throw "missing $($pdftocairo.FullName)" }
if (-not (Test-Path $rsvgConvert)) { throw "missing $rsvgConvert" }
if (-not (Test-Path $gs.FullName)) { throw "missing $($gs.FullName)" }
if (-not (Test-Path $qpdf.FullName)) { throw "missing $($qpdf.FullName)" }

$chromeCandidates = @(
	(Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe'),
	(Join-Path ${env:ProgramFiles(x86)} 'Google/Chrome/Application/chrome.exe')
)
$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
	throw 'Chrome executable was not found.'
}

$settingsDir = 'test/vscode-settings'
New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null
$settingsPath = Join-Path $settingsDir 'settings.json'
$settings = [ordered]@{
	'graphics-workbench.execPath.ghostscript' = $gs.FullName
	'graphics-workbench.execPath.pdftocairo' = $pdftocairo.FullName
	'graphics-workbench.execPath.rsvgConvert' = $rsvgConvert
	'graphics-workbench.execPath.qpdf' = $qpdf.FullName
	'graphics-workbench.puppeteer.executablePath' = $chrome
}

# Draw.io CLI is only needed by the packaged Playwright Draw.io -> PDF smoke,
# not by the Extension Host suite (whose Draw.io oracle tests skip without it).
if ($env:INSTALL_DRAWIO -eq '1') {
	$drawioVersion = '31.1.5'
	$drawioInstaller = Join-Path $env:RUNNER_TEMP 'draw.io-installer.exe'
	$drawioUrl = "https://github.com/jgraph/drawio-desktop/releases/download/v$drawioVersion/draw.io-$drawioVersion-windows-installer.exe"

	Write-Host 'Downloading Draw.io installer...'
	Invoke-WebRequest $drawioUrl -OutFile $drawioInstaller
	$process = Start-Process -Wait -FilePath $drawioInstaller -ArgumentList '/S' -PassThru
	if ($process.ExitCode -ne 0) {
		throw "Draw.io installer failed with exit code $($process.ExitCode)"
	}

	$drawio = $null
	foreach ($candidate in @(
		(Join-Path $env:ProgramFiles 'draw.io\draw.io.exe'),
		(Join-Path ${env:ProgramFiles(x86)} 'draw.io\draw.io.exe'),
		(Join-Path $env:LOCALAPPDATA 'Programs\draw.io\draw.io.exe')
	)) {
		if (Test-Path $candidate) { $drawio = Get-Item $candidate; break }
	}
	if (-not $drawio) {
		$drawio = Get-ChildItem -Path $env:ProgramFiles -Recurse -Filter 'draw.io.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
	}
	if (-not $drawio) {
		$drawio = Get-ChildItem -Path $env:LOCALAPPDATA -Recurse -Filter 'draw.io.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
	}
	if (-not $drawio) {
		throw 'draw.io.exe not found after installing Draw.io'
	}
	$settings['graphics-workbench.execPath.drawio'] = $drawio.FullName
}

$settings | ConvertTo-Json | Set-Content $settingsPath -Encoding utf8
Get-Content $settingsPath
