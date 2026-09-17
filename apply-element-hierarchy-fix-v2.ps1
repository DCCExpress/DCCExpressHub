param(
    [string]$Repo = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$file = Join-Path $Repo "web-ui\tests\element-hierarchy.test.mjs"

if (-not (Test-Path -LiteralPath $file)) {
    throw "File not found: $file"
}

$text = [IO.File]::ReadAllText($file)

if ($text.Contains("Date.now = () => 0;")) {
    Write-Host "Fix already applied." -ForegroundColor Yellow
    exit 0
}

$pattern = '(?s)(\s*const \{ ctx, calls \} = recordingCanvas\(\);\s*)(element\.draw\(ctx,\s*\{\s*locos:\s*\[\],\s*showOccupancySensorAddress:\s*true,\s*showSensorAddress:\s*true,\s*showSignalAddress:\s*true,\s*showTurnoutAddress:\s*true,\s*\}\);)'

$replacement = @'
        const { ctx, calls } = recordingCanvas();

        // TrackLevelCrossingElement contains time-based blinking.
        // Freeze the clock so canvas snapshot hashes are deterministic.
        const originalNow = Date.now;

        try {
          Date.now = () => 0;

          element.draw(ctx, {
            locos: [],
            showOccupancySensorAddress: true,
            showSensorAddress: true,
            showSignalAddress: true,
            showTurnoutAddress: true,
          });
        } finally {
          Date.now = originalNow;
        }
'@

$regex = [regex]::new($pattern)

if (-not $regex.IsMatch($text)) {
    throw "Could not locate the canvas baseline draw block."
}

$newText = $regex.Replace($text, $replacement, 1)

[IO.File]::WriteAllText(
    $file,
    $newText,
    [Text.UTF8Encoding]::new($false)
)

Write-Host "Fixed: web-ui\tests\element-hierarchy.test.mjs" -ForegroundColor Green
Write-Host ""
Write-Host "Now run:"
Write-Host "  cd web-ui"
Write-Host "  npm test"
