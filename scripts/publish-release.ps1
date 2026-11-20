#Requires -Version 5.1
<#
.SYNOPSIS
  Bump Family Bank version, pack a release tarball, and publish a GitHub Release.
  Mirrors Unison's release bump + attach-asset flow for the self-hosted updater.

.EXAMPLE
  pwsh -File scripts/publish-release.ps1
  pwsh -File scripts/publish-release.ps1 -Bump minor
  pwsh -File scripts/publish-release.ps1 -Bump none -SkipPublish
#>
param(
  [ValidateSet('none', 'patch', 'minor', 'major')]
  [string]$Bump = 'patch',
  [switch]$SkipTests,
  [switch]$SkipPublish
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$version = (& node (Join-Path $repoRoot 'scripts\bump-version.mjs') $Bump).Trim()
if (-not $version) { throw 'Version bump failed' }
Write-Host "Version $version"

if (-not $SkipTests) {
  Write-Host 'Running tests...'
  npm test
  if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
}

$artifacts = Join-Path $repoRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
$assetName = "family-bank-$version.tar.gz"
$assetPath = Join-Path $artifacts $assetName

Write-Host "Packing $assetName ..."
if (Test-Path $assetPath) { Remove-Item $assetPath -Force }

$stage = Join-Path $artifacts "stage-family-bank-$version"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$exclude = @('node_modules', 'data', '.git', 'artifacts', '.cursor', '.env')
Get-ChildItem $repoRoot -Force | ForEach-Object {
  if ($exclude -contains $_.Name) { return }
  Copy-Item $_.FullName -Destination (Join-Path $stage $_.Name) -Recurse -Force
}

Push-Location $artifacts
try {
  tar -czf $assetName -C $stage .
} finally {
  Pop-Location
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path $assetPath)) { throw "Failed to create $assetPath" }
Write-Host "Wrote $assetPath"

$tag = "v$version"
Write-Host @"

Next (if not auto-publishing):
  1. Commit the version bump in package.json / package-lock.json
  2. git tag $tag && git push origin main --tags
  3. Attach $assetName to the GitHub Release (or rely on source tarball)

"@

if ($SkipPublish) {
  Write-Host 'SkipPublish set; not creating GitHub Release.'
  return
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host 'gh CLI not found; package ready for manual release upload.'
  return
}

$notes = @"
Family Bank $version

## Install / update
``````bash
sudo GITHUB_OWNER=FreezeAnts GITHUB_REPO=family-bank TAG=$tag bash deploy/update-from-github.sh
``````

Or Parent → Audit & settings → Check for updates, then run the host update script.
"@

gh release create $tag $assetPath `
  --title "Family Bank $version" `
  --notes $notes `
  --latest

if ($LASTEXITCODE -ne 0) { throw 'gh release create failed' }
Write-Host "Published GitHub Release $tag"
