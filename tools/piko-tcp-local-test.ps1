# PIKO SmartControl WLAN TCP diagnostics smoke test (no locomotive operation).
# Start DCCExpressHub, enable the experimental PIKO device on TCP 55566,
# then open Debug > Protocol Monitor > PIKO WLAN before sending this probe.
param(
    [string]$HostAddress = "127.0.0.1",
    [int]$Port = 55566
)
$client = [System.Net.Sockets.TcpClient]::new()
try {
    $client.Connect($HostAddress, $Port)
    Write-Host "PIKO TCP connection established to ${HostAddress}:${Port}"
    # Test only the verified outer STX / ASCII hex / ETX encoding.
    # This is not a valid PIKO operating command or handshake.
    $bytes = [byte[]](0x02, 0x30, 0x30, 0x03)
    $stream = $client.GetStream()
    $stream.Write($bytes, 0, $bytes.Length)
    Write-Host "Sent harmless framed diagnostic 02 30 30 03"
    Write-Host "Look for PIKO WLAN RX 00 in Protocol Monitor."
}
finally {
    $client.Dispose()
}
