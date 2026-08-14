$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Installs the image conversion tools and prints GRAPHICS_WORKBENCH_TEST_*
# lines to stdout for the workflow to inject via $GITHUB_ENV.

$rsvgDir = Join-Path $env:RUNNER_TEMP 'rsvg'
New-Item -ItemType Directory -Force -Path $rsvgDir | Out-Null
$rsvgConvert = Join-Path $rsvgDir 'rsvg-convert.exe'

Write-Host 'Downloading rsvg-convert...'
Invoke-WebRequest 'https://github.com/miyako/console-rsvg-convert/releases/download/1.0.windows-msvc-static/rsvg-convert.exe' -OutFile $rsvgConvert

if (-not (Test-Path $rsvgConvert)) { throw "missing $rsvgConvert" }

$chromeCandidates = @(
	(Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe'),
	(Join-Path ${env:ProgramFiles(x86)} 'Google/Chrome/Application/chrome.exe')
)
$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
	throw 'Chrome executable was not found.'
}

Write-Output "GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH=$rsvgConvert"
Write-Output "GRAPHICS_WORKBENCH_TEST_CHROME_PATH=$chrome"

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
	Write-Output "GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH=$($drawio.FullName)"
}
