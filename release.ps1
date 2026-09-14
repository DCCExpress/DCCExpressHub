param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Version,

    [switch]$NoPush
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Locate repository
# ---------------------------------------------------------------------------

$RepoRoot = (& git rev-parse --show-toplevel 2>$null)

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($RepoRoot)) {
    throw "Run this script inside the DCCExpressHub Git repository."
}

$RepoRoot = $RepoRoot.Trim()
Set-Location $RepoRoot

# ---------------------------------------------------------------------------
# Validate version
# ---------------------------------------------------------------------------

$Version = $Version.Trim()

if ($Version.StartsWith("v", [System.StringComparison]::OrdinalIgnoreCase)) {
    $Version = $Version.Substring(1)
}

if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
    throw "Invalid version '$Version'. Example: 0.1.0-alpha.2 or 0.1.0"
}

$Tag = "v$Version"

# ---------------------------------------------------------------------------
# Require a clean working tree
# ---------------------------------------------------------------------------

$status = (& git status --porcelain)

if ($LASTEXITCODE -ne 0) {
    throw "Could not read git status."
}

if ($status) {
    Write-Host ""
    Write-Host "Working tree is not clean:" -ForegroundColor Red

    $status | ForEach-Object {
        Write-Host "  $_" -ForegroundColor Yellow
    }

    throw "Commit or stash current changes before creating a release."
}

# ---------------------------------------------------------------------------
# Determine current branch
# ---------------------------------------------------------------------------

$branch = (& git branch --show-current)

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
    throw "Could not determine current branch. Do not release from detached HEAD."
}

$branch = $branch.Trim()

# ---------------------------------------------------------------------------
# Refuse an already published tag
# ---------------------------------------------------------------------------

$remoteTag = (& git ls-remote --tags origin "refs/tags/$Tag" 2>$null)

if ($LASTEXITCODE -ne 0) {
    throw "Could not query remote tags from origin."
}

if ($remoteTag) {
    throw "Remote tag $Tag already exists."
}

# ---------------------------------------------------------------------------
# Update VERSION (single source of truth)
# ---------------------------------------------------------------------------

[System.IO.File]::WriteAllText(
    (Join-Path $RepoRoot "VERSION"),
    "$Version`n",
    (New-Object System.Text.UTF8Encoding($false))
)

Write-Host "VERSION -> $Version" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Synchronize npm metadata from VERSION
#
# IMPORTANT:
# Use npm.cmd explicitly on Windows and place --prefix BEFORE the subcommand.
# This avoids PowerShell argument forwarding problems.
# ---------------------------------------------------------------------------

$npmCommand = $null

if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
    $npmCommand = "npm.cmd"
} elseif (Get-Command npm -ErrorAction SilentlyContinue) {
    $npmCommand = "npm"
} else {
    throw "npm was not found in PATH."
}

& $npmCommand `
    --prefix web-ui `
    version $Version `
    --no-git-tag-version `
    --allow-same-version

if ($LASTEXITCODE -ne 0) {
    throw "npm version synchronization failed with exit code $LASTEXITCODE"
}

# ---------------------------------------------------------------------------
# Stage only version-related files
# ---------------------------------------------------------------------------

& git add VERSION web-ui/package.json

if ($LASTEXITCODE -ne 0) {
    throw "git add VERSION web-ui/package.json failed."
}

$packageLock = Join-Path $RepoRoot "web-ui\package-lock.json"

if (Test-Path -LiteralPath $packageLock) {
    & git add web-ui/package-lock.json

    if ($LASTEXITCODE -ne 0) {
        throw "git add web-ui/package-lock.json failed."
    }
}

# ---------------------------------------------------------------------------
# Commit version changes if needed
# ---------------------------------------------------------------------------

& git diff --cached --quiet
$hasStagedChanges = ($LASTEXITCODE -ne 0)

if ($hasStagedChanges) {
    & git commit -m "Release $Tag"

    if ($LASTEXITCODE -ne 0) {
        throw "Release commit failed."
    }

    Write-Host "Created release commit: $Tag" -ForegroundColor Green
} else {
    Write-Host "Version files already match $Version; no release commit needed." -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Determine current HEAD
# ---------------------------------------------------------------------------

$currentCommit = (& git rev-parse HEAD)

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentCommit)) {
    throw "Could not determine current HEAD commit."
}

$currentCommit = $currentCommit.Trim()

# ---------------------------------------------------------------------------
# Create/reuse local annotated tag
# ---------------------------------------------------------------------------

$localTagName = (& git tag --list $Tag)

if ($LASTEXITCODE -ne 0) {
    throw "Could not query local tags."
}

if (-not [string]::IsNullOrWhiteSpace($localTagName)) {
    $localTagCommit = (& git rev-list -n 1 $Tag)

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($localTagCommit)) {
        throw "Could not resolve existing local tag $Tag."
    }

    $localTagCommit = $localTagCommit.Trim()

    if ($localTagCommit -ne $currentCommit) {
        throw "Local tag $Tag already exists and points to another commit."
    }

    Write-Host "Local tag $Tag already points to HEAD; reusing it." -ForegroundColor DarkGray
} else {
    & git tag -a $Tag -m "DCCExpressHub $Tag"

    if ($LASTEXITCODE -ne 0) {
        throw "Could not create annotated tag $Tag."
    }

    Write-Host "Created annotated tag: $Tag" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Optional local-only mode
# ---------------------------------------------------------------------------

if ($NoPush) {
    Write-Host ""
    Write-Host "NoPush requested. Nothing was pushed." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "When ready:" -ForegroundColor Cyan
    Write-Host "  git push origin $branch"
    Write-Host "  git push origin $Tag"
    exit 0
}

# ---------------------------------------------------------------------------
# Push branch, then tag
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "Pushing branch '$branch'..." -ForegroundColor Cyan

& git push origin $branch

if ($LASTEXITCODE -ne 0) {
    throw "Could not push branch '$branch'."
}

Write-Host "Pushing tag '$Tag'..." -ForegroundColor Cyan

& git push origin $Tag

if ($LASTEXITCODE -ne 0) {
    throw "Could not push tag '$Tag'."
}

Write-Host ""
Write-Host "Release tag pushed successfully." -ForegroundColor Green
Write-Host "GitHub Actions will build the official DCC-EX firmware release for $Tag." -ForegroundColor Green
