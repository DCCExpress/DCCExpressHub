$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
pio run -t uploadfs
pio run -t upload
pio device monitor
