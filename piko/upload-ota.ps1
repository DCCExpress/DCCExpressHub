param(
    [string]$HostName = "192.168.4.1",
    [int]$Port = 8080,
    [switch]$NoBuild
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
$projectDir = $PSScriptRoot
$firmware = Join-Path $projectDir ".pio\build\piko-handheld\firmware.bin"

if (-not $NoBuild) {
    Write-Host "[PIKO] Building firmware..." -ForegroundColor Cyan
    & pio run -d $projectDir
    if ($LASTEXITCODE -ne 0) { throw "PlatformIO build failed (exit $LASTEXITCODE)." }
}
if (-not (Test-Path -LiteralPath $firmware -PathType Leaf)) {
    throw "Firmware not found: $firmware"
}

$uri = "http://${HostName}:${Port}/api/update"
Write-Host "[PIKO] Device: $uri"
Write-Host "[PIKO] Firmware: $firmware"
Write-Host "[PIKO] Size: $((Get-Item -LiteralPath $firmware).Length) bytes"
$securePassword = Read-Host "PIKO OTA password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if ([string]::IsNullOrEmpty($password)) { throw "OTA password must not be empty." }

$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromMinutes(5)
$stream = $null
$request = $null
$response = $null
try {
    $stream = [System.IO.File]::OpenRead($firmware)
    $body = New-Object System.Net.Http.StreamContent($stream)
    $body.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("application/octet-stream")
    $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $uri)
    $request.Headers.TryAddWithoutValidation("X-OTA-Key", $password) | Out-Null
    $request.Content = $body
    Write-Host "[PIKO] Uploading over Wi-Fi..." -ForegroundColor Cyan
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    $result = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
        throw "OTA HTTP $([int]$response.StatusCode): $result"
    }
    Write-Host "[PIKO] $result" -ForegroundColor Green
    Write-Host "[PIKO] The handheld should restart with the new firmware."
} finally {
    $password = $null
    if ($response) { $response.Dispose() }
    if ($request) { $request.Dispose() }
    if ($stream) { $stream.Dispose() }
    $client.Dispose()
}
