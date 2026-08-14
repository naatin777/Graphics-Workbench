$ErrorActionPreference = 'Stop'

# Verifies the tools injected as GRAPHICS_WORKBENCH_TEST_* by the workflow.
# The environment variables are the single source of tool paths; this script
# never probes PATH or reads settings files.

Write-Host 'Verifying image conversion tools...'

if (-not $env:GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH) { throw 'GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH is required' }
if (-not $env:GRAPHICS_WORKBENCH_TEST_CHROME_PATH) { throw 'GRAPHICS_WORKBENCH_TEST_CHROME_PATH is required' }

$rsvgConvert = $env:GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH
$chrome = $env:GRAPHICS_WORKBENCH_TEST_CHROME_PATH

if (-not (Test-Path $rsvgConvert)) { throw "missing rsvg-convert: $rsvgConvert" }
if (-not (Test-Path $chrome)) { throw "missing Chrome: $chrome" }

if ($env:INSTALL_DRAWIO -eq '1') {
	if (-not $env:GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH) { throw 'GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH is required' }
	$drawio = $env:GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH
	if (-not (Test-Path $drawio)) { throw "missing Draw.io: $drawio" }
	Write-Host "Draw.io: $drawio"
}

Write-Host "rsvg-convert: $rsvgConvert"
& $rsvgConvert --version | Out-Host

Write-Host "Chrome: $chrome"
$chromeVersion = (Get-Item $chrome).VersionInfo.ProductVersion
Write-Host "Chrome file version: $chromeVersion"

$workDir = Join-Path $env:RUNNER_TEMP "graphics-workbench-tool-smoke-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

try {
	$svgPath = Join-Path $workDir 'sample.svg'
	$pdfPath = Join-Path $workDir 'sample.pdf'

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
} finally {
	Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Image conversion tool smoke test passed.'
