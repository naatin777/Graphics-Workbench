$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$rsvgDir = Join-Path $env:RUNNER_TEMP 'rsvg'
New-Item -ItemType Directory -Force -Path $rsvgDir | Out-Null
$rsvgConvert = Join-Path $rsvgDir 'rsvg-convert.exe'

Write-Host 'Downloading rsvg-convert...'
Invoke-WebRequest 'https://github.com/miyako/console-rsvg-convert/releases/download/1.0.windows-msvc-static/rsvg-convert.exe' -OutFile $rsvgConvert

if (-not (Test-Path $rsvgConvert)) { throw "missing $rsvgConvert" }

Write-Host 'Installing Mermaid CLI...'
npm install -g @mermaid-js/mermaid-cli
$mermaid = (Get-Command mmdc -ErrorAction SilentlyContinue)
if (-not $mermaid) {
	throw 'mmdc not found after installing @mermaid-js/mermaid-cli'
}

$chromeCandidates = @(
	(Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe'),
	(Join-Path ${env:ProgramFiles(x86)} 'Google/Chrome/Application/chrome.exe')
)
$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
	throw 'Chrome executable was not found.'
}

$settingsDir = 'vscode/test/support/vscode-settings'
New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null
$settingsPath = Join-Path $settingsDir 'settings.json'
$settings = [ordered]@{
	'graphics-workbench.execPath.rsvgConvert' = $rsvgConvert
	'graphics-workbench.execPath.mermaid' = $mermaid.Source
	'graphics-workbench.execPath.chrome' = $chrome
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
