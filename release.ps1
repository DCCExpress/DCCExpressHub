param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Version,

    [switch]$NoPush
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Args
    )

    & git @Args

    if ($LASTEXITCODE -ne 0) {
        throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Invoke-Npm {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Args
    )

    & npm @Args

    if ($LASTEXITCODE -ne 0) {
        throw "npm $($Args -join ' ') failed with exit code $LASTEXITCODE"
    }
}

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
# Require clean working tree BEFORE modifying VERSION/package metadata
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
# Current branch
# ---------------------------------------------------------------------------

$branch = (& git branch --show-current)

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
    throw "Could not determine current branch. Do not release from detached HEAD."
}

$branch = $branch.Trim()

# ---------------------------------------------------------------------------
# Remote tag must not exist
# ---------------------------------------------------------------------------

$remoteTag = (& git ls-remote --tags origin "refs/tags/$Tag" 2>$null)

if ($LASTEXITCODE -ne 0) {
    throw "Could not query remote tags from origin."
}

if ($remoteTag) {
    throw "Remote tag $Tag already exists."
}

# ---------------------------------------------------------------------------
# Update VERSION
# ---------------------------------------------------------------------------

[System.IO.File]::WriteAllText(
    (Join-Path $RepoRoot "VERSION"),
    "$Version`n",
    (New-Object System.Text.UTF8Encoding($false))
)

Write-Host "VERSION -> $Version" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Synchronize npm metadata
# VERSION remains the single source of truth.
# ---------------------------------------------------------------------------

Invoke-Npm -Args @(
    "version",
    $Version,
    "--prefix",
    "web-ui",
    "--no-git-tag-version",
    "--allow-same-version"
)

Invoke-Git -Args @(
    "add",
    "VERSION",
    "web-ui/package.json"
)

$packageLock = Join-Path $RepoRoot "web-ui\package-lock.json"

if (Test-Path -LiteralPath $packageLock) {
    Invoke-Git -Args @(
        "add",
        "web-ui/package-lock.json"
    )
}

# ---------------------------------------------------------------------------
# Commit version changes only if something actually changed
# ---------------------------------------------------------------------------

& git diff --cached --quiet
$hasStagedChanges = ($LASTEXITCODE -ne 0)

if ($hasStagedChanges) {
    Invoke-Git -Args @(
        "commit",
        "-m",
        "Release $Tag"
    )

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
# Local tag handling
#
# Use 'git tag --list' first. This succeeds even when the tag does not exist,
# avoiding the Windows PowerShell/native-command issue from the previous script.
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
    Invoke-Git -Args @(
        "tag",
        "-a",
        $Tag,
        "-m",
        "DCCExpressHub $Tag"
    )

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
# Push branch, then tag.
# The tag push starts the GitHub Actions release workflow.
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "Pushing branch '$branch'..." -ForegroundColor Cyan

Invoke-Git -Args @(
    "push",
    "origin",
    $branch
)

Write-Host "Pushing tag '$Tag'..." -ForegroundColor Cyan

Invoke-Git -Args @(
    "push",
    "origin",
    $Tag
)

Write-Host ""
Write-Host "Release tag pushed successfully." -ForegroundColor Green
Write-Host "GitHub Actions will build the official DCC-EX firmware release for $Tag." -ForegroundColor Green
