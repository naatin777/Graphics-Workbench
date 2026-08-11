$ErrorActionPreference = 'Stop'

Write-Host 'Verifying image conversion tools...'

$settingsPath = Join-Path 'vscode/test/support/vscode-settings' 'settings.json'
$settings = Get-Content $settingsPath -Raw | ConvertFrom-Json

$rsvgConvert = $settings.'graphics-workbench.execPath.rsvgConvert'
$mermaid = $settings.'graphics-workbench.execPath.mermaid'
$chrome = $settings.'graphics-workbench.execPath.chrome'

if (-not (Test-Path $rsvgConvert)) { throw "missing rsvg-convert: $rsvgConvert" }
if (-not (Test-Path $mermaid)) { throw "missing mmdc from settings.json: $mermaid" }
if (-not (Test-Path $chrome)) { throw "missing Chrome from settings.json: $chrome" }

if ($env:INSTALL_DRAWIO -eq '1') {
	$drawio = $settings.'graphics-workbench.execPath.drawio'
	if (-not (Test-Path $drawio)) { throw "missing Draw.io from settings.json: $drawio" }
	Write-Host "Draw.io: $drawio"
}

Write-Host "rsvg-convert: $rsvgConvert"
& $rsvgConvert --version | Out-Host

Write-Host "Mermaid CLI: $mermaid"
& $mermaid --version | Out-Host

Write-Host "Chrome from settings.json: $chrome"
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
