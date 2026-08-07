$ErrorActionPreference = 'Stop'

Write-Host 'Verifying image conversion tools...'

$settingsPath = Join-Path 'test/vscode-settings' 'settings.json'
$settings = Get-Content $settingsPath -Raw | ConvertFrom-Json

$pdftocairo = $settings.'graphics-workbench.execPath.pdftocairo'
$rsvgConvert = $settings.'graphics-workbench.execPath.rsvgConvert'
$chrome = $settings.'graphics-workbench.execPath.chrome'

if (-not (Test-Path $pdftocairo)) { throw "missing pdftocairo: $pdftocairo" }
if (-not (Test-Path $rsvgConvert)) { throw "missing rsvg-convert: $rsvgConvert" }
if (-not (Test-Path $chrome)) { throw "missing Chrome from settings.json: $chrome" }

if ($env:INSTALL_DRAWIO -eq '1') {
	$drawio = $settings.'graphics-workbench.execPath.drawio'
	if (-not (Test-Path $drawio)) { throw "missing Draw.io from settings.json: $drawio" }
	Write-Host "Draw.io: $drawio"
}

Write-Host "pdftocairo: $pdftocairo"
& $pdftocairo -v | Out-Host

Write-Host "rsvg-convert: $rsvgConvert"
& $rsvgConvert --version | Out-Host

Write-Host "Chrome from settings.json: $chrome"
$chromeVersion = (Get-Item $chrome).VersionInfo.ProductVersion
Write-Host "Chrome file version: $chromeVersion"

$workDir = Join-Path $env:RUNNER_TEMP "graphics-workbench-tool-smoke-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

try {
	$svgPath = Join-Path $workDir 'sample.svg'
	$pdfPath = Join-Path $workDir 'sample.pdf'
	$pngPrefix = Join-Path $workDir 'sample'
	$pngPath = Join-Path $workDir 'sample.png'

	@'
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24" viewBox="0 0 32 24">
  <rect width="32" height="24" fill="#285078"/>
  <circle cx="16" cy="12" r="6" fill="#ffffff"/>
</svg>
'@ | Set-Content $svgPath -Encoding utf8

	& $rsvgConvert --format=pdf --output $pdfPath $svgPath
	if ($LASTEXITCODE -ne 0) { throw "rsvg-convert failed with exit code $LASTEXITCODE" }
	if (-not (Test-Path $pdfPath)) { throw "missing generated PDF: $pdfPath" }
	if ((Get-Item $pdfPath).Length -le 0) { throw "generated PDF is empty: $pdfPath" }

	& $pdftocairo -png -singlefile $pdfPath $pngPrefix
	if ($LASTEXITCODE -ne 0) { throw "pdftocairo failed with exit code $LASTEXITCODE" }
	if (-not (Test-Path $pngPath)) { throw "missing generated PNG: $pngPath" }
	if ((Get-Item $pngPath).Length -le 0) { throw "generated PNG is empty: $pngPath" }
} finally {
	Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Image conversion tool smoke test passed.'
